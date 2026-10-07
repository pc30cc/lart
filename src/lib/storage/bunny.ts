import "server-only"

import { decrypt } from "@/lib/crypto"
import type { SettingValue } from "@/lib/settings"
import { expectOk, storedFile, timeout, type Driver } from "./driver"

type BunnyConfig = Extract<SettingValue<"cdn">, { provider: "bunny" }>

/**
 * Bunny Storage HTTP API: PUT / GET / DELETE https://<storageHost>/<zone>/<path>
 * with the zone's AccessKey. The zone sits behind a pull zone (publicHost),
 * which serves the files; reading one (`get`) goes through the storage API.
 */
export function bunnyDriver(config: BunnyConfig): Driver {
  const zone = { name: config.publicZone, key: decrypt(config.publicZoneKeyEnc) }

  const call = (path: string, method: string, body?: Uint8Array | Blob) =>
    fetch(`https://${config.storageHost}/${encodeURIComponent(zone.name)}/${path}`, {
      method,
      // Bunny picks the served Content-Type from the file extension.
      headers: { AccessKey: zone.key, ...(body ? { "Content-Type": "application/octet-stream" } : {}) },
      body: body as BodyInit | undefined, // a Buffer is a valid body; TS types it as possibly shared memory
      // Never follow a redirect: it could carry the AccessKey to another host.
      redirect: "error",
      cache: "no-store",
      signal: timeout(body),
    })

  return {
    async put(path, body) {
      await expectOk(await call(path, "PUT", body), "Bunny upload")
    },
    async get(path) {
      const res = await call(path, "GET")
      if (res.status === 404) return null
      await expectOk(res, "Bunny download")
      return storedFile(res)
    },
    async remove(path) {
      const res = await call(path, "DELETE")
      if (res.status !== 404) await expectOk(res, "Bunny delete")
    },
    publicUrl: (path) => `https://${config.publicHost}/${path}`,
  }
}
