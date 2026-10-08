import { describe, expect, it } from "vitest"

import { logoSchema, logoSize } from "@/lib/logo"
import { LogoSvgError, parseLogoSvg } from "./logo-svg"

const codeOf = (svg: string) => {
  try {
    parseLogoSvg(svg)
  } catch (err) {
    return err instanceof LogoSvgError ? err.code : "other"
  }
  return null
}

describe("parseLogoSvg", () => {
  it("reads a traced logo: one path, its fill rule from the root", () => {
    const logo = parseLogoSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" viewBox="6 10 4468 1478"><path d="m6 19l0 9 14 0z"/></svg>`,
    )
    expect(logo).toEqual({ viewBox: "6 10 4468 1478", paths: [{ d: "m6 19l0 9 14 0z", evenodd: true }] })
  })

  it("reads an Illustrator file: class styles, white background left out, shapes as paths", () => {
    const logo = parseLogoSvg(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- Generator: Adobe Illustrator -->
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" viewBox="0 0 200 100">
  <defs><style>.cls-1{fill:#231f20;}.cls-2{fill:#fff;}</style></defs>
  <rect class="cls-2" width="200" height="100"/>
  <path class="cls-1" d="M 10 10 L 20.123456 20 Z"/>
  <polygon class="cls-1" points="1,2 3,4 5,6"/>
  <circle class="cls-1" cx="50" cy="50" r="5"/>
</svg>`)
    expect(logo.viewBox).toBe("0 0 200 100")
    expect(logo.paths).toEqual([
      { d: "M10 10L20.12 20Z" },
      { d: "M1 2L3 4L5 6Z" },
      { d: "M45 50A5 5 0 1 0 55 50A5 5 0 1 0 45 50Z" },
    ])
  })

  it("reads a Figma file: fill on each path, evenodd per path, clip paths left out", () => {
    const logo = parseLogoSvg(`<svg width="120" height="40" viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_1_2)">
<path d="M0 0H10V10Z" fill="#5B311E"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M20 0H30V10H20Z" fill="black"/>
</g>
<defs><clipPath id="clip0_1_2"><rect width="120" height="40" fill="white"/></clipPath></defs>
</svg>`)
    expect(logo.paths).toEqual([{ d: "M0 0H10V10Z" }, { d: "M20 0H30V10H20Z", evenodd: true }])
  })

  it("keeps transforms, the groups' first", () => {
    const logo = parseLogoSvg(
      `<svg viewBox="0 0 10 10"><g transform="translate(2 3)"><path transform="scale(2)" d="M0 0h1v1z"/></g><path d="M1 1h1v1z"/></svg>`,
    )
    expect(logo.paths).toEqual([{ d: "M0 0h1v1z", transform: "translate(2 3) scale(2)" }, { d: "M1 1h1v1z" }])
  })

  it("leaves out hidden shapes and a design app's own elements", () => {
    const logo = parseLogoSvg(`<svg width="10px" height="10px" xmlns:sodipodi="x">
<sodipodi:namedview><path d="M9 9h1v1z"/></sodipodi:namedview>
<path style="display:none" d="M5 5h1v1z"/>
<g opacity="0"><path d="M6 6h1v1z"/></g>
<path d="M1 1h1v1z"/>
</svg>`)
    expect(logo).toEqual({ viewBox: "0 0 10 10", paths: [{ d: "M1 1h1v1z" }] })
  })

  it("keeps the shapes of a logo all in white", () => {
    expect(parseLogoSvg(`<svg viewBox="0 0 10 10"><path fill="#FFFFFF" d="M1 1h1v1z"/></svg>`).paths).toHaveLength(1)
  })

  it("has no viewBox when the file has no size", () => {
    expect(parseLogoSvg(`<svg width="100%"><path d="M1 1h1v1z"/></svg>`).viewBox).toBeNull()
  })

  it("refuses what it cannot draw", () => {
    expect(codeOf(`<svg viewBox="0 0 10 10"><text>Limer</text></svg>`)).toBe("text")
    expect(codeOf(`<svg viewBox="0 0 10 10"><image href="logo.png"/></svg>`)).toBe("image")
    expect(codeOf(`<svg viewBox="0 0 10 10"><use href="#a"/></svg>`)).toBe("use")
    expect(codeOf(`<svg viewBox="0 0 10 10"><path d="M0 0L9 9" fill="none" stroke="#000"/></svg>`)).toBe("stroke")
    expect(codeOf(`<svg viewBox="0 0 10 10"><path d="M0 0L9 9" fill="none"/></svg>`)).toBe("empty")
    expect(codeOf(`<html><body>no</body></html>`)).toBe("notSvg")
    expect(codeOf(`\x89PNG\r\n`)).toBe("notSvg")
    expect(codeOf(`<svg viewBox="0 0 10 10"><path d="M0 0 url(javascript:x)"/></svg>`)).toBe("invalid")
    expect(codeOf(`<svg viewBox="0 0 10 10"><path transform="url(#x)" d="M0 0h1v1z"/></svg>`)).toBe("invalid")
    expect(codeOf(`<svg viewBox="0 0 10 10">${'<path d="M0 0h1v1z"/>'.repeat(601)}</svg>`)).toBe("tooComplex")
  })

  it("gives data the setting accepts", () => {
    const { viewBox, paths } = parseLogoSvg(`<svg viewBox="0 0 200 100"><path fill-rule="evenodd" d="M0 0h1v1z"/></svg>`)
    const logo = logoSchema.parse({ viewBox, paths })
    expect(logoSize(logo)).toEqual({ width: 200, height: 100 })
  })
})

describe("logoSchema", () => {
  const ok = { viewBox: "0 0 10 10", paths: [{ d: "M0 0h1v1z" }] }
  it("accepts path data and transforms only", () => {
    expect(logoSchema.safeParse(ok).success).toBe(true)
    expect(logoSchema.safeParse({ ...ok, viewBox: "0 0 0 10" }).success).toBe(false)
    expect(logoSchema.safeParse({ ...ok, viewBox: "0 0 10" }).success).toBe(false)
    expect(logoSchema.safeParse({ ...ok, paths: [] }).success).toBe(false)
    expect(logoSchema.safeParse({ ...ok, paths: [{ d: 'M0 0"/><script>' }] }).success).toBe(false)
    expect(logoSchema.safeParse({ ...ok, paths: [{ d: "M0 0", transform: "translate(1,2)" }] }).success).toBe(true)
    expect(logoSchema.safeParse({ ...ok, paths: [{ d: "M0 0", transform: "url(#a)" }] }).success).toBe(false)
  })
})
