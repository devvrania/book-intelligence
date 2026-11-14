import { AppHeader } from "@/components/layout/app-header";

/** App shell for the shared library: no accounts, so everyone gets the same header and the same books. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AppHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
