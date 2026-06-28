"use client";

/** A prominent confirmation screen for any acquisition — estates, house stakes,
 *  and player buyouts. Shows the deal terms before committing. */
export interface DealRow {
  label: string;
  value: string;
  tone?: "up" | "down";
}

export function ConfirmDeal({
  kicker,
  title,
  sub,
  rows,
  confirmText,
  tone = "buy",
  onConfirm,
  onCancel,
}: {
  kicker: string;
  title: string;
  sub?: string;
  rows: DealRow[];
  confirmText: string;
  tone?: "buy" | "sell";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="cfm-wrap" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="cfm" onClick={(e) => e.stopPropagation()}>
        <div className="cfm-kick">{kicker}</div>
        <h2 className="cfm-title">{title}</h2>
        {sub && <p className="cfm-sub">{sub}</p>}
        <div className="cfm-rows">
          {rows.map((r, i) => (
            <div className="cfm-row" key={i}>
              <span>{r.label}</span>
              <b className={r.tone ? `cfm-${r.tone}` : ""}>{r.value}</b>
            </div>
          ))}
        </div>
        <div className="cfm-acts">
          <button className="cfm-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className={`cfm-go ${tone}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
