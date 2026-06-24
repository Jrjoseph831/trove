import Link from "next/link";
import {
  brandSlug,
  itemsByBrand,
  sectorLabel,
  type Item,
} from "@trove/data";
import { money } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { archLabel, itemCopy, tierLabel } from "@/lib/itemcopy";

export function ItemDetail({ item }: { item: Item }) {
  const { lede, body, supply, sectors } = itemCopy(item);
  const slug = brandSlug(item.brand);
  const more = itemsByBrand(item.brand)
    .filter((i) => i.id !== item.id)
    .slice(0, 6);
  const isEd = item.edition !== null;

  return (
    <div className="itempage-inner">
      <nav className="item-bread">
        <Link href="/">The Floor</Link>
        <span>/</span>
        <Link href={`/brand/${slug}`}>{item.brand}</Link>
        <span>/</span>
        <span className="cur">{item.name}</span>
      </nav>

      <div className="item-hero">
        <div className="item-art">
          <ItemIcon it={item} size={88} />
          {isEd && (
            <span className="item-edbadge">
              {item.edition === 1 ? "1 of 1" : `Limited · ${item.edition}`}
            </span>
          )}
        </div>

        <div className="item-info">
          {/* The supplier — clickable, straight to the company page. */}
          <Link href={`/brand/${slug}`} className="item-supplier">
            {item.brand}
          </Link>
          <h1 className="item-name">{item.name}</h1>
          <div className="item-tags">
            <span>{tierLabel(item)}</span>
            <i>·</i>
            <span>{archLabel(item)}</span>
            <i>·</i>
            <span>{item.category}</span>
          </div>

          <div className="item-price">
            <span className="lp">List price</span>
            <span className="amt">{money(item.base)}</span>
            <span className="note">floor price moves with demand</span>
          </div>

          <p className="item-lede">{lede}</p>
          {body && <p className="item-body">{body}</p>}
          <p className="item-supply">{supply}</p>

          <Link href={`/?brand=${slug}`} className="item-cta">
            Find it on the floor →
          </Link>
        </div>
      </div>

      <section className="item-specs">
        <h2 className="dossier-h">Details</h2>
        <dl>
          <div>
            <dt>Maker</dt>
            <dd>
              <Link href={`/brand/${slug}`} className="bd-link">
                {item.brand}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Class</dt>
            <dd>{archLabel(item)}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{item.category}</dd>
          </div>
          <div>
            <dt>Line</dt>
            <dd>{item.sub}</dd>
          </div>
          <div>
            <dt>Tier</dt>
            <dd>{tierLabel(item)}</dd>
          </div>
          <div>
            <dt>Used across</dt>
            <dd>{sectors.map(sectorLabel).join(", ") || "—"}</dd>
          </div>
          <div>
            <dt>Supply</dt>
            <dd>
              {isEd
                ? item.edition === 1
                  ? "1 of 1"
                  : `Limited run of ${item.edition}`
                : "Open stock"}
            </dd>
          </div>
          <div>
            <dt>List price</dt>
            <dd>{money(item.base)}</dd>
          </div>
        </dl>
      </section>

      {more.length > 0 && (
        <section className="item-more">
          <h2 className="dossier-h">More from {item.brand}</h2>
          <div className="more-grid">
            {more.map((m) => (
              <Link key={m.id} href={`/item/${m.id}`} className="more-card">
                <ItemIcon it={m} size={30} />
                <span className="more-nm">{m.name}</span>
                <span className="more-pr">{money(m.base)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Link href="/" className="item-back">
        ← Back to the floor
      </Link>
    </div>
  );
}
