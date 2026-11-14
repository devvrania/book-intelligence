import type { Metadata } from "next";
import { connection } from "next/server";

import { LibraryView } from "@/components/library/library-view";
import { getServices } from "@/server/container";

const TAGLINE = "Understand your books. Don’t just read them.";
const DESCRIPTION =
  "An open, AI-powered library. Open a book or add a PDF, ask anything, and every answer cites the exact chapter and page.";

export const metadata: Metadata = {
  title: { absolute: `Book Intelligence — ${TAGLINE}` },
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "Book Intelligence", title: TAGLINE, description: DESCRIPTION },
  twitter: { card: "summary", title: TAGLINE, description: DESCRIPTION },
};

/** The home page is the library itself: visitors land on the books, with a short intro above them. */
export default async function HomePage() {
  // Render per request: the library changes whenever anyone uploads (otherwise Next would prerender it at build time)
  await connection();
  const services = getServices();
  const initial = await services.books.list({ sort: "recent", limit: 60 });

  return <LibraryView initialData={initial} maxUploadMb={services.env.MAX_UPLOAD_MB} />;
}
