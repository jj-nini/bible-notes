export interface Version {
  code: string;
  name: string;
  lang: "ko" | "en";
  /** Whether a Korean machine translation can be shown for this version (MSG, AMP). */
  translatable: boolean;
  /** Notice shown under the text (required for API.Bible versions). */
  copyright?: string | null;
}

export interface VerseRef {
  book: string; // USFM code, e.g. "PHP"
  chapter: number;
  verse: number;
}

export interface Verse extends VerseRef {
  version: string;
  text: string;
  /** Last verse covered when a paraphrase renders several verses as one (MSG 4:6–7 → verse 6, verse_end 7). */
  verse_end?: number | null;
}

export type TranslationStatus = "machine" | "fixed";

export interface Translation extends VerseRef {
  version: string;
  text: string;
  status: TranslationStatus;
  edited: boolean;
  /** Who made it: "google-v2", "google-v3-nmt", "claude-sonnet-5-5", "manual", … One row per engine per verse. */
  engine: string;
}

/** Engines I can ask for a translation. */
export type EngineChoice = "google-v2" | "google-v3" | "claude";
export const ENGINE_CHOICES: { id: EngineChoice; label: string }[] = [
  { id: "google-v2", label: "Google v2" },
  { id: "google-v3", label: "Google v3" },
  { id: "claude", label: "Claude" },
];

/** Which choice a stored engine name belongs to (null for manual / legacy rows). */
export function choiceOf(engine: string): EngineChoice | null {
  if (engine === "google-v2") return "google-v2";
  if (engine.startsWith("google-v3")) return "google-v3";
  if (engine.startsWith("claude")) return "claude";
  return null;
}

export function engineLabel(engine: string) {
  if (engine === "google-v3-llm") return "Google v3 LLM";
  const c = choiceOf(engine);
  if (c) return ENGINE_CHOICES.find((x) => x.id === c)!.label;
  return ({ manual: "직접 입력", legacy: "이전 번역", "chrome-builtin": "Chrome", sample: "샘플" } as Record<string, string>)[engine] ?? engine;
}

export interface Synonym {
  term: string;
  topic: string;
}

export interface TopicHit extends VerseRef {
  score: number;
  /** All topics tagged on this verse, with weights. */
  tags: Record<string, number>;
}

export interface Repo {
  mode: "local" | "supabase";
  listVersions(): Promise<Version[]>;
  getChapter(version: string, book: string, chapter: number): Promise<Verse[]>;
  /** Every version's text for the given refs. */
  getVersesForRefs(refs: VerseRef[]): Promise<Verse[]>;

  getSynonyms(): Promise<Synonym[]>;
  versesByTopics(topics: string[], limit?: number): Promise<TopicHit[]>;
  searchKeyword(q: string, limit?: number): Promise<VerseRef[]>;
  randomTaggedVerse(): Promise<VerseRef | null>;
  logSearchMiss(q: string): Promise<void>;

  getTranslations(version: string, refs: VerseRef[]): Promise<Translation[]>;
  /**
   * Machine-translates refs that have no stored translation yet, stores them as "machine", returns them.
   * `onEach` fires as each verse is done, so long chapters fill in progressively.
   */
  translateMissing(
    version: string, refs: VerseRef[], onEach?: (t: Translation) => void, opts?: { engine?: EngineChoice },
  ): Promise<Translation[]>;
  /** Confirms this engine's translation; any other confirmed one for the verse goes back to "machine". */
  fixTranslation(version: string, ref: VerseRef, engine: string): Promise<void>;
  unfixTranslation(version: string, ref: VerseRef, engine: string): Promise<void>;
  /** Saves my own text as the confirmed translation (engine "manual"). */
  saveTranslationEdit(version: string, ref: VerseRef, text: string): Promise<void>;
}

export const refKey = (r: VerseRef) => `${r.book}.${r.chapter}.${r.verse}`;
export const trKey = (version: string, r: VerseRef) => `${version}|${refKey(r)}`;
export const sameRef = (a: VerseRef, b: VerseRef) =>
  a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;
