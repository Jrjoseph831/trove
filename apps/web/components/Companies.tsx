"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Building2, Globe, Pencil } from "lucide-react";
import { getItem, recipeOf, sectorLabel, type SectorKey } from "@trove/data";
import {
  listedUnitPrice,
  makerVariantName,
  type SiteConfig,
  type SiteSectionId,
} from "@trove/engine";
import {
  fetchCompanies,
  fetchCompany,
  fetchHouse,
  type CompanyProduct,
  type CompanySite,
  type DirEntry,
} from "@/lib/api";
import { resolveDisplay } from "@/lib/display";
import { manufacturingName, money, moneyShort } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";

const SECTION_LABELS: Record<SiteSectionId, string> = {
  masthead: "Masthead",
  about: "About / The Firm",
  storefront: "Storefront",
  standing: "Market Standing",
  contact: "Contact · Bulk orders",
};
const DEFAULT_SECTIONS: { id: SiteSectionId; on: boolean }[] = [
  { id: "masthead", on: true },
  { id: "about", on: true },
  { id: "storefront", on: true },
  { id: "standing", on: true },
  { id: "contact", on: false },
];

const label = (key: string): string =>
  key ? sectorLabel(key as SectorKey) : "—";

/** Build the signed-in player's own storefront from the live world state, so the
 *  owner gets an instant preview (their listed produced goods, at their price).
 *  Applies Studio customizations so the preview matches exactly what buyers see. */
function ownStorefront(
  state: ReturnType<typeof useTrove>["state"],
  holding: string | null | undefined,
  customizations: ReturnType<typeof useTrove>["myCustomizations"],
): CompanyProduct[] {
  const prod = state.producedQty ?? {};
  const qcOn = !!state.infra?.qc;
  const out: CompanyProduct[] = [];
  for (const idStr of Object.keys(prod)) {
    const id = Number(idStr);
    const qty = prod[id] ?? 0;
    if (qty <= 0) continue;
    if (state.listed?.[id] === false) continue;
    const it = state.items.find((i) => i.id === id);
    if (!it) continue;
    const mult = state.listPrices?.[id] ?? 1;
    const c = customizations[id];
    out.push({
      id,
      name: makerVariantName(it.name, holding, id),
      price: Math.round(listedUnitPrice(it.value, mult, qcOn)),
      available: qty,
      ...(c?.displayName && { displayName: c.displayName }),
      ...(c?.customImageUrl && { customImageUrl: c.customImageUrl }),
      ...(c?.customDescription && { customDescription: c.customDescription }),
    });
  }
  return out.sort((a, b) => b.price - a.price);
}

