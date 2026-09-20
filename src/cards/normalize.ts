export function normalizeCardName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function splitFaces(name: string): string[] {
  return name
    .split(/\s*\/\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}
