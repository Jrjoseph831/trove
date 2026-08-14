/**
 * Display resolution for Company Studio.
 *
 * The economy always runs on canonical items (pricing, recipes, contracts,
 * sector effects). This helper resolves WHAT TO SHOW — name/image/description
 * — falling back to canonical data when no customization exists or it's partial.
 */
import type { ProductCustomization } from "@trove/engine";

export interface ResolvedDisplay {
  /** Display name: custom if set, else canonical item name. */
  displayName: string;
  /** Custom image URL, or null. Always check and fall back to icon/nil. */
  customImageUrl: string | null;
  /** Custom one-line description, or null. */
  customDescription: string | null;
}

export function resolveDisplay(
  canonical: { id: number; name: string },
  customizations: Record<number, ProductCustomization> | undefined,
): ResolvedDisplay {
  const c = customizations?.[canonical.id];
  return {
    displayName: c?.displayName?.trim() || canonical.name,
    customImageUrl: c?.customImageUrl ?? null,
    customDescription: c?.customDescription?.trim() ?? null,
  };
}