export function Companies() {
  const { mode, state, mySite, myStudio, myCustomizations, desk, signedIn, signIn } = useTrove();
  const [open, setOpen] = useState<string | null>(null); // handle being viewed
  const [editing, setEditing] = useState(false);

  if (mode === "sandbox") {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Companies</h2>
        </div>
        <div className="empty">
          Company websites are a live-world feature — sign in on the live market to
          build your storefront and browse others.
        </div>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Companies</h2>
        </div>
        <div className="empty">
          Sign in to build your company website and browse the directory.
          <div style={{ marginTop: 14 }}>
            <button className="site-btn" onClick={signIn}>
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (editing) {
    return <Builder onDone={() => setEditing(false)} />;
  }

  if (open === "__me__") {
    // Published → show your REAL public page (server data, real rank), exactly as
    // others see it, with your owner controls. Not published yet → local draft.
    if (mySite?.published && mySite.handle) {
      return (
        <RemoteSite
          handle={mySite.handle}
          kind="player"
          owner
          onEdit={() => setEditing(true)}
          onBack={() => setOpen(null)}
        />
      );
    }
    const site = ownPreview(mySite, desk?.name ?? null, ownStorefront(state, manufacturingName(desk?.name), myCustomizations), state, myStudio);
    return (
      <SiteView
        site={site}
        owner
        onBack={() => setOpen(null)}
        onEdit={() => setEditing(true)}
      />
    );
  }

  if (open?.startsWith("house:")) {
    return <RemoteSite handle={open.slice(6)} kind="house" onBack={() => setOpen(null)} />;
  }

  if (open) {
    return <RemoteSite handle={open} kind="player" onBack={() => setOpen(null)} />;
  }

  return (
    <Directory
      hasSite={!!mySite?.handle}
      published={!!mySite?.published}
      myName={desk?.name ?? null}
      onOpenMine={() => setOpen("__me__")}
      onEdit={() => setEditing(true)}
      onOpen={(e) => setOpen(e.kind === "house" ? `house:${e.handle}` : e.handle)}
    />
  );
}

/** The signed-in player's own holdings + net worth, from the live world state. */
function ownFinances(state: ReturnType<typeof useTrove>["state"]) {
  let assets = 0;
  const holdings: CompanySite["holdings"] = [];
  for (const it of state.items) {
    const qty = it.owners["YOU"] ?? 0;
    if (qty > 0) {
      assets += qty * it.value;
      holdings.push({ id: it.id, name: it.name, qty, value: it.value });
    }
  }
  holdings.sort((a, b) => b.qty * b.value - a.qty * a.value);
  return {
    netWorth: Math.round(state.cash - (state.debt ?? 0) + assets),
    cash: Math.round(state.cash),
    holdings: holdings.slice(0, 12),
  };
}

/** Assemble a CompanySite for the owner's own preview (rank unknown locally). */
function ownPreview(
  site: SiteConfig | null,
  name: string | null,
  storefront: CompanyProduct[],
  state: ReturnType<typeof useTrove>["state"],
  studio?: ReturnType<typeof useTrove>["myStudio"],
): CompanySite {
  const sectors = dominantSectors(storefront, state);
  const fin = ownFinances(state);
  return {
    handle: site?.handle ?? "",
    name: name ?? "Your Holding",
    kind: "player",
    tagline: site?.tagline ?? "",
    accent: site?.accent ?? "gold",
    sector: sectors[0] ?? "",
    products: storefront.length,
    about: site?.about ?? "",
    sections: site?.sections ?? DEFAULT_SECTIONS,
    storefront,
    netWorth: fin.netWorth,
    cash: fin.cash,
    holdings: fin.holdings,
    standing: {
      rank: null,
      lines: state.factories.length,
      sectors,
    },
    ...(studio?.unlocked && studio?.logoUrl ? { logoUrl: studio.logoUrl } : {}),
    ...(studio?.unlocked && studio?.bannerUrl ? { bannerUrl: studio.bannerUrl } : {}),
  };
}

function dominantSectors(
  store: CompanyProduct[],
  state: ReturnType<typeof useTrove>["state"],
): string[] {
  const tally: Record<string, number> = {};
  const ids = store.length
    ? store.map((p) => p.id)
    : state.factories.map((f) => f.itemId);
  for (const id of ids) {
    const it = getItem(id);
    if (!it) continue;
    let best = "";
    let bw = -1;
    for (const k in it.weights) {
      const w = it.weights[k] ?? 0;
      if (w > bw) {
        bw = w;
        best = k;
      }
    }
    if (best) tally[best] = (tally[best] ?? 0) + 1;
  }
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s)
    .slice(0, 3);
}

