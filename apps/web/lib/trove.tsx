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
import { factorySpec, getBrandBySlug, getItem } from "@trove/data";
import {
  deskAction,
  factoryAction,
  fetchDesk,
  fetchPortfolio,
  fetchWorld,
  postTrade,
  createOrder as apiCreateOrder,
  createBuyout as apiCreateBuyout,
  fetchOrders,
  orderAction as apiOrderAction,
  saveSite as apiSaveSite,
  type ApiPortfolio,
  type ApiWorld,
  type CompanySite,
  type Desk,
  type FactoryAction,
} from "./api";
import type { PvpOrder, SiteConfig } from "@trove/engine";

export interface OrderBook {
  incoming: PvpOrder[];
  outgoing: PvpOrder[];
}
import {
  captureTokenFromQuery,
  refreshIfNeeded,
  isSignedIn,
  signIn as authSignIn,
  signOut as authSignOut,
} from "./auth";
import { AUTH_ENABLED, sandboxEnabled } from "./config";
import { manufacturingName } from "./format";
import {
  advance,
  borrow,
  buildFactory,
  buyProperty,
  sellProperty,
  propertyById,
  buyStake,
  sellStake,
  companyValuation,
  createWorld,
  demolishFactory,
  buyInfra as engineBuyInfra,
  expandFloor as engineExpandFloor,
  installModule,
  routeFactory as engineRouteFactory,
  setSource as engineSetSource,
  setListPrice as engineSetListPrice,
  setListed as engineSetListed,
  rollSandboxOrders,
  setMarketEvent,
  negotiateSandbox,
  acceptSandboxOffer,
  declineSandboxOrder,
  fulfillSandboxOrder,
  autoNegotiate,
  autoFulfillOrders,
  setDeskAuto as engineSetDeskAuto,
  heldOfProduct,
  producesProduct,
  playerBuy,
  playerSell,
  repay,
  SEC_PER_CYCLE,
  uninstallModule,
  wallCycle,
  wallCycleFrac,
  wallProdCycle,
  type Report,
  type RuntimeItem,
  type WorldState,
} from "@trove/engine";

const REPORTS_KEY = "trove.reports.v1";

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

/** Overlay the signed-in player's own holdings/cash AND factory/sales/report
 *  state onto the live world, so the Vault/Factory/Report screens render off the
 *  live WorldState exactly as they do in the sandbox. The server owns all of it;
 *  the client never mutates these locally in live mode. */
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
  if (p.reputation !== undefined) live.reputation = p.reputation;
  if (p.floorSlots !== undefined) live.floorSlots = p.floorSlots;
  if (p.infra) live.infra = p.infra;
  if (p.factories) live.factories = p.factories;
  if (p.properties) live.properties = p.properties;
  if (p.stakes) live.stakes = p.stakes;
  if (p.listPrices) live.listPrices = p.listPrices;
  if (p.producedQty) live.producedQty = p.producedQty;
  if (p.listed) live.listed = p.listed;
  if (p.deskAuto) live.deskAuto = p.deskAuto;
  if (p.reports) live.reports = p.reports;
  if (p.periodNo !== undefined) live.periodNo = p.periodNo;
}

