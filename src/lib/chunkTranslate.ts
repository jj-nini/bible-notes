/**
 * Translates verses a block at a time so the translator sees the surrounding text
 * (consistent register, names and pronouns), then maps the result back to verses by line.
 *
 * Each block joins up to `maxChars` of consecutive verses with newlines. If the translation does not
 * come back with exactly one line per verse, that block falls back to verse-by-verse translation.
 */
export interface ChunkOptions {
  maxChars?: number;
  /** Called with each block's results as soon as it is done. */
  onBlock?: (results: { index: number; text: string }[]) => void | Promise<void>;
}

export async function translateInChunks(
  texts: string[],
  translate: (s: string) => Promise<string>,
  { maxChars = 2500, onBlock }: ChunkOptions = {},
): Promise<string[]> {
  const out: string[] = new Array(texts.length);
  // Newlines inside a verse would break the line mapping
  const clean = texts.map((t) => t.replace(/\s*\n\s*/g, " ").trim());

  let i = 0;
  while (i < clean.length) {
    let j = i, size = 0;
    while (j < clean.length && (j === i || size + clean[j].length + 1 <= maxChars)) size += clean[j++].length + 1;

    const block = clean.slice(i, j);
    let joined: string[] | null = null;
    if (block.length > 1) {
      const translated = await translate(block.join("\n"));
      const split = translated.split("\n").map((l) => l.trim()).filter(Boolean);
      if (split.length === block.length) joined = split;
    }
    const lines = joined ?? (await Promise.all(block.map((t) => translate(t)))).map((l) => l.trim());

    const results = lines.map((text, k) => ({ index: i + k, text }));
    results.forEach((r) => (out[r.index] = r.text));
    await onBlock?.(results);
    i = j;
  }
  return out;
}
