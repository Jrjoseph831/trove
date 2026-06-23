import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandSlug, brands, getBrandBySlug, getLore, itemsByBrand } from "@trove/data";
import { BrandDossier } from "@/components/BrandDossier";

export function generateStaticParams() {
  return brands.map((b) => ({ slug: brandSlug(b.name) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brand = getBrandBySlug(slug);
  if (!brand) return { title: "Trove" };
  const lore = getLore(brand.name);
  return {
    title: `${brand.name} · Trove`,
    description: lore?.tagline ?? `${brand.name} on the Trove floor.`,
  };
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brand = getBrandBySlug(slug);
  if (!brand) notFound();
  return (
    <main className="brandpage">
      <BrandDossier
        brand={brand}
        lore={getLore(brand.name)}
        brandItems={itemsByBrand(brand.name)}
      />
    </main>
  );
}
