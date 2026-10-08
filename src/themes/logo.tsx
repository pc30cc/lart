// Types only: the Atelier header (a client component) draws the logo, and lib/logo's schema (zod) stays off the site's bundle.
import type { LogoData, LogoSize } from "@/lib/logo"

const SYMBOL_ID = "site-logo"

/**
 * The logo's shapes, once per page (SiteRoot): every `BrandLogo` on the page
 * draws them, so a logo in the header, the menu and the footer is sent once.
 * Values come from the `logo` setting, checked by `logoSchema` (numbers and
 * path commands only).
 */
export function LogoSymbol({ logo }: { logo: LogoData }) {
  return (
    <svg aria-hidden focusable="false" width="0" height="0" className="pointer-events-none absolute size-0 overflow-hidden">
      <symbol id={SYMBOL_ID} viewBox={logo.viewBox}>
        {logo.paths.map((p, i) => (
          <path key={i} d={p.d} fillRule={p.evenodd ? "evenodd" : undefined} transform={p.transform} />
        ))}
      </symbol>
    </svg>
  )
}

/**
 * The site's logo in the text colour, sized by `className` (a height, or a
 * width); decorative, so the link or heading around it carries the brand's
 * name. Needs the page's `LogoSymbol`.
 */
export function BrandLogo({ logo, className }: { logo: LogoSize; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${logo.width} ${logo.height}`}
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={className}
      style={{ aspectRatio: `${logo.width} / ${logo.height}` }}
    >
      <use href={`#${SYMBOL_ID}`} width={logo.width} height={logo.height} />
    </svg>
  )
}

/**
 * The logo drawn on its own, with its shapes, without `LogoSymbol`: on a page
 * (see `HomeData.logo`) and the settings page's preview. Decorative, like
 * `BrandLogo`.
 */
export function LogoPicture({ logo, className }: { logo: LogoData; className?: string }) {
  const [, , width, height] = logo.viewBox.split(" ")
  return (
    <svg
      viewBox={logo.viewBox}
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={className}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {logo.paths.map((p, i) => (
        <path key={i} d={p.d} fillRule={p.evenodd ? "evenodd" : undefined} transform={p.transform} />
      ))}
    </svg>
  )
}
