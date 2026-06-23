"use client";

import { held } from "@trove/engine";
import { money } from "@/lib/format";
import { impliedSectors, moversByAbsMove } from "@/lib/ui";
import { useTrove } from "@/lib/trove";
import { SectorBars } from "./SectorBars";
import { Tile } from "./Tile";

export function Trending() {
  const { state } = useTrove();
  const f = state.front;
  const { ups, dns } = impliedSectors(f);

  const movers = moversByAbsMove(state)
    .filter((m) => m.it.edition === null || m.it.remaining > 0)
    .slice(0, 8)
    .map((m) => m.it);

  const watching = state.items
    .filter((i) => i.edition !== null && i.remaining > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  const mine = state.items.filter((i) => held(i, "YOU") > 0);

  return (
    <div className="view">
      <div className="masthead">
        <article className="lead">
          {f && (
            <>
              <div className="paper">
                <span className="name">THE TROVE WIRE</span>
                <span className="edition">No. {1000 + state.cycle} · evening edition</span>
              </div>
              <div className="kick">{f.kick}</div>
              <h1>{f.head}</h1>
              <p>{f.body}</p>
              <div className="implied">
                On the floor:{" "}
                {ups.length === 0 && dns.length === 0 ? (
                  "A quiet session. Prices drift on their own."
                ) : (
                  <>
                    {ups.length > 0 && (
                      <>
                        <b>{ups.join(", ")}</b> in focus
                      </>
                    )}
                    {ups.length > 0 && dns.length > 0 && " · "}
                    {dns.length > 0 && (
                      <>
                        pressure on <b>{dns.join(", ")}</b>
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </article>

        <div className="heat-panel">
          <div className="panel-h">
            Heating Up <span className="sub">sector demand</span>
          </div>
          <SectorBars clickable />
        </div>
      </div>

      <div className="railrow">
        <div className="railrow-h">
          <span className="t">On the Move</span>
          <span className="why">biggest shifts since the page turned</span>
        </div>
        <div className="tiles">
          {movers.map((it) => (
            <Tile key={it.id} it={it} />
          ))}
        </div>
      </div>

      <div className="railrow">
        <div className="railrow-h">
          <span className="t">Worth Watching</span>
          <span className="why">marquee pieces still on the floor</span>
        </div>
        {watching.length ? (
          <div className="tiles">
            {watching.map((it) => (
              <Tile key={it.id} it={it} />
            ))}
          </div>
        ) : (
          <div className="empty">
            Every marquee piece has been claimed. Watch for a relisting.
          </div>
        )}
      </div>

      <div className="twoup">
        <div className="glasspanel">
          <div className="panel-h">
            Your Vault{" "}
            <span className="sub">{mine.length ? `${mine.length} holdings` : ""}</span>
          </div>
          {mine.length ? (
            mine.slice(0, 6).map((it) => {
              const q = held(it, "YOU");
              const pl = it.value - (it.buyAt ?? it.value);
              return (
                <div className="crow" key={it.id}>
                  <span className="ic">{it.icon}</span>
                  <span className="nm">
                    <span className="bd">{it.brand}</span>
                    {it.name}
                    {q > 1 ? ` ×${q}` : ""}
                  </span>
                  <span className="pr">{money(it.value * q)}</span>
                  <span className={`chg ${pl >= 0 ? "pos" : "neg"}`}>
                    {pl >= 0 ? "+" : ""}
                    {money(pl)}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="empty">Empty. Read the page, then acquire something.</div>
          )}
        </div>

        <div className="glasspanel">
          <div className="panel-h">Floor Activity</div>
          <div className="log">
            {state.log.length ? (
              state.log.slice(0, 9).map((l, i) => (
                <div key={i}>
                  <span className="who">{l.who}</span> {l.verb}{" "}
                  <span className="it">{l.it}</span>
                </div>
              ))
            ) : (
              <div className="empty">Quiet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
