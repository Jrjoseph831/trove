/**
 * Generate custom category icons via the OpenAI image API — premium line-art
 * glyphs to replace the generic Lucide icons. One per item category, single
 * consistent style, transparent background. Resumable (skips existing).
 *
 *   Key lives in a gitignored .env (OPENAI_API_KEY) — see .env.example.
 *   Run:  node scripts/gen-icons.mjs
 *   Opts: MODEL=gpt-image-1 (default), QUALITY=medium, ONLY=auto-parts,compute
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "apps", "web", "public", "icons");

async function loadEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of (await readFile(p, "utf8")).split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// category → the symbol to draw.
const SUBJECTS = {
  "Fasteners & Fixings": "a hex bolt and nut",
  "Structural Materials": "a stacked steel I-beam",
  "Plumbing & Fixtures": "a water faucet/tap",
  "Wire & Cable": "a coiled electrical cable",
  Lighting: "a light bulb",
  "Power & Storage": "a battery cell",
  Packaging: "a cardboard shipping box",
  "Material Handling": "a forklift",
  Vehicles: "a delivery van",
  "Auto Parts": "a mechanical gear / cog",
  Compute: "a server rack",
  Devices: "a smartphone",
  "Farm Inputs": "a sprouting seedling",
  "Farm Equipment": "a tractor",
  Earthmoving: "an excavator",
  "Industrial Machines": "a factory press machine",
  "Medical Consumables": "an adhesive bandage",
  "Medical Equipment": "a stethoscope",
  "Food Service": "a chef's hat with utensils",
  "Cleaning & Jansan": "a spray bottle",
  "Raw Textiles": "a spool of thread",
  "Apparel Goods": "a folded jacket",
  "Household Goods": "a cozy armchair",
  "Hardware & Tools": "a crossed wrench and hammer",
  Timepieces: "a wristwatch",
  "Fine Goods": "a faceted gemstone",
};

const slug = (s) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const PROMPT = (subj) =>
  `A minimalist premium app icon of ${subj}: a single clean line-art symbol, ` +
  `warm gold (#EAB14A) thin strokes, centered, generous padding, geometric and ` +
  `crisp, flat (no 3D, no shadow, no gradient), no text, no frame, no background ` +
  `(fully transparent). Consistent icon-set style, 1:1.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gen(prompt, model, quality) {
  const isGpt = model === "gpt-image-1";
  const body = isGpt
    ? { model, prompt, n: 1, size: "1024x1024", quality, background: "transparent", output_format: "png" }
    : { model, prompt, n: 1, size: "1024x1024", response_format: "b64_json" };
  for (let a = 1; a <= 4; a++) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const b64 = (await res.json())?.data?.[0]?.b64_json;
      if (!b64) throw new Error("no image in response");
      return Buffer.from(b64, "base64");
    }
    const msg = await res.text();
    if ((res.status === 429 || res.status >= 500) && a < 4) {
      await sleep(2000 * a);
      continue;
    }
    throw new Error(`API ${res.status}: ${msg.slice(0, 200)}`);
  }
  throw new Error("exhausted retries");
}

async function main() {
  await loadEnv();
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in .env");
    process.exit(1);
  }
  const model = process.env.MODEL || "gpt-image-1";
  const quality = process.env.QUALITY || "medium";
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim())) : null;
  await mkdir(OUT_DIR, { recursive: true });

  const entries = Object.entries(SUBJECTS).filter(([cat]) => {
    const sl = slug(cat);
    if (only && !only.has(sl)) return false;
    return !existsSync(join(OUT_DIR, `${sl}.png`));
  });
  console.log(`Model ${model}; generating ${entries.length} of ${Object.keys(SUBJECTS).length} icons.\n`);
  let done = 0;
  for (const [cat, subj] of entries) {
    const sl = slug(cat);
    process.stdout.write(`[${++done}/${entries.length}] ${cat} … `);
    try {
      const buf = await gen(PROMPT(subj), model, quality);
      await writeFile(join(OUT_DIR, `${sl}.png`), buf);
      console.log("ok");
    } catch (e) {
      console.log("FAILED:", e.message);
    }
    await sleep(700);
  }
  console.log("\nDone. Icons in apps/web/public/icons/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
