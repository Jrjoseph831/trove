"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteView } from "@/components/Companies";
import { fetchCompany, fetchHouse, type CompanySite } from "@/lib/api";

type State =
  | { phase: "loading" }
  | { phase: "found"; site: CompanySite }
  | { phase: "missing" };

/** A firm's public page at trove.ceo/<handle> — player holdings and AI
 *  houses alike, no account needed.
 *
 *  Renders through the same <SiteView/> the Companies tab uses, so a firm
 *  looks identical whether you reach it inside the sim or by following its
 *  URL. Two separate layouts would inevitably drift.
 *
 *  An acquired firm resolves to nothing (settleBuyout clears its site), so
 *  this correctly reads as gone rather than serving a stale storefront. */
export function PublicCompany({ handle }: { handle: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    // Players first, then houses — the namespaces don't overlap, and a player
    // handle is the one someone is more likely to have been handed.
    fetchCompany(handle)
      .catch(() => fetchHouse(handle))
      .then((site) => alive && setState({ phase: "found", site }))
      .catch(() => alive && setState({ phase: "missing" }));
    return () => {
      alive = false;
    };
  }, [handle]);

  // Standalone shell: the in-app styles assume the .app/.main grid around
  // them, which doesn't exist on a bare route — without this the page
  // collapses to a narrow left-aligned column.
  if (state.phase === "loading") {
    return (
      <div className="pubshell">
        <div className="empty">Opening {handle}…</div>
      </div>
    );
  }

  if (state.phase === "missing") {
    return (
      <div className="pubshell">
        <div className="pubco-gone">
          <h1>No firm at this address.</h1>
          <p>
            It may never have existed, or it was acquired and no longer trades
            under its own name.
          </p>
          <Link className="pubco-home" href="/">
            Go to the market →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pubshell">
      <SiteView site={state.site} />
    </div>
  );
}
