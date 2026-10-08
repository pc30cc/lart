/**
 * Reads an uploaded SVG logo into the site's logo data (lib/logo.ts): its
 * filled shapes as path data, with their fill rule and transform (a group's
 * transforms multiplied into one matrix). Runs in
 * the browser (Settings → Appearance), which then crops the logo to its ink
 * (`getBBox`); the server only accepts the result through `logoSchema`, so
 * nothing of the file but numbers and path commands is ever stored or drawn.
 *
 * One colour: every filled shape is drawn in the text colour. White shapes
 * are left out (a background) unless the whole logo is white. Lines drawn
 * with a stroke (a shape with no fill, a `<line>`, a coloured outline around
 * a white shape), text, embedded pictures and `<use>` are refused with what
 * to do instead (outline them in the design app); the stroke of a shape that
 * is drawn by its own fill anyway is left out.
 *
 * Everything here runs in time linear in the file's size, whatever it holds
 * (no regular expression that can backtrack over the whole file).
 */
import { LOGO_DATA_MAX, LOGO_SHAPES_MAX, type LogoData } from "@/lib/logo"

/** The largest file read (characters). */
export const LOGO_FILE_MAX = 1_000_000

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
  strokeOpacity: string | null
  visibility: string | null
}
/** An affine transform [a b c d e f], as SVG's matrix(a b c d e f). */
type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
type Frame = { name: string; ignore: boolean; props: Props; matrix: Matrix }

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
/** The properties read from attributes, class rules and `style`. */
const PROPERTIES = ["fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "visibility", "display", "opacity"]

const ATTR = /([^\s=/<>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz\d.,\s+eE-]*$/
const TRANSFORM = /^[\s,]*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-+\d.eE,\s]*\)[\s,]*)+$/

type Token =
  | { kind: "open"; name: string; attrs: string; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string }

/**
 * The file's tags and text, in order: comments, processing instructions and
 * declarations (a DOCTYPE with its internal subset) left out, CDATA as text.
 * A tag ends at the first ">" outside quotes. Stops at anything left open at
 * the end of the file.
 */
function* tokens(source: string): Generator<Token> {
  const end = source.length
  let i = 0
  while (i < end) {
    const lt = source.indexOf("<", i)
    if (lt < 0) {
      yield { kind: "text", text: source.slice(i) }
      return
    }
    if (lt > i) yield { kind: "text", text: source.slice(i, lt) }
    i = lt
    const skipTo = (marker: string, from: number) => {
      const at = source.indexOf(marker, from)
      return at < 0 ? -1 : at + marker.length
    }
    if (source.startsWith("<!--", i)) {
      i = skipTo("-->", i + 4)
    } else if (source.startsWith("<![CDATA[", i)) {
      const close = source.indexOf("]]>", i + 9)
      if (close < 0) return
      yield { kind: "text", text: source.slice(i + 9, close) }
      i = close + 3
    } else if (source.startsWith("<?", i)) {
      i = skipTo("?>", i + 2)
    } else if (source.startsWith("<!", i)) {
      // A declaration (DOCTYPE), its internal subset in [ ] (which may hold ">").
      const close = source.indexOf(">", i)
      if (close < 0) return
      const subset = source.slice(i, close).indexOf("[")
      if (subset < 0) i = close + 1
      else {
        const subsetEnd = source.indexOf("]", i + subset)
        i = subsetEnd < 0 ? -1 : skipTo(">", subsetEnd)
      }
    } else {
      let j = i + 1
      let quote = ""
      for (; j < end; j++) {
        const c = source[j]
        if (quote) {
          if (c === quote) quote = ""
        } else if (c === '"' || c === "'") quote = c
        else if (c === ">") break
      }
      if (j >= end) return
      const body = source.slice(i + 1, j)
      i = j + 1
      if (body.startsWith("/")) {
        yield { kind: "close", name: body.slice(1).trim().toLowerCase() }
        continue
      }
      const name = /^[\w:.-]+/.exec(body)?.[0]
      if (!name) continue // a "<" that starts no tag
      const selfClosing = body.endsWith("/")
      yield { kind: "open", name: name.toLowerCase(), attrs: body.slice(name.length, selfClosing ? -1 : undefined), selfClosing }
    }
    if (i < 0) return
  }
}

