// Cloud Translation Basic (v2) with an API key. Web APIs only, so it runs in Deno and in the Node tests.
import { GoogleError } from "./googleV3.ts";

const URL_V2 = "https://translation.googleapis.com/language/translate/v2";

/** Google's error message, short and with the key masked even if it ever shows up in the text. */
export function googleReason(detail: string, key: string) {
  let reason: string;
  try {
    reason = JSON.parse(detail).error?.message ?? detail;
  } catch {
    reason = /<html/i.test(detail) ? (detail.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "HTML error page") : detail;
  }
  return reason.split(key).join("***").slice(0, 300);
}

export async function translateV2(
  texts: string[],
  opts: { key: string; source: string; target: string },
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  // Key in a header, never in the URL: Google error pages echo the URL back
  const res = await fetchFn(URL_V2, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": opts.key },
    body: JSON.stringify({ q: texts, source: opts.source, target: opts.target, format: "text" }),
  });
  const text = await res.text();
  if (!res.ok) throw new GoogleError(res.status, googleReason(text, opts.key));
  const out = JSON.parse(text).data?.translations as { translatedText: string }[] | undefined;
  if (!Array.isArray(out) || out.length !== texts.length) throw new GoogleError(502, "번역 결과 개수가 요청과 다릅니다");
  return out.map((t) => t.translatedText);
}
