export type CsvCell = { type: "text" | "decimal"; value: string };
export const csvText = (value: string): CsvCell => ({ type: "text", value });
export const csvDecimal = (value: string): CsvCell => ({ type: "decimal", value });

export function escapeCsvCell(cell: CsvCell): string {
  let value = cell.value;
  if (cell.type === "decimal") {
    // Explicit numeric columns only: no coercion/rounding and no formula expressions.
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) throw new Error("CSV decimal must be an exact numeric string.");
  } else if (/^[\s\p{Cc}\p{Cf}]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value)) {
    value = "'" + value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}
export const serializeCsv = (rows: readonly (readonly CsvCell[])[]): string => rows.map(row => row.map(escapeCsvCell).join(",")).join("\r\n");
