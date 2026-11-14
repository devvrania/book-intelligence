import { Logo } from "@/components/brand/logo";

/** App header: the logo, which also takes you home to the library. */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center px-4 sm:px-6">
        <Logo href="/" />
      </div>
    </header>
  );
}
