// Cloud Translation Advanced (v3) with a service account. Web APIs only (fetch, WebCrypto),
// so it runs in the Edge Function (Deno) and in the Node test suite.
//
// v3 does not take API keys: we sign a JWT with the service account's private key and
// exchange it for an OAuth access token, which is cached until shortly before it expires.

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string; // PEM, PKCS#8
}

export type V3Model = "nmt" | "llm";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-translation";

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importKey(pem: string) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** Signed JWT assertion for the OAuth token exchange. */
export async function signAssertion(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const key = await importKey(sa.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

let cached: { email: string; token: string; expires: number } | null = null;

export async function accessToken(sa: ServiceAccount, fetchFn: typeof fetch = fetch): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await signAssertion(sa) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`서비스 계정 인증 실패 (${res.status}): ${body.error_description ?? body.error ?? "알 수 없는 오류"}`);
  }
  cached = { email: sa.client_email, token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Translation LLM is served from us-central1; the general NMT model from global. */
export function endpointFor(projectId: string, model: V3Model) {
  const location = model === "llm" ? "us-central1" : "global";
  const modelPath = `projects/${projectId}/locations/${location}/models/${model === "llm" ? "general/translation-llm" : "general/nmt"}`;
  return { url: `https://translation.googleapis.com/v3/projects/${projectId}/locations/${location}:translateText`, model: modelPath };
}

export class GoogleError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function translateV3(
  texts: string[],
  opts: { sa: ServiceAccount; model: V3Model; source: string; target: string },
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  const token = await accessToken(opts.sa, fetchFn);
  const { url, model } = endpointFor(opts.sa.project_id, opts.model);
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents: texts, sourceLanguageCode: opts.source, targetLanguageCode: opts.target, mimeType: "text/plain", model,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let reason = text;
    try { reason = JSON.parse(text).error?.message ?? text; } catch { /* not JSON */ }
    throw new GoogleError(res.status, reason.slice(0, 300));
  }
  const out = JSON.parse(text).translations as { translatedText: string }[];
  if (!Array.isArray(out) || out.length !== texts.length) throw new GoogleError(502, "번역 결과 개수가 요청과 다릅니다");
  return out.map((t) => t.translatedText);
}

/** Batches by count and size; v3 recommends staying well under 30k characters per request. */
export function batches<T extends { text: string }>(items: T[], maxItems = 50, maxChars = 20_000): T[][] {
  const out: T[][] = [];
  let cur: T[] = [], size = 0;
  for (const it of items) {
    if (cur.length && (cur.length >= maxItems || size + it.text.length > maxChars)) { out.push(cur); cur = []; size = 0; }
    cur.push(it);
    size += it.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function _resetTokenCache() {
  cached = null;
}
