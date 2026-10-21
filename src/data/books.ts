export interface Book {
  id: string; // USFM code
  ko: string;
  chapters: number;
  testament: "OT" | "NT";
}

const OT: [string, string, number][] = [
  ["GEN", "창세기", 50], ["EXO", "출애굽기", 40], ["LEV", "레위기", 27], ["NUM", "민수기", 36],
  ["DEU", "신명기", 34], ["JOS", "여호수아", 24], ["JDG", "사사기", 21], ["RUT", "룻기", 4],
  ["1SA", "사무엘상", 31], ["2SA", "사무엘하", 24], ["1KI", "열왕기상", 22], ["2KI", "열왕기하", 25],
  ["1CH", "역대상", 29], ["2CH", "역대하", 36], ["EZR", "에스라", 10], ["NEH", "느헤미야", 13],
  ["EST", "에스더", 10], ["JOB", "욥기", 42], ["PSA", "시편", 150], ["PRO", "잠언", 31],
  ["ECC", "전도서", 12], ["SNG", "아가", 8], ["ISA", "이사야", 66], ["JER", "예레미야", 52],
  ["LAM", "예레미야애가", 5], ["EZK", "에스겔", 48], ["DAN", "다니엘", 12], ["HOS", "호세아", 14],
  ["JOL", "요엘", 3], ["AMO", "아모스", 9], ["OBA", "오바댜", 1], ["JON", "요나", 4],
  ["MIC", "미가", 7], ["NAM", "나훔", 3], ["HAB", "하박국", 3], ["ZEP", "스바냐", 3],
  ["HAG", "학개", 2], ["ZEC", "스가랴", 14], ["MAL", "말라기", 4],
];
const NT: [string, string, number][] = [
  ["MAT", "마태복음", 28], ["MRK", "마가복음", 16], ["LUK", "누가복음", 24], ["JHN", "요한복음", 21],
  ["ACT", "사도행전", 28], ["ROM", "로마서", 16], ["1CO", "고린도전서", 16], ["2CO", "고린도후서", 13],
  ["GAL", "갈라디아서", 6], ["EPH", "에베소서", 6], ["PHP", "빌립보서", 4], ["COL", "골로새서", 4],
  ["1TH", "데살로니가전서", 5], ["2TH", "데살로니가후서", 3], ["1TI", "디모데전서", 6], ["2TI", "디모데후서", 4],
  ["TIT", "디도서", 3], ["PHM", "빌레몬서", 1], ["HEB", "히브리서", 13], ["JAS", "야고보서", 5],
  ["1PE", "베드로전서", 5], ["2PE", "베드로후서", 3], ["1JN", "요한일서", 5], ["2JN", "요한이서", 1],
  ["3JN", "요한삼서", 1], ["JUD", "유다서", 1], ["REV", "요한계시록", 22],
];

export const BOOKS: Book[] = [
  ...OT.map(([id, ko, chapters]) => ({ id, ko, chapters, testament: "OT" as const })),
  ...NT.map(([id, ko, chapters]) => ({ id, ko, chapters, testament: "NT" as const })),
];

const byId = new Map(BOOKS.map((b) => [b.id, b]));
export const getBook = (id: string) => byId.get(id);
export const bookName = (id: string) => byId.get(id)?.ko ?? id;

export const formatRef = (r: { book: string; chapter: number; verse: number }) =>
  `${bookName(r.book)} ${r.chapter}:${r.verse}`;

/** Previous/next chapter across book boundaries; null at either end of the canon. */
export function stepChapter(book: string, chapter: number, dir: -1 | 1): { book: string; chapter: number } | null {
  const i = BOOKS.findIndex((b) => b.id === book);
  if (i < 0) return null;
  const next = chapter + dir;
  if (next >= 1 && next <= BOOKS[i].chapters) return { book, chapter: next };
  const j = i + dir;
  if (j < 0 || j >= BOOKS.length) return null;
  return { book: BOOKS[j].id, chapter: dir === 1 ? 1 : BOOKS[j].chapters };
}
