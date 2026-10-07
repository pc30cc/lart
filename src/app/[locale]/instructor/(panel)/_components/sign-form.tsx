"use client"

import { CircleCheckIcon, PenLineIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useId, useState, useTransition } from "react"

import { FormAlert } from "@/components/site/auth/fields"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { signContractAction } from "@/features/instructor-panel/actions"
import { sameName } from "@/features/instructor-panel/schema"
import { useRouter } from "@/i18n/navigation"
import { cn } from "@/lib/utils"

/**
 * Under the contract text: "I have read the contract and agree", the full
 * name typed as on the ID, and one big "Sign" button. The name is checked
 * loosely as it is typed (spacing and letter case don't matter); the server
 * checks it again and signs exactly the text shown (`textSha256`).
 */
export function SignForm({
  contractId,
  locale,
  textSha256,
  officialName,
}: {
  contractId: string
  locale: "fa" | "tr" | "en"
  textSha256: string
  officialName: string
}) {
  const t = useTranslations("instructorPanel.sign")
  const tc = useTranslations("common")
  const router = useRouter()
  const id = useId()
  const [agree, setAgree] = useState(false)
  const [name, setName] = useState("")
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const nameOk = sameName(name, officialName)
  // The official name inside a sentence: isolated, so a Latin name reads correctly in Persian.
  const official = `⁨${officialName}⁩`
  const agreeError = tried && !agree
  const nameError = tried && !nameOk ? (name.trim() ? t("errors.nameMismatch", { name: official }) : t("errors.name")) : null

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setTried(true)
    setError(null)
    if (!agree || !nameOk) return
    startTransition(async () => {
      try {
        const result = await signContractAction({ contractId, locale, textSha256, agree: true, signedName: name })
        if (!result) return
        if (result.ok) {
          router.replace(`/instructor/contracts/${contractId}?signed=1`)
          return
        }
        setError(result.fieldErrors?.signedName ?? result.error)
        // Show the contract as it is now (changed, replaced or already signed).
        router.refresh()
      } catch {
        setError(tc("errors.network"))
      }
    })
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-labelledby={`${id}-title`}
      className="bg-card ring-foreground/8 space-y-6 rounded-2xl p-5 shadow-xs ring-1 sm:p-7 print:hidden"
    >
      <div className="space-y-1.5">
        <h2 id={`${id}-title`} className="text-xl font-semibold">
          {t("title")}
        </h2>
        <p className="text-muted-foreground text-pretty">{t("intro")}</p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor={`${id}-agree`}
          className={cn(
            "flex cursor-pointer items-start gap-3.5 rounded-xl border p-4 transition-colors",
            agree ? "border-primary/50 bg-primary/5" : "hover:bg-muted/50",
            agreeError && "border-destructive/60",
          )}
        >
          <Checkbox
            id={`${id}-agree`}
            checked={agree}
            onCheckedChange={(value) => setAgree(value === true)}
            aria-invalid={agreeError}
            aria-describedby={agreeError ? `${id}-agree-error` : undefined}
            className="mt-0.5 size-5 rounded-[5px] border-2 border-foreground/50 [&_svg]:size-4!"
          />
          <span className="text-base leading-snug font-medium">{t("agree")}</span>
        </label>
        {agreeError && (
          <p id={`${id}-agree-error`} className="text-destructive text-sm">
            {t("errors.agree")}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${id}-name`} className="text-base">
          {t("name")}
        </Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          spellCheck={false}
          maxLength={200}
          aria-invalid={Boolean(nameError)}
          aria-describedby={`${id}-name-hint${nameError ? ` ${id}-name-error` : ""}`}
          className="h-12 text-base"
        />
        <p id={`${id}-name-hint`} className="text-muted-foreground text-sm text-pretty">
          {t("nameHint", { name: official })}
        </p>
        {nameError ? (
          <p id={`${id}-name-error`} className="text-destructive text-sm text-pretty">
            {nameError}
          </p>
        ) : (
          nameOk && (
            <p className="text-success animate-in fade-in-0 flex items-center gap-1.5 text-sm">
              <CircleCheckIcon className="size-4 shrink-0" aria-hidden />
              {t("nameMatches")}
            </p>
          )
        )}
      </div>

      {error && <FormAlert>{error}</FormAlert>}

      <div className="space-y-3">
        <Button type="submit" disabled={pending} className="h-13 w-full rounded-xl text-base">
          {pending ? <Spinner aria-hidden /> : <PenLineIcon className="size-5" />}
          {t("submit")}
        </Button>
        <p className="text-muted-foreground text-center text-xs text-pretty">{t("evidence")}</p>
      </div>
    </form>
  )
}
