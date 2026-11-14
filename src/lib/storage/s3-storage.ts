import type { S3Client } from "@aws-sdk/client-s3";

import { assertSafeKey, type StorageProvider, type StoredObject } from "./types";

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/**
 * S3-compatible storage: AWS S3, Cloudflare R2 (endpoint = account URL,
 * region "auto"), Supabase Storage (S3 endpoint + forcePathStyle), MinIO.
 *
 * The AWS SDK is loaded lazily so local development never pays for it.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private client?: Promise<{ client: S3Client; sdk: typeof import("@aws-sdk/client-s3") }>;

  constructor(private readonly options: S3StorageOptions) {}

  private getClient() {
    this.client ??= import("@aws-sdk/client-s3").then((sdk) => ({
      sdk,
      client: new sdk.S3Client({
        region: this.options.region,
        endpoint: this.options.endpoint,
        forcePathStyle: this.options.forcePathStyle,
        credentials:
          this.options.accessKeyId && this.options.secretAccessKey
            ? { accessKeyId: this.options.accessKeyId, secretAccessKey: this.options.secretAccessKey }
            : undefined,
      }),
    }));
    return this.client;
  }

  async put(key: string, body: Uint8Array, options: { contentType: string }): Promise<void> {
    assertSafeKey(key);
    const { client, sdk } = await this.getClient();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const { client, sdk } = await this.getClient();
    const result = await client.send(new sdk.GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
    if (!result.Body) throw new Error(`Empty object body for ${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async getStream(key: string): Promise<StoredObject | null> {
    assertSafeKey(key);
    const { client, sdk } = await this.getClient();
    try {
      const result = await client.send(new sdk.GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
      if (!result.Body) return null;
      return {
        body: result.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        size: result.ContentLength,
        contentType: result.ContentType,
      };
    } catch (error) {
      if (error instanceof sdk.NoSuchKey) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const { client, sdk } = await this.getClient();
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafeKey(prefix.replace(/\/+$/, ""));
    const { client, sdk } = await this.getClient();
    let token: string | undefined;
    do {
      const page = await client.send(
        new sdk.ListObjectsV2Command({ Bucket: this.options.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []));
      if (keys.length > 0) {
        await client.send(new sdk.DeleteObjectsCommand({ Bucket: this.options.bucket, Delete: { Objects: keys } }));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}
