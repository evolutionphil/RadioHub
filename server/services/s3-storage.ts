import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { logger } from "../utils/logger";

const BUCKET = process.env.AWS_BUCKET_NAME || "";
const REGION = process.env.AWS_REGION || "eu-north-1";

function getClient(): S3Client {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  });
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
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return getS3PublicUrl(key);
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
