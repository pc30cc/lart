/**
 * Reads an uploaded SVG logo into the site's logo data (lib/logo.ts): its
 * filled shapes as path data, with their fill rule and transforms. Runs in
 * the browser (Settings → Appearance), which then crops the logo to its ink
 * (`getBBox`); the server only accepts the result through `logoSchema`, so
 * nothing of the file but numbers and path commands is ever stored or drawn.
 *
 * One colour: every filled shape is drawn in the text colour. White shapes
 * are left out (a background) unless the whole logo is white; lines drawn
 * with a stroke, text, embedded pictures and `<use>` are refused with what to
 * do instead (outline them in the design app).
 */
import { LOGO_DATA_MAX, LOGO_SHAPES_MAX, type LogoData } from "@/lib/logo"

/** The largest file read (characters). */
export const LOGO_FILE_MAX = 2_000_000

export const logoSvgErrorCodes = ["tooBig", "notSvg", "text", "image", "use", "stroke", "empty", "tooComplex", "invalid"] as const
export type LogoSvgErrorCode = (typeof logoSvgErrorCodes)[number]

export class LogoSvgError extends Error {
  constructor(readonly code: LogoSvgErrorCode) {
    super(`logo svg: ${code}`)
    this.name = "LogoSvgError"
  }
}

/** The logo before it is cropped to its ink: `viewBox` is the file's own (null when it has no size). */
export type ParsedLogo = { viewBox: string | null; paths: LogoData["paths"] }

type Props = {
  fill: string | null
  fillRule: string | null
  fillOpacity: string | null
  stroke: string | null
  strokeWidth: string | null
  visibility: string | null
}
type Frame = { name: string; ignore: boolean; props: Props; transform: string }

/** Elements that would be missing from the logo: refused with what to do instead. */
const REFUSED: Record<string, LogoSvgErrorCode> = {
  text: "text",
  tspan: "text",
  textpath: "text",
  image: "image",
  use: "use",
  svg: "invalid",
}
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"])
/** `switch`: Illustrator puts the artwork in one, next to its own data. */
const GROUPS = new Set(["g", "a", "switch"])

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/gi
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz\d.,\s+eE-]*$/
const TRANSFORM = /^[\s,]*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-+\d.eE,\s]*\)[\s,]*)+$/

const decode = (value: string) =>
  value
    .replace(/&#x([\da-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

function attributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const m of source.matchAll(ATTR)) attrs.set(m[1].toLowerCase(), decode(m[2] ?? m[3] ?? ""))
  return attrs
}

/** "fill:#fff; fill-rule:evenodd" → { fill: "#fff", "fill-rule": "evenodd" } */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of css.split(";")) {
    const i = part.indexOf(":")
    if (i > 0) out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).replace(/!important/i, "").trim())
  }
  return out
}

/** The rules of `<style>` sheets for single classes (".cls-1, .cls-2 { fill: #fff }"), as design apps write them. */
function classRules(css: string, into: Map<string, Map<string, string>>) {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = declarations(m[2])
    for (const selector of m[1].split(",")) {
      const cls = /^\s*\.([\w-]+)\s*$/.exec(selector)?.[1]
      if (!cls) continue
      const rule = into.get(cls) ?? new Map<string, string>()
      for (const [k, v] of decls) rule.set(k, v)
      into.set(cls, rule)
    }
  }
}

const num = (value: string | undefined) => {
  const n = value === undefined ? NaN : parseFloat(value)
  return Number.isFinite(n) ? n : NaN
}
const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

const isNone = (v: string | null) => v !== null && v.trim().toLowerCase() === "none"
const isWhite = (v: string | null) => {
  const c = (v ?? "").replace(/\s+/g, "").toLowerCase()
  return ["#fff", "#ffffff", "#ffff", "#ffffffff", "white", "rgb(255,255,255)", "rgba(255,255,255,1)"].includes(c)
}

