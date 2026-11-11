/** Test-only CSV reader, including quoted CR/LF, commas and doubled quotes. */
export function readCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, ""), rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((c === "\r" || c === "\n") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (quoted) throw Error("Unterminated quoted CSV field");
  row.push(cell); rows.push(row); return rows;
}
