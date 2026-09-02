"use client";

import type { CSSProperties, ReactNode } from "react";
import { DEST_BY_ID } from "@/lib/nav";
import type { TabId } from "@/lib/trove";

/**
 * The header every screen opens with.
 *
 * Screens used to start with a 27px serif title that repeated the nav item
 * you had just clicked, followed by a hairline. Now the command bar names the
 * screen, so the in-view header does the job a game's screen header does
 * instead: the screen's own colour and glyph, a line saying what the screen
 * is FOR, and its live readouts on the right — one strip, same anatomy on
 * every screen, so the eye lands in the same place each time you switch.
 *
 * `tab` supplies the colour, icon, title and purpose line from `lib/nav.ts`,
 * so a screen can't drift from its tile. `title` overrides only where the
 * screen genuinely has its own name (the Factory carries the plant's name).
 */
export function ScreenHead({
  tab,
  title,
  note,
  after,
  className = "",
  children,
}: {
  tab: TabId;
  /** Override the nav title — for screens that name a thing you own. */
  title?: ReactNode;
  /** Override the purpose line; `null` drops it. */
  note?: ReactNode | null;
  /** A small control that belongs beside the title (e.g. rename). */
  after?: ReactNode;
  /** e.g. "col-12" when the header sits inside a `.bento` grid. */
  className?: string;
  /** Right-hand readouts — usually `<Stat>`s. */
  children?: ReactNode;
}) {
  const d = DEST_BY_ID[tab];
  const Icon = d?.Icon;
  return (
    <header
      className={`screenhead ${className}`}
      style={{ "--tone": d?.tone ?? "var(--ink-dim)" } as CSSProperties}
    >
      <span className="sh-ic" aria-hidden>
        {Icon && <Icon size={18} strokeWidth={1.9} />}
      </span>
      <span className="sh-txt">
        <span className="sh-t">
          {title ?? d?.title}
          {after}
        </span>
        {note !== null && <span className="sh-note">{note ?? d?.note}</span>}
      </span>
      {children && <div className="sh-right">{children}</div>}
    </header>
  );
}

/** A readout in the header's right-hand rail — the same chip shape the
 *  command bar's HUD uses, so a number means the same thing wherever it is. */
export function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Colour the value: gains bronze, losses steel. */
  tone?: "pos" | "neg";
  title?: string;
}) {
  return (
    <span className={`hud-stat ${tone ?? ""}`} title={title}>
      <i>{label}</i>
      <b>{value}</b>
    </span>
  );
}
