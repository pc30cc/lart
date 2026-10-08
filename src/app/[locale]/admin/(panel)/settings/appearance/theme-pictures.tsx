import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"
import type { FontStyle } from "@/themes/font-css"
import type { ThemeId } from "@/themes/ids"

/**
 * Small pictures of each theme for Settings → Appearance, drawn with HTML and
 * CSS in the theme's colours and the fonts it would use, and the look of the
 * font preview on that page. A new theme adds its picture and look here.
 * Sizes are in `cqw` (a hundredth of the picture's width), so a picture is a
 * true miniature at any card width.
 */

type PictureProps = {
  brand: string
  /** The theme's heading font in the admin's script (the pictures' only text is the brand). */
  heading: FontStyle
  /** The admin's language is Persian: the picture shows a Persian page (no capitals). */
  persian: boolean
}

const font = ({ family, weight }: FontStyle): CSSProperties => ({ fontFamily: family, fontWeight: weight })

/** Classic: the panel's own cream and clay tokens (globals.css), light or dark like the site. */
function ClassicPicture({ brand, heading, persian }: PictureProps) {
  return (
    <div className="bg-background text-foreground flex size-full flex-col">
      <div className="flex h-[9cqw] shrink-0 items-center gap-[3cqw] border-b px-[4cqw]">
        <span style={font(heading)} className={cn("text-[3.4cqw] leading-none", !persian && "tracking-wide")}>
          {brand}
        </span>
        <span className="bg-muted-foreground/30 h-[1cqw] w-[9cqw] rounded-full" />
        <span className="bg-muted ms-auto size-[3.6cqw] rounded-full" />
        <span className="bg-muted h-[3.6cqw] w-[9cqw] rounded-full" />
      </div>
      <div className="from-primary/8 border-b bg-linear-to-b to-transparent px-[4cqw] py-[4cqw]">
        <div style={font(heading)} className={cn("text-[7cqw] leading-none", !persian && "tracking-wide")}>
          {brand}
        </div>
        <div className="bg-muted-foreground/25 mt-[3cqw] h-[1.3cqw] w-[48cqw] rounded-full" />
        <div className="bg-muted-foreground/25 mt-[1.5cqw] h-[1.3cqw] w-[32cqw] rounded-full" />
        <div className="bg-primary mt-[3.5cqw] h-[5.5cqw] w-[22cqw] rounded-[1.3cqw]" />
      </div>
      <div className="grid grid-cols-3 gap-[2.5cqw] px-[4cqw] py-[3.5cqw]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-card overflow-hidden rounded-[1.5cqw] border">
            <div className="from-primary/15 to-muted h-[10cqw] bg-linear-to-br" />
            <div className="bg-foreground/20 m-[1.6cqw] h-[1cqw] w-2/3 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Atelier: cream page, a dark photo hero with a capitalised heading and a pill button, a grid of framed pictures. */
function AtelierPicture({ brand, heading, persian }: PictureProps) {
  return (
    <div className="flex size-full flex-col bg-[#F2E9E5] text-[#5B311E]">
      <div className="relative flex h-[60%] shrink-0 flex-col bg-[#5B311E] bg-[image:radial-gradient(circle_at_28%_38%,rgb(197_170_142/0.55),transparent_42%),radial-gradient(circle_at_78%_72%,rgb(139_74_46/0.9),transparent_50%),linear-gradient(160deg,#6d3c25,#2f190f)] text-[#F2E9E5]">
        <div className="flex h-[9cqw] shrink-0 items-center gap-[2.5cqw] px-[4cqw]">
          <span style={font(heading)} className={cn("text-[3cqw] leading-none", !persian && "tracking-[0.08em] uppercase")}>
            {brand}
          </span>
          <span className="ms-auto h-[0.9cqw] w-[7cqw] rounded-full bg-[#F2E9E5]/70" />
          <span className="h-[0.9cqw] w-[7cqw] rounded-full bg-[#F2E9E5]/70" />
          <span className="h-[4cqw] w-[11cqw] rounded-full bg-[#F2E9E5]" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center pb-[4cqw] text-center">
          <div style={font(heading)} className={cn("text-[7.5cqw] leading-none", !persian && "tracking-[0.04em] uppercase")}>
            {brand}
          </div>
          <div className="mt-[2.5cqw] h-[1cqw] w-[30cqw] rounded-full bg-[#F2E9E5]/60" />
          <div className="mt-[3cqw] flex h-[5cqw] w-[20cqw] items-center justify-center rounded-full bg-[#F2E9E5]">
            <span className="h-[0.9cqw] w-[11cqw] rounded-full bg-[#5B311E]/70" />
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-[4cqw] pt-[3cqw]">
        <div className="flex items-center">
          <span className="h-[1cqw] w-[16cqw] rounded-full bg-[#5B311E]/60" />
          <span className="ms-auto h-[3.6cqw] w-[14cqw] rounded-full border border-[#5B311E]/70" />
        </div>
        <div className="mt-[2.5cqw] grid grid-cols-4 gap-[2.5cqw]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[12cqw] bg-[#C5AA8E]/45 p-[0.8cqw] ring-1 ring-[#C5AA8E]">
              <div className="size-full bg-linear-to-br from-[#C5AA8E] to-[#8B4A2E]/50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const pictures: Record<ThemeId, (props: PictureProps) => React.ReactNode> = {
  default: ClassicPicture,
  atelier: AtelierPicture,
}

/** The picture of a theme, in a little browser-like frame. */
export function ThemePicture({ themeId, ...props }: PictureProps & { themeId: ThemeId }) {
  const Picture = pictures[themeId]
  return (
    <div className="ring-foreground/10 @container aspect-[16/10] w-full overflow-hidden rounded-md shadow-xs ring-1">
      <Picture {...props} />
    </div>
  )
}

/**
 * How the font preview looks in each theme: its surface and text colours, and
 * how Latin headings are written (Atelier writes them in capitals).
 */
export const previewLooks: Record<ThemeId, { surface: string; text: string; label: string; latinHeading: string }> = {
  default: {
    surface: "bg-background text-foreground ring-foreground/8 ring-1",
    text: "text-muted-foreground",
    label: "text-primary",
    latinHeading: "tracking-wide",
  },
  atelier: {
    surface: "bg-[#F2E9E5] text-[#5B311E]",
    text: "text-[#5B311E]",
    label: "text-[#8B4A2E]",
    latinHeading: "uppercase tracking-[0.04em]",
  },
}
