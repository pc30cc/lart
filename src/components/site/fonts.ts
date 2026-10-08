import localFont from "next/font/local"

// The public site's fonts (self-hosted, like Inter in the root layout): used by
// `.site-type` in globals.css. Montserrat (text) and Cormorant Garamond
// (headings) are split into latin and latin-ext (Turkish ğ ş İ); Noto Naskh
// Arabic covers Persian, its Latin falls back to the two above.

const montserrat = localFont({
  src: "../../fonts/montserrat-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-montserrat",
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
})

const montserratExt = localFont({
  src: "../../fonts/montserrat-latin-ext-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-montserrat-ext",
  display: "swap",
  preload: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
})

const cormorant = localFont({
  src: "../../fonts/cormorant-garamond-latin-wght-normal.woff2",
  weight: "300 700",
  variable: "--font-cormorant",
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
})

const cormorantExt = localFont({
  src: "../../fonts/cormorant-garamond-latin-ext-wght-normal.woff2",
  weight: "300 700",
  variable: "--font-cormorant-ext",
  display: "swap",
  preload: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
})

const naskh = localFont({
  src: "../../fonts/noto-naskh-arabic-arabic-wght-normal.woff2",
  weight: "400 700",
  variable: "--font-naskh",
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC",
    },
  ],
})

/** The font variables for the site's wrapper (with `site-type`). */
export const siteFonts = [montserrat, montserratExt, cormorant, cormorantExt, naskh].map((f) => f.variable).join(" ")
