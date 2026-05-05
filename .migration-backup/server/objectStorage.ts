import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  // Get upload URL for genre images - returns both upload and view URLs
  async getGenreImageUploadURL(type: 'regular' | 'discoverable'): Promise<{ uploadUrl: string; viewUrl: string }> {
    const privateObjectDir = this.getPrivateObjectDir();
    const imageId = randomUUID();
    const fullPath = `${privateObjectDir}/genres/${type}/${imageId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    
    // Generate signed URL for uploading
    const uploadUrl = await signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });

    // Generate signed URL for viewing (GET) - valid for 1 year
    const viewUrl = await signObjectURL({
      bucketName,
      objectName,
      method: "GET",
      ttlSec: 31536000, // 1 year
    });

    return { uploadUrl, viewUrl };
  }

  // Get upload URL for station favicons
  async getFaviconUploadURL(): Promise<{ uploadUrl: string; publicUrl: string; objectPath: string }> {
    const privateObjectDir = this.getPrivateObjectDir();
    const faviconId = randomUUID();
    const fullPath = `${privateObjectDir}/favicons/${faviconId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    
    const uploadUrl = await signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });

    return {
      uploadUrl,
      publicUrl: `/public-objects/favicons/${faviconId}`,
      objectPath: fullPath
    };
  }

  // Normalize image paths for object storage URLs
  normalizeImagePath(rawPath: string, type: 'regular' | 'discoverable'): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    
    let objectDir = this.getPrivateObjectDir();
    if (!objectDir.endsWith("/")) {
      objectDir = `${objectDir}/`;
    }

    const expectedPrefix = `${objectDir}genres/${type}/`;
    if (!rawObjectPath.startsWith(expectedPrefix)) {
      return rawObjectPath;
    }

    const imageId = rawObjectPath.slice(expectedPrefix.length);
    return `/public-objects/genres/${type}/${imageId}`;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    // First search in public object search paths
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }
    
    // Also search in private object dir (for favicons uploaded via admin)
    try {
      const privateDir = this.getPrivateObjectDir();
      const fullPath = `${privateDir}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    } catch (e) {
      // Private dir not configured, skip
    }
    
    return null;
  }

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 604800) {
    try {
      const [metadata] = await file.getMetadata();
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `public, max-age=${cacheTtlSec}, stale-while-revalidate=86400`,
        "Vary": "Accept-Encoding",
        "ETag": `"${metadata.size}-${metadata.timeCreated || metadata.updated || Date.now()}"`,
        "Last-Modified": metadata.updated || new Date().toUTCString()
      });

      const stream = file.createReadStream();
      stream.on("error", (err) => {
        // console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      stream.pipe(res);
    } catch (error) {
      // console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }
}

export function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

export async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}