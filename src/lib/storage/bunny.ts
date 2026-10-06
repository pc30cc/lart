import "server-only"

import { decrypt } from "@/lib/crypto"
import type { SettingValue } from "@/lib/settings"
import { expectOk, storedFile, timeout, type Driver, type Zone } from "./driver"

type BunnyConfig = Extract<SettingValue<"cdn">, { provider: "bunny" }>

/**
 * Bunny Storage HTTP API: PUT / GET / DELETE https://<storageHost>/<zone>/<path>
 * with the zone's AccessKey. The public zone sits behind a pull zone
 * (publicHost); the private zone has no pull zone at all.
 */
export function bunnyDriver(config: BunnyConfig): Driver {
  const zones = {
    public: { name: config.publicZone, key: decrypt(config.publicZoneKeyEnc) },
    private: { name: config.privateZone, key: decrypt(config.privateZoneKeyEnc) },
  }

  const call = (zone: Zone, path: string, method: string, body?: Uint8Array | Blob) =>
    fetch(`https://${config.storageHost}/${encodeURIComponent(zones[zone].name)}/${path}`, {
      method,
      // Bunny picks the served Content-Type from the file extension.
      headers: { AccessKey: zones[zone].key, ...(body ? { "Content-Type": "application/octet-stream" } : {}) },
      body: body as BodyInit | undefined, // a Buffer is a valid body; TS types it as possibly shared memory
      // Never follow a redirect: it could carry the AccessKey to another host.
      redirect: "error",
      cache: "no-store",
      signal: timeout(body),
    })

  return {
    async put(zone, path, body) {
      await expectOk(await call(zone, path, "PUT", body), "Bunny upload")
    },
    async get(zone, path) {
      const res = await call(zone, path, "GET")
      if (res.status === 404) return null
      await expectOk(res, "Bunny download")
      return storedFile(res)
    },
    async remove(zone, path) {
      const res = await call(zone, path, "DELETE")
      if (res.status !== 404) await expectOk(res, "Bunny delete")
    },
    publicUrl: (path) => `https://${config.publicHost}/${path}`,
  }
}
