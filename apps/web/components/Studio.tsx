"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Building2, Image, Package, Palette, Plus, Trash2, X } from "lucide-react";
import { held } from "@trove/engine";
import { reportStudioContent, studioCheckout, studioUpload } from "@/lib/api";
import { resolveDisplay } from "@/lib/display";
import { money } from "@/lib/format";
import { ItemIcon } from "@/lib/icons";
import { useTrove } from "@/lib/trove";
import { ScreenHead, Stat } from "./ScreenHead";

// ── Slot counter ─────────────────────────────────────────────────────────────
function SlotBar({ used, total }: { used: number; total: number }) {
  return (
    <div className="studio-slots">
      <span className="ss-label">
        {used}/{total} slots used
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
  const { notify } = useTrove();
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [imageUrl, setImageUrl] = useState(initial.customImageUrl ?? "");
  const [description, setDescription] = useState(initial.customDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);

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

  const handleImgUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      notify("Image too large — max 2 MB");
      return;
    }
    setUploading(true);
    const url = await studioUpload(file, "product");
    setUploading(false);
    if (!url) { notify("Upload failed — try again"); return; }
    setImageUrl(url);
    setImgError(false);
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

        <div className="sm-canonical">
          <span className="sm-canon-name">{itemName}</span>
          <span className="sm-canon-class">{canonicalClass}</span>
          <span className="sm-canon-value">{money(itemValue)}</span>
        </div>
        <div className="sm-disclosure">
          Market price and contract terms never change — only how it looks on your storefront.
        </div>

        <div className="sm-field">
          <label className="sm-lbl">
            <Image size={13} /> Product image
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

          <div className="sm-img-upload-row">
            <button
              className="tbtn sell"
              onClick={() => imgInputRef.current?.click()}
              disabled={uploading || saving}
            >
              {uploading ? "Uploading…" : imageUrl ? "Replace image" : "Upload image"}
            </button>
            {imageUrl && (
              <button className="tbtn" onClick={() => { setImageUrl(""); setImgError(false); }}>
                Remove
              </button>
            )}
            <input
              ref={imgInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImgUpload(f);
                e.target.value = "";
              }}
            />
          </div>

          <span className="sm-hint">Or paste a URL below · max 2 MB · PNG, JPG, WebP, GIF</span>
          <input
            className="sm-input"
            type="url"
            placeholder="https://…"
            value={imageUrl}
            onChange={(e) => { setImageUrl(e.target.value); setImgError(false); }}
          />
        </div>

        <div className="sm-field">
          <label className="sm-lbl">
            <Package size={13} /> Display name{" "}
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

        <div className="sm-field">
          <label className="sm-lbl">
            Tagline{" "}
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