function shapePath(name: string, a: Map<string, string>): string | null {
  const n = (key: string) => num(a.get(key))
  switch (name) {
    case "path":
      return a.get("d") ?? null
    case "rect": {
      const x = n("x") || 0
      const y = n("y") || 0
      const w = n("width")
      const h = n("height")
      if (!(w > 0 && h > 0)) return null
      let rx = n("rx")
      let ry = n("ry")
      if (!(rx > 0)) rx = ry > 0 ? ry : 0
      if (!(ry > 0)) ry = rx
      rx = Math.min(rx, w / 2)
      ry = Math.min(ry, h / 2)
      if (!rx || !ry) return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`
      const arc = (ex: number, ey: number) => `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(ex)} ${fmt(ey)}`
      return (
        `M${fmt(x + rx)} ${fmt(y)}H${fmt(x + w - rx)}${arc(x + w, y + ry)}V${fmt(y + h - ry)}${arc(x + w - rx, y + h)}` +
        `H${fmt(x + rx)}${arc(x, y + h - ry)}V${fmt(y + ry)}${arc(x + rx, y)}Z`
      )
    }
    case "circle":
    case "ellipse": {
      const cx = n("cx") || 0
      const cy = n("cy") || 0
      const rx = name === "circle" ? n("r") : n("rx")
      const ry = name === "circle" ? n("r") : n("ry")
      if (!(rx > 0 && ry > 0)) return null
      const r = `${fmt(rx)} ${fmt(ry)}`
      return `M${fmt(cx - rx)} ${fmt(cy)}A${r} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}A${r} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`
    }
    case "polygon":
    case "polyline": {
      const points = (a.get("points") ?? "").trim().split(/[\s,]+/).map(Number)
      if (points.length < 4 || points.some((p) => !Number.isFinite(p))) return null
      const pairs: string[] = []
      for (let i = 0; i + 1 < points.length; i += 2) pairs.push(`${fmt(points[i])} ${fmt(points[i + 1])}`)
      return `M${pairs.join("L")}${name === "polygon" ? "Z" : ""}`
    }
    default:
      return null // line: no area to fill
  }
}

/** Path data with no needless spaces, numbers rounded to `decimals` (not when it has arcs: their flags may run into numbers). */
function compact(d: string, decimals: number | null): string {
  let out = d.replace(/\s+/g, " ").replace(/\s*([MmLlHhVvCcSsQqTtAaZz])\s*/g, "$1").replace(/\s*,\s*/g, ",").trim()
  if (decimals !== null && !/[Aa]/.test(out)) {
    out = out.replace(/-?\d*\.\d+(?![\deE])/g, (n) => String(Number(Number(n).toFixed(decimals))))
  }
  return out
}

/** The SVG's own coordinates box: its viewBox, else its width and height in px (null when it has neither). */
function ownViewBox(a: Map<string, string>): string | null {
  const vb = (a.get("viewbox") ?? "").trim().split(/[\s,]+/).map(Number)
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return vb.map(fmt).join(" ")
  const size = (key: string) => {
    const v = (a.get(key) ?? "").trim()
    return /^[\d.]+(px)?$/i.test(v) ? num(v) : NaN
  }
  const w = size("width")
  const h = size("height")
  return w > 0 && h > 0 ? `0 0 ${fmt(w)} ${fmt(h)}` : null
}

export function parseLogoSvg(source: string): ParsedLogo {
  if (source.length > LOGO_FILE_MAX) throw new LogoSvgError("tooBig")

  // First pass: the class rules of every <style> sheet (they may come after the shapes).
  const classes = new Map<string, Map<string, string>>()
  for (const m of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    classRules(m[1].replace(/<!\[CDATA\[|\]\]>/g, ""), classes)
  }

  const stack: Frame[] = []
  let root: Map<string, string> | null = null
  let viewBox: string | null = null
  const shapes: { d: string; evenodd: boolean; transform: string; white: boolean }[] = []
  let strokeOnly = false

  const rootProps: Props = { fill: null, fillRule: null, fillOpacity: null, stroke: null, strokeWidth: null, visibility: null }

  for (const m of source.matchAll(TOKEN)) {
    const [, , closing, opening, attrSource, selfClosing] = m
    if (closing) {
      const name = closing.toLowerCase()
      const at = stack.findLastIndex((f) => f.name === name)
      if (at >= 0) stack.length = at
      continue
    }
    if (!opening) continue

    const raw = opening.toLowerCase()
    const prefix = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : null
    const name = prefix === "svg" ? raw.slice(4) : raw
    const attrs = attributes(attrSource ?? "")
    const parent = stack.at(-1)

    if (!root) {
      if (name !== "svg") throw new LogoSvgError("notSvg")
      root = attrs
      viewBox = ownViewBox(attrs)
    } else if (!parent?.ignore && !prefix) {
      if (REFUSED[name]) throw new LogoSvgError(REFUSED[name])
    }

    // Presentation attributes, then class rules, then the style attribute (CSS order).
    const own = new Map<string, string>()
    for (const key of ["fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "visibility", "display", "opacity"]) {
      const v = attrs.get(key)
      if (v !== undefined) own.set(key, v)
    }
    for (const cls of (attrs.get("class") ?? "").split(/\s+/)) {
      for (const [k, v] of classes.get(cls) ?? []) own.set(k, v)
    }
    for (const [k, v] of declarations(attrs.get("style") ?? "")) own.set(k, v)

    const inherited = parent?.props ?? rootProps
    const pick = (key: string, from: string | null) => {
      const v = own.get(key)
      return v === undefined || v.trim().toLowerCase() === "inherit" ? from : v.trim()
    }
    const props: Props = {
      fill: pick("fill", inherited.fill),
      fillRule: pick("fill-rule", inherited.fillRule),
      fillOpacity: pick("fill-opacity", inherited.fillOpacity),
      stroke: pick("stroke", inherited.stroke),
      strokeWidth: pick("stroke-width", inherited.strokeWidth),
      visibility: pick("visibility", inherited.visibility),
    }
    const hidden =
      isNone(own.get("display") ?? null) || Number(own.get("opacity") ?? "1") === 0 || props.visibility === "hidden"

    const transform = (attrs.get("transform") ?? "").trim()
    if (transform && !TRANSFORM.test(transform)) throw new LogoSvgError("invalid")
    const transforms = [parent?.transform ?? "", root === attrs ? "" : transform].filter(Boolean).join(" ")

    // Anything else (definitions, styles, metadata, a design app's own elements) is left out with its content.
    const skip =
      Boolean(parent?.ignore) || hidden || Boolean(prefix) || (root !== attrs && !GROUPS.has(name) && !SHAPES.has(name))

    if (!skip && SHAPES.has(name)) {
      const filled = !isNone(props.fill) && Number(props.fillOpacity ?? "1") !== 0
      const stroked = !isNone(props.stroke) && props.stroke !== null && Number.parseFloat(props.strokeWidth ?? "1") !== 0
      if (!filled) {
        if (stroked) strokeOnly = true
      } else {
        const d = shapePath(name, attrs)
        if (d !== null) {
          if (!PATH_DATA.test(d)) throw new LogoSvgError("invalid")
          if (/\d/.test(d)) {
            shapes.push({ d, evenodd: props.fillRule === "evenodd", transform: transforms, white: isWhite(props.fill) })
          }
        }
      }
    }

    if (!selfClosing) stack.push({ name, ignore: skip, props, transform: transforms })
  }

  if (!root) throw new LogoSvgError("notSvg")
  if (strokeOnly) throw new LogoSvgError("stroke")
  // White shapes on a coloured logo are its background; a logo all in white keeps them.
  const coloured = shapes.filter((s) => !s.white)
  const kept = coloured.length > 0 ? coloured : shapes
  if (kept.length === 0) throw new LogoSvgError("empty")
  if (kept.length > LOGO_SHAPES_MAX) throw new LogoSvgError("tooComplex")

  const size = viewBox ? Math.max(...viewBox.split(" ").slice(2).map(Number)) : null
  const decimals = size ? Math.min(6, Math.max(1, 4 - Math.floor(Math.log10(size)))) : null
  const paths = kept.map((s) => ({
    d: compact(s.d, decimals),
    ...(s.evenodd ? { evenodd: true as const } : {}),
    ...(s.transform ? { transform: s.transform } : {}),
  }))
  if (paths.reduce((sum, p) => sum + p.d.length, 0) > LOGO_DATA_MAX) throw new LogoSvgError("tooComplex")
  return { viewBox, paths }
}
