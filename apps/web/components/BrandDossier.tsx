import Link from "next/link";
import { brandSlug, sectorLabel, type Brand, type BrandLore } from "@trove/data";
import { brandStanding, sectorLabels } from "@/lib/brand";
import { money } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import type { Item } from "@trove/data";

export function BrandDossier({
  brand,
  lore,
  brandItems,
}: {
  brand: Brand;
  lore: BrandLore | undefined;
  brandItems: Item[];
}) {
  const s = brandStanding(brandItems);
  const slug = brandSlug(brand.name);

  return (
    <div className="dossier-wrap">
      <div className="dossier-top">
        <Link href="/" className="backlink">
          ← The Floor
        </Link>
        <span className="dossier-mark">TROVE</span>
      </div>

      <div className="dossier">
        <header className="dossier-head">
          <div className="eyebrow">
            {sectorLabel(brand.homeSector)}
            {lore ? ` · Est. ${lore.founded}` : ""}
          </div>
          <h1>{brand.name}</h1>
          {lore?.tagline && <p className="dossier-tag">{lore.tagline}</p>}
        </header>

        <div className="dossier-grid">
          <section className="dossier-house">
            <h2 className="dossier-h">The House</h2>
            <p>{lore?.story ?? "A house of the Trove floor."}</p>

            <h2 className="dossier-h" style={{ marginTop: 28 }}>
              What They Make
            </h2>
            <div className="makes">
              {brand.categories.map((c) => (
                <span className="makechip" key={c}>
                  <ItemIcon it={{ category: c, sub: "" }} size={16} />
                  {c}
                </span>
              ))}
            </div>
          </section>

          <aside className="dossier-standing">
            <h2 className="dossier-h">Market Standing</h2>
            <dl className="standing">
              <div>
                <dt>Pieces on the floor</dt>
                <dd>{s.count}</dd>
              </div>
              <div>
                <dt>Price range</dt>
                <dd>
                  {money(s.min)} – {money(s.max)}
                </dd>
              </div>
              <div>
                <dt>Typical piece</dt>
                <dd>{money(s.avg)}</dd>
              </div>
              <div>
                <dt>Top tier</dt>
                <dd>{s.topTier}</dd>
              </div>
            </dl>
            <div className="houseindex">
              <div className="houseindex-top">
                <span>House valuation index</span>
                <span className="num">{s.houseIndex}</span>
              </div>
              <div className="hi-bar">
                <i style={{ width: `${s.houseIndex}%` }} />
              </div>
              <div className="hi-note">vs the whole floor (0–100)</div>
            </div>
            <div className="dossier-sectors">
              {sectorLabels(brand.sectors).map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </aside>
        </div>

        <section className="flagship">
          <h2 className="dossier-h">Flagship Pieces</h2>
          {s.flagship.map((it) => (
            <div className="flag-row" key={it.id}>
              <ItemIcon it={it} size={20} className="ic" />
              <span className="flag-nm">
                {it.name}
                {it.edition !== null && (
                  <span className="flag-ed">
                    {" "}
                    · {it.edition === 1 ? "1 of 1" : "Limited"}
                  </span>
                )}
              </span>
              <span className="flag-sct">{sectorLabel(primarySector(it))}</span>
              <span className="flag-pr">{money(it.base)}</span>
            </div>
          ))}
        </section>

        <Link href={`/?brand=${slug}`} className="floor-cta">
          View all {s.count} pieces on the floor →
        </Link>
      </div>
    </div>
  );
}

function primarySector(it: Item): string {
  let best = "";
  let bw = -1;
  for (const k in it.weights) {
    const w = it.weights[k] ?? 0;
    if (w > bw) {
      bw = w;
      best = k;
    }
  }
  return best;
}
