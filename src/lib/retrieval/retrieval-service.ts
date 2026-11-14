import { sql, type SQL } from "drizzle-orm";

import type { RetrievalConfig } from "@/lib/config/env";
import { queryRows, toVectorLiteral, type Database } from "@/lib/db/client";
import type { EmbeddingService } from "@/lib/embeddings/embedding-service";
import { logger } from "@/lib/logger";
import type { ChunkMetadata } from "@/types/domain";

import { fuseScores } from "./hybrid";
import type { QueryAnalysis } from "./query-analyzer";

export interface RetrievalFilters {
  chapterIds?: string[];
  /** Inclusive physical page range; a chunk matches if it overlaps it. */
  pageRange?: { from: number; to: number };
  sectionTitle?: string;
}

export interface RetrievedChunk {
  id: string;
  chapterId: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  chapterLabel: string | null;
  sectionTitle: string | null;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number;
  pageEnd: number;
  metadata: ChunkMetadata;
  semanticScore: number;
  keywordScore: number;
  hybridScore: number;
  matchedBy: ("semantic" | "keyword" | "phrase" | "coverage" | "page")[];
}

export interface SearchRequest {
  bookId: string;
  query: string;
  filters?: RetrievalFilters;
  limit?: number;
}

export interface RetrieveRequest extends SearchRequest {
  analysis: QueryAnalysis;
  /** Physical page numbers that must be represented (e.g. a highlighted passage). */
  anchorPages?: { from: number; to: number };
}

export interface RetrievalResult {
  candidates: RetrievedChunk[];
  strategy: "hybrid" | "chapter_focus" | "comparison_by_chapter" | "book_coverage";
  latencyMs: number;
}

type MatchSource = RetrievedChunk["matchedBy"][number];

interface ScoreRow {
  id: string;
  chapter_id: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
  chapter_label: string | null;
  section_title: string | null;
  chunk_index: number;
  content: string;
  token_count: number;
  page_start: number;
  page_end: number;
  metadata: ChunkMetadata;
  semantic_score: number | string | null;
  keyword_score: number | string | null;
}

/** OR-semantics full-text query: rank passages matching more of the question's terms higher. */
const orTsQuery = (query: string) =>
  sql`nullif(replace(plainto_tsquery('english', ${query})::text, ' & ', ' | '), '')::tsquery`;

/**
 * Hybrid retrieval over a single book's chunks.
 *
 * Recall: several cheap id-only queries (vector KNN, full-text, exact phrase,
 * chapter coverage) gather candidates. Scoring: one query computes both the
 * cosine similarity and the ts_rank_cd for every candidate, which are then
 * fused with configurable weights. Results are always scoped to one book.
 */
export class RetrievalService {
  constructor(
    private readonly db: Database,
    private readonly embeddings: EmbeddingService,
    private readonly config: RetrievalConfig,
  ) {}

  isCompatibleWith(storedModel: string | null | undefined) {
    return this.embeddings.isCompatibleWith(storedModel);
  }

  /** Plain hybrid search with metadata filters (also used by "search by meaning"). */
  async search(request: SearchRequest): Promise<RetrievedChunk[]> {
    const embedding = await this.embeddings.embedQuery(request.query);
    const limit = request.limit ?? this.config.candidates;
    const sources = new Map<string, Set<MatchSource>>();
    const add = (ids: string[], source: MatchSource) => {
      for (const id of ids) sources.set(id, (sources.get(id) ?? new Set()).add(source));
    };
    add(await this.semanticIds(request.bookId, embedding, request.filters, limit), "semantic");
    add(await this.keywordIds(request.bookId, request.query, request.filters, limit), "keyword");
    return this.score(request.bookId, request.query, embedding, sources);
  }

