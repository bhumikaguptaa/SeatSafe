"use client";

// Owner: A. Loads async data (chain reads or mock data) with loading/error state, refresh and
// optional polling. Used by A's pages; B's hooks in lib/hooks.ts stay the contract for D's pages.

import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncData<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

/**
 * `key` identifies the request: when it changes the data reloads. Pass null to skip loading
 * (e.g. while the wallet is still loading).
 */
export function useAsyncData<T>(
  key: string | null,
  load: () => Promise<T>,
  opts: { pollMs?: number } = {},
): AsyncData<T> {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: unknown; loading: boolean }>({
    key: null,
    loading: key !== null,
  });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const run = useCallback(async (k: string) => {
    try {
      const data = await loadRef.current();
      setState((s) => (s.key === k || s.key === null ? { key: k, data, loading: false } : s));
    } catch (error) {
      console.error("load failed", k, error);
      setState((s) => (s.key === k || s.key === null ? { ...s, key: k, error, loading: false } : s));
    }
  }, []);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    setState({ key, loading: true });
    void run(key);
    const id = opts.pollMs
      ? setInterval(() => {
          if (!cancelled) void run(key);
        }, opts.pollMs)
      : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [key, run, opts.pollMs]);

  const refresh = useCallback(async () => {
    if (key !== null) await run(key);
  }, [key, run]);

  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    loading: key !== null && (!current || state.loading),
    error: current ? state.error : undefined,
    refresh,
  };
}

/**
 * Current time in ms, updated every second; 0 until mounted (so prerendered HTML is stable).
 * Use for countdowns and "deadline passed?" checks instead of calling Date.now() in render.
 */
export function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, []);
  return now;
}
