import { describe, expect, it } from "vitest"

import { logoSchema, logoSize } from "@/lib/logo"
import { LOGO_FILE_MAX, LogoSvgError, normalizePath, paintOf, parseLogoSvg, transformMatrix } from "./logo-svg"

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

  it("keeps transforms, a group's and the shape's multiplied into one", () => {
    const logo = parseLogoSvg(
      `<svg viewBox="0 0 10 10"><g transform="translate(2 3)"><path transform="scale(2)" d="M0 0h1v1z"/><path transform="translate(1,1)" d="M0 0h1v1z"/></g><g transform="scale(1)"><path d="M1 1h1v1z"/></g></svg>`,
    )
    expect(logo.paths).toEqual([
      { d: "M0 0h1v1z", transform: "matrix(2 0 0 2 2 3)" },
      { d: "M0 0h1v1z", transform: "translate(3 4)" },
      { d: "M1 1h1v1z" },
    ])
  })

  it("keeps a deep nest of design-app matrices short enough for the setting", () => {
    const m = "matrix(0.9876543,0.0123457,-0.0123457,0.9876543,12.345678,-23.456789)"
    const svg = `<svg viewBox="0 0 100 100">${`<g transform="${m}">`.repeat(12)}<path d="M1 1h1v1z"/>${"</g>".repeat(12)}</svg>`
    const { viewBox, paths } = parseLogoSvg(svg)
    expect(paths[0].transform).toMatch(/^matrix\(/)
    expect(logoSchema.safeParse({ viewBox, paths }).success).toBe(true)
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

describe("parseLogoSvg: strokes, classes and hostile files", () => {
  it("refuses a stroke that is what shows: around a white shape, on a line", () => {
    expect(codeOf(`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#fff" stroke="#5B311E" stroke-width="1"/><path d="M4 4h2v2z"/></svg>`)).toBe("stroke")
    expect(codeOf(`<svg viewBox="0 0 10 10"><style>.a{stroke:#000}</style><line class="a" x1="0" y1="0" x2="9" y2="9"/><path d="M4 4h2v2z"/></svg>`)).toBe("stroke")
    expect(codeOf(`<svg viewBox="0 0 10 10"><path d="M0 0L9 9" fill="none" stroke="#000" stroke-opacity="0"/><path d="M4 4h2v2z"/></svg>`)).toBeNull()
  })

  it("keeps a filled shape whose stroke only thickens it", () => {
    const logo = parseLogoSvg(`<svg viewBox="0 0 10 10"><path d="M4 4h2v2z" fill="#5B311E" stroke="#5B311E" stroke-width="0.2"/></svg>`)
    expect(logo.paths).toEqual([{ d: "M4 4h2v2z" }])
  })

  it("applies class rules in the sheet's order, not the attribute's", () => {
    // .cls-1 comes later in the sheet, so it wins although the element names it first.
    const logo = parseLogoSvg(
      `<svg viewBox="0 0 10 10"><style>.cls-2{fill:#fff}.cls-1{fill:#5b311e}</style><path class="cls-1 cls-2" d="M1 1h1v1z"/><rect class="cls-2" width="10" height="10"/></svg>`,
    )
    expect(logo.paths).toEqual([{ d: "M1 1h1v1z" }])
  })

  it("reads styles in CDATA, with comments, and after the shapes", () => {
    const logo = parseLogoSvg(
      `<svg viewBox="0 0 10 10"><path class="bg" d="M0 0h10v10z"/><path class="ink" d="M1 1h1v1z"/><style><![CDATA[/* a { */ .bg{fill:#FFF} .ink{fill:#000}]]></style></svg>`,
    )
    expect(logo.paths).toEqual([{ d: "M1 1h1v1z" }])
  })

  it("reads a DOCTYPE with an internal subset, and prefixed svg: elements", () => {
    const logo = parseLogoSvg(`<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [ <!ENTITY ns_x "http://x/"> <!ENTITY a "b"> ]>
<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><svg:g><svg:path d="M1 1h1v1z"/></svg:g></svg:svg>`)
    expect(logo.paths).toEqual([{ d: "M1 1h1v1z" }])
  })

  it("reads hostile or broken files in linear time", () => {
    const big = (unit: string) => unit.repeat(Math.floor((LOGO_FILE_MAX - 100) / unit.length))
    for (const body of [
      `<!DOCTYPE${" ".repeat(LOGO_FILE_MAX - 100)}`,
      big("<a b "),
      big("<!--"),
      big("<!"),
      big("<!x[<"),
      `<style>${big("/*")}`,
      `<style>${big(".a{")}`,
      `<path d="M0 0${big(" 1")}"/>`,
      // Many class rules and many elements with a class (each element must not walk the whole sheet).
      `<style>${".a{fill:#000}".repeat(40_000)}</style>${'<g class="a b">'.repeat(30_000)}`,
      // Many open groups, then closing tags that match none of them.
      `${"<g>".repeat(60_000)}${"</x>".repeat(60_000)}`,
    ]) {
      const started = performance.now()
      try {
        parseLogoSvg(`<svg viewBox="0 0 10 10">${body}`)
      } catch {
        // refused or empty: only the time matters here
      }
      expect(performance.now() - started, body.slice(0, 12)).toBeLessThan(1500)
    }
  })
})

describe("parseLogoSvg: files as design apps export them", () => {
  it("refuses a clipping mask or a mask, but not a frame as large as the file", () => {
    // Illustrator: a gradient painted through a clip path that is the real shape.
    expect(
      codeOf(`<svg viewBox="0 0 80 80"><defs><clipPath id="c"><circle cx="40" cy="40" r="30"/></clipPath><linearGradient id="g"/></defs>
<rect x="10" y="10" width="60" height="60" style="clip-path:url(#c);fill:url(#g)"/></svg>`),
    ).toBe("clip")
    // Illustrator's clipping mask through a class rule.
    expect(
      codeOf(`<svg viewBox="0 0 200 80"><style>.st0{clip-path:url(#SVGID_2_)}</style><clipPath id="SVGID_2_"><use xlink:href="#SVGID_1_"/></clipPath><g class="st0"><path d="M0 12H200V22H0Z"/></g></svg>`),
    ).toBe("clip")
    // Figma: "Use as mask".
    expect(codeOf(`<svg viewBox="0 0 200 80"><mask id="m"><circle cx="100" cy="40" r="30" fill="#fff"/></mask><g mask="url(#m)"><path d="M-20 30H220V50H-20Z"/></g></svg>`)).toBe("clip")
    // Figma's frame, even moved into place.
    const frame = parseLogoSvg(
      `<svg width="120" height="40" viewBox="0 0 120 40" fill="none"><g clip-path="url(#f)"><path d="M0 0H10V10Z" fill="#5B311E"/></g><defs><clipPath id="f"><rect width="120" height="40" fill="white" transform="translate(0 0)"/></clipPath></defs></svg>`,
    )
    expect(frame.paths).toEqual([{ d: "M0 0H10V10Z" }])
  })

  it("refuses a picture painted as a pattern (Figma's image fill)", () => {
    expect(
      codeOf(`<svg width="200" height="80" viewBox="0 0 200 80"><rect width="200" height="80" fill="url(#pattern0)"/>
<defs><pattern id="pattern0" patternContentUnits="objectBoundingBox" width="1" height="1"><use xlink:href="#image0" transform="scale(0.005)"/></pattern>
<image id="image0" width="200" height="80" xlink:href="data:image/png;base64,iVBORw0KGgo="/></defs></svg>`),
    ).toBe("image")
  })

  it("reads Illustrator's entity-reference styles", () => {
    const logo = parseLogoSvg(`<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
  <!ENTITY st0 "fill:#FFFFFF;">
  <!ENTITY st1 "fill-rule:evenodd;clip-rule:evenodd;fill:#5B311E;">
  <!ENTITY note "a ] and a > in a value">
]>
<svg viewBox="0 0 200 80"><rect style="&st0;" width="200" height="80"/><path style="&st1;" d="M10 10h20v20h-20z"/></svg>`)
    expect(logo.paths).toEqual([{ d: "M10 10h20v20h-20z", evenodd: true }])
  })

  it("does not let entities grow the file without end", () => {
    const refs = "&big;".repeat(4000)
    expect(codeOf(`<!DOCTYPE svg [<!ENTITY big "${"x".repeat(1000)}">]><svg viewBox="0 0 10 10"><path d="M0 0h1v1z" class="${refs}"/></svg>`)).toBe("tooBig")
  })

  it("knows white and transparent in every spelling", () => {
    for (const background of ["rgb(100%, 100%, 100%)", "rgb(255 255 255)", "hsl(0 0% 100%)", "#FFFFFFFF", "transparent", "rgba(255,255,255,0)", "#ffffff00", "rgb(10 20 30 / 0)"]) {
      const logo = parseLogoSvg(`<svg viewBox="0 0 200 80"><rect x="-15" y="-6" width="230" height="92" fill="${background}"/><path d="M10 10h20v20h-20z" fill="#5B311E"/></svg>`)
      expect(logo.paths, background).toEqual([{ d: "M10 10h20v20h-20z" }])
    }
  })

  it("leaves out a lone point (a stray anchor)", () => {
    const logo = parseLogoSvg(`<svg viewBox="0 0 200 80"><path d="M196,3"/><path d="M10 10h20v20h-20z"/></svg>`)
    expect(logo.paths).toEqual([{ d: "M10 10h20v20h-20z" }])
  })
})

describe("paintOf", () => {
  it("tells nothing, white and ink apart", () => {
    expect(paintOf("none")).toBe("none")
    expect(paintOf("#fff")).toBe("white")
    expect(paintOf("#FFF8")).toBe("white")
    expect(paintOf("#fff0")).toBe("none")
    expect(paintOf("rgba(255, 255, 255, 0%)")).toBe("none")
    expect(paintOf("hsla(120, 50%, 100%, 1)")).toBe("white")
    expect(paintOf("#5B311E")).toBe("ink")
    expect(paintOf("url(#gradient)")).toBe("ink")
    expect(paintOf("currentColor")).toBe("ink")
    expect(paintOf("#ffff")).toBe("white")
  })
})

describe("transformMatrix", () => {
  const close = (a: number[], b: number[]) => a.every((n, i) => Math.abs(n - b[i]) < 1e-9)
  it("reads the six functions and composes them left to right", () => {
    expect(transformMatrix("translate(10)")).toEqual([1, 0, 0, 1, 10, 0])
    expect(transformMatrix("scale(2, 3)")).toEqual([2, 0, 0, 3, 0, 0])
    expect(close(transformMatrix("rotate(90 5 5)"), [0, 1, -1, 0, 10, 0])).toBe(true)
    expect(close(transformMatrix("translate(1 2) scale(2)"), [2, 0, 0, 2, 1, 2])).toBe(true)
    expect(close(transformMatrix("skewX(45)"), [1, 0, 1, 1, 0, 0])).toBe(true)
  })

  it("refuses a function with the wrong number of values", () => {
    for (const bad of ["rotate(1 2)", "matrix(1 2 3)", "scale()", "translate(1 2 3)", "url(#a)", "scale(x)"]) {
      expect(() => transformMatrix(bad), bad).toThrow(LogoSvgError)
    }
  })
})

describe("normalizePath", () => {
  it("never joins two numbers when rounding (compressed path data)", () => {
    expect(normalizePath("M0 0h50.002.5", 2)).toBe("M0 0h50 0.5")
    expect(normalizePath("M0 0l3.996.25 20 20", 2)).toBe("M0 0l4 0.25 20 20")
    expect(normalizePath("M0 0l1-0.001 2 3", 2)).toBe("M0 0l1 0 2 3")
    expect(normalizePath("M0,0 L 1e2,-2.5E-1", null)).toBe("M0 0L100-0.25")
  })

  it("reads an arc's flags as single digits", () => {
    expect(normalizePath("M0 0a1 1 0 01.5.5", 2)).toBe("M0 0a1 1 0 0 1 0.5 0.5")
    expect(normalizePath("M0 0A5 5 0 1 0 55 50", 2)).toBe("M0 0A5 5 0 1 0 55 50")
  })

  it("keeps implicit repeats and closes", () => {
    expect(normalizePath("m6 19l0 9 14 0c11 0 16 0 24 2zm1 1h1v1z", 1)).toBe("m6 19l0 9 14 0c11 0 16 0 24 2zm1 1h1v1z")
  })

  it("refuses path data a browser would stop drawing at", () => {
    for (const bad of ["L0 0", "M0", "M0 0L1", "M0 0z 1 1", "M0 0a1 1 0 2 1 3 3", "M0 0X1 1", "M0 0L1 x"]) {
      expect(() => normalizePath(bad, 2), bad).toThrow(LogoSvgError)
    }
  })
})

describe("logoSchema", () => {
  const ok = { viewBox: "0 0 10 10", paths: [{ d: "M0 0h1v1z" }] }
  it("accepts path data and transforms only", () => {
    expect(logoSchema.safeParse(ok).success).toBe(true)
    expect(logoSchema.safeParse({ ...ok, viewBox: "0 0 0 10" }).success).toBe(false)
    expect(logoSchema.safeParse({ ...ok, viewBox: "0 0 10" }).success).toBe(false)
    expect(logoSchema.safeParse({ ...ok, viewBox: "0 0 1000. 500." }).success).toBe(false)
    expect(logoSchema.safeParse({ ...ok, viewBox: "-0.5 .5 1e3 5E2" }).success).toBe(true)
    expect(logoSchema.safeParse({ ...ok, paths: [] }).success).toBe(false)
    expect(logoSchema.safeParse({ ...ok, paths: [{ d: 'M0 0"/><script>' }] }).success).toBe(false)
    expect(logoSchema.safeParse({ ...ok, paths: [{ d: "M0 0", transform: "translate(1,2)" }] }).success).toBe(true)
    expect(logoSchema.safeParse({ ...ok, paths: [{ d: "M0 0", transform: "url(#a)" }] }).success).toBe(false)
  })
})
