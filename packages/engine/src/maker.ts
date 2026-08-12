/**
 * Maker attribution — who actually made a unit, and what they call it.
 *
 * The catalog SKU is a *design*, not a product. Once a firm builds a line for
 * it, the units coming off that line are theirs: they carry the firm's own
 * manufacturing name and their own designation, and clicking through goes to
 * that firm — not to whichever brand happened to originate the design. Two
 * firms making cowhide are competitors selling their own cowhide, not two
 * links to the same third party.
 *
 * The base noun is always preserved so the goods stay comparable and
 * searchable; only a designation is appended. Everything here is a pure
 * function of (maker, itemId), so the server storefront, the owner's vault
 * preview, and the public company page all render the identical string
 * without coordinating.
 */

/** Deterministic 0..1 hash (FNV-1a — the same one @trove/data uses for tiers,
 *  so nothing here ever touches the RNG sequence). */
function hash01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/** Manufacturing-trade designations. Deliberately mundane and industrial —
 *  these read as a real product line, not as fantasy flavour. */
const DESIGNATIONS = [
  "Select",
  "Series",
  "Grade",
  "Reserve",
  "Standard",
  "Works",
  "Prime",
  "Classic",
  "Mill Run",
  "Signature",
  "Heritage",
  "Trade",
];

/** Firm suffixes to drop when shortening a company name into a product mark:
 *  "Shore Holdings" → "Shore", so the SKU reads "Cowhide — Shore Select".
 *  Applied repeatedly, because real names stack them ("Aldousmont & Sons Ltd"). */
const FIRM_TAIL =
  /[\s,]+(&|and)?\s*(sons|holdings?|group|company|co|corp(oration)?|inc(orporated)?|ltd|limited|llc|plc|partners|capital|industries|enterprises|ventures|manufacturing)\.?$/i;

/** The short product mark for a firm — its name with the corporate tail off. */
export function makerMark(maker: string): string {
  let base = maker.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const next = base.replace(FIRM_TAIL, "").trim();
    if (next === base || !next) break;
    base = next;
  }
  return base || maker.trim();
}

/**
 * A firm's house designation — ONE word for everything it makes, so the mark
 * behaves like real branding: learn "Shore Reserve" once and you recognise
 * Shore's goods anywhere. Keying this per-item instead would give a single
 * firm a different designation on every SKU, which reads as noise.
 */
export function makerDesignation(maker: string): string {
  const mark = makerMark(maker);
  return DESIGNATIONS[Math.floor(hash01(mark) * DESIGNATIONS.length)]!;
}

/**
 * What `maker` calls their version of catalog item `itemId` (base name
 * `baseName`) — "Cowhide — Shore Reserve". Distinct between makers, so each
 * firm's cowhide is visibly its own product, while the base noun stays intact
 * so the goods remain comparable and searchable.
 *
 * `itemId` is accepted (and currently unused) so callers pass the full identity
 * of the SKU; per-SKU variation belongs here if it's ever wanted, not at every
 * call site.
 */
export function makerVariantName(
  baseName: string,
  maker: string | null | undefined,
  itemId?: number,
): string {
  void itemId;
  if (!maker) return baseName;
  const mark = makerMark(maker);
  if (!mark) return baseName;
  return `${baseName} — ${mark} ${makerDesignation(maker)}`;
}
