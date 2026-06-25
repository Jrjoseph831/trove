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
import { getBrandBySlug } from "@trove/data";
import {
  deskAction,
  fetchDesk,
  fetchPortfolio,
  fetchWorld,
  postTrade,
  type ApiPortfolio,
  type ApiWorld,
  type Desk,
} from "./api";
import {
  captureTokenFromHash,
  isSignedIn,
  signIn as authSignIn,
  signOut as authSignOut,
} from "./auth";
import { AUTH_ENABLED } from "./config";
import {
  advance,
  borrow,
  createWorld,
  playerBuy,
  playerSell,
  repay,
  SEC_PER_CYCLE,
  wallCycle,
  wallCycleFrac,
  type RuntimeItem,
  type WorldState,
} from "@trove/engine";

/** A warmed world whose clock is pinned to the current UTC 6h block, so its
 *  next settlement lands on the next 6h mark — in lockstep with the newsroom. */
function liveWorld(): WorldState {
  const w = createWorld();
  w.cycle = wallCycle();
  w.cycleFrac = wallCycleFrac();
  return w;
}

/** Overlay the server's shared prices/news onto the live world in place. The
 *  server owns these — the client never drifts them locally in live mode. */
function overlayWorld(live: WorldState, api: ApiWorld): void {
  const byId = new Map(live.items.map((it) => [it.id, it]));
  for (const s of api.items) {
    const it = byId.get(s.id);
    if (!it) continue;
    it.value = s.value;
    it.prevValue = s.prevValue;
    it.stock = s.stock;
    it.remaining = s.remaining ?? Infinity;
  }
  live.cycle = api.cycle;
  if (api.front) live.front = { ...live.front, ...api.front } as WorldState["front"];
  if (api.archive) live.archive = api.archive;
}

/** Overlay the signed-in player's own holdings/cash onto the live world. */
function overlayPortfolio(live: WorldState, p: ApiPortfolio): void {
  live.cash = p.cash;
  live.debt = p.debt;
  const owned = new Map(p.holdings.map((h) => [h.id, h.qty]));
  for (const it of live.items) {
    const qty = owned.get(it.id) ?? 0;
    if (qty > 0) it.owners["YOU"] = qty;
    else delete it.owners["YOU"];
  }
  live.nwHist = [...live.nwHist.slice(-29), p.netWorth];
}

export type TabId = "trending" | "catalog" | "wire" | "vault" | "orders";
export type Mode = "live" | "sandbox";

export interface RevealInfo {
  it: RuntimeItem;
  copyNo: number | null;
  /** Units acquired (bulk goods come in cases). */
  qty?: number;
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
  /** item id to highlight in the catalog (from "Find it on the floor"). */
  hlItem: number | null;
  buy: (id: number, qty?: number) => void;
  sell: (id: number, qty?: number) => void;
  doBorrow: () => void;
  doRepay: () => void;
  closeReveal: () => void;
  /** Shared-world auth (the Acquire gate). */
  signedIn: boolean;
  authReady: boolean;
  signIn: () => void;
  signOut: () => void;
  /** Order Desk (PVE). null until loaded. */
  desk: Desk | null;
  acceptOrder: (id: string) => void;
  declineOrder: (id: string) => void;
  fulfillOrder: (id: string) => void;
  nameHolding: (name: string) => void;
}

const TroveContext = createContext<Trove | null>(null);

/** Render cadence — prices update ~5×/s; the ticker scroll is CSS-continuous. */
const RENDER_MS = 180;

