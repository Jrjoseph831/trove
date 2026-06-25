"use client";

import { useState } from "react";
import type { Ledger, Report } from "@trove/engine";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

/** A Trove day rolled up from its (up to 2) flip reports. */
interface DayAgg {
  day: number;
  netWorth: number;
  cash: number;
  assets: number;
  debt: number;
  flows: Ledger;
  at: number;
  halves: string[];
}

const LEDGER_KEYS: (keyof Ledger)[] = [
  "produced",
  "listingUnits",
  "listingRev",
  "orderUnits",
  "orderRev",
  "bought",
  "spent",
  "soldUnits",
  "soldRev",
  "upkeep",
];

function aggregateDays(reports: Report[]): DayAgg[] {
  const map = new Map<number, Report[]>();
  for (const r of reports) {
    const arr = map.get(r.day) ?? [];
    arr.push(r);
    map.set(r.day, arr);
  }
  return [...map.keys()]
    .sort((a, b) => a - b)
    .map((day) => {
      const ps = map.get(day)!.sort((a, b) => a.period - b.period);
      const last = ps[ps.length - 1]!;
      const flows = Object.fromEntries(
        LEDGER_KEYS.map((k) => [k, ps.reduce((s, p) => s + p.flows[k], 0)]),
      ) as unknown as Ledger;
      return {
        day,
        netWorth: last.netWorth,
        cash: last.cash,
        assets: last.assets,
        debt: last.debt,
        flows,
        at: last.at,
        halves: ps.map((p) => (p.half ? "Evening" : "Morning")),
      };
    });
}