export type TabId =
  | "trending"
  | "catalog"
  | "wire"
  | "vault"
  | "orders"
  | "factory"
  | "estates"
  | "deals"
  | "report"
  | "companies"
  | "goals";
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
  /** The clock factory build/online checks read: the fast production tick in
   *  live (decoupled from the 6h market cycle), the local world cycle in sandbox. */
  factoryCycle: number;
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
  /** Factory (sandbox): stand up / tear down a production line, tune modules. */
  buildLine: (itemId: number) => void;
  /** Property Market: buy / sell real estate (sandbox in v1). */
  buyEstate: (propId: number) => void;
  sellEstate: (propId: number) => void;
  /** Deal Room: buy / sell an equity stake (pct 0..1) in an AI house. */
  buyStakeIn: (company: string, pct: number) => void;
  sellStakeIn: (company: string, pct: number) => void;
  demolishLine: (id: string) => void;
  addModule: (factoryId: string, moduleId: string) => void;
  removeModule: (factoryId: string, moduleId: string) => void;
  expandFloor: () => void;
  routeLine: (id: string, bay: number) => void;
  setLineSource: (lineId: string, inputItemId: number, feederId: string | null) => void;
  setSellPrice: (itemId: number, mult: number) => void;
  setListing: (itemId: number, on: boolean) => void;
  buyUpgrade: (id: "power" | "router" | "qc") => void;
  setDeskAutomation: (patch: {
    specialist?: boolean;
    autoFulfill?: boolean;
    minMargin?: number;
  }) => void;
  closeReveal: () => void;
  /** Shared-world auth (the Acquire gate). */
  signedIn: boolean;
  authReady: boolean;
  signIn: () => void;
  signOut: () => void;
  /** Order Desk (PVE). null until loaded. */
  desk: Desk | null;
  acceptOrder: (id: string) => void;
  counterOrder: (id: string, bid: number) => void;
  declineOrder: (id: string) => void;
  fulfillOrder: (id: string) => void;
  nameHolding: (name: string) => void;
  /** Rename flow: open the name dialog for an already-named Holding. */
  renaming: boolean;
  startRename: () => void;
  cancelRename: () => void;
  /** Latest daily-report card to surface (sandbox), or null. */
  dailyReport: Report | null;
  dismissDailyReport: () => void;
  /** The signed-in player's own company-site config (null until loaded / set). */
  mySite: SiteConfig | null;
  /** Save the player's site config; resolves to the updated public view or null. */
  saveSite: (patch: Partial<SiteConfig>) => Promise<CompanySite | null>;
  /** Player-to-player order book (incoming as seller, outgoing as buyer). */
  orders: OrderBook | null;
  /** Buyer: request a bulk order from a company storefront. */
  requestOrder: (
    sellerHandle: string,
    itemId: number,
    qty: number,
    price: number,
  ) => Promise<boolean>;
  /** M&A: offer to acquire another player's entire firm (full buyout). */
  requestBuyout: (sellerHandle: string, price: number) => Promise<boolean>;
  /** Act on a P2P order: accept | decline | counter | withdraw. */
  orderAct: (
    id: string,
    action: "accept" | "decline" | "counter" | "withdraw",
    price?: number,
  ) => Promise<void>;
}

const TroveContext = createContext<Trove | null>(null);

/** Shape the sandbox world's local orders into the Desk view the UI consumes
 *  (same type the live API returns), so one Desk screen serves both modes. */
function sandboxDeskView(state: WorldState, name: string | null): Desk {
  const mfg = manufacturingName(name);
  return {
    name,
    reputation: state.reputation ?? 0,
    cash: state.cash,
    orders: (state.orders ?? []).map((o) => {
      const it = state.items.find((i) => i.id === o.itemId);
      const youProduce = it ? producesProduct(state, it) : false;
      return {
        id: o.id,
        company: o.company,
        sector: o.sector,
        itemId: o.itemId,
        itemName: it?.name ?? `#${o.itemId}`,
        // Goods you make are branded as YOURS, not the original catalog maker.
        brand: youProduce ? mfg : (it?.brand ?? ""),
        qty: o.qty,
        companyOffer: o.companyOffer,
        round: o.round,
        maxRounds: o.maxRounds,
        quote: o.quote,
        status: o.status,
        expiresAt: o.expiresAt,
        marketValue: Math.round((it?.value ?? 0) * o.qty),
        held: it ? heldOfProduct(state, it) : 0,
        youProduce,
      };
    }),
  };
}

/** Render cadence — prices update ~5×/s; the ticker scroll is CSS-continuous. */
const RENDER_MS = 180;

