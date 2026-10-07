import "server-only"
import { AwsClient } from "aws4fetch"

import { decrypt } from "@/lib/crypto"
import type { SettingValue } from "@/lib/settings"
import { expectOk, IMMUTABLE, storedFile, timeout, type Driver } from "./driver"

type CloudflareConfig = Extract<SettingValue<"cdn">, { provider: "cloudflare" }>

/**
 * Cloudflare R2 through its S3 API (signed with aws4fetch):
 * https://<accountId>.r2.cloudflarestorage.com/<bucket>/<path>. The bucket
 * is served from its custom domain (publicHost); reading a file (`get`) is a
 * signed GetObject.
 */
export function r2Driver(config: CloudflareConfig): Driver {
  const client = new AwsClient({
    accessKeyId: decrypt(config.accessKeyIdEnc),
    secretAccessKey: decrypt(config.secretAccessKeyEnc),
    service: "s3",
    region: "auto",
    retries: 0,
  })

  const call = async (path: string, method: string, body?: Uint8Array | Blob, headers?: HeadersInit) => {
    const url = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.publicBucket)}/${path}`
    // The payload is not hashed (UNSIGNED-PAYLOAD), so a file-backed Blob streams from disk.
    const signed = await client.sign(url, {
      method,
      headers,
      body: body as BodyInit | undefined, // a Buffer is a valid body; TS types it as possibly shared memory
      redirect: "error",
      cache: "no-store",
      signal: timeout(body),
    })
    return fetch(signed)
  }

  return {
    async put(path, body, contentType) {
      // Every path is new and random, so a file never changes: cache it for good.
      const headers = { "Content-Type": contentType, "Cache-Control": IMMUTABLE }
      await expectOk(await call(path, "PUT", body, headers), "R2 upload")
    },
    async get(path) {
      const res = await call(path, "GET")
      if (res.status === 404) return null
      await expectOk(res, "R2 download")
      return storedFile(res)
    },
    async remove(path) {
      const res = await call(path, "DELETE")
      if (res.status !== 404) await expectOk(res, "R2 delete")
    },
    publicUrl: (path) => `https://${config.publicHost}/${path}`,
  }
}