  /** Query-aware retrieval for answering a question. */
  async retrieve(request: RetrieveRequest): Promise<RetrievalResult> {
    const started = performance.now();
    const { bookId, query, analysis } = request;
    const limit = request.limit ?? this.config.candidates;
    const embedding = await this.embeddings.embedQuery(query);

    const sources = new Map<string, Set<MatchSource>>();
    const add = (ids: string[], source: MatchSource) => {
      for (const id of ids) sources.set(id, (sources.get(id) ?? new Set()).add(source));
    };

    const baseFilters: RetrievalFilters = { ...request.filters };
    const focusChapters = baseFilters.chapterIds?.length ? baseFilters.chapterIds : analysis.chapterIds;
    let strategy: RetrievalResult["strategy"] = "hybrid";

    if (analysis.type === "comparison" && focusChapters.length >= 2) {
      // Balance evidence across the chapters being compared.
      strategy = "comparison_by_chapter";
      const perChapter = Math.max(4, Math.ceil(limit / focusChapters.length));
      for (const chapterId of focusChapters) {
        const filters = { ...baseFilters, chapterIds: [chapterId] };
        add(await this.semanticIds(bookId, embedding, filters, perChapter), "semantic");
        add(await this.keywordIds(bookId, query, filters, Math.ceil(perChapter / 2)), "keyword");
        add(await this.coverageIds(bookId, [chapterId], 3), "coverage");
      }
    } else if (focusChapters.length > 0) {
      strategy = "chapter_focus";
      const filters = { ...baseFilters, chapterIds: focusChapters };
      add(await this.semanticIds(bookId, embedding, filters, limit), "semantic");
      add(await this.keywordIds(bookId, query, filters, limit), "keyword");
      if (analysis.intents.includes("summarization") || analysis.type === "chapter") {
        // Summaries need the whole arc of the chapter, not just the most similar passages.
        add(await this.coverageIds(bookId, focusChapters, 8), "coverage");
      }
    } else {
      add(await this.semanticIds(bookId, embedding, baseFilters, limit), "semantic");
      add(await this.keywordIds(bookId, query, baseFilters, limit), "keyword");
      if (analysis.mentionedChapterIds.length > 0) {
        add(await this.semanticIds(bookId, embedding, { ...baseFilters, chapterIds: analysis.mentionedChapterIds }, 5), "semantic");
      }
      if ((analysis.type === "broad" || analysis.type === "summarization") && !baseFilters.pageRange) {
        // Book-level questions: one representative passage per chapter, for coverage.
        strategy = "book_coverage";
        add(await this.bestPerChapterIds(bookId, embedding, 24), "coverage");
      }
    }

    for (const phrase of analysis.quotedPhrases.slice(0, 3)) {
      add(await this.phraseIds(bookId, phrase, baseFilters, 5), "phrase");
    }
    if (request.anchorPages) {
      add(await this.pageIds(bookId, request.anchorPages, 4), "page");
    }

    const candidates = await this.score(bookId, query, embedding, sources);
    const latencyMs = Math.round(performance.now() - started);
    logger.info("retrieval.completed", {
      bookId,
      strategy,
      queryType: analysis.type,
      candidates: candidates.length,
      latencyMs,
    });
    return { candidates, strategy, latencyMs };
  }

  /* ------------------------------- Recall ------------------------------- */

