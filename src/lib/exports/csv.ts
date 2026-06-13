function cell(value: unknown) {
  let text = String(value ?? "");
  const formula = /^[=+\-@]/.test(text);
  if (formula) text = `'${text}`;
  return formula || /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function toCsv(rows: unknown[][]) {
  return `${rows.map((row) => row.map(cell).join(",")).join("\n")}\n`;
}
