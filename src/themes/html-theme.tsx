"use client"

import { useLayoutEffect } from "react"

/**
 * Puts the active theme's id on <html> while a site page is open, and takes it
 * off when the visitor leaves the site (to /admin, for example). Dialogs,
 * menus and toasts are rendered at the end of <body>, outside the site's
 * wrapper: through <html> they get the theme's colours and fonts too.
 */
export function HtmlTheme({ themeId }: { themeId: string }) {
  useLayoutEffect(() => {
    const html = document.documentElement
    html.dataset.siteTheme = themeId
    return () => {
      delete html.dataset.siteTheme
    }
  }, [themeId])
  return null
}
