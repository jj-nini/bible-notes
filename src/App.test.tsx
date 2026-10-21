// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "./App";
import { repo } from "./data";
import { TranslatorUnavailableError } from "./lib/browserTranslator";
import { ToastProvider } from "./lib/toast";
import { TranslationsProvider } from "./lib/translations";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  Element.prototype.scrollIntoView ??= () => {};
  window.scrollTo = () => {};
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const setup = () =>
  render(<ToastProvider><TranslationsProvider><App /></TranslationsProvider></ToastProvider>);

describe("app (sample mode)", () => {
  it("opens the reader on Philippians 4 and walks to the next chapter", async () => {
    const user = userEvent.setup();
    setup();
    expect(await screen.findByRole("heading", { name: "빌립보서 4장" })).toBeTruthy();
    expect(await screen.findByText(/아무 것도 염려하지 말고/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "다음 장" }));
    expect(await screen.findByRole("heading", { name: "골로새서 1장" })).toBeTruthy();
    expect(await screen.findByText("이 장의 본문 데이터가 아직 없습니다.")).toBeTruthy();
  });

  it("top toggle only shows stored translations; translating is per verse and per engine", async () => {
    const translate = vi.spyOn(repo, "translateMissing");
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "빌립보서 4장" });
    const koBtn = screen.getByRole("button", { name: "한글 번역" }) as HTMLButtonElement;
    expect(koBtn.disabled).toBe(true); // 개역개정 has nothing to translate
    await user.selectOptions(screen.getByLabelText("번역본"), "MSG");
    await user.click(screen.getByRole("button", { name: "한글 번역" }));
    // MSG seed has 4:6 and 4:7 stored; the other 4 verses are not translated automatically
    await waitFor(() => expect(document.querySelector(".batch")!.textContent).toMatch(/2\/6절 저장됨/));
    expect(await screen.findAllByText("번역 없음")).toHaveLength(4);
    expect(translate).not.toHaveBeenCalled();

    // Translate one verse with one engine
    const v4 = document.getElementById("v-4")!;
    await user.click(within(v4).getByRole("button", { name: "+ Google v3" }));
    await waitFor(() => expect(within(v4).getByText("방금 번역")).toBeTruthy(), { timeout: 3000 });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0][1]).toEqual([{ book: "PHP", chapter: 4, verse: 4 }]);
    expect(translate.mock.calls[0][3]).toEqual({ engine: "google-v3" });
    expect(screen.getAllByText("번역 없음")).toHaveLength(3);
    expect(within(v4).queryByRole("button", { name: "+ Google v3" })).toBeNull(); // already tried

    // Confirm it
    await user.click(within(v4).getByRole("button", { name: "확정" }));
    await waitFor(() => expect(within(v4).getByText("확정됨")).toBeTruthy());
  });

  it("per-verse button opens the verse; an engine button translates it", async () => {
    const translate = vi.spyOn(repo, "translateMissing");
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "빌립보서 4장" });
    await user.selectOptions(screen.getByLabelText("번역본"), "NIV");
    await user.click(await screen.findByRole("button", { name: "9절 NIV 한글 번역" }));
    const v9 = document.getElementById("v-9")!;
    expect(await within(v9).findByText("번역 없음")).toBeTruthy();
    expect(translate).not.toHaveBeenCalled(); // opening is read-only
    await user.click(within(v9).getByRole("button", { name: "+ Google v3" }));
    expect(await within(v9).findByText(/샘플 데이터에 번역이 없습니다/, {}, { timeout: 3000 })).toBeTruthy(); // the mock's NIV output
    await user.click(screen.getByRole("button", { name: "9절 NIV 한글 번역" })); // hide again
    expect(within(v9).queryByText(/샘플 데이터에 번역이 없습니다/)).toBeNull();
  });

  it("finds verses by topic and jumps into the reader", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: /빌립보서/ });
    await user.click(screen.getByRole("tab", { name: "성구찾기" }));
    expect(await screen.findByText(/동의어 사전 매칭/)).toBeTruthy();
    const cards = await screen.findAllByRole("article");
    expect(within(cards[0]).getByRole("heading").textContent).toMatch(/빌립보서 4:6|이사야 41:10/);
    const isa = cards.find((c) => within(c).queryByText("이사야 41:10"))!;
    await user.click(within(isa).getByRole("button", { name: "읽기모드로 보기" }));
    expect(await screen.findByRole("heading", { name: "이사야 41장" })).toBeTruthy();
    await waitFor(() => expect(document.querySelector("#v-10.hl")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "← 검색 결과로" }));
    expect(screen.getAllByRole("article").length).toBe(cards.length);
  });

  it("falls back to keyword search for unknown phrases", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: /빌립보서/ });
    await user.click(screen.getByRole("tab", { name: "성구찾기" }));
    const input = await screen.findByLabelText("검색어");
    await user.clear(input);
    await user.type(input, "멍에{Enter}");
    expect(await screen.findByText("주제 사전에 없는 표현입니다.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "본문 단어 검색으로 다시 찾기" }));
    const cards = await screen.findAllByRole("article");
    expect(cards.length).toBe(2); // 마 11:29, 11:30
    expect(cards[0].querySelector("mark")?.textContent).toBe("멍에");
  });

  it("explains an empty database instead of showing a blank page", async () => {
    vi.spyOn(repo, "listVersions").mockResolvedValue([]);
    setup();
    expect(await screen.findByText("볼 수 있는 번역본이 없습니다.")).toBeTruthy();
    expect(screen.getByText(/scripts\/import.ts --sample/)).toBeTruthy();
  });

  it("offers manual entry, and reports a failed translation", async () => {
    vi.spyOn(repo, "translateMissing").mockRejectedValue(new TranslatorUnavailableError());
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "빌립보서 4장" });
    // AMP: the sample repo is shared across tests, and no other test translates AMP
    await user.selectOptions(screen.getByLabelText("번역본"), "AMP");
    await user.click(screen.getByRole("button", { name: "한글 번역" }));
    expect(await screen.findAllByRole("button", { name: "직접 입력" })).toHaveLength(6);
    const v5 = document.getElementById("v-5")!;
    await user.click(within(v5).getByRole("button", { name: "+ Google v3" }));
    expect(await screen.findByText(/번역을 쓸 수 없습니다/)).toBeTruthy();

    await user.click(within(v5).getByRole("button", { name: "직접 입력" }));
    await user.type(screen.getByLabelText("한글 번역 수정"), "너희 관용을 모든 사람에게 알게 하라");
    await user.click(screen.getByRole("button", { name: "직접 입력으로 확정" }));
    expect(await within(v5).findByText("너희 관용을 모든 사람에게 알게 하라")).toBeTruthy();
    expect(within(v5).getByText("확정됨 · 직접 수정")).toBeTruthy();
    expect(within(v5).getByText("직접 입력", { selector: ".engine-chip" })).toBeTruthy();
  });

  it("shows MSG's combined verses as a range in parallel view", async () => {
    const real = repo.getChapter.bind(repo);
    vi.spyOn(repo, "getChapter").mockImplementation(async (version, book, chapter) =>
      version === "MSG"
        ? [{ version, book, chapter, verse: 4, verse_end: 5, text: "Celebrate God all day, every day." }]
        : (await real(version, book, chapter)).filter((v) => v.verse <= 5));
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "빌립보서 4장" });
    await user.click(screen.getByRole("button", { name: "대조" })); // KRV | AMP by default
    await user.selectOptions(screen.getByLabelText("대조 번역본"), "MSG");
    expect(await screen.findByText("↑ 4–5절에 함께 옮김")).toBeTruthy();
    expect(screen.getByText("4–5절")).toBeTruthy();
    expect(screen.queryByText("이 번역본에는 본문이 없습니다")).toBeNull();
  });

  it("shows every engine's translation of a verse together; one can be confirmed", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "빌립보서 4장" });
    // NIV 4:4: no other test translates it
    await user.selectOptions(screen.getByLabelText("번역본"), "NIV");
    await user.click(await screen.findByRole("button", { name: "4절 NIV 한글 번역" }));
    const v4 = document.getElementById("v-4")!;
    await user.click(await within(v4).findByRole("button", { name: "+ Claude" }));
    await user.click(within(v4).getByRole("button", { name: "+ Google v2" }));
    await waitFor(() => expect(within(v4).getAllByRole("listitem")).toHaveLength(2), { timeout: 3000 });
    expect(within(v4).getByText(/^\[Claude\] /)).toBeTruthy();
    expect(within(v4).getByText(/^\[v2\] /)).toBeTruthy();
    expect(within(v4).getByRole("button", { name: "+ Google v3" })).toBeTruthy(); // not tried yet

    const row = (label: string) => within(v4).getAllByRole("listitem").find((li) => within(li).queryByText(label, { selector: ".engine-chip" }))!;
    await user.click(within(row("Google v2")).getByRole("button", { name: "확정" }));
    await waitFor(() => expect(within(row("Google v2")).getByText("확정됨")).toBeTruthy());
    await user.click(within(row("Claude")).getByRole("button", { name: "확정" }));
    await waitFor(() => expect(within(row("Claude")).getByText("확정됨")).toBeTruthy());
    expect(within(v4).getAllByText("확정됨")).toHaveLength(1); // the v2 one went back to machine
  });
});