// ── Branding editor (logo + banner) with live company page preview ────────────
function BrandingPanel() {
  const { myStudio, doStudio, notify } = useTrove();
  const [logoUrl, setLogoUrl] = useState(myStudio?.logoUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(myStudio?.bannerUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "banner" | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  const hasChanges =
    logoUrl !== (myStudio?.logoUrl ?? "") ||
    bannerUrl !== (myStudio?.bannerUrl ?? "");

  const pickFile = async (file: File, type: "logo" | "banner") => {
    const maxMB = type === "logo" ? 1 : 2;
    if (file.size > maxMB * 1024 * 1024) {
      notify(`File too large — max ${maxMB} MB`);
      return;
    }
    setUploading(type);
    const url = await studioUpload(file, type);
    setUploading(null);
    if (!url) { notify("Upload failed — try again"); return; }
    if (type === "logo") setLogoUrl(url);
    else setBannerUrl(url);
  };

  const handleSave = async () => {
    setSaving(true);
    const err = await doStudio({
      action: "branding",
      logoUrl: logoUrl || undefined,
      bannerUrl: bannerUrl || undefined,
    });
    setSaving(false);
    if (!err) notify("Branding saved");
  };

  return (
    <div className="bento-card col-12 studio-branding-panel">
      <div className="bc-h">
        <span className="t"><Palette size={14} /> Company branding</span>
        <button
          className="tbtn sm-save"
          onClick={handleSave}
          disabled={saving || !hasChanges || uploading !== null}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="sbp-layout">
        {/* ── Upload controls ── */}
        <div className="sbp-controls">

          {/* Logo */}
          <div className="sbp-field">
            <div className="sbp-field-header">
              <span className="sbp-label">Logo</span>
              <span className="sm-hint">Square · max 1 MB</span>
            </div>
            <div className="sbp-logo-row">
              <div className="sbp-logo-thumb">
                {logoUrl
                  ? <img src={logoUrl} alt="logo" onError={(e) => (e.currentTarget.style.display = "none")} />
                  : <Building2 size={20} className="sbp-empty-icon" />
                }
              </div>
              <div className="sbp-upload-btns">
                <button
                  className="tbtn sell"
                  onClick={() => logoRef.current?.click()}
                  disabled={uploading !== null}
                >
                  {uploading === "logo" ? "Uploading…" : logoUrl ? "Change" : "Upload logo"}
                </button>
                {logoUrl && (
                  <button className="tbtn" onClick={() => setLogoUrl("")} disabled={uploading !== null}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            <input
              ref={logoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f, "logo"); e.target.value = ""; }}
            />
          </div>

          {/* Banner */}
          <div className="sbp-field">
            <div className="sbp-field-header">
              <span className="sbp-label">Banner</span>
              <span className="sm-hint">Wide photo · 16:5 ratio · max 2 MB</span>
            </div>
            <div className="sbp-banner-thumb">
              {bannerUrl
                ? <img src={bannerUrl} alt="banner" onError={(e) => (e.currentTarget.style.display = "none")} />
                : <span className="sbp-empty-icon">No banner</span>
              }
            </div>
            <div className="sbp-upload-btns">
              <button
                className="tbtn sell"
                onClick={() => bannerRef.current?.click()}
                disabled={uploading !== null}
              >
                {uploading === "banner" ? "Uploading…" : bannerUrl ? "Change banner" : "Upload banner"}
              </button>
              {bannerUrl && (
                <button className="tbtn" onClick={() => setBannerUrl("")} disabled={uploading !== null}>
                  Remove
                </button>
              )}
            </div>
            <input
              ref={bannerRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f, "banner"); e.target.value = ""; }}
            />
          </div>
        </div>

        {/* ── Live company page preview ── */}
        <div className="sbp-preview-wrap">
          <span className="sbp-preview-label">Live preview</span>
          <div className="sbp-preview-card">
            <div
              className="sbp-preview-banner"
              style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}
            >
              {!bannerUrl && <span className="sbp-banner-placeholder">Banner</span>}
              <div className={`sbp-preview-logo ${logoUrl ? "" : "sbp-logo-empty"}`}>
                {logoUrl
                  ? <img src={logoUrl} alt="logo" onError={(e) => (e.currentTarget.style.display = "none")} />
                  : <Building2 size={18} />
                }
              </div>
            </div>
            <div className="sbp-preview-body">
              <div className="sbp-preview-name">Your Company</div>
              <div className="sbp-preview-meta">Company page on Trove</div>
            </div>
          </div>
          <p className="sbp-preview-note">
            This is how your logo and banner appear on your company page.
          </p>
        </div>
      </div>
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
  const { state, myStudio, myCustomizations, doStudio, notify, signedIn, signIn, setTab } = useTrove();
  const [customizing, setCustomizing] = useState<number | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [addingSlots, setAddingSlots] = useState(false);


  const myProduced = useMemo(
    () => state.items.filter((it) => (state.producedQty[it.id] ?? 0) > 0 && held(it, "YOU") > 0),
    [state],
  );

  const hasFactories = (state.factories?.length ?? 0) > 0;

  const handleUnlock = async () => {
    if (!signedIn) { signIn(); return; }
    setUnlocking(true);
    const result = await studioCheckout("unlock");
    if ("url" in result) {
      window.location.href = result.url;
    } else {
      notify(`Checkout failed: ${result.error}`);
      setUnlocking(false);
    }
  };

  const handleAddSlots = async () => {
    setAddingSlots(true);
    const err = await doStudio({ action: "add-slots" });
    setAddingSlots(false);
    if (!err) notify("+10 slots added");
    else notify(err);
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
  const totalSlots = myStudio?.productSlots ?? 20;

  // ── Locked state ──────────────────────────────────────────────────────────
  if (!myStudio?.unlocked) {
    return (
      <div className="view">
        <div className="bento">
          <ScreenHead tab="studio" className="col-12" />
          <div className="bento-card col-12 studio-locked">
            <div className="studio-hero">
              <h3 className="studio-hero-title">Your brand. Your storefront.</h3>
              <p className="studio-hero-sub">
                Upload product images, write custom names and descriptions, and put a logo on your company page.
              </p>
            </div>

            <div className="studio-pillars">
              <div className="studio-pillar">
                <div className="sp-icon"><Image size={22} /></div>
                <strong>Product images</strong>
                <span>Replace the default icon with your own photo or artwork for any item you sell.</span>
              </div>
              <div className="studio-pillar">
                <div className="sp-icon"><Package size={22} /></div>
                <strong>Custom names & taglines</strong>
                <span>Give products their own name and a short description shown on your storefront.</span>
              </div>
              <div className="studio-pillar">
                <div className="sp-icon"><Palette size={22} /></div>
                <strong>Logo & banner</strong>
                <span>Brand your company page with a custom logo and header image.</span>
              </div>
            </div>

            <p className="studio-economy-note">
              Prices, recipes, and contract terms stay with the market. Studio is display only.
            </p>

            <div className="studio-cta-block">
              <div className="studio-price-row">
                <span className="studio-price">$4.99</span>
                <span className="studio-price-note">one-time · not a subscription</span>
              </div>
              <button
                className="tbtn studio-unlock-btn"
                onClick={handleUnlock}
                disabled={unlocking}
              >
                {unlocking ? "Opening checkout…" : "Unlock Studio"}
              </button>
              <p className="studio-fine">Secure payment via Stripe</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Unlocked + no factory built yet ──────────────────────────────────────
  if (!hasFactories) {
    return (
      <div className="view">
        <div className="bento">
          <ScreenHead tab="studio" className="col-12" />
          <div className="bento-card col-12 studio-empty-state">
            <div className="ses-icon"><Package size={28} /></div>
            <h3 className="ses-title">Studio is ready — build something to sell</h3>
            <p className="ses-body">
              Head to the Factory tab and set up a production line. Once you have items in stock, you can customize how they look here.
            </p>
            <button className="tbtn sell ses-cta" onClick={() => setTab("factory" as never)}>
              Go to Factory
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Unlocked + factory running + nothing produced yet ─────────────────────
  if (myProduced.length === 0) {
    return (
      <div className="view">
        <div className="bento">
          <ScreenHead tab="studio" className="col-12" />
          <BrandingPanel />
          <div className="bento-card col-12 studio-empty-state">
            <div className="ses-icon"><Package size={24} /></div>
            <h3 className="ses-title">Nothing to customize yet</h3>
            <p className="ses-body">
              Your factory is set up. Products appear here once your first production run completes — or hit "Run Now" in the Factory tab to move things along.
            </p>
            <button className="tbtn ses-cta" onClick={() => setTab("factory" as never)}>
              Go to Factory
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Fully unlocked with products ──────────────────────────────────────────
  const activeItem = customizing != null
    ? state.items.find((it) => it.id === customizing)
    : null;

  return (
    <div className="view">
      <div className="bento">
        <ScreenHead tab="studio" className="col-12">
          <Stat label="Customized" value={slotsUsed} />
          <Stat label="Slots left" value={totalSlots - slotsUsed} />
        </ScreenHead>

        <BrandingPanel />

        <div className="bento-card col-12">
          <div className="bc-h">
            <span className="t"><Package size={14} /> Products</span>
            <span className="why">{myProduced.length} item{myProduced.length !== 1 ? "s" : ""} in production</span>
          </div>
          <SlotBar used={slotsUsed} total={totalSlots} />

          {myProduced.map((it) => {
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
                      ? "No slots left — get more below"
                      : isCustomized
                        ? "Edit customization"
                        : "Customize this product"
                  }
                >
                  {isCustomized ? "Edit" : "Customize"}
                </button>
              </div>
            );
          })}

          {slotsUsed >= totalSlots && (
            <div className="studio-add-slots">
              <span>All {totalSlots} slots used.</span>
              <button
                className="tbtn sell"
                onClick={handleAddSlots}
                disabled={addingSlots}
              >
                <Plus size={13} /> {addingSlots ? "Adding…" : "Get 10 more slots"}
              </button>
            </div>
          )}
        </div>
      </div>

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