export function TroveProvider({ children }: { children: React.ReactNode }) {
  const worldsRef = useRef<{ live: WorldState; sandbox: WorldState } | null>(
    null,
  );
  if (worldsRef.current === null) {
    // The sandbox is a private tuning world — start it richer so factory chains
    // (component lines + feeders) are affordable to experiment with. Live + the
    // server keep the real START_CASH.
    const sandbox = createWorld();
    sandbox.cash = 50_000;
    sandbox.nwHist = [50_000];
    // Restore the persisted report log so history continues across reloads.
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(REPORTS_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { periodNo?: number; reports?: Report[] };
          if (Array.isArray(saved.reports)) {
            sandbox.reports = saved.reports;
            sandbox.periodNo = saved.periodNo ?? saved.reports.length;
          }
        }
      } catch {
        /* ignore corrupt storage */
      }
    }
    worldsRef.current = { live: liveWorld(), sandbox };
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
  const [renaming, setRenaming] = useState(false);
  const [dailyReport, setDailyReport] = useState<Report | null>(null);
  const [mySite, setMySite] = useState<SiteConfig | null>(null);
  const [orders, setOrders] = useState<OrderBook | null>(null);
  const lastReportRef = useRef(-1);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const warpRef = useRef(warp);
  warpRef.current = warp;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Capture the Hosted-UI auth code on return (or silently refresh a stored
  // session), then keep the id token fresh on a timer and on tab refocus so the
  // player stays signed in for days instead of an hour.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const handled = await captureTokenFromQuery();
      if (!handled) await refreshIfNeeded();
      if (!alive) return;
      setSignedIn(isSignedIn());
      setAuthReady(true);
    })();
    const sync = () =>
      void refreshIfNeeded().then(() => alive && setSignedIn(isSignedIn()));
    const t = setInterval(sync, 8 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
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
            if (alive) {
              overlayPortfolio(worldsRef.current!.live, p);
              setMySite(p.site ?? null);
            }
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

  // Player-to-player order book: poll both sides while signed in.
  useEffect(() => {
    if (!signedIn) {
      setOrders(null);
      return;
    }
    let alive = true;
    const pull = async () => {
      try {
        const o = await fetchOrders();
        if (alive) setOrders(o);
      } catch {
        /* best-effort */
      }
    };
    pull();
    const t = setInterval(pull, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [signedIn]);

  // Sandbox Order Desk: roll/expire local orders on a short beat (demand pulls
  // toward what you produce + heated sectors; faster when the market is hot).
  useEffect(() => {
    if (mode !== "sandbox") return;
    const tick = () => {
      const sbx = worldsRef.current!.sandbox;
      const now = Date.now();
      setMarketEvent(sbx, now); // telegraphed surge boosts its sector's orders
      let changed = rollSandboxOrders(sbx, now);
      if (autoNegotiate(sbx, now)) changed = true; // Procurement Specialist
      if (autoFulfillOrders(sbx, now)) changed = true; // Auto-Fulfill
      if (changed) refresh();
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [mode, refresh]);

  // Report log: when a new period (flip) is captured, stamp it, surface a
  // daily-report card, and (sandbox only) persist the log to localStorage. Live
  // reports are server-captured on the 6h settlement and arrive via the
  // portfolio overlay; sandbox captures them locally as the clock warps.
  useEffect(() => {
    const w = worldsRef.current![mode];
    const reps = w.reports;
    if (!reps.length) return;
    const latest = reps[reps.length - 1]!;
    if (latest.period === lastReportRef.current) return;
    const firstSeen = lastReportRef.current === -1;
    for (const r of reps) if (!r.at) r.at = Date.now();
    lastReportRef.current = latest.period;
    if (mode === "sandbox") {
      try {
        window.localStorage.setItem(
          REPORTS_KEY,
          JSON.stringify({ periodNo: w.periodNo, reports: reps }),
        );
      } catch {
        /* ignore */
      }
    }
    if (!firstSeen) setDailyReport(latest); // popup on genuinely new flips only
  }, [tick, mode]);

  // Reset the report watermark on mode switch so we don't pop a stale flip.
  useEffect(() => {
    lastReportRef.current = -1;
  }, [mode]);

  const dismissDailyReport = useCallback(() => setDailyReport(null), []);

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
    // Sandbox is dev-only; never let it engage on the public site.
    setModeState(m === "sandbox" && !sandboxEnabled() ? "live" : m);
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
        setMySite(p.site ?? null);
      }
    } catch {
      /* best-effort */
    }
    refresh();
  }, [refresh]);

  // Save the player's company-site config, then reflect it locally.
  const saveSite = useCallback(
    async (patch: Partial<SiteConfig>): Promise<CompanySite | null> => {
      if (!isSignedIn()) {
        authSignIn();
        return null;
      }
      const r = await apiSaveSite(patch);
      if ("error" in r) {
        showToast(
          r.error === "that address is taken"
            ? "That address is taken"
            : r.error === "name your Holding first"
              ? "Name your Holding first"
              : "Couldn't save your site",
        );
        return null;
      }
      setMySite(r.site);
      showToast(r.site.published ? "Site published" : "Draft saved");
      return r.view;
    },
    [showToast],
  );

  const refreshOrders = useCallback(async () => {
    try {
      setOrders(await fetchOrders());
    } catch {
      /* best-effort */
    }
  }, []);

  // Buyer: send a bulk request to a company storefront.
  const requestOrder = useCallback(
    async (sellerHandle: string, itemId: number, qty: number, price: number) => {
      if (!isSignedIn()) {
        authSignIn();
        return false;
      }
      const r = await apiCreateOrder({ sellerHandle, itemId, qty, price });
      if ("error" in r) {
        showToast(
          r.error === "name your Holding first"
            ? "Name your Holding first"
            : r.error.startsWith("they only have")
              ? r.error.charAt(0).toUpperCase() + r.error.slice(1)
              : r.error === "that's your own company"
                ? "That's your own company"
                : r.error === "they don't list that"
                  ? "They don't list that anymore"
                  : r.error === "you can't cover that offer"
                    ? "You can't cover that offer"
                    : r.error === "your open requests would exceed your cash"
                      ? "Your open requests would exceed your cash"
                      : "Couldn't send the request",
        );
        return false;
      }
      showToast("Request sent");
      void refreshOrders();
      return true;
    },
    [showToast, refreshOrders],
  );

  // M&A: offer to acquire another player's entire firm (consensual full buyout).
  const requestBuyout = useCallback(
    async (sellerHandle: string, price: number) => {
      if (!isSignedIn()) {
        authSignIn();
        return false;
      }
      const r = await apiCreateBuyout(sellerHandle, price);
      if ("error" in r) {
        showToast(
          r.error === "name your Holding first"
            ? "Name your Holding first"
            : r.error === "that's your own company"
              ? "That's your own firm"
              : r.error === "you can't cover that offer"
                ? "You can't cover that offer"
                : r.error === "your open offers would exceed your cash"
                  ? "Your open offers would exceed your cash"
                  : r.error === "no such company"
                    ? "Can't find that firm"
                    : "Couldn't send the offer",
        );
        return false;
      }
      showToast("Buyout offer sent");
      void refreshOrders();
      return true;
    },
    [showToast, refreshOrders],
  );

  // Either side: act on a P2P order. Accept settles, so resync cash + holdings.
  const orderAct = useCallback(
    async (
      id: string,
      action: "accept" | "decline" | "counter" | "withdraw",
      price?: number,
    ) => {
      const r = await apiOrderAction(id, action, price);
      if ("error" in r) {
        showToast(
          r.error === "not your move"
            ? "Not your move yet"
            : r.error.startsWith("buyer can't")
              ? "Buyer can't cover it right now"
              : r.error === "seller no longer holds enough"
                ? "Not enough stock to deliver"
                : "Couldn't do that",
        );
        await refreshOrders();
        return;
      }
      const verb =
        action === "accept"
          ? "Deal closed"
          : action === "counter"
            ? "Counter sent"
            : action === "decline"
              ? "Declined"
              : "Withdrawn";
      showToast(verb);
      await refreshOrders();
      if (action === "accept") await syncLive(); // cash + vault changed
    },
    [showToast, refreshOrders, syncLive],
  );

  // Live factory/sales action: post to the shared world, then overlay the fresh
  // portfolio snapshot the server returns. Returns true on success.
  const liveFactory = useCallback(
    async (
      body: FactoryAction,
      ok?: string,
      errMsg = "Couldn't do that",
    ): Promise<boolean> => {
      if (!isSignedIn()) {
        authSignIn();
        return false;
      }
      const r = await factoryAction(body);
      if ("error" in r) {
        if (r.status === 401) authSignIn();
        else showToast(errMsg);
        return false;
      }
      overlayPortfolio(worldsRef.current!.live, r);
      if (ok) showToast(ok);
      refresh();
      return true;
    },
    [refresh, showToast],
  );

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

  // Factories run on both worlds: the sandbox mutates the local engine instantly;
  // live posts to the shared world and overlays the server's fresh snapshot.
  const buildLine = useCallback(
    (itemId: number) => {
      const w = worldsRef.current![modeRef.current];
      const it = getItem(itemId);
      if (w.factories.length >= w.floorSlots) {
        showToast("Floor's full — expand it on the Floor tab");
        return;
      }
      const spec = it ? factorySpec(it) : null;
      if (spec && w.cash < spec.buildCost) {
        showToast("Not enough cash to build");
        return;
      }
      if (modeRef.current === "live") {
        void liveFactory(
          { action: "build", itemId },
          `Building ${it?.name ?? "line"}…`,
          "Can't build that line",
        );
        return;
      }
      const f = buildFactory(w, itemId);
      if (!f) {
        showToast("Can't build that line");
        return;
      }
      showToast(`Building ${it?.name ?? "line"}…`);
      refresh();
    },
    [refresh, showToast, liveFactory],
  );

  // Property Market — live posts to the shared world (cash + ownership persist,
  // rent accrues server-side per flip); sandbox mutates the local world.
  const buyEstate = useCallback(
    (propId: number) => {
      const p = propertyById(propId);
      if (modeRef.current === "live") {
        void liveFactory(
          { action: "buy-property", propId },
          `Acquired ${p?.name ?? "property"}`,
          "Can't buy — check your cash",
        );
        return;
      }
      const w = worldsRef.current!.sandbox;
      if (p && w.cash < p.price) {
        showToast("Not enough cash for that property");
        return;
      }
      if (buyProperty(w, propId)) {
        showToast(`Acquired ${p?.name ?? "property"}`);
        refresh();
      } else {
        showToast("Can't buy that property");
      }
    },
    [refresh, showToast, liveFactory],
  );

  const sellEstate = useCallback(
    (propId: number) => {
      const p = propertyById(propId);
      if (modeRef.current === "live") {
        void liveFactory(
          { action: "sell-property", propId },
          `Sold ${p?.name ?? "property"}`,
          "Can't sell that property",
        );
        return;
      }
      const w = worldsRef.current!.sandbox;
      if (sellProperty(w, propId)) {
        showToast(`Sold ${p?.name ?? "property"}`);
        refresh();
      }
    },
    [refresh, showToast, liveFactory],
  );

  // Deal Room — equity stakes in AI houses. Live posts to the shared world
  // (player-record only, like factories); sandbox mutates the local world.
  const buyStakeIn = useCallback(
    (company: string, pct: number) => {
      if (modeRef.current === "live") {
        void liveFactory(
          { action: "buy-stake", company, pct },
          `Bought into ${company}`,
          "Can't buy — check your cash",
        );
        return;
      }
      const w = worldsRef.current!.sandbox;
      const cost = pct * companyValuation(w, company);
      if (w.cash < cost) {
        showToast("Not enough cash for that stake");
        return;
      }
      if (buyStake(w, company, pct)) {
        showToast(`Bought into ${company}`);
        refresh();
      } else {
        showToast("Can't buy that stake");
      }
    },
    [refresh, showToast, liveFactory],
  );

  const sellStakeIn = useCallback(
    (company: string, pct: number) => {
      if (modeRef.current === "live") {
        void liveFactory(
          { action: "sell-stake", company, pct },
          `Sold stake in ${company}`,
          "Can't sell that stake",
        );
        return;
      }
      if (sellStake(worldsRef.current!.sandbox, company, pct)) {
        showToast(`Sold stake in ${company}`);
        refresh();
      }
    },
    [refresh, showToast, liveFactory],
  );

  const demolishLine = useCallback(
    (id: string) => {
      if (modeRef.current === "live") {
        void liveFactory({ action: "demolish", factoryId: id }, "Line torn down");
        return;
      }
      if (demolishFactory(worldsRef.current!.sandbox, id)) {
        showToast("Line torn down");
        refresh();
      }
    },
    [refresh, showToast, liveFactory],
  );

  const addModule = useCallback(
    (factoryId: string, moduleId: string) => {
      if (modeRef.current === "live") {
        void liveFactory(
          { action: "module-add", factoryId, moduleId },
          undefined,
          "Can't install — check your cash",
        );
        return;
      }
      if (installModule(worldsRef.current!.sandbox, factoryId, moduleId)) {
        refresh();
      } else {
        showToast("Can't install — check your cash");
      }
    },
    [refresh, showToast, liveFactory],
  );

  const removeModule = useCallback(
    (factoryId: string, moduleId: string) => {
      if (modeRef.current === "live") {
        void liveFactory({ action: "module-remove", factoryId, moduleId });
        return;
      }
      if (uninstallModule(worldsRef.current!.sandbox, factoryId, moduleId)) {
        refresh();
      }
    },
    [refresh, liveFactory],
  );

  const expandFloor = useCallback(() => {
    if (modeRef.current === "live") {
      void liveFactory(
        { action: "expand" },
        "Floor expanded",
        "Not enough cash to expand",
      );
      return;
    }
    if (engineExpandFloor(worldsRef.current!.sandbox)) {
      showToast("Floor expanded");
      refresh();
    } else {
      showToast("Not enough cash to expand");
    }
  }, [refresh, showToast, liveFactory]);

  const routeLine = useCallback(
    (id: string, bay: number) => {
      if (modeRef.current === "live") {
        void liveFactory({ action: "route", lineId: id, bay });
        return;
      }
      if (engineRouteFactory(worldsRef.current!.sandbox, id, bay)) refresh();
    },
    [refresh, liveFactory],
  );

  const setDeskAutomation = useCallback(
    (patch: { specialist?: boolean; autoFulfill?: boolean; minMargin?: number }) => {
      if (modeRef.current === "live") {
        void liveFactory({ action: "deskauto", patch });
        return;
      }
      engineSetDeskAuto(worldsRef.current!.sandbox, patch);
      refresh();
    },
    [refresh, liveFactory],
  );

  const buyUpgrade = useCallback(
    (id: "power" | "router" | "qc") => {
      if (modeRef.current === "live") {
        void liveFactory(
          { action: "infra", id },
          "Upgrade installed",
          "Already installed or not enough cash",
        );
        return;
      }
      if (engineBuyInfra(worldsRef.current!.sandbox, id)) {
        showToast("Upgrade installed");
        refresh();
      } else {
        showToast("Already installed or not enough cash");
      }
    },
    [refresh, showToast, liveFactory],
  );

  const setLineSource = useCallback(
    (lineId: string, inputItemId: number, feederId: string | null) => {
      if (modeRef.current === "live") {
        void liveFactory({ action: "source", lineId, inputItemId, feederId });
        return;
      }
      if (engineSetSource(worldsRef.current!.sandbox, lineId, inputItemId, feederId))
        refresh();
    },
    [refresh, liveFactory],
  );

  const setSellPrice = useCallback(
    (itemId: number, mult: number) => {
      if (modeRef.current === "live") {
        void liveFactory({ action: "listprice", itemId, mult });
        return;
      }
      engineSetListPrice(worldsRef.current!.sandbox, itemId, mult);
      refresh();
    },
    [refresh, liveFactory],
  );

  const setListing = useCallback(
    (itemId: number, on: boolean) => {
      if (modeRef.current === "live") {
        void liveFactory({ action: "listed", itemId, on });
        return;
      }
      engineSetListed(worldsRef.current!.sandbox, itemId, on);
      refresh();
    },
    [refresh, liveFactory],
  );

  const signIn = useCallback(() => {
    void authSignIn();
  }, []);
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
  const nameHolding = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) return;
      void deskAction("name", { name: trimmed }).then((d) => {
        if ("error" in d) {
          showToast(d.error);
        } else {
          setDesk(d);
          setRenaming(false);
        }
      });
    },
    [showToast],
  );
  const startRename = useCallback(() => setRenaming(true), []);
  const cancelRename = useCallback(() => setRenaming(false), []);

  // Accept the client's current standing offer outright (no counter).
  const acceptOrder = useCallback(
    (id: string) => {
      if (modeRef.current === "sandbox") {
        const r = acceptSandboxOffer(worldsRef.current!.sandbox, id, Date.now());
        if (r.kind === "deal")
          showToast(`Deal · ${moneyShort(r.price)} — deliver before the timer`);
        refresh();
        return;
      }
      void deskAction("accept", { orderId: id }).then((d) => {
        if ("error" in d) {
          showToast("Couldn't accept");
          return;
        }
        setDesk(d);
        if (d.note?.kind === "deal")
          showToast(`Deal · ${moneyShort(d.note.price)} — deliver within 2h`);
      });
    },
    [refresh, showToast],
  );

  // Counter with an ask; the client haggles within its hidden budget.
  const counterOrder = useCallback(
    (id: string, bid: number) => {
      if (modeRef.current === "sandbox") {
        const n = negotiateSandbox(worldsRef.current!.sandbox, id, bid, Date.now());
        if (n.kind === "invalid") showToast("Enter a valid bid");
        else if (n.kind === "deal")
          showToast(`Deal · ${moneyShort(n.price)} — deliver before the timer`);
        else if (n.kind === "counter")
          showToast(
            `Countered: ${moneyShort(n.offer)}${n.overBudget ? " · over their budget" : ""}`,
          );
        else if (n.kind === "pullout") showToast("They walked away");
        refresh();
        return;
      }
      void deskAction("counter", { orderId: id, bid }).then((d) => {
        if ("error" in d) {
          showToast(d.error === "invalid bid" ? "Enter a valid bid" : "Couldn't send");
          return;
        }
        setDesk(d);
        const n = d.note;
        if (!n) return;
        if (n.kind === "deal")
          showToast(`Deal · ${moneyShort(n.price)} — deliver within 2h`);
        else if (n.kind === "counter")
          showToast(
            `${n.company ?? "They"} countered: ${moneyShort(n.offer)}${
              n.overBudget ? " · over their budget" : ""
            }`,
          );
        else if (n.kind === "pullout")
          showToast(`${n.company ?? "They"} walked away`);
      });
    },
    [refresh, showToast],
  );

  const declineOrder = useCallback(
    (id: string) => {
      if (modeRef.current === "sandbox") {
        declineSandboxOrder(worldsRef.current!.sandbox, id);
        refresh();
        return;
      }
      void deskAction("decline", { orderId: id }).then((d) => {
        if (!("error" in d)) setDesk(d);
      });
    },
    [refresh],
  );

  const fulfillOrder = useCallback(
    (id: string) => {
      if (modeRef.current === "sandbox") {
        const r = fulfillSandboxOrder(worldsRef.current!.sandbox, id, Date.now());
        showToast(
          r.ok
            ? `Order fulfilled · +${moneyShort(r.quote)}`
            : r.reason === "not enough in your vault"
              ? "Not enough in your vault"
              : r.reason === "deadline passed"
                ? "Deadline passed"
                : "Couldn't fulfill",
        );
        refresh();
        return;
      }
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
    [refresh, showToast, syncLive],
  );

  // The desk is mode-aware: in sandbox it's derived from the local world; in
  // live it's the server-backed state. One Desk screen serves both.
  const effectiveDesk =
    mode === "sandbox"
      ? sandboxDeskView(worldsRef.current!.sandbox, desk?.name ?? null)
      : desk;

  const value = useMemo<Trove>(
    () => ({
      mounted,
      state,
      mode,
      factoryCycle: mode === "live" ? wallProdCycle() : state.cycle,
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
      buildLine,
      buyEstate,
      sellEstate,
      buyStakeIn,
      sellStakeIn,
      demolishLine,
      addModule,
      removeModule,
      expandFloor,
      routeLine,
      setLineSource,
      setSellPrice,
      setListing,
      buyUpgrade,
      setDeskAutomation,
      closeReveal,
      signedIn,
      authReady,
      signIn,
      signOut,
      desk: effectiveDesk,
      acceptOrder,
      counterOrder,
      declineOrder,
      fulfillOrder,
      nameHolding,
      renaming,
      startRename,
      cancelRename,
      dailyReport,
      dismissDailyReport,
      mySite,
      saveSite,
      orders,
      requestOrder,
      requestBuyout,
      orderAct,
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
      buildLine,
      buyEstate,
      sellEstate,
      buyStakeIn,
      sellStakeIn,
      demolishLine,
      addModule,
      removeModule,
      expandFloor,
      routeLine,
      setLineSource,
      setSellPrice,
      setListing,
      buyUpgrade,
      setDeskAutomation,
      closeReveal,
      signedIn,
      authReady,
      signIn,
      signOut,
      effectiveDesk,
      acceptOrder,
      counterOrder,
      declineOrder,
      fulfillOrder,
      nameHolding,
      renaming,
      startRename,
      cancelRename,
      dailyReport,
      dismissDailyReport,
      mySite,
      saveSite,
      orders,
      requestOrder,
      requestBuyout,
      orderAct,
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
