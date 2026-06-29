/** Minimal, dependency-free CSV serializer for usage/feedback exports. */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str: string;
  if (typeof value === "object") {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(escapeCell).join(",");
  const lines = rows.map((row) =>
    columns.map((col) => escapeCell((row as Record<string, unknown>)[col])).join(",")
  );
  return [header, ...lines].join("\r\n");
}
