/**
 * Studio asset upload Lambda — returns a presigned S3 PUT URL so the client can
 * upload images (logo, banner, product) directly to S3 without routing binary
 * data through the Lambda.
 *
 *   POST /studio/upload  (auth)
 *   Body: { filename: string; contentType: string; type: "logo"|"banner"|"product" }
 *   Returns: { uploadUrl: string; publicUrl: string }
 *
 * The client calls PUT on uploadUrl with the raw image binary, then saves publicUrl
 * via the /studio branding or customize action.
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const BUCKET = process.env.ASSETS_BUCKET ?? "";
const REGION = process.env.AWS_REGION ?? "us-east-1";

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};
const UPLOAD_TYPES = new Set(["logo", "banner", "product"]);

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

const subOf = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  e.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  if (!BUCKET) return json(503, { error: "storage not configured" });

  const playerId = subOf(event);
  if (!playerId) return json(401, { error: "unauthorized" });

  let body: { filename?: string; contentType?: string; type?: string };
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : event.body ?? "{}";
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad json" });
  }

  const contentType = body.contentType ?? "";
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return json(400, { error: "unsupported image type" });

  const uploadType = body.type ?? "product";
  if (!UPLOAD_TYPES.has(uploadType)) return json(400, { error: "invalid upload type" });

  const key = `studio/${playerId}/${uploadType}/${Date.now()}.${ext}`;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  );

  const publicUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
  return json(200, { uploadUrl, publicUrl });
}
