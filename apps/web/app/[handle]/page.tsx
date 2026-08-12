import type { Metadata } from "next";
import { companyRoster } from "@trove/data";
import { PublicCompany } from "@/components/PublicCompany";
import { TroveProvider } from "@/lib/trove";

/** Same slug rule the server uses for house handles (see repo.ts). */
const houseHandle = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** AI houses are known at build time and get prerendered. Player handles are
 *  created at runtime, so they're rendered on demand — which is what makes a
 *  company page linkable at all.
 *
 *  NOTE for a future merge to main: this is incompatible with the GitHub
 *  Pages static-export fallback (`output: "export"` requires
 *  dynamicParams: false, and route-segment config must be a literal so it
 *  can't be switched per-build). Pages currently only builds on main, so
 *  beta is unaffected — but that workflow will need this route excluded, or
 *  retiring, before prod. Vercel is the real deployment and handles it. */
export const dynamicParams = true;

export function generateStaticParams() {
  return companyRoster.map((c) => ({ handle: houseHandle(c.name) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `${handle} · Trove`,
    description: `A firm trading on the Trove market.`,
  };
}

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  // Wrapped in the provider because the shared <SiteView/> (and the storefront
  // Request flow inside it) reads Trove context — so a visitor who clicks
  // Request gets the normal sign-in gate rather than a crash.
  return (
    <TroveProvider>
      <PublicCompany handle={handle} />
    </TroveProvider>
  );
}
