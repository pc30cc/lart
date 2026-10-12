import { DownloadIcon, QrCodeIcon } from "lucide-react"
import { getLocale, getTranslations } from "next-intl/server"
import QRCode from "qrcode"

import { Button } from "@/components/ui/button"
import { telegramConfig, workshopPost } from "@/features/telegram/telegram"
import { absoluteLocaleUrl, mainLocale } from "@/i18n/links"
import { Link } from "@/i18n/navigation"
import { formatDateTime } from "@/lib/format"
import { PostToTelegramButton } from "./telegram-button"

type Shared = { id: string; slug: string; telegramPostedAt: Date | null }

/**
 * The workshop's Telegram post: how it will look in the channel (cover,
 * caption, "Register" button), and the super admin's go to send it. Without
 * a channel set: where to set one. Before it is public: why not yet.
 */
export async function TelegramCard({ workshop: w }: { workshop: Shared }) {
  const [t, config, locale] = await Promise.all([getTranslations("workshops.telegram"), telegramConfig().catch(() => null), getLocale()])
  if (!config) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("notSet")}{" "}
        <Link href="/admin/settings/telegram" className="text-primary underline underline-offset-4">
          {t("setUp")}
        </Link>
      </p>
    )
  }
  const post = await workshopPost(w.id, config.locale)
  if (!post) return null
  return (
    <div className="space-y-3">
      {/* A preview in the channel's language and direction. */}
      <div lang={config.locale} dir={config.locale === "fa" ? "rtl" : "ltr"} className="bg-muted/60 overflow-hidden rounded-xl text-sm">
        {post.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- CDN URL decided at runtime
          <img src={post.photoUrl} alt="" className="aspect-video w-full object-cover" />
        )}
        <div
          className="space-y-0 p-3 leading-relaxed whitespace-pre-line [&_b]:font-semibold [&_i]:italic"
          // The caption is built by us from escaped text, with only <b> and <i> (telegram.ts).
          dangerouslySetInnerHTML={{ __html: post.caption }}
        />
        <div className="border-t p-2 text-center text-xs font-medium text-sky-600 dark:text-sky-400">{post.button}</div>
      </div>
      {post.public ? (
        <>
          {w.telegramPostedAt && <p className="text-muted-foreground text-xs">{t("postedAt", { date: formatDateTime(w.telegramPostedAt, locale, "medium") })}</p>}
          <PostToTelegramButton id={w.id} chat={config.chatId} again={w.telegramPostedAt !== null} />
        </>
      ) : (
        <p className="text-muted-foreground text-xs">{t("notPublic")}</p>
      )}
    </div>
  )
}

/**
 * The workshop page's QR code for posters: its address in the site's main
 * language, to download as a PNG (1200 px, print) or an SVG (any size).
 */
export async function QrCard({ workshop: w }: { workshop: Shared }) {
  const [t, main] = await Promise.all([getTranslations("workshops.qr"), mainLocale()])
  const url = await absoluteLocaleUrl(main, `/workshops/${w.slug}`)
  const options = { errorCorrectionLevel: "M" as const, margin: 2, color: { dark: "#1f1a17", light: "#ffffff" } }
  const [svg, png] = await Promise.all([
    QRCode.toString(url, { ...options, type: "svg" }),
    QRCode.toDataURL(url, { ...options, width: 1200 }),
  ])
  const svgHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  return (
    <div className="space-y-3">
      <div className="mx-auto w-44 rounded-xl bg-white p-2 ring-1 ring-black/10" aria-label={t("alt")} role="img">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
        <img src={svgHref} alt="" className="block w-full" />
      </div>
      <p dir="ltr" className="text-muted-foreground text-center text-xs break-all">
        {url}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={png} download={`qr-${w.slug}.png`}>
            <DownloadIcon />
            PNG
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={svgHref} download={`qr-${w.slug}.svg`}>
            <QrCodeIcon />
            SVG
          </a>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t("hint")}</p>
    </div>
  )
}
