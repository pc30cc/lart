import { ImageResponse } from "next/og"

import { getSetting } from "@/lib/settings"

const WIDTH = 1200
const HEIGHT = 630
/** The site's colours (globals.css, light): the warm paper background and the clay accent. */
const PAPER = "#faf7f2"
const CLAY = "#a4562f"

/**
 * The picture a link to the site shows when shared (Open Graph, 1200×630
 * PNG) on pages without one of their own (lib/seo `openGraphOf`): the site's
 * logo (Settings → Appearance) in the clay colour on paper, or the brand's
 * name when there is no logo. Outside the language routes (a dot in the path,
 * so the proxy leaves it alone); cached for a day.
 */
export async function GET() {
  const [logo, brand] = await Promise.all([getSetting("logo"), getSetting("brand")])
  const frame = { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: PAPER }
  let picture: React.ReactElement
  if (logo) {
    const [, , w, h] = logo.viewBox.split(" ").map(Number)
    // At most 760 × 300, keeping the logo's shape.
    const scale = Math.min(760 / w, 300 / h)
    picture = (
      <svg width={Math.round(w * scale)} height={Math.round(h * scale)} viewBox={logo.viewBox} fill={CLAY}>
        {logo.paths.map((p, i) => (
          <path key={i} d={p.d} fillRule={p.evenodd ? "evenodd" : undefined} transform={p.transform} />
        ))}
      </svg>
    )
  } else {
    // The built-in font has Latin letters only: the English or Turkish name.
    picture = <div style={{ fontSize: 120, fontWeight: 700, color: CLAY, letterSpacing: -2 }}>{brand.en || brand.tr || "Lart"}</div>
  }
  return new ImageResponse(
    (
      <div style={frame}>
        {picture}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14, background: CLAY, display: "flex" }} />
      </div>
    ),
    { width: WIDTH, height: HEIGHT, headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } },
  )
}
