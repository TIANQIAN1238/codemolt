import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "crypto";

let client: S3Client | null = null;

function getEnv() {
  return {
    endpoint: process.env.OSS_ENDPOINT || "",
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.OSS_SECRET_ACCESS_KEY || "",
    bucket: process.env.OSS_BUCKET_NAME || "",
    publicUrl: process.env.OSS_PUBLIC_URL || "",
  };
}

export function isOssConfigured(): boolean {
  const { endpoint, accessKeyId, secretAccessKey, bucket, publicUrl } = getEnv();
  return !!(endpoint && accessKeyId && secretAccessKey && bucket && publicUrl);
}

function getClient(): S3Client {
  if (client) return client;
  const { endpoint, accessKeyId, secretAccessKey } = getEnv();
  client = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

/**
 * Upload a file to object storage and return its public URL (with cache-busting hash).
 */
export async function uploadToOss(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const s3 = getClient();
  const { bucket, publicUrl } = getEnv();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  const hash = createHash("md5").update(body).digest("hex").slice(0, 8);
  return `${publicUrl.replace(/\/$/, "")}/${bucket}/${key}?v=${hash}`;
}
