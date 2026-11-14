import { describe, expect, it } from "vitest";

import { analyzeQuery, topKForQuery, type ChapterLike } from "@/lib/retrieval/query-analyzer";

const chapters: ChapterLike[] = [
  { id: "c-pref", chapterNumber: 1, title: "Preface", label: null, labelNumber: null },
  { id: "c1", chapterNumber: 2, title: "Laying Plans", label: "Chapter I", labelNumber: 1 },
  { id: "c2", chapterNumber: 3, title: "Waging War", label: "Chapter II", labelNumber: 2 },
  { id: "c3", chapterNumber: 4, title: "Attack by Stratagem", label: "Chapter III", labelNumber: 3 },
  { id: "c7", chapterNumber: 8, title: "Manoeuvring", label: "Chapter VII", labelNumber: 7 },
  { id: "c13", chapterNumber: 14, title: "The Use of Spies", label: "Chapter XIII", labelNumber: 13 },
];

describe("query analysis", () => {
  it("classifies question types", () => {
    expect(analyzeQuery("Summarize chapter 3.", chapters).type).toBe("summarization");
    expect(analyzeQuery("Compare the ideas in chapters 2 and 7.", chapters).type).toBe("comparison");
    expect(analyzeQuery("What are the major themes?", chapters).type).toBe("theme");
    expect(analyzeQuery("What is this book mainly about?", chapters).type).toBe("broad");
    expect(analyzeQuery("Who is the protagonist?", chapters).type).toBe("character");
    expect(analyzeQuery("Why does the general avoid sieges?", chapters).type).toBe("conceptual");
    expect(analyzeQuery("When was the treaty signed?", chapters).type).toBe("factual");
  });

  it("resolves chapter references using the book's own numbering", () => {
    // "chapter 3" means the book's Chapter III, not the 3rd entry (the preface shifts positions).
    expect(analyzeQuery("Summarize chapter 3.", chapters).chapterIds).toEqual(["c3"]);
    expect(analyzeQuery("Compare the ideas in chapters 2 and 7.", chapters).chapterIds).toEqual(["c2", "c7"]);
    expect(analyzeQuery("What happens in chapter III?", chapters).chapterIds).toEqual(["c3"]);
    expect(analyzeQuery("Explain chapter one", chapters).chapterIds).toEqual(["c1"]);
    expect(analyzeQuery("Summarize chapters 1-3", chapters).chapterIds).toEqual(["c1", "c2", "c3"]);
    expect(analyzeQuery("What happens in the last chapter?", chapters).chapterIds).toEqual(["c13"]);
  });

  it("treats a mentioned chapter title as a soft signal, not a filter", () => {
    const analysis = analyzeQuery("What does the author say in The Use of Spies about double agents?", chapters);
    expect(analysis.chapterIds).toEqual([]);
    expect(analysis.mentionedChapterIds).toEqual(["c13"]);
  });

  it("extracts page references and quoted phrases", () => {
    const analysis = analyzeQuery('Where does it say "all warfare is based on deception" — maybe page 12?', chapters);
    expect(analysis.type).toBe("quote");
    expect(analysis.quotedPhrases).toEqual(["all warfare is based on deception"]);
    expect(analysis.pageNumbers).toEqual([12]);
  });

  it("flags likely follow-up questions", () => {
    expect(analyzeQuery("Why did she do that?").looksLikeFollowUp).toBe(true);
    expect(analyzeQuery("And the second one?").looksLikeFollowUp).toBe(true);
    expect(analyzeQuery("What does Sun Tzu say about the use of terrain in warfare?").looksLikeFollowUp).toBe(false);
  });

  it("sends more passages for broad questions than for pinpoint ones", () => {
    expect(topKForQuery(analyzeQuery("What is this book mainly about?"), 7)).toBeGreaterThan(7);
    expect(topKForQuery(analyzeQuery('Find the quote "know your enemy"'), 7)).toBeLessThan(7);
  });
});