const decode = (value: string) =>
  value
    .replace(/&#x([\da-f]{1,6});/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => safeChar(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
const safeChar = (code: number) => (code <= 0x10ffff ? String.fromCodePoint(code) : "")

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

/** CSS without its comments. */
function uncomment(css: string): string {
  let out = ""
  let i = 0
  for (;;) {
    const start = css.indexOf("/*", i)
    if (start < 0) return out + css.slice(i)
    out += css.slice(i, start)
    const close = css.indexOf("*/", start + 2)
    if (close < 0) return out
    i = close + 2
  }
}

/** A `<style>` rule for one class (".cls-1, .cls-2 { fill: #fff }" gives two), in the sheet's order. */
type ClassRule = { cls: string; decls: Map<string, string> }

/** The rules of `<style>` sheets for single classes, as design apps write them. */
function classRules(css: string, into: ClassRule[]) {
  for (const chunk of uncomment(css).split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    const decls = declarations(chunk.slice(open + 1))
    for (const selector of chunk.slice(0, open).split(",")) {
      const cls = /^\s*\.([\w-]+)\s*$/.exec(selector)?.[1]
      if (cls) into.push({ cls, decls })
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

/** `m` then `n` (n applied first), as nested SVG transforms compose. */
const multiply = ([a, b, c, d, e, f]: Matrix, [g, h, i, j, k, l]: Matrix): Matrix => [
  a * g + c * h,
  b * g + d * h,
  a * i + c * j,
  b * i + d * j,
  a * k + c * l + e,
  b * k + d * l + f,
]

/** An SVG transform list as one matrix; refuses anything but the six functions with their numbers. */
export function transformMatrix(list: string): Matrix {
  if (!TRANSFORM.test(list)) throw new LogoSvgError("invalid")
  let m = IDENTITY
  for (const [, fn, args] of list.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const v = args.trim() === "" ? [] : args.trim().split(/[\s,]+/).map(Number)
    if (v.some((n) => !Number.isFinite(n))) throw new LogoSvgError("invalid")
    const rad = (deg: number) => (deg * Math.PI) / 180
    let t: Matrix
    if (fn === "matrix" && v.length === 6) t = v as Matrix
    else if (fn === "translate" && (v.length === 1 || v.length === 2)) t = [1, 0, 0, 1, v[0], v[1] ?? 0]
    else if (fn === "scale" && (v.length === 1 || v.length === 2)) t = [v[0], 0, 0, v[1] ?? v[0], 0, 0]
    else if (fn === "rotate" && (v.length === 1 || v.length === 3)) {
      const [cos, sin] = [Math.cos(rad(v[0])), Math.sin(rad(v[0]))]
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0]
      t = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy])
    } else if (fn === "skewX" && v.length === 1) t = [1, 0, Math.tan(rad(v[0])), 1, 0, 0]
    else if (fn === "skewY" && v.length === 1) t = [1, Math.tan(rad(v[0])), 0, 1, 0, 0]
    else throw new LogoSvgError("invalid")
    m = multiply(m, t)
  }
  return m
}

/** A matrix as the shortest transform that draws it ("" for none). */
function matrixText(m: Matrix): string {
  const r = m.map((n) => Number(n.toFixed(6)) + 0) // + 0: no "-0"
  if (r.every((n, i) => n === IDENTITY[i])) return ""
  if (r[0] === 1 && r[1] === 0 && r[2] === 0 && r[3] === 1) return `translate(${r[4]} ${r[5]})`
  return `matrix(${r.join(" ")})`
}

/** How many numbers each path command takes. */
const PARAMS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y

/**
 * Path data read number by number and written again: rounded to `decimals`
 * (none: as they are), one space between numbers unless the next one starts
 * with a minus. An arc's two flags are read as single digits, as browsers do
 * ("a1 1 0 01.5.5"). Refuses path data a browser would stop drawing at.
 */
export function normalizePath(d: string, decimals: number | null): string {
  // Parts joined at the end: reading the end of a growing string would copy it each time.
  const out: string[] = []
  let afterNumber = false
  let command = ""
  let i = 0
  const skip = () => {
    while (i < d.length && (d[i] === " " || d[i] === "," || d[i] === "\t" || d[i] === "\n" || d[i] === "\r" || d[i] === "\f")) i++
  }
  const write = (text: string) => {
    out.push(afterNumber && !text.startsWith("-") ? ` ${text}` : text)
    afterNumber = true
  }
  skip()
  while (i < d.length) {
    const c = d[i]
    if (/[a-zA-Z]/.test(c)) {
      if (!(c.toLowerCase() in PARAMS)) throw new LogoSvgError("invalid")
      // Path data starts with a move.
      if (!command && c.toLowerCase() !== "m") throw new LogoSvgError("invalid")
      command = c
      out.push(c)
      afterNumber = false
      i++
      skip()
      if (c.toLowerCase() === "z") continue
    } else if (!command || command.toLowerCase() === "z") {
      throw new LogoSvgError("invalid")
    }
    const lower = command.toLowerCase()
    for (let k = 0; k < PARAMS[lower]; k++) {
      if (k > 0) skip()
      if (lower === "a" && (k === 3 || k === 4)) {
        if (d[i] !== "0" && d[i] !== "1") throw new LogoSvgError("invalid")
        write(d[i])
        i++
        continue
      }
      NUMBER.lastIndex = i
      const m = NUMBER.exec(d)
      if (!m) throw new LogoSvgError("invalid")
      i = NUMBER.lastIndex
      const value = Number(m[0])
      if (!Number.isFinite(value)) throw new LogoSvgError("invalid")
      write(String(decimals === null ? value : Number(value.toFixed(decimals))))
    }
    skip()
  }
  return out.join("")
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
  const rules: ClassRule[] = []
  let inStyle = false
  let css = ""
  for (const token of tokens(source)) {
    if (token.kind === "open" && token.name.replace(/^svg:/, "") === "style" && !token.selfClosing) {
      inStyle = true
      css = ""
    } else if (token.kind === "close" && token.name.replace(/^svg:/, "") === "style" && inStyle) {
      classRules(css, rules)
      inStyle = false
    } else if (token.kind === "text" && inStyle) css += token.text
  }

  const stack: Frame[] = []
  let root: Map<string, string> | null = null
  let viewBox: string | null = null
  const shapes: { d: string; evenodd: boolean; matrix: Matrix; white: boolean }[] = []
  let strokeOnly = false

  const rootProps: Props = {
    fill: null,
    fillRule: null,
    fillOpacity: null,
    stroke: null,
    strokeWidth: null,
    strokeOpacity: null,
    visibility: null,
  }

  for (const token of tokens(source)) {
    if (token.kind === "text") continue
    if (token.kind === "close") {
      const at = stack.findLastIndex((f) => f.name === token.name.replace(/^svg:/, ""))
      if (at >= 0) stack.length = at
      continue
    }

    const raw = token.name
    const prefix = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : null
    const name = prefix === "svg" ? raw.slice(4) : raw
    const attrs = attributes(token.attrs)
    const parent = stack.at(-1)
    const isRoot = !root

    if (isRoot) {
      if (name !== "svg") throw new LogoSvgError("notSvg")
      root = attrs
      viewBox = ownViewBox(attrs)
    } else if (!parent?.ignore && (!prefix || prefix === "svg")) {
      if (REFUSED[name]) throw new LogoSvgError(REFUSED[name])
    }

    // Presentation attributes, then class rules in the sheet's order, then the style attribute (CSS order).
    const own = new Map<string, string>()
    for (const key of PROPERTIES) {
      const v = attrs.get(key)
      if (v !== undefined) own.set(key, v)
    }
    const classes = new Set((attrs.get("class") ?? "").split(/\s+/).filter(Boolean))
    if (classes.size > 0) {
      for (const rule of rules) if (classes.has(rule.cls)) for (const [k, v] of rule.decls) own.set(k, v)
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
      strokeOpacity: pick("stroke-opacity", inherited.strokeOpacity),
      visibility: pick("visibility", inherited.visibility),
    }
    const hidden =
      isNone(own.get("display") ?? null) ||
      Number(own.get("opacity") ?? "1") === 0 ||
      props.visibility === "hidden" ||
      props.visibility === "collapse"

    // Nested groups' transforms, multiplied into one (a transform on the root <svg> is not drawn by every browser: left out).
    const transform = isRoot ? "" : (attrs.get("transform") ?? "").trim()
    const matrix = transform ? multiply(parent?.matrix ?? IDENTITY, transformMatrix(transform)) : (parent?.matrix ?? IDENTITY)

    // Anything else (definitions, styles, metadata, a design app's own elements) is left out with its content.
    const skip =
      Boolean(parent?.ignore) ||
      hidden ||
      Boolean(prefix && prefix !== "svg") ||
      (!isRoot && !GROUPS.has(name) && !SHAPES.has(name))

    if (!skip && SHAPES.has(name)) {
      const filled = !isNone(props.fill) && Number(props.fillOpacity ?? "1") !== 0
      const stroked =
        props.stroke !== null &&
        !isNone(props.stroke) &&
        Number.parseFloat(props.strokeWidth ?? "1") !== 0 &&
        Number(props.strokeOpacity ?? "1") !== 0
      // A stroke that is what shows: on a shape with no fill, a line, or around a white (background) fill.
      if (stroked && (!filled || name === "line" || (isWhite(props.fill) && !isWhite(props.stroke)))) strokeOnly = true
      const d = filled ? shapePath(name, attrs) : null
      if (d !== null) {
        if (!PATH_DATA.test(d)) throw new LogoSvgError("invalid")
        if (/\d/.test(d)) shapes.push({ d, evenodd: props.fillRule === "evenodd", matrix, white: isWhite(props.fill) })
      }
    }

    if (!token.selfClosing) stack.push({ name, ignore: skip, props, matrix })
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
  const paths = kept.map((s) => {
    const transform = matrixText(s.matrix)
    return {
      d: normalizePath(s.d, decimals),
      ...(s.evenodd ? { evenodd: true as const } : {}),
      ...(transform ? { transform } : {}),
    }
  })
  if (paths.reduce((sum, p) => sum + p.d.length, 0) > LOGO_DATA_MAX) throw new LogoSvgError("tooComplex")
  return { viewBox, paths }
}
