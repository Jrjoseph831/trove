import { brands, items, sectorKeys, sectors, stats } from "@trove/data";
import { freshState, netWorth, priceItem } from "@trove/engine";

/**
 * Phase 0 — boot check.
 * Proves the wiring end to end: the app boots, @trove/engine imports, and the
 * full @trove/data catalog loads and type-checks. The real terminal UI
 * (Trending / Catalog / The Wire / My Vault) is Phase 2.
 */
export default function Home() {
  const state = freshState();
  const editionCount = items.filter((it) => it.edition !== null).length;

  // A small sample, priced through the engine, to show the pipeline is live.
  const sample = [...state.items]
    .filter((it) => it.edition === null)
    .slice(0, 6)
    .map((it) => ({ it, price: priceItem(state, it) }));

  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <p className="text-xs uppercase tracking-[0.3em] text-brass-dim">
        Phase 0 · boot check
      </p>
      <h1
        className="mt-2 text-5xl tracking-[0.18em] text-brass"
        style={{ fontFamily: "var(--font-display)" }}
      >
        TROVE
      </h1>
      <p className="mt-3 max-w-xl text-ink-dim">
        Engine online, catalog loaded. A real-time, shared-world market for
        physical assets, priced by a news-driven economy.
      </p>

      <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        {[
          ["Items", stats.total_items.toLocaleString()],
          ["Brands", String(stats.total_brands)],
          ["Sectors", String(stats.total_sectors)],
          ["Editions", String(editionCount)],
        ].map(([label, value]) => (
          <div key={label} className="bg-felt-2 px-5 py-4">
            <dt className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
              {label}
            </dt>
            <dd
              className="mt-1 text-2xl text-ink"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mt-10">
        <h2 className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
          Sectors
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {sectorKeys.map((k) => (
            <span
              key={k}
              className="rounded-full border border-line bg-felt-2 px-3 py-1 text-xs text-ink-dim"
            >
              {sectors[k]?.label}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
          Sample floor · priced through the engine
        </h2>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {sample.map(({ it, price }) => (
              <tr key={it.id} className="border-b border-line">
                <td className="py-2 pr-3">
                  <span className="block text-[9px] uppercase tracking-[0.12em] text-brass-dim">
                    {it.brand}
                  </span>
                  <span className="text-ink">
                    {it.icon} {it.name}
                  </span>
                </td>
                <td
                  className="py-2 text-right text-ink"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="mt-10 text-xs text-ink-faint">
        Starting net worth{" "}
        <span className="text-brass-dim">
          ${netWorth(state, "YOU").toLocaleString()}
        </span>{" "}
        · {brands.length} brands in the bible · next: Phase 1 (engine port +
        invariant tests).
      </p>
    </main>
  );
}
