/**
 * Apple report TSVs. Rows keep every column: trailing empty fields are real
 * columns, so lines are never trimmed before splitting (doing so caused false
 * "malformed row" errors on sales reports).
 */
export interface Tsv {
  header: string[];
  rows: Record<string, string>[];
  malformed: number;
}

export function parseTsv(text: string): Tsv {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return { header: [], rows: [], malformed: 0 };
  const header = lines[0]!.split("\t").map((h) => h.trim());
  let malformed = 0;
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (cells.length !== header.length) { malformed++; continue; }
    rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i]!.trim()])));
  }
  return { header, rows, malformed };
}

export function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
