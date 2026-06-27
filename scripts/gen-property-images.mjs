/**
 * Generate the Property Market card art via the OpenAI image API.
 *
 * Reads the property catalog, builds one prompt per property (a fixed style so
 * the set stays cohesive), and writes <slug>.jpg|.png into the web app's
 * public/properties/ folder. Resumable: skips any property that already has an
 * image. Sequential with retry so it stays under rate limits.
 *
 *   THE API KEY IS NEVER IN THIS FILE. Put it in a gitignored .env at the repo
 *   root:   OPENAI_API_KEY=sk-...      (see .env.example)
 *   or set it in your shell:           $env:OPENAI_API_KEY = "sk-..."   (PowerShell)
 *
 * Run:   node scripts/gen-property-images.mjs
 * Opts (env):  MODEL=gpt-image-1|dall-e-3 (default gpt-image-1)
 *              QUALITY=medium|high|low     (gpt-image-1 only; default medium)
 *              ONLY=meridian-tower,the-spire   (comma slugs; default = all)
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "apps", "web", "public", "properties");
const CATALOG = join(ROOT, "packages", "data", "catalog", "properties.json");

// ── Load .env (simple KEY=VALUE parse) so the key never lives in the script ───
async function loadEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  const txt = await readFile(p, "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const PROMPT = (subj) =>
  `Architectural marketing render of ${subj}, dramatic golden-hour lighting, ` +
  `clean centered composition with breathing room at the edges, dark moody ` +
  `background, subtle warm gold rim-light, photorealistic but slightly ` +
  `stylized, no text, no logos, no people, no watermark, 3:2 landscape, high detail.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(prompt, model, quality) {
  const isGpt = model === "gpt-image-1";
  const body = isGpt
    ? { model, prompt, n: 1, size: "1536x1024", quality, output_format: "jpeg" }
    : { model, prompt, n: 1, size: "1792x1024", quality: "standard", response_format: "b64_json" };

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      const b64 = data?.data?.[0]?.b64_json;
      if (!b64) throw new Error("no image in response: " + JSON.stringify(data).slice(0, 300));
      return Buffer.from(b64, "base64");
    }
    const msg = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = 2000 * attempt;
      console.log(`   …${res.status}, retrying in ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`API ${res.status}: ${msg.slice(0, 300)}`);
  }
  throw new Error("exhausted retries");
}

async function main() {
  await loadEnv();
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "Missing OPENAI_API_KEY. Put it in a .env file at the repo root\n" +
        "  OPENAI_API_KEY=sk-...\n" +
        "or set it in your shell, then re-run.",
    );
    process.exit(1);
  }
  const model = process.env.MODEL || "gpt-image-1";
  const quality = process.env.QUALITY || "medium";
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim())) : null;
  const ext = model === "gpt-image-1" ? "jpg" : "png";

  await mkdir(OUT_DIR, { recursive: true });
  const props = JSON.parse(await readFile(CATALOG, "utf8"));
  const todo = props.filter((p) => {
    if (only && !only.has(p.slug)) return false;
    return !existsSync(join(OUT_DIR, `${p.slug}.jpg`)) && !existsSync(join(OUT_DIR, `${p.slug}.png`));
  });

  console.log(`Model ${model} (${ext}); ${todo.length} of ${props.length} to generate.\n`);
  let done = 0;
  for (const p of todo) {
    process.stdout.write(`[${++done}/${todo.length}] ${p.name} … `);
    try {
      const buf = await generate(PROMPT(p.img), model, quality);
      await writeFile(join(OUT_DIR, `${p.slug}.${ext}`), buf);
      console.log("ok");
    } catch (e) {
      console.log("FAILED:", e.message);
    }
    await sleep(800); // gentle on rate limits
  }
  console.log("\nDone. Images in apps/web/public/properties/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
