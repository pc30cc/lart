"use client"

import { CircleCheckBigIcon, FileUpIcon, LoaderCircleIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format"
import { MAX_IMAGE_BYTES, RECEIPT_ACCEPT } from "@/lib/storage/shared"

/**
 * "Send the transfer receipt" on a registration waiting for a bank transfer:
 * one big button that opens the phone's camera roll or files (a photo or a
 * PDF); once sent, "We got your receipt" with a link to it and a quieter
 * "Send another". The super admins see it in the panel and mark it paid.
 */
export function ReceiptUpload({ registrationId, receiptUrl, receiptAt }: { registrationId: string; receiptUrl: string | null; receiptAt: Date | null }) {
  const t = useTranslations("registration.receipt")
  const locale = useLocale()
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)

  async function send(file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t("errors.too_large"))
      return
    }
    setSending(true)
    try {
      const form = new FormData()
      // The id first: the server reads the fields before the file.
      form.append("registrationId", registrationId)
      form.append("file", file, file.name)
      const answer = await fetch("/api/account/receipts", { method: "POST", body: form })
      if (answer.ok) {
        toast.success(t("sent"))
        router.refresh()
        return
      }
      const code = ((await answer.json().catch(() => ({}))) as { error?: string }).error
      toast.error(t.has(`errors.${code}`) ? t(`errors.${code}` as "errors.server") : t("errors.server"))
    } catch {
      toast.error(t("errors.network"))
    } finally {
      setSending(false)
      if (input.current) input.current.value = ""
    }
  }

  return (
    <section className="bg-card ring-foreground/8 space-y-3 rounded-2xl p-4 shadow-xs ring-1 sm:p-5" aria-labelledby="receipt">
      <h3 id="receipt" className="text-base font-semibold">
        {t("title")}
      </h3>
      {receiptUrl ? (
        <p className="text-success flex items-start gap-2.5 text-[0.95rem] leading-relaxed text-pretty">
          <CircleCheckBigIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span className="text-foreground">
            {t("received", { date: receiptAt ? formatDateTime(receiptAt, locale, "medium") : "" })}{" "}
            <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
              {t("view")}
            </a>
          </span>
        </p>
      ) : (
        <p className="text-[0.95rem] leading-relaxed text-pretty">{t("text")}</p>
      )}
      <input
        ref={input}
        type="file"
        accept={RECEIPT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void send(file)
        }}
      />
      <Button
        type="button"
        variant={receiptUrl ? "outline" : "default"}
        className="h-12 w-full rounded-xl text-base"
        disabled={sending}
        onClick={() => input.current?.click()}
      >
        {sending ? <LoaderCircleIcon className="size-5 animate-spin" aria-hidden /> : <FileUpIcon className="size-5" aria-hidden />}
        {sending ? t("sending") : receiptUrl ? t("again") : t("button")}
      </Button>
    </section>
  )
}
