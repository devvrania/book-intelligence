import Link from "next/link";

import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <defs>
        <linearGradient id="bi-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.66 0.1 6)" />
          <stop offset="100%" stopColor="oklch(0.6 0.08 300)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#bi-mark)" />
      {/* open book */}
      <path
        d="M8 10.5c2.6-.9 5.2-.6 8 1.1v10.3c-2.8-1.6-5.4-1.9-8-1V10.5Z"
        fill="white"
        fillOpacity="0.95"
      />
      <path
        d="M24 10.5c-2.6-.9-5.2-.6-8 1.1v10.3c2.8-1.6 5.4-1.9 8-1V10.5Z"
        fill="white"
        fillOpacity="0.78"
      />
      {/* spark */}
      <path
        d="M22.6 5.2l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55.55-1.45Z"
        fill="white"
      />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("group inline-flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
    >
      <LogoMark className="size-7 transition-transform duration-300 group-hover:-rotate-6" />
      <span className="font-display text-[1.15rem] font-semibold tracking-tight text-foreground">
        Book <span className="text-primary">Intelligence</span>
      </span>
    </Link>
  );
}