// ── One unified directory: every firm on the market ───────────────────────
function Directory({
  hasSite,
  published,
  myName,
  onOpenMine,
  onEdit,
  onOpen,
}: {
  hasSite: boolean;
  published: boolean;
  myName: string | null;
  onOpenMine: () => void;
  onEdit: () => void;
  onOpen: (entry: DirEntry) => void;
}) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCompanies()
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="view">
      <div className="page-col">
        <div className="cat-head">
          <h2 className="serif">Companies</h2>
        </div>

        <div className="site-myrow">
        <div className="site-myinfo">
          <span className="site-mylab">Your company</span>
          {hasSite ? (
            <b className="site-mylink" onClick={onOpenMine}>
              {manufacturingName(myName)}
            </b>
          ) : (
            <b>{manufacturingName(myName)}</b>
          )}
          <span className="site-mystate">
            {!hasSite
              ? "Not set up yet"
              : published
                ? "Published · live in the directory"
                : "Draft · only you can see it"}
          </span>
        </div>
        <div className="site-myactions">
          {hasSite && (
            <button className="site-btn ghost" onClick={onOpenMine}>
              View
            </button>
          )}
          <button className="site-btn" onClick={onEdit}>
            <Pencil size={13} /> {hasSite ? "Edit page" : "Build my page"}
          </button>
        </div>
      </div>

      <div className="site-dirhead">The Directory · every firm on the market</div>
      {entries === null ? (
        <div className="empty">Loading the directory…</div>
      ) : entries.length === 0 ? (
        <div className="empty">No firms on the market yet.</div>
      ) : (
        <div className="site-grid">
          {entries.map((e) => (
            <button
              key={`${e.kind}:${e.handle}`}
              className="site-card"
              onClick={() => onOpen(e)}
            >
              <span className={`site-card-accent a-${e.accent}`} />
              <span className="site-card-sector">{e.sector ? label(e.sector) : "Index"}</span>
              <span className="site-card-name">
                {e.kind === "player" ? manufacturingName(e.name) : e.name}
              </span>
              <span className="site-card-foot">
                Net worth <b>{moneyShort(e.netWorth)}</b>
              </span>
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

// ── A remote company's page (fetched — player OR AI house, same component) ───
function RemoteSite({
  handle,
  kind,
  owner,
  onEdit,
  onBack,
}: {
  handle: string;
  kind: "player" | "house";
  owner?: boolean;
  onEdit?: () => void;
  onBack: () => void;
}) {
  const [site, setSite] = useState<CompanySite | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setSite(null);
    setErr(false);
    (kind === "house" ? fetchHouse(handle) : fetchCompany(handle))
      .then((s) => alive && setSite(s))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [handle, kind]);

  if (err) {
    return (
      <div className="view">
        <button className="site-back" onClick={onBack}>
          ← Directory
        </button>
        <div className="empty">That company couldn&apos;t be found.</div>
      </div>
    );
  }
  if (!site) {
    return (
      <div className="view">
        <button className="site-back" onClick={onBack}>
          ← Directory
        </button>
        <div className="empty">Opening {handle}…</div>
      </div>
    );
  }
  return <SiteView site={site} owner={owner} onEdit={onEdit} onBack={onBack} />;
}

/** Top holdings grid — the transparent, auditable inventory, on every page. */
function HoldingsGrid({ holdings }: { holdings: CompanySite["holdings"] }) {
  if (!holdings.length) return null;
  return (
    <section className="site-sec">
      <h2 className="site-h">Holdings</h2>
      <div className="store-grid">
        {holdings.map((it) => {
          const cat = getItem(it.id);
          return (
            <div className="store-card" key={it.id}>
              <span className="store-ic">{cat ? <ItemIcon it={cat} size={22} /> : null}</span>
              <span className="store-nm">{it.name}</span>
              <span className="store-pr">{money(it.qty * it.value)}</span>
              <span className="store-av">
                {it.qty.toLocaleString()} × {money(it.value)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── The rendered company page (one layout for players AND AI houses) ────────
const ALWAYS_ON = new Set(["masthead", "storefront", "standing"]);

/** Exported so the public page at /<handle> renders the EXACT same layout as
 *  the in-sim view — one component, so the two can't drift apart. Omitting
 *  `onBack` switches the chrome from in-app (back to Directory) to standalone
 *  (wordmark + a way into the market). */
export function SiteView({
  site,
  owner,
  onBack,
  onEdit,
}: {
  site: CompanySite;
  owner?: boolean;
  onBack?: () => void;
  onEdit?: () => void;
}) {
  const [req, setReq] = useState<CompanyProduct | null>(null);
  const isHouse = site.kind === "house";
  const sections = (site.sections.length ? site.sections : DEFAULT_SECTIONS).filter(
    (s) => s.on || ALWAYS_ON.has(s.id),
  );
  const displayName = isHouse ? site.name : manufacturingName(site.name);
  const eyebrow = isHouse
    ? site.sector
      ? `${label(site.sector)} · Institutional firm`
      : "Broad-market index"
    : `${label(site.sector)} · Manufacturing`;
  const canRequest = !owner && !isHouse && !!site.handle;

  return (
    <div className="view">
      <div className="site-bar">
        {onBack ? (
          <button className="site-back" onClick={onBack}>
            ← Directory
          </button>
        ) : (
          <a className="site-back" href="/">
            TROVE
          </a>
        )}
        <span className="site-url">
          <Globe size={12} />{" "}
          {site.handle ? `trove.ceo/${site.handle}` : "unpublished"}
        </span>
        {owner && onEdit && (
          <button className="site-btn" onClick={onEdit}>
            <Pencil size={13} /> Edit
          </button>
        )}
        {!onBack && (
          <a className="site-btn" href="/">
            Enter the market
          </a>
        )}
      </div>

      <div className={`site a-${site.accent}`}>
        {sections.map((sec) => {
          if (sec.id === "masthead")
            return (
              <header className="site-masthead" key="masthead">
                {(site.bannerUrl || site.logoUrl) && (
                  <div
                    className="site-brand-banner"
                    style={site.bannerUrl ? { backgroundImage: `url(${site.bannerUrl})` } : undefined}
                  >
                    {site.logoUrl && (
                      <img className="site-brand-logo" src={site.logoUrl} alt={displayName} />
                    )}
                  </div>
                )}
                <div className="site-masthead-body">
                  <div className="site-eyebrow">{eyebrow}</div>
                  <h1>{displayName}</h1>
                  {site.tagline && <p className="site-tag">{site.tagline}</p>}
                </div>
              </header>
            );
          if (sec.id === "about" && sec.on && !isHouse)
            return (
              <section className="site-sec" key="about">
                <h2 className="site-h">The Firm</h2>
                <p className="site-about">{site.about || "A firm on the Trove market."}</p>
              </section>
            );
          if (sec.id === "standing")
            return (
              <section className="site-sec" key="standing">
                <h2 className="site-h">Standing</h2>
                <div className="site-standing">
                  <div>
                    <span className="ss-lab">Net worth</span>
                    <span className="ss-v">{moneyShort(site.netWorth)}</span>
                  </div>
                  <div>
                    <span className="ss-lab">Market rank</span>
                    <span className="ss-v">
                      {site.standing.rank ? `#${site.standing.rank}` : "—"}
                    </span>
                  </div>
                  {site.standing.lines > 0 && (
                    <div>
                      <span className="ss-lab">Production lines</span>
                      <span className="ss-v">{site.standing.lines}</span>
                    </div>
                  )}
                  <div>
                    <span className="ss-lab">Sectors</span>
                    <span className="ss-v small">
                      {site.standing.sectors.map(label).join(" · ") || "—"}
                    </span>
                  </div>
                </div>
              </section>
            );
          if (sec.id === "storefront" && site.storefront.length > 0)
            return (
              <Storefront
                key="storefront"
                products={site.storefront}
                owner={owner}
                sellerHandle={site.handle}
                onRequest={canRequest ? (p) => setReq(p) : undefined}
              />
            );
          if (sec.id === "contact" && sec.on && !isHouse)
            return (
              <section className="site-sec" key="contact">
                <h2 className="site-h">Bulk orders</h2>
                <p className="site-about">
                  {displayName} takes bulk contracts through the Order Desk. Hit{" "}
                  <b>Request</b> on any product to send an offer.
                </p>
              </section>
            );
          return null;
        })}
        <HoldingsGrid holdings={site.holdings} />
      </div>
      {req && (
        <RequestModal
          handle={site.handle}
          seller={site.name}
          product={req}
          onClose={() => setReq(null)}
        />
      )}
    </div>
  );
}

function Storefront({
  products,
  owner,
  sellerHandle,
  onRequest,
}: {
  products: CompanyProduct[];
  owner?: boolean;
  /** Absent for the owner's own live preview (no standing-source affordance
   *  makes sense there — the "Request"/"set as standing source" actions
   *  never render for your own storefront either way). */
  sellerHandle?: string;
  onRequest?: (p: CompanyProduct) => void;
}) {
  return (
    <section className="site-sec" key="storefront">
      <h2 className="site-h">Storefront</h2>
      {products.length === 0 ? (
        <p className="site-about">
          {owner
            ? "No products listed. List produced goods on the Vault tab and they'll appear here."
            : "Nothing in stock right now."}
        </p>
      ) : (
        <div className="store-grid">
          {products.map((p) => {
            const it = getItem(p.id);
            const label = p.displayName ?? p.name;
            return (
              <div className="store-card" key={p.id}>
                <span className="store-ic">
                  {p.customImageUrl
                    ? <img className="store-custom-img" src={p.customImageUrl} alt={label} />
                    : it ? <ItemIcon it={it} size={22} /> : null
                  }
                </span>
                <span className="store-nm">{label}</span>
                {p.customDescription && (
                  <span className="store-desc">{p.customDescription}</span>
                )}
                <span className="store-pr">{money(p.price)}</span>
                <span className="store-av">{p.available.toLocaleString()} available</span>
                <button
                  className="store-req"
                  disabled={!onRequest}
                  onClick={onRequest ? () => onRequest(p) : undefined}
                  title={onRequest ? "Request a bulk order" : "Your own storefront"}
                >
                  Request
                </button>
                {onRequest && sellerHandle && (
                  <StandingSourcePicker product={p} sellerHandle={sellerHandle} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** "Set as standing source" — only rendered for a real other player's
 *  storefront (same gate as the Request button). Lists the viewer's OWN
 *  factory lines whose recipe consumes this product, so picking one wires
 *  that line to auto-buy from THIS seller each production tick. Nothing to
 *  show if the viewer has no eligible line — no point cluttering the card. */
function StandingSourcePicker({
  product,
  sellerHandle,
}: {
  product: CompanyProduct;
  sellerHandle: string;
}) {
  const { state, mode, setStandingLineSource } = useTrove();
  if (mode !== "live") return null; // sandbox has no other real players

  const eligible = state.factories.filter((f) => {
    const out = getItem(f.itemId);
    return !!out && !!recipeOf(out)?.inputs.some((inp) => inp.itemId === product.id);
  });
  if (eligible.length === 0) return null;

  return (
    <select
      className="store-standing"
      value=""
      title="Set as a standing source for one of your lines"
      onChange={(e) => {
        const lineId = e.target.value;
        if (!lineId) return;
        setStandingLineSource(lineId, product.id, sellerHandle);
        e.target.value = "";
      }}
    >
      <option value="">Set as standing source…</option>
      {eligible.map((f) => {
        const out = getItem(f.itemId);
        return (
          <option key={f.id} value={f.id}>
            For my {out?.name ?? "line"} line
          </option>
        );
      })}
    </select>
  );
}

/** Buyer's bulk-order composer for a storefront product. */
function RequestModal({
  handle,
  seller,
  product,
  onClose,
}: {
  handle: string;
  seller: string;
  product: CompanyProduct;
  onClose: () => void;
}) {
  const { state, requestOrder } = useTrove();
  // product.price is the per-UNIT listed price from the server.
  const unitPrice = product.price;
  const startQty = Math.min(10, product.available) || 1;
  // Both fields hold TEXT and coerce on read. Clamping per keystroke made them
  // impossible to clear — deleting the last digit snapped straight back to 1,
  // so you could only ever append to the number already there.
  const [qtyText, setQtyText] = useState(String(startQty));
  const [offerText, setOfferText] = useState(String(unitPrice * startQty));
  const [busy, setBusy] = useState(false);
  const qty = Math.max(0, Math.floor(Number(qtyText) || 0));
  const offer = Math.max(0, Math.round(Number(offerText) || 0));

  /** On blur, settle the field to something legal and re-anchor the offer to
   *  list price for the new quantity. */
  const settleQty = () => {
    const q = Math.max(1, Math.min(product.available, qty || 1));
    setQtyText(String(q));
    setOfferText(String(unitPrice * q));
  };

  const send = async () => {
    setBusy(true);
    const ok = await requestOrder(handle, product.id, qty, Math.round(offer));
    setBusy(false);
    if (ok) onClose();
  };

  const cash = state.cash;
  const short = Math.round(offer) > cash;

  return (
    <div className="reveal-bg show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="reqmodal">
        <div className="req-co">{manufacturingName(seller)}</div>
        <div className="req-item">{product.name}</div>
        <div className="req-sub">
          List {money(unitPrice)}/unit · {product.available.toLocaleString()} available
        </div>

        <label className="req-field">
          <span>Quantity</span>
          <input
            type="number"
            min={1}
            max={product.available}
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            onBlur={settleQty}
          />
        </label>

        <label className="req-field">
          <span>Your offer (total)</span>
          <input
            type="number"
            min={1}
            value={offerText}
            onChange={(e) => setOfferText(e.target.value)}
            onBlur={() => setOfferText(String(Math.max(1, offer)))}
          />
        </label>
        <div className="req-meta">
          {money(Math.round(offer / Math.max(1, qty)))}/unit · your cash {moneyShort(cash)}
        </div>
        {short && <div className="req-warn">That's more than your cash on hand.</div>}

        <div className="req-actions">
          <button className="site-btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="site-btn"
            onClick={send}
            disabled={busy || short || qty < 1 || offer < 1}
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── The modular builder ─────────────────────────────────────────────────────
function Builder({ onDone }: { onDone: () => void }) {
  const { mySite, myStudio, myCustomizations, saveSite, desk, state } = useTrove();
  const baseHandle = useMemo(
    () =>
      mySite?.handle ||
      (desk?.name ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 30),
    [mySite?.handle, desk?.name],
  );
  const [handle, setHandle] = useState(baseHandle);
  const [tagline, setTagline] = useState(mySite?.tagline ?? "");
  const [about, setAbout] = useState(mySite?.about ?? "");
  const [accent, setAccent] = useState<SiteConfig["accent"]>(mySite?.accent ?? "gold");
  const [sections, setSections] = useState<{ id: SiteSectionId; on: boolean }[]>(
    mySite?.sections?.length ? mySite.sections : DEFAULT_SECTIONS,
  );
  const [autoSupply, setAutoSupply] = useState(mySite?.autoSupply ?? false);
  const [busy, setBusy] = useState(false);

  const move = useCallback((i: number, dir: -1 | 1) => {
    setSections((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }, []);
  const toggle = useCallback((id: SiteSectionId) => {
    if (id === "masthead" || id === "storefront" || id === "standing") return; // always on
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, on: !s.on } : s)));
  }, []);

  const draft: Partial<SiteConfig> = { handle, tagline, about, accent, sections, autoSupply };
  const preview = ownPreview(
    { handle, tagline, about, accent, sections },
    desk?.name ?? null,
    ownStorefront(state, manufacturingName(desk?.name), myCustomizations),
    state,
    myStudio,
  );

  const save = async (publish: boolean) => {
    setBusy(true);
    const r = await saveSite({ ...draft, published: publish });
    setBusy(false);
    if (r) onDone();
  };

  return (
    <div className="view">
      <div className="site-bar">
        <button className="site-back" onClick={onDone}>
          ← Companies
        </button>
        <span className="site-url">Editing your site</span>
      </div>

      <div className="builder">
        <div className="bld-form">
          <label className="bld-row">
            <span>Address</span>
            {/* Prefix, not suffix: the page really does live at
                trove.ceo/<handle>, so the preview should read as the URL
                someone can actually type. The old ".trove" suffix looked
                like a domain that nothing served. */}
            <span className="bld-handle">
              <em>trove.ceo/</em>
              <input
                value={handle}
                maxLength={30}
                onChange={(e) =>
                  setHandle(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  )
                }
                placeholder="your-company"
              />
            </span>
          </label>

          <label className="bld-row">
            <span>Tagline</span>
            <input
              value={tagline}
              maxLength={120}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="One line about your firm"
            />
          </label>

          <label className="bld-row">
            <span>About</span>
            <textarea
              value={about}
              maxLength={1200}
              rows={4}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="What you make, what you stand for…"
            />
          </label>

          <div className="bld-row">
            <span>Accent</span>
            <div className="bld-accents">
              {(["gold", "steel", "ink"] as const).map((a) => (
                <button
                  key={a}
                  className={`bld-accent a-${a} ${accent === a ? "on" : ""}`}
                  onClick={() => setAccent(a)}
                  aria-label={a}
                />
              ))}
            </div>
          </div>

          <div className="bld-sectionshd">Sections — show, hide, reorder</div>
          <div className="bld-sections">
            {sections.map((s, i) => {
              const locked =
                s.id === "masthead" || s.id === "storefront" || s.id === "standing";
              return (
                <div className={`bld-sec ${s.on ? "" : "off"}`} key={s.id}>
                  <span className="bld-secnm">{SECTION_LABELS[s.id]}</span>
                  <div className="bld-secctl">
                    <button
                      className="bld-mv"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      className="bld-mv"
                      onClick={() => move(i, 1)}
                      disabled={i === sections.length - 1}
                      aria-label="Move down"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      className={`bld-tog ${s.on ? "on" : ""}`}
                      onClick={() => toggle(s.id)}
                      disabled={locked}
                      title={locked ? "Always shown" : s.on ? "Showing" : "Hidden"}
                    >
                      {locked ? "always" : s.on ? "shown" : "hidden"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="bld-note">
            Products come from your <b>listed</b> vault goods — list or unlist them
            on the Vault tab to control what appears in your storefront.
          </p>

          <div className="bld-row">
            <span>Standing supply</span>
            <button
              type="button"
              className={`da-toggle ${autoSupply ? "on" : ""}`}
              onClick={() => setAutoSupply((v) => !v)}
            >
              {autoSupply ? "On" : "Off"}
            </button>
          </div>
          <p className="bld-note">
            When on, other players can set your storefront as a{" "}
            <b>standing source</b> for a factory input — their line auto-buys
            from you each production tick at your live listed price, no
            accepting required. Off by default; nothing is drawn from you
            without this.
          </p>

          <div className="bld-actions">
            <button className="site-btn ghost" disabled={busy} onClick={() => save(false)}>
              Save draft
            </button>
            <button className="site-btn" disabled={busy} onClick={() => save(true)}>
              {busy ? "Saving…" : "Publish"}
            </button>
          </div>
        </div>

        <div className="bld-preview">
          <div className="bld-previewlab">Live preview</div>
          <div className={`site a-${accent} mini`}>
            <header className="site-masthead">
              <div className="site-eyebrow">{label(preview.sector)} · Manufacturing</div>
              <h1>{manufacturingName(desk?.name ?? null)}</h1>
              {tagline && <p className="site-tag">{tagline}</p>}
            </header>
            {sections.filter((s) => s.on).map((s) => {
              if (s.id === "about")
                return (
                  <section className="site-sec" key="about">
                    <h2 className="site-h">The Firm</h2>
                    <p className="site-about">{about || "Your story goes here."}</p>
                  </section>
                );
              if (s.id === "storefront")
                return <Storefront key="storefront" products={preview.storefront} owner />;
              if (s.id === "standing")
                return (
                  <section className="site-sec" key="standing">
                    <h2 className="site-h">Standing</h2>
                    <div className="site-standing">
                      <div>
                        <span className="ss-lab">Net worth</span>
                        <span className="ss-v">{moneyShort(preview.netWorth)}</span>
                      </div>
                      <div>
                        <span className="ss-lab">Sectors</span>
                        <span className="ss-v small">
                          {preview.standing.sectors.map(label).join(" · ") || "—"}
                        </span>
                      </div>
                    </div>
                  </section>
                );
              if (s.id === "contact")
                return (
                  <section className="site-sec" key="contact">
                    <h2 className="site-h">Bulk orders</h2>
                    <p className="site-about">Front door for bulk contracts.</p>
                  </section>
                );
              return null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
