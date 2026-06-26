"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Globe, Pencil } from "lucide-react";
import { getItem, sectorLabel, type SectorKey } from "@trove/data";
import { listedUnitPrice, type SiteConfig, type SiteSectionId } from "@trove/engine";
import {
  fetchCompanies,
  fetchCompany,
  fetchHouse,
  type CompanyCard,
  type CompanyProduct,
  type CompanySite,
  type HouseCard,
  type HouseView,
} from "@/lib/api";
import { manufacturingName, money } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";

const SECTION_LABELS: Record<SiteSectionId, string> = {
  masthead: "Masthead",
  about: "About / The House",
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
 *  owner gets an instant preview (their listed produced goods, at their price). */
function ownStorefront(state: ReturnType<typeof useTrove>["state"]): CompanyProduct[] {
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
    out.push({
      id,
      name: it.name,
      // Same canonical formula the server storefront + engine use, so the
      // owner's preview matches exactly what others see and what orders charge.
      price: Math.round(listedUnitPrice(it.value, mult, qcOn)),
      available: qty,
    });
  }
  return out.sort((a, b) => b.price - a.price);
}

export function Companies() {
  const { mode, state, mySite, desk, signedIn, signIn } = useTrove();
  const [open, setOpen] = useState<string | null>(null); // handle being viewed
  const [editing, setEditing] = useState(false);

  if (mode === "sandbox") {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Companies</h2>
        </div>
        <div className="empty">
          Company websites are a live-world feature — sign in on the live floor to
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
    const site = ownPreview(mySite, desk?.name ?? null, ownStorefront(state), state);
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
    return <HouseDossier handle={open.slice(6)} onBack={() => setOpen(null)} />;
  }

  if (open) {
    return <RemoteSite handle={open} onBack={() => setOpen(null)} />;
  }

  return (
    <Directory
      hasSite={!!mySite?.handle}
      published={!!mySite?.published}
      myName={desk?.name ?? null}
      onOpenMine={() => setOpen("__me__")}
      onEdit={() => setEditing(true)}
      onOpen={(h) => setOpen(h)}
      onOpenHouse={(h) => setOpen(`house:${h}`)}
    />
  );
}

