/**
 * Hybrid score fusion.
 *
 * finalScore = semanticWeight × semanticNorm + keywordWeight × keywordNorm
 *
 * Raw cosine similarity and ts_rank_cd live on different scales, so each is
 * normalized against the best score in the candidate set (with 0 as the
 * theoretical minimum) before the weighted sum — the "TM2C2" convex
 * combination, which tends to beat rank-based fusion when scores are
 * meaningful. Weights are configurable (default 0.7 / 0.3).
 */

export interface ScoredCandidate {
  semanticScore: number;
  keywordScore: number;
}

export interface FusionWeights {
  semantic: number;
  keyword: number;
}

export function fuseScores<T extends ScoredCandidate>(
  candidates: T[],
  weights: FusionWeights,
): (T & { hybridScore: number })[] {
  const total = weights.semantic + weights.keyword || 1;
  const semanticWeight = weights.semantic / total;
  const keywordWeight = weights.keyword / total;

  const maxSemantic = Math.max(0, ...candidates.map((c) => c.semanticScore));
  const maxKeyword = Math.max(0, ...candidates.map((c) => c.keywordScore));

  return candidates
    .map((candidate) => {
      const semanticNorm = maxSemantic > 0 ? Math.max(0, candidate.semanticScore) / maxSemantic : 0;
      const keywordNorm = maxKeyword > 0 ? Math.max(0, candidate.keywordScore) / maxKeyword : 0;
      return { ...candidate, hybridScore: semanticWeight * semanticNorm + keywordWeight * keywordNorm };
    })
    .sort((a, b) => b.hybridScore - a.hybridScore);
}
