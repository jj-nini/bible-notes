import { useEffect, useRef, useState } from "react";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Past about half a screen: shown while scrolling up, hidden while reading downward. */
export function ToTop() {
  const [show, setShow] = useState(false);
  const lastY = useRef(window.scrollY);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y < Math.min(600, window.innerHeight * 0.5)) setShow(false);
      else if (y < lastY.current - 4) setShow(true);
      else if (y > lastY.current + 4) setShow(false);
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;
  return (
    <button
      type="button" className="to-top" aria-label="맨 위로"
      onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" })}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
      </svg>
    </button>
  );
}
