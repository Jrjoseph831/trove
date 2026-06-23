"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  advance,
  borrow,
  createWorld,
  playerBuy,
  playerSell,
  repay,
  SEC_PER_CYCLE,
  type RuntimeItem,
  type WorldState,
} from "@trove/engine";

export type TabId = "trending" | "catalog" | "wire" | "vault";
export type Mode = "live" | "sandbox";

export interface RevealInfo {
  it: RuntimeItem;
  copyNo: number | null;
}

interface Trove {
  mounted: boolean;
  state: WorldState;
  mode: Mode;
  tab: TabId;
  warp: number;
  navOpen: boolean;
  reveal: RevealInfo | null;
  toast: string | null;
  /** bumped each render tick — read it to subscribe to live updates. */
  tick: number;
  cat: { sector: string | null; brand: string | null; search: string };
  setMode: (m: Mode) => void;
  setTab: (t: TabId) => void;
  setWarp: (w: number) => void;
  setNavOpen: (b: boolean) => void;
  jump: () => void;
  setCatSector: (s: string | null) => void;
  setCatBrand: (b: string | null) => void;
  setCatSearch: (s: string) => void;
  /** jump straight to the catalog filtered to a sector (deep-link). */
  openSector: (s: string) => void;
  buy: (id: number) => void;
  sell: (id: number) => void;
  doBorrow: () => void;
  doRepay: () => void;
  closeReveal: () => void;
}

const TroveContext = createContext<Trove | null>(null);

/** Render cadence — prices update ~5×/s; the ticker scroll is CSS-continuous. */
const RENDER_MS = 180;

export function TroveProvider({ children }: { children: React.ReactNode }) {
  const worldsRef = useRef<{ live: WorldState; sandbox: WorldState } | null>(
    null,
  );
  if (worldsRef.current === null) {
    worldsRef.current = { live: createWorld(), sandbox: createWorld() };
  }
  const jumpRef = useRef(0);

  const [mounted, setMounted] = useState(false);
  const [tick, setTick] = useState(0);
  const [mode, setModeState] = useState<Mode>("live");
  const [tab, setTab] = useState<TabId>("trending");
  const [warp, setWarp] = useState(2000);
  const [navOpen, setNavOpen] = useState(false);
  const [reveal, setReveal] = useState<RevealInfo | null>(null);
  const [toast, setToastState] = useState<string | null>(null);
  const [catSector, setCatSector] = useState<string | null>(null);
  const [catBrand, setCatBrand] = useState<string | null>(null);
  const [catSearch, setCatSearch] = useState("");

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const warpRef = useRef(warp);
  warpRef.current = warp;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // The game loop: advance both worlds every frame, re-render on a throttle.
  useEffect(() => {
    setMounted(true);
    let raf = 0;
    let last = performance.now();
    let lastRender = 0;
    const frame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const w = worldsRef.current!;
      advance(w.live, dt / SEC_PER_CYCLE);
      const sbx =
        (dt / SEC_PER_CYCLE) * warpRef.current +
        (modeRef.current === "sandbox" ? jumpRef.current : 0);
      jumpRef.current = 0;
      advance(w.sandbox, Math.min(sbx, 6));
      if (now - lastRender > RENDER_MS) {
        lastRender = now;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Toast auto-dismiss.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastState(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(null), 1500);
  }, []);

  const state = worldsRef.current[mode];

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    setNavOpen(false);
  }, []);

  const jump = useCallback(() => {
    jumpRef.current += 1;
  }, []);

  const buy = useCallback(
    (id: number) => {
      const r = playerBuy(worldsRef.current![modeRef.current], id);
      if (!r) {
        showToast("Can't acquire that");
        return;
      }
      if (r.it.edition !== null) setReveal({ it: r.it, copyNo: r.copyNo });
      else showToast("Acquired");
      refresh();
    },
    [refresh, showToast],
  );

  const sell = useCallback(
    (id: number) => {
      const r = playerSell(worldsRef.current![modeRef.current], id);
      if (!r) return;
      showToast(`Sold · ${r.pl >= 0 ? "+" : ""}${moneyShort(r.pl)}`);
      refresh();
    },
    [refresh, showToast],
  );

  const doBorrow = useCallback(() => {
    showToast(
      borrow(worldsRef.current![modeRef.current], 5000)
        ? "Borrowed $5,000"
        : "No credit available",
    );
    refresh();
  }, [refresh, showToast]);

  const doRepay = useCallback(() => {
    showToast(
      repay(worldsRef.current![modeRef.current], 5000)
        ? "Repaid $5,000"
        : "Nothing to repay",
    );
    refresh();
  }, [refresh, showToast]);

  const openSector = useCallback((s: string) => {
    setCatSector(s);
    setTab("catalog");
    setNavOpen(false);
  }, []);

  const value = useMemo<Trove>(
    () => ({
      mounted,
      state,
      mode,
      tab,
      warp,
      navOpen,
      reveal,
      toast,
      tick,
      cat: { sector: catSector, brand: catBrand, search: catSearch },
      setMode,
      setTab,
      setWarp,
      setNavOpen,
      jump,
      setCatSector,
      setCatBrand,
      setCatSearch,
      openSector,
      buy,
      sell,
      doBorrow,
      doRepay,
      closeReveal: () => setReveal(null),
    }),
    [
      mounted,
      state,
      mode,
      tab,
      warp,
      navOpen,
      reveal,
      toast,
      tick,
      catSector,
      catBrand,
      catSearch,
      setMode,
      jump,
      openSector,
      buy,
      sell,
      doBorrow,
      doRepay,
    ],
  );

  return <TroveContext.Provider value={value}>{children}</TroveContext.Provider>;
}

export function useTrove(): Trove {
  const ctx = useContext(TroveContext);
  if (!ctx) throw new Error("useTrove must be used within TroveProvider");
  return ctx;
}

function moneyShort(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString();
}
