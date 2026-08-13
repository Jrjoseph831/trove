import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  brandSlug,
  itemsByBrand,
  lotSize,
  sectorLabel,
  type Item,
} from "@trove/data";
import { money } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { itemPlate } from "@/lib/texture";
import { archLabel, itemCopy, tierLabel } from "@/lib/itemcopy";

export function ItemDetail({ item }: { item: Item }) {
  const { lede, body, supply, sectors } = itemCopy(item);
  const slug = brandSlug(item.brand);
  const more = itemsByBrand(item.brand)
    .filter((i) => i.id !== item.id)
    .slice(0, 6);
  const isEd = item.edition !== null;
  const lot = lotSize(item);

  return (
    <div className="itempage-inner">
      {/* The same edge handle the terminal carries, so the gesture is in the
          same place here. This route has no rail to slide out, so it means the
          honest thing instead — back to the market — and points that way. On a
          phone it's the only way out of a product page that doesn't involve
          the browser's own back button. */}
      <Link href="/" className="page-peek" aria-label="Back to the market" title="Back to the market">
        <ChevronLeft size={17} strokeWidth={2} />
      </Link>

      <nav className="item-bread">
        <Link href="/">The Market</Link>
        <span>/</span>
        <Link href={`/brand/${slug}`}>{item.brand}</Link>
        <span>/</span>
        <span className="cur">{item.name}</span>
      </nav>

      <div className="item-hero">
        {/* Same plate as the item's catalogue card, so following a product
            through lands somewhere that looks like where you came from. */}
        <div className="item-art" style={itemPlate(item)}>
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
            <span className="note">price moves with demand</span>
          </div>

          <p className="item-lede">{lede}</p>
          {body && <p className="item-body">{body}</p>}
          <p className="item-supply">{supply}</p>

          <Link
            href={`/?q=${encodeURIComponent(item.name)}&hl=${item.id}`}
            className="item-cta"
          >
            Find it on the market →
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
            <dt>Sold in</dt>
            <dd>{lot > 1 ? `Cases of ${lot.toLocaleString()}` : "Singles"}</dd>
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
        ← Back to the market
      </Link>
    </div>
  );
}