/** Trove Day N (2 flips per in-game day). */
const dayOf = (p: number) => Math.floor(p / 2) + 1;
const halfOf = (p: number) => (p % 2 ? "Evening" : "Morning");
const realStamp = (at: number) =>
  at
    ? new Date(at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

/** Flow rows for a report (label, value, sign). */
function flowRows(r: Report) {
  const f = r.flows;
  return [
    { k: "Produced", v: f.produced, money: false, good: true },
    { k: "Listing sales", v: f.listingRev, u: f.listingUnits, money: true, good: true },
    { k: "Order revenue", v: f.orderRev, u: f.orderUnits, money: true, good: true },
    { k: "Bought", v: -f.spent, u: f.bought, money: true, good: false },
    { k: "Sold (market)", v: f.soldRev, u: f.soldUnits, money: true, good: true },
    { k: "Upkeep + inputs", v: -f.upkeep, money: true, good: false },
  ].filter((row) => row.v !== 0 || (row.u ?? 0) !== 0);
}

export function ReportView() {
  const { mode, state } = useTrove();
  const [sel, setSel] = useState<number | null>(null); // null = follow latest

  if (mode === "live") {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Reports</h2>
        </div>
        <div className="empty">
          Daily reports track your factory + trading activity. Switch to{" "}
          <b>Sandbox</b> to start building a history.
        </div>
      </div>
    );
  }

  const days = aggregateDays(state.reports);

  if (days.length === 0) {
    return (
      <div className="view">
        <div className="cat-head">
          <h2 className="serif">Reports</h2>
        </div>
        <div className="empty">
          No reports yet — a report is filed every time the floor flips. Advance
          the sandbox clock and a dashboard will build here.
        </div>
      </div>
    );
  }

  const idx =
    sel === null ? days.length - 1 : Math.max(0, Math.min(sel, days.length - 1));
  const d = days[idx]!;
  const prev = idx > 0 ? days[idx - 1] : undefined;
  const delta = prev ? d.netWorth - prev.netWorth : 0;
  const f = d.flows;
  const revenue = f.listingRev + f.orderRev + f.soldRev;
  const costs = f.spent + f.upkeep;

  // ── Net-worth line/area chart over all days ─────────────────────────────
  const W = 680;
  const H = 168;
  const P = 12;
  const series = days.map((x) => x.netWorth);
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const xAt = (i: number) =>
    days.length <= 1 ? W / 2 : P + (i / (days.length - 1)) * (W - 2 * P);
  const yAt = (v: number) => {
    const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    return H - P - t * (H - 2 * P);
  };
  const linePath = days
    .map((x, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(x.netWorth).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${xAt(days.length - 1).toFixed(1)} ${H - P} L ${xAt(0).toFixed(1)} ${H - P} Z`;

  const atLatest = idx === days.length - 1;
  const revBars = [
    { k: "Listing sales", v: f.listingRev, c: "rb-listing" },
    { k: "Order revenue", v: f.orderRev, c: "rb-order" },
    { k: "Market sales", v: f.soldRev, c: "rb-market" },
  ];
  const maxRev = Math.max(1, ...revBars.map((b) => b.v));

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">Reports</h2>
        <div className="rep-now">
          Day net worth <b>{money(d.netWorth)}</b>
        </div>
      </div>

      {/* Day navigator */}
      <div className="dash-nav">
        <button className="dn-btn" disabled={idx <= 0} onClick={() => setSel(idx - 1)}>
          ‹ Prev
        </button>
        <div className="dn-day">
          <span className="dn-d">Trove Day {d.day}</span>
          <span className="dn-meta">
            {d.halves.join(" + ")} · {realStamp(d.at)}
          </span>
        </div>
        <button
          className="dn-btn"
          disabled={atLatest}
          onClick={() => setSel(idx + 1 >= days.length - 1 ? null : idx + 1)}
        >
          Next ›
        </button>
        <input
          className="dn-jump"
          type="number"
          min={days[0]!.day}
          max={days[days.length - 1]!.day}
          placeholder="day #"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const n = Number((e.target as HTMLInputElement).value);
            const i = days.findIndex((x) => x.day === n);
            if (i >= 0) setSel(i);
          }}
        />
        <button className="dn-btn latest" disabled={atLatest} onClick={() => setSel(null)}>
          Latest ⏭
        </button>
      </div>

      {/* KPI tiles */}
      <div className="kpi-row">
        <div className="kpi">
          <span className="kpi-l">Net worth</span>
          <span className="kpi-v">{money(d.netWorth)}</span>
          {prev && (
            <span className={`kpi-d ${delta >= 0 ? "rc-up" : "rc-dn"}`}>
              {delta >= 0 ? "▲ +" : "▼ "}
              {money(delta)} vs prev day
            </span>
          )}
        </div>
        <div className="kpi">
          <span className="kpi-l">Cash</span>
          <span className="kpi-v">{money(d.cash)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">Assets</span>
          <span className="kpi-v">{money(d.assets)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">Revenue (day)</span>
          <span className="kpi-v rc-up">{money(revenue)}</span>
          <span className="kpi-d">costs {money(costs)}</span>
        </div>
      </div>

      {/* Net-worth trend chart */}
      <div className="dash-card">
        <div className="dash-h">Net worth · all days</div>
        <svg
          className="dash-chart"
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <path className="nw-area" d={areaPath} />
          <path className="nw-line" d={linePath} fill="none" />
          <line className="nw-guide" x1={xAt(idx)} y1={P} x2={xAt(idx)} y2={H - P} />
          <circle className="nw-dot" cx={xAt(idx)} cy={yAt(d.netWorth)} r={4} />
        </svg>
        <div className="dash-foot">
          <span>Day {days[0]!.day}</span>
          <span>Day {days[days.length - 1]!.day} (latest)</span>
        </div>
      </div>

      {/* Breakdown panels */}
      <div className="dash-panels">
        <div className="dash-card">
          <div className="dash-h">Revenue mix · Day {d.day}</div>
          {revenue === 0 ? (
            <div className="rc-quiet">No sales this day.</div>
          ) : (
            revBars.map((b) => (
              <div key={b.k} className="bar-row">
                <span className="bar-k">{b.k}</span>
                <span className="bar-track">
                  <i className={`bar-fill ${b.c}`} style={{ width: `${(b.v / maxRev) * 100}%` }} />
                </span>
                <span className="bar-v">{money(b.v)}</span>
              </div>
            ))
          )}
        </div>

        <div className="dash-card">
          <div className="dash-h">Activity · Day {d.day}</div>
          <div className="act-grid">
            <div className="act">
              <span>Produced</span>
              <b>{f.produced.toLocaleString()}</b>
            </div>
            <div className="act">
              <span>Sold (listed)</span>
              <b>{f.listingUnits.toLocaleString()}</b>
            </div>
            <div className="act">
              <span>Order units</span>
              <b>{f.orderUnits.toLocaleString()}</b>
            </div>
            <div className="act">
              <span>Bought</span>
              <b>{f.bought.toLocaleString()}</b>
            </div>
            <div className="act">
              <span>Purchases</span>
              <b className="rc-dn">{money(f.spent)}</b>
            </div>
            <div className="act">
              <span>Upkeep + inputs</span>
              <b className="rc-dn">{money(f.upkeep)}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The dismissible daily-report card that pops on each new flip. */
export function DailyReportCard() {
  const { dailyReport, dismissDailyReport, state } = useTrove();
  if (!dailyReport) return null;
  const r = dailyReport;
  const idx = state.reports.findIndex((x) => x.period === r.period);
  const prev = idx > 0 ? state.reports[idx - 1] : undefined;
  const delta = prev ? r.netWorth - prev.netWorth : 0;

  return (
    <div className="dailyrep">
      <div className="dr-head">
        <span className="dr-kick">Daily Report</span>
        <button className="dr-x" onClick={dismissDailyReport} aria-label="Dismiss">
          ✕
        </button>
      </div>
      <div className="dr-day">
        Trove Day {dayOf(r.period)} · {halfOf(r.period)}
      </div>
      <div className="dr-net">
        Net worth <b>{money(r.netWorth)}</b>
        {prev && (
          <span className={delta >= 0 ? "rc-up" : "rc-dn"}>
            {" "}
            {delta >= 0 ? "+" : ""}
            {money(delta)}
          </span>
        )}
      </div>
      <div className="dr-flows">
        {flowRows(r).map((row) => (
          <div key={row.k} className="dr-flow">
            <span>{row.k}</span>
            <b className={row.good ? "rc-up" : "rc-dn"}>
              {row.money
                ? `${row.v >= 0 ? "+" : ""}${money(row.v)}`
                : row.v.toLocaleString()}
            </b>
          </div>
        ))}
        {flowRows(r).length === 0 && <div className="rc-quiet">A quiet shift.</div>}
      </div>
    </div>
  );
}
