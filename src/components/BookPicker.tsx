import { useEffect, useRef, useState } from "react";
import { BOOKS, getBook } from "../data/books";

interface Props {
  currentBook: string;
  currentChapter: number;
  onPick(book: string, chapter: number): void;
  onClose(): void;
}

export function BookPicker({ currentBook, currentChapter, onPick, onClose }: Props) {
  const [book, setBook] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>("button.cur, .grid-btns button")?.focus();
  }, [book]);

  const b = book ? getBook(book) : null;

  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title" ref={panel}>
        <div className="sheet-head">
          <h3 id="sheet-title">{b ? `${b.ko} · 장 선택` : "책 선택"}</h3>
          <button type="button" className="mini" onClick={onClose}>닫기</button>
        </div>
        {!b ? (
          (["OT", "NT"] as const).map((tm) => (
            <div key={tm} className="sheet-group">
              <h4>{tm === "OT" ? "구약" : "신약"}</h4>
              <div className="grid-btns">
                {BOOKS.filter((x) => x.testament === tm).map((x) => (
                  <button key={x.id} type="button" className={x.id === currentBook ? "cur" : ""} onClick={() => setBook(x.id)}>
                    {x.ko}
                  </button>
                ))}
              </div>
            </div>
          ))
        ) : (
          <>
            <button type="button" className="mini back" onClick={() => setBook(null)}>← 책 목록</button>
            <div className="grid-btns nums">
              {Array.from({ length: b.chapters }, (_, i) => i + 1).map((n) => (
                <button
                  key={n} type="button"
                  className={b.id === currentBook && n === currentChapter ? "cur" : ""}
                  onClick={() => onPick(b.id, n)}
                >{n}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
