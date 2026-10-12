import { describe, expect, it } from "vitest"

import { cleanPath, deviceOf, isRobot, referrerHost } from "./shared"

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"

describe("visit statistics rules", () => {
  it("leaves out robots, link previews and scripts", () => {
    expect(isRobot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true)
    expect(isRobot("facebookexternalhit/1.1")).toBe(true)
    expect(isRobot("WhatsApp/2.24")).toBe(true)
    expect(isRobot("curl/8.7.1")).toBe(true)
    expect(isRobot(null)).toBe(true)
    expect(isRobot(IPHONE)).toBe(false)
  })

  it("tells phones, tablets and computers apart", () => {
    expect(deviceOf(IPHONE)).toBe("mobile")
    expect(deviceOf(IPAD)).toBe("tablet")
    expect(deviceOf(ANDROID_TABLET)).toBe("tablet")
    expect(deviceOf(MAC)).toBe("desktop")
  })

  it("keeps only the host of another site, with the big apps under one name", () => {
    expect(referrerHost("https://www.google.com.tr/", "limer.tr")).toBe("google.com")
    expect(referrerHost("https://l.instagram.com/?u=x", "limer.tr")).toBe("instagram.com")
    expect(referrerHost("https://lm.facebook.com/l.php", "limer.tr")).toBe("facebook.com")
    expect(referrerHost("https://t.co/abc", "limer.tr")).toBe("x.com")
    expect(referrerHost("https://www.limer.tr/fa", "limer.tr")).toBeNull()
    expect(referrerHost("android-app://com.google.android.gm", "limer.tr")).toBeNull()
    expect(referrerHost("not a url", "limer.tr")).toBeNull()
    expect(referrerHost(undefined, "limer.tr")).toBeNull()
  })

  it("keeps a clean page address", () => {
    expect(cleanPath("/workshops/candl?utm=x#top")).toBe("/workshops/candl")
    expect(cleanPath("/workshops/")).toBe("/workshops")
    expect(cleanPath("/")).toBe("/")
    expect(cleanPath("//evil.com")).toBeNull()
    expect(cleanPath("workshops")).toBeNull()
    expect(cleanPath(`/${"a".repeat(250)}`)).toBeNull()
    expect(cleanPath("/<script>")).toBeNull()
  })
})
