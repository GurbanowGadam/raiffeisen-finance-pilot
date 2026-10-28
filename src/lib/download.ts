/** Browser-only: saves text as a file download. */
export function downloadText(fileName: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** "2026-10-28T12:30:05.123Z" → "2026-10-28 12:30:05 UTC" (stable, locale-independent). */
export function formatTimestamp(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 19)} UTC`;
}