/** Assemble a CompanySite for the owner's own preview (rank unknown locally). */
function ownPreview(
  site: SiteConfig | null,
  name: string | null,
  storefront: CompanyProduct[],
  state: ReturnType<typeof useTrove>["state"],
): CompanySite {
  const sectors = dominantSectors(storefront, state);
  return {
    handle: site?.handle ?? "",
    name: name ?? "Your Holding",
    tagline: site?.tagline ?? "",
    accent: site?.accent ?? "gold",
    sector: sectors[0] ?? "",
    products: storefront.length,
    about: site?.about ?? "",
    sections: site?.sections ?? DEFAULT_SECTIONS,
    storefront,
    standing: {
      rank: null,
      lines: state.factories.length,
      sectors,
    },
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

// ── Directory ────────────────────────────────────────────────────────────────
function Directory({
  hasSite,
  published,
  myName,
  onOpenMine,
  onEdit,
  onOpen,
  onOpenHouse,
}: {
  hasSite: boolean;
  published: boolean;
  myName: string | null;
  onOpenMine: () => void;
  onEdit: () => void;
  onOpen: (handle: string) => void;
  onOpenHouse: (handle: string) => void;
}) {
  const [companies, setCompanies] = useState<CompanyCard[] | null>(null);
  const [houses, setHouses] = useState<HouseCard[]>([]);

  useEffect(() => {
    let alive = true;
    fetchCompanies()
      .then((r) => {
        if (!alive) return;
        setCompanies(r.companies);
        setHouses(r.houses ?? []);
      })
      .catch(() => alive && setCompanies([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">Companies</h2>
      </div>

      <div className="site-myrow">
        <div className="site-myinfo">
          <span className="site-mylab">Your website</span>
          <b>{manufacturingName(myName)}</b>
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
            <Pencil size={13} /> {hasSite ? "Edit site" : "Build my site"}
          </button>
        </div>
      </div>

      <div className="site-dirhead">The Directory</div>
      {companies === null ? (
        <div className="empty">Loading the directory…</div>
      ) : companies.length === 0 ? (
        <div className="empty">
          No company sites published yet. Be the first — build yours above.
        </div>
      ) : (
        <div className="site-grid">
          {companies.map((c) => (
            <button key={c.handle} className="site-card" onClick={() => onOpen(c.handle)}>
              <span className={`site-card-accent a-${c.accent}`} />
              <span className="site-card-sector">{label(c.sector)}</span>
              <span className="site-card-name">{manufacturingName(c.name)}</span>
              {c.tagline && <span className="site-card-tag">{c.tagline}</span>}
              <span className="site-card-foot">
                <Globe size={12} /> {c.handle} · {c.products} product
                {c.products === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      )}

      {houses.length > 0 && (
        <>
          <div className="site-dirhead" style={{ marginTop: 26 }}>
            The Houses · institutional players
          </div>
          <div className="site-grid">
            {houses.map((h) => (
              <button
                key={h.handle}
                className="site-card"
                onClick={() => onOpenHouse(h.handle)}
              >
                <span className="site-card-accent a-ink" />
                <span className="site-card-sector">
                  {h.sector ? label(h.sector) : "Index"} · {h.tier}
                </span>
                <span className="site-card-name">{h.name}</span>
                <span className="site-card-foot">
                  Net worth <b>{money(h.netWorth)}</b>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── An AI company's audit dossier (fetched) ─────────────────────────────────
function HouseDossier({ handle, onBack }: { handle: string; onBack: () => void }) {
  const [h, setH] = useState<HouseView | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setH(null);
    setErr(false);
    fetchHouse(handle)
      .then((v) => alive && setH(v))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [handle]);

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
  if (!h) {
    return (
      <div className="view">
        <button className="site-back" onClick={onBack}>
          ← Directory
        </button>
        <div className="empty">Opening {handle}…</div>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="site-bar">
        <button className="site-back" onClick={onBack}>
          ← Directory
        </button>
        <span className="site-url">{h.sector ? label(h.sector) : "Index"} · {h.tier}</span>
      </div>

      <div className="site a-ink">
        <header className="site-masthead">
          <div className="site-eyebrow">Institutional player</div>
          <h1>{h.name}</h1>
          <p className="site-tag">
            {h.sector ? `${label(h.sector)} house` : "Broad-market index"} ·{" "}
            {h.tier} tier
          </p>
        </header>

        <section className="site-sec">
          <h2 className="site-h">Balance sheet</h2>
          <div className="site-standing">
            <div>
              <span className="ss-lab">Net worth</span>
              <span className="ss-v">{money(h.netWorth)}</span>
            </div>
            <div>
              <span className="ss-lab">Cash</span>
              <span className="ss-v">{money(h.cash)}</span>
            </div>
            <div>
              <span className="ss-lab">Holdings value</span>
              <span className="ss-v">{money(h.assets)}</span>
            </div>
          </div>
        </section>

        <section className="site-sec">
          <h2 className="site-h">Top holdings</h2>
          {h.holdings.length === 0 ? (
            <p className="site-about">Holding cash — nothing on the floor right now.</p>
          ) : (
            <div className="store-grid">
              {h.holdings.map((it) => {
                const cat = getItem(it.id);
                return (
                  <div className="store-card" key={it.id}>
                    <span className="store-ic">
                      {cat ? <ItemIcon it={cat} size={22} /> : null}
                    </span>
                    <span className="store-nm">{it.name}</span>
                    <span className="store-pr">{money(it.qty * it.value)}</span>
                    <span className="store-av">
                      {it.qty.toLocaleString()} × {money(it.value)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── A remote company's site (fetched) ───────────────────────────────────────
function RemoteSite({ handle, onBack }: { handle: string; onBack: () => void }) {
  const [site, setSite] = useState<CompanySite | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setSite(null);
    setErr(false);
    fetchCompany(handle)
      .then((s) => alive && setSite(s))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [handle]);

  if (err) {
    return (
      <div className="view">
        <button className="site-back" onClick={onBack}>
          ← Directory
        </button>
        <div className="empty">That company site couldn&apos;t be found.</div>
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
  return <SiteView site={site} onBack={onBack} />;
}

// ── The rendered storefront (shared by owner preview + remote view) ─────────
function SiteView({
  site,
  owner,
  onBack,
  onEdit,
}: {
  site: CompanySite;
  owner?: boolean;
  onBack: () => void;
  onEdit?: () => void;
}) {
  const [req, setReq] = useState<CompanyProduct | null>(null);
  const sections = (site.sections.length ? site.sections : DEFAULT_SECTIONS).filter(
    (s) => s.on || s.id === "masthead" || s.id === "storefront",
  );
  const mfg = manufacturingName(site.name);
  const show = (id: string) => sections.some((s) => s.id === id && (s.on || id === "masthead" || id === "storefront"));
  const canRequest = !owner && !!site.handle;

  return (
    <div className="view">
      <div className="site-bar">
        <button className="site-back" onClick={onBack}>
          ← Directory
        </button>
        <span className="site-url">
          <Globe size={12} /> {site.handle || "unpublished"}.trove
        </span>
        {owner && onEdit && (
          <button className="site-btn" onClick={onEdit}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>

      <div className={`site a-${site.accent}`}>
        {sections.map((sec) => {
          if (sec.id === "masthead")
            return (
              <header className="site-masthead" key="masthead">
                <div className="site-eyebrow">{label(site.sector)} · Manufacturing</div>
                <h1>{mfg}</h1>
                {site.tagline && <p className="site-tag">{site.tagline}</p>}
              </header>
            );
          if (sec.id === "about" && sec.on)
            return (
              <section className="site-sec" key="about">
                <h2 className="site-h">The House</h2>
                <p className="site-about">
                  {site.about || "A house of the Trove floor."}
                </p>
              </section>
            );
          if (sec.id === "standing" && sec.on)
            return (
              <section className="site-sec" key="standing">
                <h2 className="site-h">Standing</h2>
                <div className="site-standing">
                  <div>
                    <span className="ss-lab">Floor rank</span>
                    <span className="ss-v">
                      {site.standing.rank ? `#${site.standing.rank}` : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="ss-lab">Production lines</span>
                    <span className="ss-v">{site.standing.lines}</span>
                  </div>
                  <div>
                    <span className="ss-lab">Sectors</span>
                    <span className="ss-v small">
                      {site.standing.sectors.map(label).join(" · ") || "—"}
                    </span>
                  </div>
                </div>
              </section>
            );
          if (sec.id === "storefront")
            return (
              <Storefront
                key="storefront"
                products={site.storefront}
                owner={owner}
                onRequest={canRequest ? (p) => setReq(p) : undefined}
              />
            );
          if (sec.id === "contact" && sec.on)
            return (
              <section className="site-sec" key="contact">
                <h2 className="site-h">Bulk orders</h2>
                <p className="site-about">
                  {mfg} takes bulk contracts through the Order Desk. Hit{" "}
                  <b>Request</b> on any product to send an offer.
                </p>
              </section>
            );
          return null;
        })}
        {!show("about") && !show("standing") && site.storefront.length === 0 && (
          <div className="empty">Nothing listed yet.</div>
        )}
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
  onRequest,
}: {
  products: CompanyProduct[];
  owner?: boolean;
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
            return (
              <div className="store-card" key={p.id}>
                <span className="store-ic">
                  {it ? <ItemIcon it={it} size={22} /> : null}
                </span>
                <span className="store-nm">{p.name}</span>
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
              </div>
            );
          })}
        </div>
      )}
    </section>
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
  const [qty, setQty] = useState(startQty);
  const [offer, setOffer] = useState(unitPrice * startQty);
  const [busy, setBusy] = useState(false);

  const setQtyClamped = (n: number) => {
    const q = Math.max(1, Math.min(product.available, Math.floor(n || 1)));
    setQty(q);
    setOffer(unitPrice * q); // re-anchor the offer to list price on qty change
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
            value={qty}
            onChange={(e) => setQtyClamped(Number(e.target.value))}
          />
        </label>

        <label className="req-field">
          <span>Your offer (total)</span>
          <input
            type="number"
            min={1}
            value={Math.round(offer)}
            onChange={(e) => setOffer(Number(e.target.value))}
          />
        </label>
        <div className="req-meta">
          {money(Math.round(offer / Math.max(1, qty)))}/unit · your cash {money(cash)}
        </div>
        {short && <div className="req-warn">That's more than your cash on hand.</div>}

        <div className="req-actions">
          <button className="site-btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="site-btn" onClick={send} disabled={busy || short}>
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── The modular builder ─────────────────────────────────────────────────────
function Builder({ onDone }: { onDone: () => void }) {
  const { mySite, saveSite, desk, state } = useTrove();
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
    if (id === "masthead" || id === "storefront") return; // always on
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, on: !s.on } : s)));
  }, []);

  const draft: Partial<SiteConfig> = { handle, tagline, about, accent, sections };
  const preview = ownPreview(
    { handle, tagline, about, accent, sections },
    desk?.name ?? null,
    ownStorefront(state),
    state,
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
            <span className="bld-handle">
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
              <em>.trove</em>
            </span>
          </label>

          <label className="bld-row">
            <span>Tagline</span>
            <input
              value={tagline}
              maxLength={120}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="One line about your house"
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
              const locked = s.id === "masthead" || s.id === "storefront";
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
                    <h2 className="site-h">The House</h2>
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
                        <span className="ss-lab">Production lines</span>
                        <span className="ss-v">{preview.standing.lines}</span>
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
