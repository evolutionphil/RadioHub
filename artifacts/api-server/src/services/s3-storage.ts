import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { logger } from "../utils/logger";

const BUCKET = process.env.AWS_BUCKET_NAME || "";
const REGION = process.env.AWS_REGION || "eu-north-1";

let _cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (_cachedClient) return _cachedClient;
  _cachedClient = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
    maxAttempts: 2,
  });
  return _cachedClient;
}

export function getS3PublicUrl(key: string): string {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

export function isS3Url(value: string): boolean {
  return value.startsWith("https://") && value.includes(".s3.");
}

export async function uploadToS3(
  key: string,
  buffer: Buffer,
  contentType: string = "image/webp"
): Promise<string> {
  if (!BUCKET) throw new Error("AWS_BUCKET_NAME is not configured");

  const client = getClient();
  const abortController = new AbortController();
  const uploadTimeout = setTimeout(() => abortController.abort(), 15000);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
      { abortSignal: abortController.signal }
    );
    return getS3PublicUrl(key);
  } finally {
    clearTimeout(uploadTimeout);
  }
}

export async function deleteFromS3(key: string): Promise<void> {
  if (!BUCKET) return;
  const client = getClient();
  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err: any) {
    logger.error(`S3 delete failed for ${key}: ${err.message}`);
  }
}

export async function deleteFolderFromS3(folderPrefix: string): Promise<void> {
  if (!BUCKET) return;
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const client = getClient();

  try {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: folderPrefix })
    );

    const objects = (listed.Contents || []).map((o) => ({ Key: o.Key! }));
    if (objects.length === 0) return;

    await client.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: objects },
      })
    );
    logger.log(`🗑️ S3: Deleted ${objects.length} objects from ${folderPrefix}`);
  } catch (err: any) {
    logger.error(`S3 folder delete failed for ${folderPrefix}: ${err.message}`);
  }
}

export function isS3Configured(): boolean {
  return !!(BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export function logoVariantStorageConfig(): { bucket: string; region: string } | null {
  return isS3Configured() && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(BUCKET) && /^[a-z0-9-]+$/.test(REGION)
    ? { bucket: BUCKET, region: REGION } : null;
}

/** Read only an already-published 256px object from our own configured bucket. */
export async function readLogoVariantSource(key: string, signal: AbortSignal): Promise<Buffer> {
  if (!logoVariantStorageConfig() || !/^station-logos\/[a-z0-9_-]{1,200}\/logo-256\.webp$/.test(key)) {
    throw new Error('Unsupported logo variant source key');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const combined = AbortSignal.any([signal, controller.signal]);
  let body: any;
  try {
    const result = await getClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }), { abortSignal: combined });
    body = result.Body;
    const maxBytes = 2 * 1024 * 1024;
    if (result.ContentType?.split(';')[0].trim() !== 'image/webp' || !body ||
      (result.ContentLength !== undefined && (result.ContentLength <= 0 || result.ContentLength > maxBytes))) {
      throw new Error('Invalid stored logo content');
    }
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of body) {
      combined.throwIfAborted();
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (bytes > maxBytes) throw new Error('Stored logo exceeds size limit');
      chunks.push(buffer);
    }
    if (!bytes) throw new Error('Stored logo is empty');
    return Buffer.concat(chunks, bytes);
  } finally {
    controller.abort(); body?.destroy?.(); clearTimeout(timeout);
  }
}

/** New UUID-scoped keys only; a collision must fail rather than overwrite. */
export async function uploadLogoVariant(key: string, buffer: Buffer, signal: AbortSignal): Promise<string> {
  if (!logoVariantStorageConfig() || !/^station-logos\/[a-z0-9_-]{1,200}\/variants\/[a-f0-9-]{36}\/logo-(48|96)\.webp$/.test(key) ||
    !buffer.length || buffer.length > 128 * 1024) throw new Error('Invalid small logo variant');
  await getClient().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer, ContentType: 'image/webp', IfNoneMatch: '*',
    CacheControl: 'public, max-age=31536000, immutable',
  }), { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  return getS3PublicUrl(key);
}
