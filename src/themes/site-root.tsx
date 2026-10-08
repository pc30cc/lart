import { preload } from "react-dom"

import { siteFontCss, siteFontPreloads } from "./font-css"
import { scriptOf, type SiteFonts } from "./fonts"
import { HtmlTheme } from "./html-theme"

/**
 * The public site's root: the chosen fonts (@font-face and variables, only the
 * fonts in use; the current language's files are preloaded) and the wrapper
 * that carries the theme's id, which its tokens and the site's font rules
 * (globals.css) are scoped to.
 */
export function SiteRoot({
  themeId,
  fonts,
  locale,
  children,
}: {
  themeId: string
  fonts: SiteFonts
  locale: string
  children: React.ReactNode
}) {
  for (const href of siteFontPreloads(fonts, scriptOf(locale))) {
    preload(href, { as: "font", type: "font/woff2", crossOrigin: "anonymous" })
  }
  return (
    <>
      {/* Built from the font registry only (src/themes/fonts.ts), never from what an admin typed. */}
      <style dangerouslySetInnerHTML={{ __html: siteFontCss(fonts) }} />
      <HtmlTheme themeId={themeId} />
      <div data-site-theme={themeId} className="flex min-h-svh flex-col">
        {children}
      </div>
    </>
  )
}
