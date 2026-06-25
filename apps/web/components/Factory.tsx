"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Cog, Package, Truck } from "lucide-react";
import {
  canProduce,
  effectiveSpec,
  factorySpec,
  getItem,
  getModule,
  items as catalog,
  MODULES,
  moduleCost,
  productionStages,
  recipeOf,
} from "@trove/data";
import type { Item } from "@trove/data";
import {
  expandCost,
  floorBays,
  lineLanes,
  LANES_PER_BAY,
  resolveBay,
  type Factory as FactoryLine,
} from "@trove/engine";
import { manufacturingName, money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

/** Short "2× Steel Billet + 1× I-Beam" recipe summary, or "extraction". */
function recipeText(out: Item): string {
  const r = recipeOf(out);
  if (!r || r.inputs.length === 0) return "Extraction · no inputs";
  return r.inputs
    .map((i) => `${i.qty}× ${getItem(i.itemId)?.name ?? "?"}`)
    .join("  +  ");
}

export function Factory() {
  const { mode, state, buildLine, desk } = useTrove();
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<"lines" | "floor">("lines");
  const mfg = manufacturingName(desk?.name ?? null);

  if (mode === "live") {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Factory</h2>
        </div>
        <div className="empty">
          Production lines are coming to the live floor soon. For now, switch to{" "}
          <b>Sandbox</b> to engineer a line, install modules, and watch it run.
        </div>
      </div>
    );
  }

  const full = state.factories.length >= state.floorSlots;

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">{mfg}</h2>
        <div className="fac-cash">
          Cash <b>{money(state.cash)}</b>
        </div>
      </div>

      <div className="fac-tabs">
        <button
          className={view === "lines" ? "on" : ""}
          onClick={() => setView("lines")}
        >
          Lines
        </button>
        <button
          className={view === "floor" ? "on" : ""}
          onClick={() => setView("floor")}
        >
          Floor
        </button>
        <span className="fac-tabnote">
          {state.factories.length}/{state.floorSlots} slots ·{" "}
          {floorBays(state.floorSlots)} bay
          {floorBays(state.floorSlots) > 1 ? "s" : ""}
        </span>
      </div>

      {view === "floor" ? (
        <FloorView mfg={mfg} />
      ) : (
        <>
          <p className="fac-intro">
            Engineer a line: pick a product, then install <b>modules</b> to push
            throughput up, upkeep down, or trim material per unit. Output is
            branded <b>{mfg}</b> and lands in your vault to sell or fill orders.
          </p>

          {state.factories.length === 0 && (
            <div className="empty">
              No lines yet. Build one below — start cheap, then engineer it.
            </div>
          )}

          {state.factories.map((f) => (
            <LineBay key={f.id} f={f} mfg={mfg} />
          ))}

          <button
            className="fac-build"
            onClick={() => (full ? setView("floor") : setPicking(true))}
          >
            {full ? "Floor's full — expand it →" : "＋ Build a new line"}
          </button>
        </>
      )}

      {picking && (
        <BuildPicker
          cash={state.cash}
          onPick={(id) => {
            buildLine(id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** The warehouse: a connected floor diagram. Line nodes (left) route belts that
 *  merge into shipping bays (right); the belt surface flows line→bay→truck. A
 *  bay over capacity jams (its belts go red and slow). Tap a line to send it to
 *  the next bay and balance the load. */
function FloorView({ mfg }: { mfg: string }) {
  const { state, expandFloor, routeLine } = useTrove();
  const slots = state.floorSlots;
  const bays = floorBays(slots);
  const cost = expandCost(slots);

  const lines = state.factories.map((f, i) => {
    const out = state.items.find((it) => it.id === f.itemId);
    const rate = out ? effectiveSpec(out, f.modules).rate : 0;
    const building = state.cycle < f.onlineCycle;
    return {
      f,
      i,
      name: out?.name ?? `#${f.itemId}`,
      rate,
      lanes: lineLanes(rate),
      bay: resolveBay(f, i, bays),
      building,
      idle: !building && f.status === "idle",
    };
  });

  // Per-bay lane load + congestion.
  const bayLoad = new Array<number>(bays).fill(0);
  for (const l of lines) if (!l.building) bayLoad[l.bay]! += l.lanes;
  const bayOver = bayLoad.map((ld) => ld > LANES_PER_BAY);

  // ── SVG layout ──────────────────────────────────────────────────────────
  const ROW = 64;
  const PAD = 24;
  const rows = Math.max(lines.length, bays, 1);
  const W = 600;
  const H = PAD * 2 + rows * ROW;
  const LINE_L = 36; // node left edge (leaves a left margin for feeder belts)
  const LINE_R = 132; // node right edge (belts to bays start here)
  const BAY_L = 496;
  const lineY = (i: number) => PAD + i * ROW + ROW / 2;
  const bayY = (b: number) => PAD + ((b + 0.5) * (rows * ROW)) / bays;
  const trunkX = (b: number) => (bays > 1 ? 340 + (b * 130) / (bays - 1) : 390);
  const path = (i: number, b: number) =>
    `M ${LINE_R} ${lineY(i)} L ${trunkX(b)} ${lineY(i)} L ${trunkX(b)} ${bayY(b)} L ${BAY_L} ${bayY(b)}`;

  // In-house feeder links: a belt bowing into the left margin from the feeder
  // line to the consumer line.
  const byId = new Map(lines.map((l) => [l.f.id, l]));
  const feederLinks = lines
    .flatMap((c) =>
      Object.values(c.f.sources ?? {}).map((fid) => {
        const fdr = byId.get(fid);
        return fdr ? { key: `${c.i}-${fdr.i}`, c, fdr } : null;
      }),
    )
    .filter((x): x is { key: string; c: (typeof lines)[number]; fdr: (typeof lines)[number] } => !!x);
  const feederPath = (ci: number, fi: number) =>
    `M ${LINE_L} ${lineY(fi)} C 6 ${lineY(fi)}, 6 ${lineY(ci)}, ${LINE_L} ${lineY(ci)}`;
  const flowDur = (rate: number, jam: boolean) =>
    (jam ? 2.4 : 1) * Math.max(0.5, Math.min(1.5, 1.7 - Math.log10(Math.max(1, rate)) * 0.26));

  // Alerts.
  const alerts: string[] = [];
  bayLoad.forEach((ld, b) => {
    if (ld > LANES_PER_BAY)
      alerts.push(
        `Bay ${b + 1} overloaded — ${ld}/${LANES_PER_BAY} lanes, throttled to ~${Math.round((LANES_PER_BAY / ld) * 100)}%`,
      );
  });
  for (const l of lines)
    if (l.idle) alerts.push(`${l.name} line stalled — feed it inputs`);

  return (
    <div className="floor">
      <p className="fac-intro">
        Your warehouse: lines route belts into <b>{bays}</b> shipping bay
        {bays > 1 ? "s" : ""} (each moves {LANES_PER_BAY} lanes). <b>Tap a line</b>{" "}
        to send it to the next bay — balance the load so no bay jams.
      </p>

      <div className="wh-wrap">
        <svg
          className="wh"
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          {lines.map((l) => {
            const jam = !l.building && bayOver[l.bay];
            const cls = l.building
              ? "build"
              : l.idle
                ? "idle"
                : jam
                  ? "jam"
                  : "run";
            const d = path(l.i, l.bay);
            const dur = flowDur(l.rate, !!jam);
            return (
              <g key={`belt${l.f.id}`}>
                <path className={`wb-base ${cls}`} d={d} fill="none" />
                <path
                  className={`wb-flow ${cls}`}
                  d={d}
                  fill="none"
                  style={
                    cls === "run" || cls === "jam"
                      ? { animationDuration: `${dur}s` }
                      : undefined
                  }
                />
              </g>
            );
          })}

          {/* in-house feeder belts (line → line) */}
          {feederLinks.map(({ key, c, fdr }) => {
            const live = !c.building && !fdr.building;
            const cls = live ? "run" : "build";
            const d = feederPath(c.i, fdr.i);
            return (
              <g key={`feed${key}`}>
                <path className={`wb-base ${cls}`} d={d} fill="none" />
                <path
                  className={`wb-flow ${cls}`}
                  d={d}
                  fill="none"
                  style={live ? { animationDuration: "1.1s" } : undefined}
                />
              </g>
            );
          })}

          {Array.from({ length: bays }).map((_, b) => (
            <g
              key={`bay${b}`}
              transform={`translate(${BAY_L} ${bayY(b) - 18})`}
            >
              <rect
                x={4}
                y={0}
                width={92}
                height={36}
                rx={9}
                className={`wb-box bay ${bayOver[b] ? "jam" : ""}`}
              />
              <text x={14} y={15} className="wb-name">
                🚚 Bay {b + 1}
              </text>
              <text x={14} y={29} className={`wb-sub ${bayOver[b] ? "jam" : ""}`}>
                {bayLoad[b]}/{LANES_PER_BAY} lanes {bayOver[b] ? "⚠" : ""}
              </text>
            </g>
          ))}

          {lines.map((l) => (
            <g
              key={`node${l.f.id}`}
              className="wb-node"
              transform={`translate(0 ${lineY(l.i) - 18})`}
              onClick={() => routeLine(l.f.id, (l.bay + 1) % bays)}
            >
              <rect
                x={36}
                y={0}
                width={96}
                height={36}
                rx={9}
                className={`wb-box ${l.building ? "build" : l.idle ? "idle" : "run"}`}
              />
              <text x={46} y={15} className="wb-name">
                {trim(l.name, 13)}
              </text>
              <text x={46} y={29} className="wb-sub">
                {l.building ? "building" : `${l.rate.toLocaleString()}/cy`} · →Bay{" "}
                {l.bay + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {alerts.length > 0 && (
        <div className="wh-alerts">
          {alerts.map((a, i) => (
            <div key={i} className="wh-alert">
              ⚠ {a}
            </div>
          ))}
        </div>
      )}

      <button className="fac-build" onClick={expandFloor}>
        Expand floor · +2 slots · {money(cost)}
      </button>
      <p className="floor-foot">
        {mfg} floor · {state.factories.length}/{slots} slots used · {bays} bay
        {bays > 1 ? "s" : ""} · bay upkeep scales with size.
      </p>
    </div>
  );
}

function LineBay({ f, mfg }: { f: FactoryLine; mfg: string }) {
  const { state, demolishLine, addModule, removeModule, setLineSource, setSellPrice } =
    useTrove();
  const out = state.items.find((i) => i.id === f.itemId);
  if (!out) return null;

  const base = factorySpec(out);
  const eff = effectiveSpec(out, f.modules);
  const recipe = recipeOf(out);
  const inputs = recipe?.inputs ?? [];

  const building = state.cycle < f.onlineCycle;
  const cyclesLeft = f.onlineCycle - state.cycle;

  // Per-input: where it's sourced (a feeder line in-house, or the market), what
  // it costs per unit there, and feeder options the player owns.
  const batch = inputs.map((inp) => {
    const held = state.items.find((i) => i.id === inp.itemId);
    const need = Math.ceil(inp.qty * eff.rate * eff.inputMul);
    const feederId = f.sources?.[inp.itemId];
    const feeder = feederId
      ? state.factories.find((x) => x.id === feederId)
      : undefined;
    const inHouse = !!feeder;
    // In-house unit cost ≈ the feeder's marginal cost (upkeep / its rate);
    // market unit cost = the live price.
    const fSpec = feeder
      ? effectiveSpec(
          state.items.find((i) => i.id === feeder.itemId) ?? out,
          feeder.modules,
        )
      : null;
    const unitCost =
      inHouse && fSpec ? fSpec.upkeep / fSpec.rate : (held?.value ?? 0);
    const feeders = state.factories.filter(
      (x) => x.itemId === inp.itemId && x.id !== f.id,
    );
    return {
      id: inp.itemId,
      name: held?.name ?? `#${inp.itemId}`,
      value: held?.value ?? 0,
      perUnit: inp.qty,
      have: held?.owners["YOU"] ?? 0,
      need,
      inHouse,
      feederId: feederId ?? null,
      unitCost,
      feeders,
    };
  });
  // Run-readiness mirrors the engine: in-house needs vault stock; market
  // auto-buys the shortfall (so it just needs cash).
  let cashCost = 0;
  let canRun = true;
  for (const b of batch) {
    if (b.inHouse) {
      if (b.have < b.need) canRun = false;
    } else {
      cashCost += Math.max(0, b.need - b.have) * b.value;
    }
  }
  const ready = canRun && state.cash >= cashCost;
  const status = building ? "building" : ready ? "running" : "idle";

  // Cost to make one unit: per-input source cost (× input multiplier) + upkeep.
  const matPerUnit =
    batch.reduce((s, b) => s + b.unitCost * b.perUnit, 0) * eff.inputMul;
  const perUnit = matPerUnit + eff.upkeep / eff.rate;
  const sellEa = out.value * (1 + eff.premium);

  // Which installed module badges onto which stage.
  const stages = productionStages(out);
  const processStages = stages.filter((s) => s.kind === "process");
  const badge: Record<string, string[]> = {};
  for (const id of f.modules) {
    const m = getModule(id);
    if (!m) continue;
    let st = stages.find((s) => s.label === m.stage);
    if (!st)
      st =
        m.stage === "Feed"
          ? stages[0]
          : m.stage === "Pack"
            ? stages[stages.length - 1]
            : (processStages[0] ?? stages[0]);
    (badge[st.key] ??= []).push(m.name);
  }

  return (
    <div className={`bay ${status}`}>
      <div className="bay-head">
        <div className="bay-title">
          <span className="bay-mfg">{mfg}</span>
          <Link href={`/item/${out.id}`} className="it-link">
            {out.name}
          </Link>{" "}
          Line
        </div>
        <span className={`bay-status ${status}`}>
          {building
            ? `building · ${cyclesLeft} cy`
            : status === "running"
              ? "● running"
              : "◐ idle"}
        </span>
      </div>

      <Conveyor
        stages={stages}
        rate={eff.rate}
        status={status}
        badge={badge}
      />
      {status === "idle" && (
        <div className="cvy-note">Line stalled — feed it inputs below.</div>
      )}
      {building && (
        <div className="cvy-note">Line under construction — coming online soon.</div>
      )}

      {inputs.length > 0 && (
        <div className="bay-inputs">
          <div className="bay-sub">Feed / cycle · source</div>
          {batch.map((b) => {
            const short = b.inHouse && b.have < b.need;
            return (
              <div key={b.id} className={`bay-inp ${short ? "short" : ""}`}>
                <Link href={`/item/${b.id}`} className="it-link">
                  {b.name}
                </Link>
                <select
                  className="bay-src"
                  value={b.feederId ?? "market"}
                  onChange={(e) =>
                    setLineSource(
                      f.id,
                      b.id,
                      e.target.value === "market" ? null : e.target.value,
                    )
                  }
                >
                  <option value="market">Market · {money(b.value)}/ea</option>
                  {b.feeders.map((fd) => (
                    <option key={fd.id} value={fd.id}>
                      In-house · my line
                    </option>
                  ))}
                </select>
                <span className="bay-need">
                  {b.inHouse
                    ? `${b.have.toLocaleString()} / ${b.need.toLocaleString()}`
                    : `${b.need.toLocaleString()}/cy`}
                </span>
              </div>
            );
          })}
          {!building && !ready && (
            <div className="bay-warn">
              Line idles — an in-house feeder can&apos;t keep up, or not enough
              cash to buy market inputs.
            </div>
          )}
          {batch.some((b) => b.feeders.length > 0) && (
            <div className="bay-srchint">
              Tip: source an input from your own line to skip the market markup.
            </div>
          )}
        </div>
      )}

      <div className="bay-stats">
        <span>
          rate <b>{eff.rate.toLocaleString()}/cy</b>
          {f.modules.length > 0 && (
            <em className="bay-vs"> (base {base.rate.toLocaleString()})</em>
          )}
        </span>
        <span>upkeep {money(eff.upkeep)}/cy</span>
        <span>cost/ea {money(perUnit)}</span>
        <span>sells ≈ {money(sellEa)}/ea</span>
        {eff.premium > 0 && (
          <span className="bay-prem">+{Math.round(eff.premium * 100)}% quality</span>
        )}
      </div>

      {(() => {
        const mult = state.listPrices[out.id] ?? 1;
        const pct = Math.round((mult - 1) * 100);
        return (
          <div className="bay-price">
            <span className="bay-sub">Your sell price — what orders anchor to</span>
            <div className="bp-row">
              <button
                className="bp-btn"
                onClick={() => setSellPrice(out.id, mult - 0.05)}
              >
                −
              </button>
              <span className="bp-val">
                {money(out.value * mult)}
                <small>/ea</small>
              </span>
              <button
                className="bp-btn"
                onClick={() => setSellPrice(out.id, mult + 0.05)}
              >
                +
              </button>
              <span className="bp-mkt">
                market {money(out.value)} · {pct >= 0 ? "+" : ""}
                {pct}%
              </span>
            </div>
          </div>
        );
      })()}

      <div className="bay-modules">
        <div className="bay-sub">Modules — engineer the line</div>
        <div className="bay-mgrid">
          {MODULES.map((m) => {
            const installed = f.modules.includes(m.id);
            const cost = moduleCost(out, m.id);
            const afford = state.cash >= cost;
            return (
              <button
                key={m.id}
                className={`mod ${installed ? "on" : ""}`}
                disabled={!installed && !afford}
                onClick={() =>
                  installed ? removeModule(f.id, m.id) : addModule(f.id, m.id)
                }
              >
                <span className="mod-name">{m.name}</span>
                <span className="mod-blurb">{m.blurb}</span>
                <span className="mod-cost">
                  {installed ? "✓ installed · remove" : `install ${money(cost)}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bay-foot">
        <button className="fl-demolish" onClick={() => demolishLine(f.id)}>
          Tear down
        </button>
      </div>
    </div>
  );
}

/** The animated assembly line: stations linked by belts with product flowing
 *  Source → … → Pack → 🚚. Belt speed + box count scale with the line's rate;
 *  boxes only flow when the line is running. */
function Conveyor({
  stages,
  rate,
  status,
  badge,
}: {
  stages: { key: string; label: string; kind: "feed" | "process" | "output" }[];
  rate: number;
  status: "building" | "running" | "idle";
  badge: Record<string, string[]>;
}) {
  // Faster belt + more boxes for higher throughput.
  const lg = Math.log10(Math.max(1, rate));
  const dur = Math.max(0.8, Math.min(2.8, 3 - lg * 0.4)); // seconds per box
  const boxes = Math.max(2, Math.min(6, Math.round(lg + 1)));
  const flowing = status === "running";

  const icon = (kind: string) =>
    kind === "feed" ? (
      <Boxes size={16} strokeWidth={1.75} />
    ) : kind === "output" ? (
      <Package size={16} strokeWidth={1.75} />
    ) : (
      <Cog size={16} strokeWidth={1.75} />
    );

  const Belt = () => (
    <div className="cvy-belt">
      <span className="cvy-rail" />
      {flowing &&
        Array.from({ length: boxes }).map((_, b) => (
          <i
            key={b}
            className="cvy-box"
            style={{
              animationDuration: `${dur}s`,
              animationDelay: `${(dur / boxes) * b}s`,
            }}
          />
        ))}
    </div>
  );

  return (
    <div className={`cvy ${status}`}>
      {stages.map((s, i) => (
        <Fragment key={s.key}>
          <div className={`cvy-station ${s.kind}`}>
            <span className="cvy-ic">{icon(s.kind)}</span>
            <span className="cvy-lbl">{s.label}</span>
            {badge[s.key]?.length ? (
              <span className="cvy-dot" title={badge[s.key]!.join(", ")} />
            ) : null}
          </div>
          {i < stages.length - 1 && <Belt />}
        </Fragment>
      ))}
      <Belt />
      <div className="cvy-station bay">
        <span className="cvy-ic">
          <Truck size={16} strokeWidth={1.75} />
        </span>
        <span className="cvy-lbl">
          {flowing ? `${rate.toLocaleString()}/cy` : "Bay"}
        </span>
      </div>
    </div>
  );
}

const PRODUCIBLE: Item[] = catalog
  .filter(canProduce)
  .sort((a, b) => a.base - b.base);

function BuildPicker({
  cash,
  onPick,
  onClose,
}: {
  cash: number;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle
      ? PRODUCIBLE.filter(
          (it) =>
            it.name.toLowerCase().includes(needle) ||
            it.brand.toLowerCase().includes(needle),
        )
      : PRODUCIBLE;
    return pool.slice(0, 60);
  }, [q]);

  return (
    <div
      className="reveal-bg show"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="facpick">
        <div className="fp-head">
          <h3 className="serif">Build a line</h3>
          <button className="fp-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <input
          className="fp-search"
          placeholder="Search a product to make…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="fp-list">
          {results.map((it) => {
            const spec = factorySpec(it);
            const afford = cash >= spec.buildCost;
            return (
              <button
                key={it.id}
                className="fp-row"
                disabled={!afford}
                onClick={() => onPick(it.id)}
                title={recipeText(it)}
              >
                <div className="fp-r-main">
                  <span className="fp-r-name">{it.name}</span>
                  <span className="fp-r-bd">{it.brand}</span>
                </div>
                <div className="fp-r-recipe">{recipeText(it)}</div>
                <div className="fp-r-econ">
                  <span>{spec.rate.toLocaleString()}/cy</span>
                  <span className={afford ? "" : "fp-cant"}>
                    build {money(spec.buildCost)}
                  </span>
                </div>
              </button>
            );
          })}
          {results.length === 0 && (
            <div className="empty">No producible items match.</div>
          )}
        </div>
      </div>
    </div>
  );
}
