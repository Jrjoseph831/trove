"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import { money, moneyShort } from "@/lib/format";
import { fetchCompany, fetchHouse, type CompanySite } from "@/lib/api";

type State =
  | { phase: "loading" }
  | { phase: "found"; site: CompanySite }
  | { phase: "missing" };

/** A firm's public page at trove.ceo/<handle>. Works for both player-run
 *  holdings and AI houses — the API returns the same shape for each — and
 *  needs no account, which is the point: these are meant to be linkable.
 *
 *  An acquired firm resolves to nothing (settleBuyout clears its site), so
 *  the page correctly reads as gone rather than serving a stale storefront. */
export function PublicCompany({ handle }: { handle: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    // Players first, then houses: a player handle is the one someone is more
    // likely to have been given, and the two namespaces don't overlap.
    fetchCompany(handle)
      .catch(() => fetchHouse(handle))
      .then((site) => alive && setState({ phase: "found", site }))
      .catch(() => alive && setState({ phase: "missing" }));
    return () => {
      alive = false;
    };
  }, [handle]);

  if (state.phase === "loading") {
    return (
      <div className="pubco">
        <div className="pubco-wrap pubco-quiet">Opening {handle}…</div>
      </div>
    );
  }

  if (state.phase === "missing") {
    return (
      <div className="pubco">
        <div className="pubco-wrap pubco-quiet">
          <h1 className="pubco-404">No firm at this address.</h1>
          <p>
            It may never have existed, or it was acquired and no longer
            trades under its own name.
          </p>
          <Link className="pubco-home" href="/">
            Go to the market →
          </Link>
        </div>
      </div>
    );
  }

  const { site } = state;
  const on = (id: string) =>
    !site.sections || site.sections.find((s) => s.id === id)?.on !== false;

  return (
    <div className="pubco">
      <header className="pubco-top">
        <Link href="/" className="pubco-mark">
          TROVE
        </Link>
        <Link href="/" className="pubco-cta">
          Enter the market
        </Link>
      </header>

      <div className="pubco-wrap">
        <div className={`pubco-hero a-${site.accent}`}>
          <div className="pubco-kind">
            <Globe size={12} /> {site.handle}
            {site.kind === "house" && <span className="pubco-tag">House</span>}
          </div>
          <h1 className="pubco-name">{site.name}</h1>
          {site.tagline && <p className="pubco-tagline">{site.tagline}</p>}
        </div>

        {on("about") && site.about && (
          <section className="pubco-sec">
            <h2 className="pubco-h">The firm</h2>
            <p className="pubco-about">{site.about}</p>
          </section>
        )}

        {on("standing") && (
          <section className="pubco-sec">
            <h2 className="pubco-h">Market standing</h2>
            <div className="pubco-stats">
              <div className="pubco-stat">
                <b>{moneyShort(site.netWorth)}</b>
                <span>Net worth</span>
              </div>
              <div className="pubco-stat">
                <b>{site.standing.rank ? `#${site.standing.rank}` : "—"}</b>
                <span>Rank</span>
              </div>
              <div className="pubco-stat">
                <b>{site.products.toLocaleString()}</b>
                <span>Products listed</span>
              </div>
              {site.standing.sectors.length > 0 && (
                <div className="pubco-stat">
                  <b className="pubco-sector">{site.standing.sectors.join(", ")}</b>
                  <span>Sectors</span>
                </div>
              )}
            </div>
          </section>
        )}

        {on("storefront") && site.storefront.length > 0 && (
          <section className="pubco-sec">
            <h2 className="pubco-h">Storefront</h2>
            <div className="pubco-store">
              {site.storefront.map((p) => (
                <Link href={`/item/${p.id}`} className="pubco-prod" key={p.id}>
                  <span className="pubco-prod-nm">{p.name}</span>
                  <span className="pubco-prod-pr">{money(p.price)}</span>
                  <span className="pubco-prod-av">
                    {p.available.toLocaleString()} available
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <footer className="pubco-foot">
          <Link href="/">TROVE — a shared-world market</Link>
        </footer>
      </div>
    </div>
  );
}
