"use client"

import { Trash2Icon, TriangleAlertIcon, UploadIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useId, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { ConfirmAction } from "@/components/admin/confirm-action"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { removeSiteLogo, saveSiteLogo } from "@/features/settings/appearance-actions"
import { LOGO_FILE_MAX, LogoSvgError, parseLogoSvg, type ParsedLogo } from "@/features/settings/logo-svg"
import type { LogoData } from "@/lib/logo"
import { LogoPicture } from "@/themes/logo"
import { Panel } from "../_components/fields"

/** The logo cropped to its ink, as the browser draws it: the viewBox around every shape (transforms included). */
function inkBox(logo: ParsedLogo): string {
  const ns = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(ns, "svg")
  svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden")
  const group = document.createElementNS(ns, "g")
  for (const p of logo.paths) {
    const path = document.createElementNS(ns, "path")
    path.setAttribute("d", p.d)
    if (p.transform) path.setAttribute("transform", p.transform)
    group.appendChild(path)
  }
  svg.appendChild(group)
  document.body.appendChild(svg)
  try {
    const box = group.getBBox()
    if (!(box.width > 0 && box.height > 0)) throw new LogoSvgError("empty")
    const down = (n: number) => Math.floor(n * 100) / 100
    const x = down(box.x)
    const y = down(box.y)
    const up = (n: number) => Math.ceil(n * 100) / 100
    return `${x} ${y} ${up(box.x + box.width - x)} ${up(box.y + box.height - y)}`
  } finally {
    svg.remove()
  }
}

/**
 * Settings → Appearance: the site's logo. An SVG file is read here
 * (logo-svg.ts: its filled shapes, cropped to the ink) and saved at once; the
 * preview shows it in a light and a dark theme's colours, as the site draws it.
 */
export function LogoPanel({ saved, brand }: { saved: LogoData | null; brand: string }) {
  const t = useTranslations("appearance.logo")
  const tc = useTranslations("common")
  const input = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const upload = (file: File) =>
    startTransition(async () => {
      setError(null)
      try {
        if (file.size > LOGO_FILE_MAX) throw new LogoSvgError("tooBig")
        const parsed = parseLogoSvg(await file.text())
        const result = await saveSiteLogo({ logo: { viewBox: inkBox(parsed), paths: parsed.paths } })
        if (!result) return // the action redirected (e.g. the session ended)
        if (result.ok) toast.success(t("saved"))
        else setError(result.error)
      } catch (err) {
        setError(err instanceof LogoSvgError ? t(`errors.${err.code}`) : tc("errors.network"))
      }
    })

  return (
    <Panel title={t("title")} description={t("description")}>
      {saved ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <figure className="space-y-2">
            <div className="flex h-32 items-center justify-center rounded-lg bg-[#F2E9E5] px-8 text-[#5B311E] ring-1 ring-black/5">
              <LogoPicture logo={saved} className="max-h-16 max-w-full" />
            </div>
            <figcaption className="text-muted-foreground text-xs">{t("onLight")}</figcaption>
          </figure>
          <figure className="space-y-2">
            <div className="flex h-32 items-center justify-center rounded-lg bg-[#2B1A12] px-8 text-[#F2E9E5] ring-1 ring-white/10">
              <LogoPicture logo={saved} className="max-h-16 max-w-full" />
            </div>
            <figcaption className="text-muted-foreground text-xs">{t("onDark")}</figcaption>
          </figure>
        </div>
      ) : (
        <div className="bg-muted/40 flex min-h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-6 py-6 text-center">
          <span className="font-serif text-2xl" dir="auto">
            {brand}
          </span>
          <span className="text-muted-foreground text-sm">{t("none")}</span>
        </div>
      )}

      <p id={hintId} className="text-muted-foreground text-sm text-pretty">
        {t("hint")}
      </p>

      {error && (
        <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept=".svg,image/svg+xml"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) upload(file)
          }}
        />
        <Button type="button" variant="outline" disabled={pending} aria-describedby={hintId} onClick={() => input.current?.click()}>
          {pending ? <Spinner aria-hidden /> : <UploadIcon aria-hidden />}
          {saved ? t("replace") : t("upload")}
        </Button>
        {saved && (
          <ConfirmAction
            action={removeSiteLogo}
            input={{}}
            title={t("removeTitle")}
            description={t("removeDescription", { brand })}
            confirmLabel={t("remove")}
            successMessage={t("removed")}
            onSuccess={() => setError(null)}
            trigger={
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending}>
                <Trash2Icon aria-hidden />
                {t("remove")}
              </Button>
            }
          />
        )}
      </div>
    </Panel>
  )
}
