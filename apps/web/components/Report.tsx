"use client";

import type { Report } from "@trove/engine";
import { money } from "@/lib/format";
import { useTrove } from "@/lib/trove";

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

  const reports = [...state.reports].reverse(); // newest first

  return (
    <div className="view">
      <div className="cat-head">
        <h2 className="serif">Reports</h2>
        <div className="rep-now">
          Net worth <b>{money(state.reports.at(-1)?.netWorth ?? state.cash)}</b>
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="empty">
          No reports yet — a report is filed every time the floor flips. Advance
          the sandbox clock and they&apos;ll start logging here.
        </div>
      ) : (
        <div className="rep-list">
          {reports.map((r, i) => {
            const prev = reports[i + 1];
            const delta = prev ? r.netWorth - prev.netWorth : 0;
            return (
              <div key={r.period} className="repcard">
                <div className="rc-head">
                  <span className="rc-day">
                    Trove Day {dayOf(r.period)}
                    <span className="rc-half"> · {halfOf(r.period)}</span>
                  </span>
                  <span className="rc-stamp">{realStamp(r.at)}</span>
                </div>
                <div className="rc-net">
                  <span>
                    Net worth <b>{money(r.netWorth)}</b>
                  </span>
                  {prev && (
                    <span className={delta >= 0 ? "rc-up" : "rc-dn"}>
                      {delta >= 0 ? "▲ +" : "▼ "}
                      {money(delta)}
                    </span>
                  )}
                </div>
                <div className="rc-sub">
                  cash {money(r.cash)} · assets {money(r.assets)}
                  {r.debt > 0 ? ` · debt ${money(r.debt)}` : ""}
                </div>
                <div className="rc-flows">
                  {flowRows(r).length === 0 ? (
                    <span className="rc-quiet">quiet period</span>
                  ) : (
                    flowRows(r).map((row) => (
                      <span key={row.k} className="rc-flow">
                        {row.k}{" "}
                        <b className={row.good ? "rc-up" : "rc-dn"}>
                          {row.money
                            ? `${row.v >= 0 ? "+" : ""}${money(row.v)}`
                            : row.v.toLocaleString()}
                        </b>
                        {row.u ? ` · ${row.u.toLocaleString()}u` : ""}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
