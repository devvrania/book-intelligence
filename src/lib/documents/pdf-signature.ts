/** Check for the `%PDF-` signature (the spec allows it anywhere in the first 1 KB). */
export function looksLikePdf(data: Uint8Array): boolean {
  const head = Buffer.from(data.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}
