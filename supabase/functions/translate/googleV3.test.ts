import { generateKeyPairSync, createVerify } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetTokenCache, accessToken, batches, endpointFor, GoogleError, signAssertion, translateV3 } from "./googleV3";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const sa = {
  project_id: "my-proj",
  client_email: "bot@my-proj.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => _resetTokenCache());

describe("signAssertion", () => {
  it("produces an RS256 JWT for the token endpoint that verifies with the public key", async () => {
    const jwt = await signAssertion(sa, 1_700_000_000);
    const [h, c, s] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(c)).toMatchObject({
      iss: sa.client_email, aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/cloud-translation", iat: 1_700_000_000, exp: 1_700_003_600,
    });
    const verify = createVerify("RSA-SHA256");
    verify.update(`${h}.${c}`);
    expect(verify.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("accessToken", () => {
  it("exchanges the assertion once and reuses the token", async () => {
    const f = vi.fn(async () => ok({ access_token: "tok", expires_in: 3600 }));
    expect(await accessToken(sa, f as unknown as typeof fetch)).toBe("tok");
    expect(await accessToken(sa, f as unknown as typeof fetch)).toBe("tok");
    expect(f).toHaveBeenCalledTimes(1);
    const body = (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
  });

  it("explains a rejected service account", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT Signature." }), { status: 400 }));
    await expect(accessToken(sa, f as unknown as typeof fetch)).rejects.toThrow("Invalid JWT Signature.");
  });
});

describe("translateV3", () => {
  it("calls the v3 endpoint with the chosen model and returns texts in order", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("oauth2") ? ok({ access_token: "tok" }) : ok({ translations: [{ translatedText: "가" }, { translatedText: "나" }] }));
    const out = await translateV3(["a", "b"], { sa, model: "llm", source: "en", target: "ko" }, f as unknown as typeof fetch);
    expect(out).toEqual(["가", "나"]);
    const [url, init] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://translation.googleapis.com/v3/projects/my-proj/locations/us-central1:translateText");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({
      contents: ["a", "b"], sourceLanguageCode: "en", targetLanguageCode: "ko", mimeType: "text/plain",
      model: "projects/my-proj/locations/us-central1/models/general/translation-llm",
    });
  });

  it("surfaces Google's error message", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("oauth2") ? ok({ access_token: "tok" })
        : new Response(JSON.stringify({ error: { message: "Cloud Translation API has not been used in project" } }), { status: 403 }));
    const p = translateV3(["a"], { sa, model: "nmt", source: "en", target: "ko" }, f as unknown as typeof fetch);
    await expect(p).rejects.toBeInstanceOf(GoogleError);
    await expect(p).rejects.toThrow("has not been used");
  });
});

describe("endpointFor / batches", () => {
  it("uses global for NMT", () => {
    expect(endpointFor("p", "nmt")).toEqual({
      url: "https://translation.googleapis.com/v3/projects/p/locations/global:translateText",
      model: "projects/p/locations/global/models/general/nmt",
    });
  });

  it("splits by count and by size", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ text: "x".repeat(10), i }));
    expect(batches(items, 2).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(batches(items, 50, 25).map((b) => b.length)).toEqual([2, 2, 1]);
  });
});
