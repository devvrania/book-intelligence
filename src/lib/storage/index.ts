import { getEnv, type Env } from "@/lib/config/env";

import { LocalStorageProvider } from "./local-storage";
import { S3StorageProvider } from "./s3-storage";
import type { StorageProvider } from "./types";

export * from "./types";

export function createStorageProvider(env: Env = getEnv()): StorageProvider {
  switch (env.STORAGE_PROVIDER) {
    case "local":
      return new LocalStorageProvider(env.LOCAL_STORAGE_DIR);
    case "s3":
      if (!env.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_PROVIDER=s3");
      return new S3StorageProvider({
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
  }
}
