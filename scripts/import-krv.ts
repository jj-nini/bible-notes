// Loads the full 개역한글 (1961) text into Supabase as version "KRV".
//
//   node scripts/import-krv.ts                 # downloads from bolls.life
//   node scripts/import-krv.ts path/KRV.json   # or a file you already downloaded
//
// Source: https://bolls.life/static/translations/KRV.json — an array of
// { book: 1..66, chapter, verse, text }. Books are numbered in canonical order, matching BOOKS.
import { readFileSync } from "node:fs";
import { BOOKS } from "../src/data/books.ts";
import { adminClient, fail, upsert } from "./lib.ts";

const SOURCE = "https://bolls.life/static/translations/KRV.json";

interface Row { book: number; chapter: number; verse: number; text: string }

const file = process.argv[2];
let rows: Row[];
if (file) {
  rows = JSON.parse(readFileSync(file, "utf8"));
} else {
  console.log(`내려받는 중: ${SOURCE}`);
  const res = await fetch(SOURCE);
  if (!res.ok) fail(`내려받기 실패 (${res.status})`);
  rows = await res.json();
}

const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const verses = rows.map((r) => {
  const book = BOOKS[r.book - 1];
  if (!book) fail(`알 수 없는 책 번호: ${r.book}`);
  return { version: "KRV", book: book.id, chapter: r.chapter, verse: r.verse, text: strip(r.text) };
});
const chapters = new Set(verses.map((v) => `${v.book}.${v.chapter}`)).size;
console.log(`개역한글 ${verses.length}절 · ${chapters}장`);
if (verses.length < 31000 || chapters !== 1189) fail("본문이 불완전합니다. 파일을 확인하세요.");

const sb = await adminClient();
await upsert(sb, "versions", [{
  code: "KRV", name: "개역한글", lang: "ko", translatable: false, sort: 0, source: "local",
  copyright: "성경전서 개역한글판 (1961)",
}], "code");
await upsert(sb, "verses", verses, "version,book,chapter,verse");
console.log("done");
