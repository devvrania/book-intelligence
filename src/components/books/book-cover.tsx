import { cn } from "@/lib/utils";

/**
 * A book cover. Uses the cover rendered from the PDF's first page when
 * available, otherwise an elegant generated cover derived from the title.
 */

const PALETTES = [
  { from: "oklch(0.88 0.045 10)", to: "oklch(0.76 0.075 5)", ink: "oklch(0.32 0.05 5)", rule: "oklch(0.45 0.07 5 / 0.45)" },
  { from: "oklch(0.88 0.035 300)", to: "oklch(0.74 0.065 298)", ink: "oklch(0.3 0.05 300)", rule: "oklch(0.42 0.06 300 / 0.45)" },
  { from: "oklch(0.9 0.03 150)", to: "oklch(0.77 0.05 160)", ink: "oklch(0.3 0.04 160)", rule: "oklch(0.4 0.05 160 / 0.45)" },
  { from: "oklch(0.92 0.04 70)", to: "oklch(0.8 0.07 50)", ink: "oklch(0.33 0.05 45)", rule: "oklch(0.45 0.07 45 / 0.45)" },
  { from: "oklch(0.84 0.045 345)", to: "oklch(0.68 0.075 345)", ink: "oklch(0.98 0.01 345)", rule: "oklch(0.98 0.01 345 / 0.5)" },
  { from: "oklch(0.45 0.05 300)", to: "oklch(0.3 0.035 320)", ink: "oklch(0.95 0.02 60)", rule: "oklch(0.9 0.04 60 / 0.4)" },
] as const;

function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const SIZES = {
  xs: { width: "w-10", title: "text-[5px]", author: "hidden", pad: "p-1" },
  sm: { width: "w-16", title: "text-[8px]", author: "hidden", pad: "p-1.5" },
  md: { width: "w-full", title: "text-[15px] sm:text-base", author: "text-[8.5px]", pad: "p-4" },
  lg: { width: "w-full", title: "text-xl", author: "text-[10px]", pad: "p-6" },
} as const;

export interface BookCoverProps {
  title: string;
  author?: string | null;
  coverUrl?: string | null;
  seed?: string;
  /** Force a palette (0–5) instead of deriving one from the seed. */
  palette?: number;
  size?: keyof typeof SIZES;
  className?: string;
}

export function BookCover({ title, author, coverUrl, seed, palette: paletteIndex, size = "md", className }: BookCoverProps) {
  const palette = PALETTES[(paletteIndex ?? hash(seed ?? title)) % PALETTES.length];
  const s = SIZES[size];

  return (
    <div
      className={cn(
        "relative aspect-[2/3] shrink-0 overflow-hidden rounded-[3px_8px_8px_3px] shadow-book",
        s.width,
        className,
      )}
    >
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by an authenticated route; next/image can't forward cookies
        <img src={coverUrl} alt={`Cover of ${title}`} className="absolute inset-0 size-full object-cover" loading="lazy" />
      ) : (
        <div
          className={cn("absolute inset-0 flex flex-col items-center text-center", s.pad)}
          style={{ background: `linear-gradient(155deg, ${palette.from}, ${palette.to})`, color: palette.ink }}
        >
          {size !== "xs" && size !== "sm" && (
            <div className="pointer-events-none absolute inset-[7%] rounded-[2px] border" style={{ borderColor: palette.rule }} />
          )}
          <div className="flex flex-1 flex-col items-center justify-center gap-[0.6em] px-[6%]">
            <span aria-hidden className="block h-px w-[28%]" style={{ background: palette.rule }} />
            <span className={cn("line-clamp-4 font-display leading-[1.15] font-semibold text-balance", s.title)}>{title}</span>
            <span aria-hidden className="text-[0.55em] opacity-70" style={{ fontSize: "0.6em" }}>
              ✦
            </span>
          </div>
          {author && (
            <span className={cn("mb-[6%] line-clamp-1 font-sans font-medium tracking-[0.18em] uppercase opacity-80", s.author)}>
              {author}
            </span>
          )}
        </div>
      )}
      {/* spine + page-edge lighting */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[6%] bg-gradient-to-r from-black/20 via-black/5 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-[6%] w-px bg-white/30" />
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-black/5 ring-inset" />
    </div>
  );
}
