// API.Bible chapter content (content-type=json) → verse texts.
// Content is nested nodes; text nodes carry attrs.verseId ("PHP.4.6"). Verse-number tags have no verseId and are skipped.
// Paraphrases combine verses ("PHP.4.6-PHP.4.7", as in MSG): the text is stored on the first verse with `end` = last verse.
export interface ApiNode {
  type: string;
  name?: string;
  text?: string;
  attrs?: { verseId?: string; style?: string; [k: string]: unknown };
  items?: ApiNode[];
}

export interface ParsedVerse {
  text: string;
  /** Last verse when this text covers a range, e.g. 7 for 6–7. */
  end?: number;
}

// USFM character styles that are apparatus, not text: cross-references, footnotes, inline quote references
const SKIP_STYLES = new Set(["rq", "x", "xo", "xt", "f", "fr", "ft", "fq", "fqa"]);
// Trailing cross-reference brackets as AMP prints them: "[Ps 37:4]", "[Dan 12:1; Mal 3:16, 17; Rev 3:5; 21:27]".
// Requires chapter:verse inside, so AMP's amplifying brackets ("[delight, take pleasure in Him]") stay.
const TRAILING_REFS = /\s*\[(?:\s*(?:[1-3]\s?)?[A-Z][A-Za-z]*\.?\s+)?\d+:\d+[^\]]*\]\s*$/;

const verseNum = (id: string) => Number(id.split(".")[2]);

export function parseChapter(content: ApiNode[]): Map<number, ParsedVerse> {
  const parts = new Map<number, string[]>();
  const ends = new Map<number, number>();
  let last: number | null = null; // verse that received the latest text
  const walk = (nodes: ApiNode[]) => {
    for (const n of nodes) {
      if (n.attrs?.style && SKIP_STYLES.has(n.attrs.style)) continue;
      // A new paragraph or poetry line: separate it from the previous text of the same verse.
      // Inside a paragraph, pieces are joined as-is (small-caps "L"+"ord", red-letter quotes carry their own spacing).
      if (n.name === "para" && last !== null) parts.get(last)!.push(" ");
      if (n.type === "text" && n.text && n.attrs?.verseId) {
        const [from, to] = n.attrs.verseId.split("-");
        const num = verseNum(from);
        if (Number.isFinite(num)) {
          if (!parts.has(num)) parts.set(num, []);
          parts.get(num)!.push(n.text);
          last = num;
          const end = to ? verseNum(to) : NaN;
          if (Number.isFinite(end) && end > num) ends.set(num, end);
        }
      }
      if (n.items) walk(n.items);
    }
  };
  walk(content);
  return new Map([...parts].sort((a, b) => a[0] - b[0]).map(([n, p]) => {
    let text = p.join("")
      .replace(/¶/g, "")
      .replace(/(?:\s*\*){3,}\s*$/, "") // MSG section break "* * *"
      .replace(/\s+/g, " ")
      .replace(/([“‘(\[]) /g, "$1") // "“ This" → "“This"
      .replace(/ ([,.;:!?’”)\]])/g, "$1") // "Lord ," → "Lord,"
      .trim();
    // A verse can end with several reference brackets in a row
    for (let prev = ""; prev !== text; ) { prev = text; text = text.replace(TRAILING_REFS, "").trim(); }
    return [n, ends.has(n) ? { text, end: ends.get(n) } : { text }];
  }));
}
