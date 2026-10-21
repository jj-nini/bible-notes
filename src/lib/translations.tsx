import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { repo } from "../data";
import { choiceOf, type EngineChoice, type Translation, type VerseRef, trKey } from "../data/types";
import { TranslatorUnavailableError } from "./browserTranslator";
import { useToast } from "./toast";

/** `fresh` marks a translation machine-made during this session (not loaded from the DB). */
export type Entry = Translation & { fresh?: boolean };

export interface LoadStats {
  total: number;
  /** Verses with at least one stored translation. */
  hit: number;
  /** Verses with none (sent to the translator only when `translate` was requested). */
  miss: number;
}

interface TranslationsApi {
  /** Every stored translation of the verse, one per engine. */
  list(version: string, ref: VerseRef): Entry[];
  /** The confirmed one, else the newest. */
  get(version: string, ref: VerseRef): Entry | undefined;
  /** A translation is being made for this verse (by `engine`, or by any engine). */
  isLoading(version: string, ref: VerseRef, engine?: EngineChoice): boolean;
  /** The DB was asked for this verse (so "no translation" is a real answer, not "not looked yet"). */
  isChecked(version: string, ref: VerseRef): boolean;
  /**
   * Reads stored translations. With `translate: true`, verses that `engine` (default Google v3) has not
   * translated yet are machine-translated in the background and saved. Resolves after the DB lookup.
   */
  load(version: string, refs: VerseRef[], opts?: { translate?: boolean; engine?: EngineChoice }): Promise<LoadStats>;
  fix(version: string, ref: VerseRef, engine: string): Promise<void>;
  unfix(version: string, ref: VerseRef, engine: string): Promise<void>;
  saveEdit(version: string, ref: VerseRef, text: string): Promise<void>;
}

const Ctx = createContext<TranslationsApi | null>(null);

export function TranslationsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [store, setStore] = useState<Map<string, Entry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const storeRef = useRef(store);
  storeRef.current = store;
  const checkedRef = useRef(checked);
  checkedRef.current = checked;
  const inFlight = useRef(new Set<string>()); // "VERSION|REF|CHOICE"
  const warnedUnavailable = useRef(false);

  /** Adds or replaces rows (matched by engine) for each verse. */
  const merge = useCallback((items: Entry[]) => {
    if (!items.length) return;
    setStore((prev) => {
      const next = new Map(prev);
      for (const t of items) {
        const k = trKey(t.version, t);
        const list = (next.get(k) ?? []).filter((x) => x.engine !== t.engine);
        next.set(k, [...list, t]);
      }
      return next;
    });
  }, []);

  const setBusy = useCallback((keys: string[], busy: boolean) => {
    keys.forEach((k) => (busy ? inFlight.current.add(k) : inFlight.current.delete(k)));
    setLoading(new Set(inFlight.current));
  }, []);

  const load = useCallback<TranslationsApi["load"]>(async (version, refs, opts = {}) => {
    const choice = opts.engine ?? "google-v3";
    const unknown = refs.filter((r) => !storeRef.current.has(trKey(version, r)) && !checkedRef.current.has(trKey(version, r)));
    let fetched: Translation[] = [];
    if (unknown.length) {
      try {
        fetched = await repo.getTranslations(version, unknown);
        merge(fetched);
      } catch (e) {
        toast(`번역을 불러오지 못했습니다: ${(e as Error).message}`);
        return { total: refs.length, hit: 0, miss: 0 };
      }
    }
    setChecked((prev) => new Set([...prev, ...refs.map((r) => trKey(version, r))]));

    const rowsOf = (r: VerseRef) => [
      ...(storeRef.current.get(trKey(version, r)) ?? []),
      ...fetched.filter((t) => trKey(version, t) === trKey(version, r)),
    ];
    const hit = refs.filter((r) => rowsOf(r).length > 0).length;

    if (opts.translate) {
      const todo = refs.filter((r) => !rowsOf(r).some((t) => choiceOf(t.engine) === choice)
        && !inFlight.current.has(`${trKey(version, r)}|${choice}`));
      if (todo.length) {
        const keys = todo.map((r) => `${trKey(version, r)}|${choice}`);
        setBusy(keys, true);
        repo.translateMissing(version, todo, (t) => merge([{ ...t, fresh: true }]), { engine: choice })
          .catch((e: Error) => {
            // Say it once per session; verses without a translation then offer manual entry
            if (e instanceof TranslatorUnavailableError) {
              if (!warnedUnavailable.current) toast(e.message);
              warnedUnavailable.current = true;
            } else {
              toast(`번역하지 못했습니다: ${e.message}`);
            }
          })
          .finally(() => setBusy(keys, false));
      }
    }
    return { total: refs.length, hit, miss: refs.length - hit };
  }, [merge, setBusy, toast]);

  /** Applies a confirmation locally the same way the DB does: one fixed row per verse. */
  const markFixed = useCallback((version: string, ref: VerseRef, fixedEngine: string, extra?: Entry) => {
    setStore((prev) => {
      const k = trKey(version, ref);
      let list = (prev.get(k) ?? []).map((t) =>
        t.engine === fixedEngine ? { ...t, status: "fixed" as const, fresh: false }
          : t.status === "fixed" ? { ...t, status: "machine" as const } : t);
      if (extra) list = [...list.filter((t) => t.engine !== extra.engine), extra];
      const next = new Map(prev);
      next.set(k, list);
      return next;
    });
  }, []);

  const api = useMemo<TranslationsApi>(() => {
    const list = (version: string, ref: VerseRef) => store.get(trKey(version, ref)) ?? [];
    return {
      list,
      get(version, ref) {
        const all = list(version, ref);
        return all.find((t) => t.status === "fixed") ?? all[all.length - 1];
      },
      isLoading: (version, ref, eng) => eng
        ? loading.has(`${trKey(version, ref)}|${eng}`)
        : [...loading].some((k) => k.startsWith(`${trKey(version, ref)}|`)),
      isChecked: (version, ref) => checked.has(trKey(version, ref)),
      load,
      async fix(version, ref, eng) {
        await repo.fixTranslation(version, ref, eng);
        markFixed(version, ref, eng);
        toast("확정 번역으로 저장했습니다");
      },
      async unfix(version, ref, eng) {
        await repo.unfixTranslation(version, ref, eng);
        setStore((prev) => {
          const k = trKey(version, ref);
          const next = new Map(prev);
          next.set(k, (prev.get(k) ?? []).map((t) => (t.engine === eng ? { ...t, status: "machine" as const } : t)));
          return next;
        });
        toast("확정을 해제했습니다. 기계 번역으로 남아 있습니다");
      },
      async saveEdit(version, ref, text) {
        await repo.saveTranslationEdit(version, ref, text);
        const { book, chapter, verse } = ref;
        markFixed(version, ref, "manual", { version, book, chapter, verse, text, status: "fixed", edited: true, engine: "manual" });
        toast("내 번역을 확정 저장했습니다");
      },
    };
  }, [store, loading, checked, load, markFixed, toast]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useTranslations() {
  const api = useContext(Ctx);
  if (!api) throw new Error("useTranslations must be used inside TranslationsProvider");
  return api;
}