  private filterSql(filters: RetrievalFilters | undefined): SQL {
    const parts: SQL[] = [];
    if (filters?.chapterIds?.length) {
      parts.push(sql`and c.chapter_id in (${sql.join(filters.chapterIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    }
    if (filters?.pageRange) {
      parts.push(sql`and c.page_end >= ${filters.pageRange.from} and c.page_start <= ${filters.pageRange.to}`);
    }
    if (filters?.sectionTitle) parts.push(sql`and c.section_title = ${filters.sectionTitle}`);
    return sql.join(parts, sql` `);
  }

  private async semanticIds(bookId: string, embedding: number[], filters: RetrievalFilters | undefined, limit: number) {
    const vector = toVectorLiteral(embedding);
    const query = sql`
      select c.id from document_chunks c
      where c.book_id = ${bookId} and c.embedding is not null ${this.filterSql(filters)}
      order by c.embedding <=> ${vector}::vector
      limit ${limit}
    `;
    if (!this.config.iterativeScan) {
      return (await queryRows<{ id: string }>(this.db, query)).map((row) => row.id);
    }
    // With a book filter, a plain HNSW scan can return fewer than `limit` rows
    // (it filters after the index scan). pgvector ≥ 0.8 iterative scans fix that.
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
      return (await queryRows<{ id: string }>(tx, query)).map((row) => row.id);
    });
  }

  private async keywordIds(bookId: string, text: string, filters: RetrievalFilters | undefined, limit: number) {
    const rows = await queryRows<{ id: string }>(
      this.db,
      sql`
        select c.id from document_chunks c
        where c.book_id = ${bookId} and c.search_vector @@ ${orTsQuery(text)} ${this.filterSql(filters)}
        order by ts_rank_cd(c.search_vector, ${orTsQuery(text)}, 32) desc
        limit ${limit}
      `,
    );
    return rows.map((row) => row.id);
  }

  private async phraseIds(bookId: string, phrase: string, filters: RetrievalFilters | undefined, limit: number) {
    const rows = await queryRows<{ id: string }>(
      this.db,
      sql`
        select c.id from document_chunks c
        where c.book_id = ${bookId} and c.search_vector @@ phraseto_tsquery('english', ${phrase}) ${this.filterSql(filters)}
        order by c.chunk_index
        limit ${limit}
      `,
    );
    return rows.map((row) => row.id);
  }

  /** Evenly spaced chunks across the given chapters (narrative coverage for summaries). */
  private async coverageIds(bookId: string, chapterIds: string[], perChapter: number) {
    const rows = await queryRows<{ id: string }>(
      this.db,
      sql`
        with ranked as (
          select c.id, c.chapter_id,
                 row_number() over (partition by c.chapter_id order by c.chunk_index) as rn,
                 count(*) over (partition by c.chapter_id) as total
          from document_chunks c
          where c.book_id = ${bookId}
            and c.chapter_id in (${sql.join(chapterIds.map((id) => sql`${id}::uuid`), sql`, `)})
        )
        select id from ranked
        where (rn - 1) % greatest(1, ceil(total::numeric / ${perChapter})::int) = 0
      `,
    );
    return rows.map((row) => row.id);
  }

  /** The most query-similar chunk of each chapter (exact scan within one book). */
  private async bestPerChapterIds(bookId: string, embedding: number[], maxChapters: number) {
    const vector = toVectorLiteral(embedding);
    const rows = await queryRows<{ id: string }>(
      this.db,
      sql`
        select id from (
          select distinct on (c.chapter_id) c.id, c.embedding <=> ${vector}::vector as distance
          from document_chunks c
          where c.book_id = ${bookId} and c.chapter_id is not null and c.embedding is not null
          order by c.chapter_id, c.embedding <=> ${vector}::vector
        ) best
        order by distance
        limit ${maxChapters}
      `,
    );
    return rows.map((row) => row.id);
  }

  private async pageIds(bookId: string, range: { from: number; to: number }, limit: number) {
    const rows = await queryRows<{ id: string }>(
      this.db,
      sql`
        select c.id from document_chunks c
        where c.book_id = ${bookId} and c.page_end >= ${range.from} and c.page_start <= ${range.to}
        order by c.chunk_index
        limit ${limit}
      `,
    );
    return rows.map((row) => row.id);
  }

  /* ------------------------------- Scoring ------------------------------ */

  private async score(
    bookId: string,
    query: string,
    embedding: number[],
    sources: Map<string, Set<MatchSource>>,
  ): Promise<RetrievedChunk[]> {
    if (sources.size === 0) return [];
    const vector = toVectorLiteral(embedding);
    const ids = [...sources.keys()];
    const rows = await queryRows<ScoreRow>(
      this.db,
      sql`
        select c.id, c.chapter_id, ch.chapter_number, ch.title as chapter_title, ch.label as chapter_label,
               c.section_title, c.chunk_index, c.content, c.token_count, c.page_start, c.page_end, c.metadata,
               case when c.embedding is null then 0 else 1 - (c.embedding <=> ${vector}::vector) end as semantic_score,
               coalesce(ts_rank_cd(c.search_vector, ${orTsQuery(query)}, 32), 0) as keyword_score
        from document_chunks c
        left join chapters ch on ch.id = c.chapter_id
        where c.book_id = ${bookId} and c.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      `,
    );

    const fused = fuseScores(
      rows.map((row) => ({
        id: row.id,
        chapterId: row.chapter_id,
        chapterNumber: row.chapter_number,
        chapterTitle: row.chapter_title,
        chapterLabel: row.chapter_label,
        sectionTitle: row.section_title,
        chunkIndex: row.chunk_index,
        content: row.content,
        tokenCount: row.token_count,
        pageStart: row.page_start,
        pageEnd: row.page_end,
        metadata: row.metadata ?? {},
        semanticScore: Number(row.semantic_score ?? 0),
        keywordScore: Number(row.keyword_score ?? 0),
        matchedBy: [...(sources.get(row.id) ?? [])],
      })),
      { semantic: this.config.semanticWeight, keyword: this.config.keywordWeight },
    );
    return fused;
  }
}
