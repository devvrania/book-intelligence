/**
 * Small, pure formatting helpers for the library dashboard. The locale is
 * fixed to English (like the rest of the UI copy) so server and client
 * render identical strings.
 */

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 365 * 24 * 3600 },
  { unit: "month", seconds: 30 * 24 * 3600 },
  { unit: "week", seconds: 7 * 24 * 3600 },
  { unit: "day", seconds: 24 * 3600 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
];

/** "just now", "5 minutes ago", "yesterday", "2 days ago", "last month"… */
export function formatRelativeTime(iso: string, now: number): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const magnitude = Math.abs(seconds);
  if (magnitude < 60) return "just now";
  const { unit, seconds: size } = UNITS.find((candidate) => magnitude >= candidate.seconds) ?? UNITS[UNITS.length - 1];
  return relativeTime.format(Math.round(seconds / size), unit);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? singular : plural}`;
}

/** "the-art-of-war.pdf" → "the-art-of-war" */
export function displayFilename(name: string): string {
  return name.replace(/\.pdf$/i, "");
}
