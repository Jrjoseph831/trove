import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getItem, items } from "@trove/data";
import { ItemDetail } from "@/components/ItemDetail";

export function generateStaticParams() {
  return items.map((it) => ({ id: String(it.id) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = getItem(Number(id));
  if (!item) return { title: "Trove" };
  return {
    title: `${item.name} · ${item.brand} · Trove`,
    description: `${item.name} by ${item.brand} — on the Trove floor.`,
  };
}

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = getItem(Number(id));
  if (!item) notFound();
  return (
    <main className="itempage">
      <ItemDetail item={item} />
    </main>
  );
}
