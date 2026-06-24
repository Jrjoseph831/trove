/**
 * Read Lambda — the public, anonymous read path behind API Gateway (GET /world).
 * Returns only the public view (no sector demand, no news effects). If the world
 * has not been seeded yet it seeds it, so the very first visitor sees a live floor.
 */
import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { loadWorld, seedWorld } from "../repo";
import { publicView } from "../view";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: {
    "content-type": "application/json",
    "cache-control": "public, max-age=15",
  },
  body: JSON.stringify(body),
});

export async function handler(): Promise<APIGatewayProxyResultV2> {
  let doc = await loadWorld();
  if (!doc) doc = await seedWorld();
  return json(200, publicView(doc));
}