export function TroveProvider({ children }: { children: React.ReactNode }) {
  const worldsRef = useRef<{ live: WorldState; sandbox: WorldState } | null>(
    null,
  );
  if (worldsRef.current === null) {
    worldsRef.current = { live: liveWorld(), sandbox: createWorld() };
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
  const [hlItem, setHlItem] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [desk, setDesk] = useState<Desk | null>(null);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const warpRef = useRef(warp);
  warpRef.current = warp;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Capture a Hosted-UI token on return, then track sign-in state.
  useEffect(() => {
    captureTokenFromHash();
    setSignedIn(isSignedIn());
    setAuthReady(true);
  }, []);

  // Live mode: pull the shared world (and the player's portfolio, if signed in)
  // every 15s and overlay it. This is what makes the floor the SAME for everyone.
  useEffect(() => {
    if (mode !== "live") return;
    let alive = true;
    const pull = async () => {
      try {
        const w = await fetchWorld();
        if (!alive) return;
        overlayWorld(worldsRef.current!.live, w);
        if (isSignedIn()) {
          try {
            const p = await fetchPortfolio();
            if (alive) overlayPortfolio(worldsRef.current!.live, p);
          } catch {
            /* portfolio is best-effort */
          }
        }
        refresh();
      } catch {
        /* keep last-known world on a failed poll */
      }
    };
    pull();
    const t = setInterval(pull, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mode, signedIn, refresh]);

  // Order Desk: poll for new contracts while signed in (server rolls one ~every
  // 10 min; we check in on a shorter beat so the desk + countdowns stay live).
  useEffect(() => {
    if (!signedIn) {
      setDesk(null);
      return;
    }
    let alive = true;
    const pull = async () => {
      try {
        const d = await fetchDesk();
        if (alive) setDesk(d);
      } catch {
        /* best-effort */
      }
    };
    pull();
    const t = setInterval(pull, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [signedIn]);

  // Deep link: /?brand=<slug> opens the Catalog filtered to that company.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("brand");
    if (slug) {
      const brand = getBrandBySlug(slug);
      if (brand) {
        setCatBrand(brand.name);
        setTab("catalog");
      }
    }
    const q = params.get("q");
    if (q) {
      setCatSearch(q);
      setTab("catalog");
    }
    const hl = params.get("hl");
    if (hl && /^\d+$/.test(hl)) {
      setHlItem(Number(hl));
      setTab("catalog");
      window.setTimeout(() => setHlItem(null), 6000);
    }
  }, []);

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
      // Live prices are server-owned (overlaid by the poll); only keep the
      // clock ticking for the "front page turns in ~Xh" countdown.
      w.live.cycleFrac = wallCycleFrac();
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

  // Re-pull the shared world + portfolio after a trade so the UI reflects the
  // authoritative server state immediately.
  const syncLive = useCallback(async () => {
    try {
      const w = await fetchWorld();
      overlayWorld(worldsRef.current!.live, w);
      if (isSignedIn()) {
        const p = await fetchPortfolio();
        overlayPortfolio(worldsRef.current!.live, p);
      }
    } catch {
      /* best-effort */
    }
    refresh();
  }, [refresh]);

  const buy = useCallback(
    (id: number, qty = 1) => {
      const n = Math.max(1, Math.floor(qty));
      // Sandbox: the local engine, instant and free.
      if (modeRef.current === "sandbox") {
        let r: ReturnType<typeof playerBuy> = null;
        let got = 0;
        for (let i = 0; i < n; i++) {
          const x = playerBuy(worldsRef.current!.sandbox, id);
          if (!x) break;
          r = x;
          got++;
        }
        if (!r) {
          showToast("Can't acquire that");
          return;
        }
        setReveal({ it: r.it, copyNo: r.copyNo, qty: got });
        refresh();
        return;
      }
      // Live: the Acquire gate — sign in, then trade against the shared world.
      if (!AUTH_ENABLED) {
        showToast("Trading opens soon");
        return;
      }
      if (!isSignedIn()) {
        showToast("Sign in to acquire");
        authSignIn();
        return;
      }
      void postTrade("buy", id, n).then(async (r) => {
        if ("error" in r) {
          if (r.status === 401) {
            authSignIn();
            return;
          }
          showToast(
            r.error === "insufficient funds"
              ? "Not enough cash"
              : r.error === "sold out"
                ? "Just sold out"
                : r.error === "network error"
                  ? "Connection issue — try again"
                  : r.error.startsWith("sold in cases")
                    ? `This is ${r.error}`
                    : "Couldn't acquire that",
          );
          // refresh so a sold-out item immediately greys out for everyone
          await syncLive();
          return;
        }
        await syncLive();
        const it = worldsRef.current!.live.items.find((i) => i.id === id);
        if (it) setReveal({ it, copyNo: r.copyNo, qty: r.qty });
        else showToast("Acquired");
      });
    },
    [refresh, showToast, syncLive],
  );

  const sell = useCallback(
    (id: number, qty = 1) => {
      const n = Math.max(1, Math.floor(qty));
      if (modeRef.current === "sandbox") {
        let last: ReturnType<typeof playerSell> = null;
        let pl = 0;
        for (let i = 0; i < n; i++) {
          const x = playerSell(worldsRef.current!.sandbox, id);
          if (!x) break;
          last = x;
          pl += x.pl;
        }
        if (!last) return;
        showToast(`Sold · ${pl >= 0 ? "+" : ""}${moneyShort(pl)}`);
        refresh();
        return;
      }
      if (!isSignedIn()) {
        authSignIn();
        return;
      }
      void postTrade("sell", id, n).then(async (r) => {
        if ("error" in r) {
          if (r.status === 401) authSignIn();
          else
            showToast(
              r.error === "network error"
                ? "Connection issue — try again"
                : "Couldn't sell that",
            );
          return;
        }
        await syncLive();
        showToast(r.qty > 1 ? `Sold ${r.qty}` : "Sold");
      });
    },
    [refresh, showToast, syncLive],
  );

  // Debt is a sandbox-only mechanic for now (no server credit endpoint yet).
  const doBorrow = useCallback(() => {
    if (modeRef.current === "live") {
      showToast("Credit opens soon");
      return;
    }
    showToast(
      borrow(worldsRef.current!.sandbox, 5000)
        ? "Borrowed $5,000"
        : "No credit available",
    );
    refresh();
  }, [refresh, showToast]);

  const doRepay = useCallback(() => {
    if (modeRef.current === "live") {
      showToast("Credit opens soon");
      return;
    }
    showToast(
      repay(worldsRef.current!.sandbox, 5000)
        ? "Repaid $5,000"
        : "Nothing to repay",
    );
    refresh();
  }, [refresh, showToast]);

  const signIn = useCallback(() => authSignIn(), []);
  const signOut = useCallback(() => {
    authSignOut();
    setSignedIn(false);
  }, []);
  const closeReveal = useCallback(() => setReveal(null), []);

  const openSector = useCallback((s: string) => {
    setCatSector(s);
    setTab("catalog");
    setNavOpen(false);
  }, []);

  // ── Order Desk actions ──────────────────────────────────────────────────
  const nameHolding = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    void deskAction("name", { name: trimmed }).then((d) => {
      if (!("error" in d)) setDesk(d);
    });
  }, []);

  const acceptOrder = useCallback(
    (id: string) => {
      void deskAction("accept", { orderId: id }).then((d) => {
        if ("error" in d) showToast("Couldn't accept");
        else setDesk(d);
      });
    },
    [showToast],
  );

  const declineOrder = useCallback((id: string) => {
    void deskAction("decline", { orderId: id }).then((d) => {
      if (!("error" in d)) setDesk(d);
    });
  }, []);

  const fulfillOrder = useCallback(
    (id: string) => {
      void deskAction("fulfill", { orderId: id }).then(async (d) => {
        if ("error" in d) {
          showToast(
            d.error === "not enough in your vault"
              ? "Not enough in your vault"
              : d.error === "deadline passed"
                ? "Deadline passed"
                : "Couldn't fulfill",
          );
          return;
        }
        setDesk(d);
        await syncLive(); // vault + cash changed
        showToast("Order fulfilled");
      });
    },
    [showToast, syncLive],
  );

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
      hlItem,
      buy,
      sell,
      doBorrow,
      doRepay,
      closeReveal,
      signedIn,
      authReady,
      signIn,
      signOut,
      desk,
      acceptOrder,
      declineOrder,
      fulfillOrder,
      nameHolding,
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
      hlItem,
      buy,
      sell,
      doBorrow,
      doRepay,
      closeReveal,
      signedIn,
      authReady,
      signIn,
      signOut,
      desk,
      acceptOrder,
      declineOrder,
      fulfillOrder,
      nameHolding,
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
