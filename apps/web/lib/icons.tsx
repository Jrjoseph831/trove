"use client";

import {
  Bandage,
  BatteryCharging,
  Bolt,
  Boxes,
  BrickWall,
  Cable,
  Car,
  Cog,
  Cpu,
  Crown,
  Disc,
  Droplet,
  Droplets,
  Factory,
  Forklift,
  Fuel,
  Gem,
  Hammer,
  House,
  Keyboard,
  Lightbulb,
  type LucideIcon,
  Network,
  Package,
  Server,
  Scissors,
  Shirt,
  Shovel,
  Smartphone,
  SprayCan,
  Sprout,
  Stethoscope,
  Tractor,
  Truck,
  Utensils,
  Watch,
  Wrench,
  Zap,
} from "lucide-react";
import type { Item } from "@trove/data";

/**
 * Curated monochrome line icons mapped by category (with subcategory overrides
 * where a category mixes object types). Chosen for legibility — a drill reads
 * as a drill — and a cohesive, premium feel. Items are fictional brands, so
 * this stands in for per-item photography. See specs/05_UI_SPEC.md.
 */
const BY_CATEGORY: Record<string, LucideIcon> = {
  "Fasteners & Fixings": Bolt,
  "Structural Materials": BrickWall,
  "Plumbing & Fixtures": Droplets,
  "Wire & Cable": Cable,
  Lighting: Lightbulb,
  "Power & Storage": BatteryCharging,
  Packaging: Package,
  "Material Handling": Forklift,
  Vehicles: Car,
  "Auto Parts": Cog,
  Compute: Server,
  Devices: Smartphone,
  "Farm Inputs": Sprout,
  "Farm Equipment": Tractor,
  Earthmoving: Shovel,
  "Industrial Machines": Factory,
  "Medical Consumables": Bandage,
  "Medical Equipment": Stethoscope,
  "Food Service": Utensils,
  "Cleaning & Jansan": SprayCan,
  "Raw Textiles": Scissors,
  "Apparel Goods": Shirt,
  "Household Goods": House,
  "Hardware & Tools": Hammer,
  Timepieces: Watch,
  "Fine Goods": Gem,
};

const BY_SUB: Record<string, LucideIcon> = {
  "Wire & Cable/Data & Fiber": Network,
  "Power & Storage/Generation": Zap,
  "Power & Storage/Fuel": Fuel,
  "Packaging/Pallets & Crates": Boxes,
  "Vehicles/Commercial": Truck,
  "Auto Parts/Tires & Rubber": Disc,
  "Auto Parts/Fluids": Droplet,
  "Compute/Components": Cpu,
  "Compute/Networking": Network,
  "Devices/Peripherals": Keyboard,
  "Hardware & Tools/Power Tools": Wrench,
  "Fine Goods/Objects": Crown,
};

export function iconFor(it: Pick<Item, "category" | "sub">): LucideIcon {
  return BY_SUB[`${it.category}/${it.sub}`] ?? BY_CATEGORY[it.category] ?? Package;
}

export function ItemIcon({
  it,
  size = 20,
  className,
}: {
  it: Pick<Item, "category" | "sub">;
  size?: number;
  className?: string;
}) {
  const Icon = iconFor(it);
  return <Icon size={size} strokeWidth={1.5} className={className} aria-hidden />;
}
