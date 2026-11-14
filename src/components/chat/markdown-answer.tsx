"use client";

import { memo, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import type { SourceDTO } from "@/types/api";

import { CitationChip } from "./citation-chip";

/**
 * Renders model output as Markdown, safely:
 *  - raw HTML is skipped and images are never rendered (a classic prompt-injection
 *    exfiltration channel), links open externally with rel=noopener
 *  - [S1] citation markers become interactive citation chips
 */
const CITE_PREFIX = "#cite-";

function linkifyCitations(text: string) {
  return text.replace(/\[(S\d+)\]/g, (_, label: string) => `[${label}](${CITE_PREFIX}${label})`);
}

export const MarkdownAnswer = memo(function MarkdownAnswer({
  content,
  sources,
  onOpenSource,
  className,
}: {
  content: string;
  sources: SourceDTO[];
  onOpenSource?: (source: SourceDTO) => void;
  className?: string;
}) {
  const components = useMemo<Components>(() => {
    const byLabel = new Map(sources.map((source) => [source.label, source]));
    return {
      a: ({ href, children }) => {
        if (href?.startsWith(CITE_PREFIX)) {
          const label = href.slice(CITE_PREFIX.length);
          return <CitationChip label={label} source={byLabel.get(label)} onOpen={onOpenSource} />;
        }
        if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        );
      },
      img: () => null,
    };
  }, [sources, onOpenSource]);

  return (
    <div className={cn("prose-answer", className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {linkifyCitations(content)}
      </Markdown>
    </div>
  );
});
