// Chrome's built-in Translator API (on-device, no key). Desktop Chrome 138+.
// https://developer.chrome.com/docs/ai/translator-api

interface TranslatorInstance {
  translate(text: string): Promise<string>;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(o: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<TranslatorInstance>;
}

export class TranslatorUnavailableError extends Error {
  constructor(message = "이 브라우저에서는 내장 번역을 쓸 수 없습니다 (PC용 Chrome 138 이상). 저장된 번역만 보이고, 없는 절은 직접 입력할 수 있습니다.") {
    super(message);
  }
}

const api = () => (globalThis as { Translator?: TranslatorStatic }).Translator;
const pending = new Map<string, Promise<TranslatorInstance>>();

/**
 * Starts creating the translator. Call it directly inside a click handler: the first use downloads
 * the language model, which Chrome only allows with a user gesture.
 */
export function prepareTranslator(source = "en", target = "ko", onProgress?: (fraction: number) => void) {
  const key = `${source}>${target}`;
  if (!pending.has(key)) {
    const T = api();
    const p = (async () => {
      if (!T) throw new TranslatorUnavailableError();
      const status = await T.availability({ sourceLanguage: source, targetLanguage: target });
      if (status === "unavailable") throw new TranslatorUnavailableError("이 기기에서는 영어→한국어 내장 번역을 쓸 수 없습니다.");
      return T.create({
        sourceLanguage: source,
        targetLanguage: target,
        monitor: (m) => m.addEventListener("downloadprogress", (e) => onProgress?.((e as ProgressEvent).loaded)),
      });
    })();
    // A failed attempt (e.g. no user gesture yet) may succeed later
    p.catch(() => pending.delete(key));
    pending.set(key, p);
  }
  return pending.get(key)!;
}

export const hasBuiltInTranslator = () => !!api();
