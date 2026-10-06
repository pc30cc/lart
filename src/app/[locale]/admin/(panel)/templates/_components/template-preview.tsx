"use client"

import { EyeIcon, XIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"
import { useFormContext, useWatch } from "react-hook-form"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Locale, LocalizedText } from "@/db/schema"
import { parseContractText } from "@/features/contracts/text"
import { fillTemplate, type TemplateKind } from "@/features/templates/placeholders"
import type { TemplatePreview } from "@/features/templates/preview"
import { cn } from "@/lib/utils"

const LOCALES: Locale[] = ["fa", "tr", "en"]
/** Invisible marker around filled-in values, so the preview can highlight them. */
const MARK = "⁣"

/** "Preview" button: the text as people will read it, with sample data, in each language. */
export function TemplatePreviewDialog({ kind, preview }: { kind: TemplateKind; preview: TemplatePreview }) {
  const t = useTranslations("templates.preview")
  const tc = useTranslations("common")
  const uiLocale = useLocale() as Locale
  const [lang, setLang] = useState<Locale>(LOCALES.includes(uiLocale) ? uiLocale : "tr")
  const { control } = useFormContext()
  const body = (useWatch({ control, name: "body" }) ?? {}) as LocalizedText

  const sample = preview[lang]
  const values = Object.fromEntries(Object.entries(sample[kind]).map(([k, v]) => [k, `${MARK}${v}${MARK}`]))
  const clauses = fillTemplate(body[lang] ?? "", values).trim()
  const text = kind === "contract" ? `${sample.contractHeader}\n\n${clauses}` : clauses

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="lg" className="px-3.5">
          <EyeIcon />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="bg-popover/95 supports-backdrop-filter:bg-popover/80 sticky top-0 z-10 gap-3 border-b p-4 backdrop-blur-sm sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 text-start">
              <DialogTitle className="text-base font-semibold">{t("title")}</DialogTitle>
              <DialogDescription className="text-pretty">{t("description")}</DialogDescription>
            </div>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" className="-me-1 shrink-0">
                <XIcon />
                <span className="sr-only">{tc("actions.close")}</span>
              </Button>
            </DialogClose>
          </div>
          <Tabs value={lang} onValueChange={(v) => setLang(v as Locale)}>
            <TabsList className="w-full sm:w-fit">
              {LOCALES.map((l) => (
                <TabsTrigger key={l} value={l} className="px-3" lang={l}>
                  {tc(`locales.${l}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </DialogHeader>
        <div className="p-3 sm:p-6">
          {clauses ? (
            <TemplateDocument text={text} locale={lang} />
          ) : (
            <p className="text-muted-foreground py-16 text-center text-sm">{t("empty")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A template text set as a calm document: "# " title, "## " headings, "- "
 * list items, other lines as paragraphs (the same format contracts use).
 * Filled-in sample values are highlighted; unknown placeholders stand out.
 */
export function TemplateDocument({ text, locale }: { text: string; locale: Locale }) {
  const blocks = parseContractText(text)
  const rtl = locale === "fa"
  return (
    <article
      lang={locale}
      dir={rtl ? "rtl" : "ltr"}
      className={cn(
        "bg-card ring-foreground/8 text-card-foreground rounded-xl px-5 py-7 text-start shadow-xs ring-1 sm:px-10 sm:py-10",
        rtl ? "font-(family-name:--font-iransans) leading-loose" : "leading-relaxed",
      )}
    >
      <div className="mx-auto max-w-[68ch] text-[0.95rem]">
        {blocks.map((block, i) => {
          const content = <Inline text={block.text} />
          if (block.type === "title") {
            return (
              <h2 key={i} className={cn("text-center text-xl font-semibold text-balance", !rtl && "tracking-tight")}>
                {content}
              </h2>
            )
          }
          if (block.type === "heading") {
            return (
              <h3 key={i} className="mt-7 mb-2 border-b pb-1.5 text-base font-semibold first:mt-0">
                {content}
              </h3>
            )
          }
          if (block.type === "item") {
            return (
              <p key={i} className="relative my-1.5 ps-5">
                <span aria-hidden className="bg-foreground/40 absolute start-1 top-[0.7em] size-1.5 rounded-full" />
                {content}
              </p>
            )
          }
          const subtitle = i === 1 && blocks[0]?.type === "title"
          return (
            <p key={i} className={cn("text-pretty", subtitle ? "text-muted-foreground mt-1 mb-6 text-center text-sm" : "my-2.5")}>
              {content}
            </p>
          )
        })}
      </div>
    </article>
  )
}

function Inline({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${MARK}[^${MARK}]*${MARK}|\\{[a-z_]+\\})`, "g"))
  return parts.map((part, i) => {
    if (part.startsWith(MARK)) {
      return (
        <mark key={i} className="bg-primary/10 text-foreground rounded-sm px-0.5 [box-decoration-break:clone]">
          {part.slice(1, -1)}
        </mark>
      )
    }
    if (/^\{[a-z_]+\}$/.test(part)) {
      return (
        <mark key={i} dir="ltr" className="bg-destructive/10 text-destructive rounded-sm px-0.5 font-mono text-[0.85em]">
          {part}
        </mark>
      )
    }
    return part
  })
}
