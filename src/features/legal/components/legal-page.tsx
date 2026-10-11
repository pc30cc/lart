import { getTranslations } from "next-intl/server"

import { parseContractText, type ContractBlock } from "@/features/contracts/text"
import { Link } from "@/i18n/navigation"

/** The legal pages, in the order of the footer (the "other pages" links leave out the one open). */
const pages = [
  { href: "/privacy", key: "privacy" },
  { href: "/distance-sales", key: "distanceSales" },
  { href: "/cancellation", key: "cancellation" },
  { href: "/contact", key: "contact" },
] as const

/**
 * A legal page's frame: a readable column in any theme, the page's own content,
 * and links to the other legal pages under it.
 */
export async function LegalShell({ current, children }: { current: (typeof pages)[number]["href"]; children: React.ReactNode }) {
  const t = await getTranslations("legal")
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-20 sm:pt-14">
      {children}
      <nav aria-label={t("otherPages")} className="mt-14 border-t pt-6">
        <h2 className="text-muted-foreground text-sm font-medium">{t("otherPages")}</h2>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {pages
            .filter((p) => p.href !== current)
            .map((p) => (
              <li key={p.href}>
                <Link href={p.href} className="text-primary underline-offset-4 hover:underline">
                  {t(`links.${p.key}`)}
                </Link>
              </li>
            ))}
        </ul>
      </nav>
    </div>
  )
}

/**
 * A legal text in the template format, as a page: its "# " title the page's
 * heading, "## " its sections. Plain text only (no HTML).
 */
export function LegalText({ text }: { text: string }) {
  const groups: (ContractBlock | ContractBlock[])[] = []
  for (const block of parseContractText(text)) {
    const last = groups[groups.length - 1]
    if (block.type === "item" && Array.isArray(last)) last.push(block)
    else groups.push(block.type === "item" ? [block] : block)
  }
  return (
    <article className="space-y-4 text-[0.97rem] leading-relaxed text-pretty">
      {groups.map((group, i) => {
        if (Array.isArray(group)) {
          return (
            <ul key={i} className="marker:text-primary/70 list-disc space-y-1.5 ps-5">
              {group.map((item, j) => (
                <li key={j} className="[overflow-wrap:anywhere]">{item.text}</li>
              ))}
            </ul>
          )
        }
        if (group.type === "title") {
          return (
            <h1 key={i} className="pb-2 text-3xl leading-tight font-semibold text-balance sm:text-4xl">
              {group.text}
            </h1>
          )
        }
        if (group.type === "heading") return <h2 key={i} className="pt-4 text-xl font-semibold">{group.text}</h2>
        return <p key={i}>{group.text}</p>
      })}
    </article>
  )
}
