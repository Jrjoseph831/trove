"use client";

import { useCallback, useMemo, useState } from "react";
import { Image, Lock, Package, Palette, Plus, Trash2, X } from "lucide-react";
import { held } from "@trove/engine";
import { reportStudioContent } from "@/lib/api";
import { resolveDisplay } from "@/lib/display";
import { money } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";

// ── Slot counter ─────────────────────────────────────────────────────────────
function SlotBar({ used, total }: { used: number; total: number }) {
  return (
    <div className="studio-slots">
      <span className="ss-label">
        {used}/{total} product slots used
      </span>
      <div className="ss-bar">
        <div className="ss-fill" style={{ width: `${Math.min(100, (used / total) * 100)}%` }} />
      </div>
    </div>
  );
}

// ── Product customizer modal ──────────────────────────────────────────────────
interface CustomizerProps {
  itemId: number;
  itemName: string;
  itemValue: number;
  canonicalClass: string;
  initial: { displayName?: string; customImageUrl?: string; customDescription?: string };
  onSave: (
    itemId: number,
    patch: { displayName?: string; customImageUrl?: string; customDescription?: string },
  ) => Promise<void>;
  onRemove: (itemId: number) => Promise<void>;
  onClose: () => void;
}

function Customizer({
  itemId,
  itemName,
  itemValue,
  canonicalClass,
  initial,
  onSave,
  onRemove,
  onClose,
}: CustomizerProps) {
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [imageUrl, setImageUrl] = useState(initial.customImageUrl ?? "");
  const [description, setDescription] = useState(initial.customDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);

  const hasChanges =
    displayName !== (initial.displayName ?? "") ||
    imageUrl !== (initial.customImageUrl ?? "") ||
    description !== (initial.customDescription ?? "");

  const handleSave = async () => {
    setSaving(true);
    await onSave(itemId, {
      displayName: displayName.trim() || undefined,
      customImageUrl: imageUrl.trim() || undefined,
      customDescription: description.trim() || undefined,
    });
    setSaving(false);
    onClose();
  };

  const handleRemove = async () => {
    setSaving(true);
    await onRemove(itemId);
    setSaving(false);
    onClose();
  };

  return (
    <div className="studio-overlay" onClick={onClose}>
      <div className="studio-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sm-head">
          <span className="sm-title">Customize product</span>
          <button className="tbtn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Canonical identity — always visible, never editable */}
        <div className="sm-canonical">
          <span className="sm-canon-name">{itemName}</span>
          <span className="sm-canon-class">{canonicalClass}</span>
          <span className="sm-canon-value">{money(itemValue)}</span>
        </div>
        <div className="sm-disclosure">
          Market classification, pricing, and all contract terms stay tied to the
          canonical item. Only how it's presented to other players changes.
        </div>

        {/* Image preview + URL input */}
        <div className="sm-field">
          <label className="sm-lbl">
            <Image size={13} /> Product image URL
          </label>
          {imageUrl && !imgError ? (
            <div className="sm-img-preview">
              <img
                src={imageUrl}
                alt="preview"
                onError={() => setImgError(true)}
                onLoad={() => setImgError(false)}
              />
            </div>
          ) : null}
          <input
            className="sm-input"
            type="url"
            placeholder="https://…"
            value={imageUrl}
            onChange={(e) => { setImageUrl(e.target.value); setImgError(false); }}
          />
          <span className="sm-hint">
            Must be HTTPS. Hosted anywhere publicly accessible.
            <br />
            <label>
              <input type="checkbox" style={{ marginRight: 4 }} required />I confirm I have the right to use this image.
            </label>
          </span>
        </div>

        {/* Custom display name */}
        <div className="sm-field">
          <label className="sm-lbl">
            <Package size={13} /> Product display name{" "}
            <span className="sm-hint">({displayName.length}/60)</span>
          </label>
          <input
            className="sm-input"
            type="text"
            maxLength={60}
            placeholder={itemName}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        {/* Custom tagline */}
        <div className="sm-field">
          <label className="sm-lbl">
            Tagline / description{" "}
            <span className="sm-hint">({description.length}/200)</span>
          </label>
          <textarea
            className="sm-input sm-textarea"
            maxLength={200}
            placeholder="One-line description shown on your storefront…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="sm-footer">
          {initial.displayName || initial.customImageUrl || initial.customDescription ? (
            <button className="tbtn sm-remove" onClick={handleRemove} disabled={saving}>
              <Trash2 size={13} /> Remove
            </button>
          ) : (
            <span />
          )}
          <div className="sm-actions">
            <button className="tbtn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="tbtn sm-save"
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Branding editor (logo + banner) ──────────────────────────────────────────
function BrandingPanel() {
  const { myStudio, doStudio, notify } = useTrove();
  const [logoUrl, setLogoUrl] = useState(myStudio?.logoUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(myStudio?.bannerUrl ?? "");
  const [saving, setSaving] = useState(false);

  const hasChanges =
    logoUrl !== (myStudio?.logoUrl ?? "") ||
    bannerUrl !== (myStudio?.bannerUrl ?? "");

  const handleSave = async () => {
    setSaving(true);
    const err = await doStudio({ action: "branding", logoUrl: logoUrl || undefined, bannerUrl: bannerUrl || undefined });
    setSaving(false);
    if (!err) notify("Branding saved");
  };

  return (
    <div className="bento-card col-4 studio-branding">
      <div className="bc-h">
        <span className="t"><Palette size={14} /> Company branding</span>
      </div>
      <div className="sm-field">
        <label className="sm-lbl">Logo URL</label>
        <input
          className="sm-input"
          type="url"
          placeholder="https://…"
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
        />
        {logoUrl && (
          <div className="branding-preview logo-preview">
            <img src={logoUrl} alt="logo" onError={(e) => (e.currentTarget.style.display = "none")} />
          </div>
        )}
      </div>
      <div className="sm-field">
        <label className="sm-lbl">Banner URL</label>
        <input
          className="sm-input"
          type="url"
          placeholder="https://…"
          value={bannerUrl}
          onChange={(e) => setBannerUrl(e.target.value)}
        />
        {bannerUrl && (
          <div className="branding-preview banner-preview">
            <img src={bannerUrl} alt="banner" onError={(e) => (e.currentTarget.style.display = "none")} />
          </div>
        )}
      </div>
      <button
        className="tbtn sm-save"
        onClick={handleSave}
        disabled={saving || !hasChanges}
        style={{ marginTop: 8 }}
      >
        {saving ? "Saving…" : "Save branding"}
      </button>
    </div>
  );
}

// ── Report button (shown on other players' storefronts) ───────────────────────
export function ReportStudioButton({
  playerId,
  itemId,
}: {
  playerId: string;
  itemId?: number;
}) {
  const [reported, setReported] = useState(false);
  const handleReport = async () => {
    await reportStudioContent({ reportedPlayerId: playerId, itemId, reason: "user-flagged" });
    setReported(true);
  };
  if (reported) return <span className="studio-reported">Reported</span>;
  return (
    <button className="tbtn studio-report-btn" onClick={handleReport} title="Report this content">
      Report
    </button>
  );
}

// ── Main Studio component ─────────────────────────────────────────────────────
export function Studio() {
  const { state, myStudio, myCustomizations, doStudio, notify, signedIn, signIn } = useTrove();
  const [customizing, setCustomizing] = useState<number | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  // All items the player currently holds that they produced themselves.
  const myProduced = useMemo(
    () => state.items.filter((it) => (state.producedQty[it.id] ?? 0) > 0 && held(it, "YOU") > 0),
    [state],
  );

  const handleUnlock = async () => {
    if (!signedIn) { signIn(); return; }
    setUnlocking(true);
    const err = await doStudio({ action: "unlock" });
    setUnlocking(false);
    if (!err) notify("Company Studio unlocked");
  };

  const handleCustomize = useCallback(
    async (
      itemId: number,
      patch: { displayName?: string; customImageUrl?: string; customDescription?: string },
    ) => {
      await doStudio({ action: "customize", itemId, ...patch });
    },
    [doStudio],
  );

  const handleRemove = useCallback(
    async (itemId: number) => {
      await doStudio({ action: "remove", itemId });
    },
    [doStudio],
  );

  const slotsUsed = Object.keys(myCustomizations).length;
  const totalSlots = myStudio?.productSlots ?? 5;

  // ── Locked state ──────────────────────────────────────────────────────────
  if (!myStudio?.unlocked) {
    return (
      <div className="view">
        <div className="bento">
          <header className="cat-head col-12">
            <h2 className="serif">Company Studio</h2>
          </header>
          <div className="bento-card col-12 studio-locked">
            <div className="studio-lock-icon">
              <Lock size={32} />
            </div>
            <h3 className="studio-lock-title">Build your own brand</h3>
            <p className="studio-lock-body">
              Give your products their own name, image, and story — without
              changing a single market price or contract term.
            </p>
            <ul className="studio-perks">
              <li>Custom names and images for 5 products</li>
              <li>Company logo + page banner</li>
              <li>Canonical classification always visible — market integrity intact</li>
              <li>Expand later: +10 product slots for $2.99</li>
            </ul>
            <div className="studio-price-row">
              <span className="studio-price">$4.99</span>
              <span className="studio-price-note">one-time unlock · not a subscription</span>
            </div>
            <button
              className="tbtn studio-unlock-btn"
              onClick={handleUnlock}
              disabled={unlocking}
            >
              {unlocking ? "Unlocking…" : "Unlock Company Studio — $4.99"}
            </button>
            <p className="studio-fine">
              Stripe payment coming soon — click to unlock in preview.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Unlocked state ────────────────────────────────────────────────────────
  const activeItem = customizing != null
    ? state.items.find((it) => it.id === customizing)
    : null;

  return (
    <div className="view">
      <div className="bento">
        <header className="cat-head col-12">
          <h2 className="serif">Company Studio</h2>
          <div className="vault-sum">
            <span className="vs"><i>Products customized</i><b>{slotsUsed}</b></span>
            <span className="vs"><i>Slots available</i><b>{totalSlots - slotsUsed}</b></span>
          </div>
        </header>

        {/* Branding panel */}
        <BrandingPanel />

        {/* Product list */}
        <div className="bento-card col-8">
          <div className="bc-h">
            <span className="t"><Package size={14} /> Products</span>
            <span className="why">{myProduced.length} producible item{myProduced.length !== 1 ? "s" : ""}</span>
          </div>
          <SlotBar used={slotsUsed} total={totalSlots} />

          {myProduced.length === 0 ? (
            <div className="empty">
              Build a factory line to start producing goods — then customize how
              they appear on your storefront.
            </div>
          ) : (
            myProduced.map((it) => {
              const custom = myCustomizations[it.id];
              const { displayName, customImageUrl } = resolveDisplay(it, myCustomizations);
              const isCustomized = !!custom;
              return (
                <div className="crow studio-product-row" key={it.id}>
                  {customImageUrl ? (
                    <img
                      className="studio-thumb"
                      src={customImageUrl}
                      alt={displayName}
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                  ) : (
                    <ItemIcon it={it} size={18} className="ic" />
                  )}
                  <span className="nm">
                    <span className={isCustomized ? "studio-custom-name" : ""}>{displayName}</span>
                    {isCustomized && displayName !== it.name && (
                      <span className="studio-canon-hint"> ({it.name})</span>
                    )}
                  </span>
                  <span className="pr">{money(it.value)}</span>
                  <button
                    className={`tbtn ${isCustomized ? "" : "sell"}`}
                    onClick={() => setCustomizing(it.id)}
                    disabled={!isCustomized && slotsUsed >= totalSlots}
                    title={
                      !isCustomized && slotsUsed >= totalSlots
                        ? "No slots remaining — buy more"
                        : isCustomized
                          ? "Edit customization"
                          : "Customize this product"
                    }
                  >
                    {isCustomized ? "Edit" : "Customize"}
                  </button>
                </div>
              );
            })
          )}

          {slotsUsed >= totalSlots && (
            <div className="studio-add-slots">
              <span>Slot limit reached.</span>
              <button
                className="tbtn"
                onClick={() => doStudio({ action: "add-slots" })}
              >
                <Plus size={13} /> Add 10 slots — $2.99
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Customizer modal */}
      {activeItem && (
        <Customizer
          itemId={activeItem.id}
          itemName={activeItem.name}
          itemValue={activeItem.value}
          canonicalClass={activeItem.category ?? ""}
          initial={myCustomizations[activeItem.id] ?? {}}
          onSave={handleCustomize}
          onRemove={handleRemove}
          onClose={() => setCustomizing(null)}
        />
      )}
    </div>
  );
}
