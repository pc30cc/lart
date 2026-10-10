"use client"

import { FileTextIcon, ImagePlusIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useId, useRef, useState } from "react"

import { checkFile, failureCode, uploadFile, useMediaText } from "@/components/admin/upload/upload-client"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { MAX_EXPENSE_FILES, type ExpenseFile } from "@/features/money/schema"
import { RECEIPT_ACCEPT } from "@/lib/storage/shared"

type Kept = ExpenseFile & { url: string; name: string }
type Pending = { key: string; name: string }

/**
 * The files kept with an expense, of one role: receipts (photo or PDF) or
 * photos of what was bought. Each file is uploaded as soon as it is chosen
 * (purpose "receipt"); the form keeps their paths and saves them with the
 * expense. `value` holds every role's files: this field shows only its own.
 */
export function ReceiptFiles({
  role,
  label,
  hint,
  value,
  onAdd,
  onRemove,
  onBusy,
}: {
  role: ExpenseFile["role"]
  label: string
  hint: string
  value: ExpenseFile[]
  /** Called when an upload finishes (the form appends it to what it holds then). */
  onAdd: (file: ExpenseFile) => void
  onRemove: (path: string) => void
  /** +1 when an upload starts, -1 when it ends: the form waits for them before saving. */
  onBusy?: (delta: number) => void
}) {
  const t = useTranslations("money.receipts.field")
  const { error: errorText } = useMediaText()
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  // What this field uploaded (for the previews); `value` stays the source of truth for what is saved.
  const [kept, setKept] = useState<Kept[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const mine = kept.filter((k) => value.some((v) => v.path === k.path))
  const room = MAX_EXPENSE_FILES - value.length - pending.length

  async function add(files: File[]) {
    setError(null)
    for (const file of files.slice(0, Math.max(0, room))) {
      const problem = checkFile(file, "receipt")
      if (problem) {
        setError(errorText(problem, "receipt"))
        continue
      }
      const key = `${file.name}-${(seq.current += 1)}`
      setPending((p) => [...p, { key, name: file.name }])
      onBusy?.(1)
      try {
        const result = await uploadFile(file, "receipt")
        setKept((k) => [...k, { path: result.path, role, url: result.url, name: file.name }])
        onAdd({ path: result.path, role })
      } catch (err) {
        const code = failureCode(err)
        if (code !== "aborted") setError(errorText(code, "receipt"))
      } finally {
        setPending((p) => p.filter((x) => x.key !== key))
        onBusy?.(-1)
      }
    }
    if (files.length > room) setError(t("tooMany", { max: MAX_EXPENSE_FILES }))
  }

  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={inputId} className="text-sm font-medium">
          {label}
        </label>
        <p className="text-muted-foreground text-xs text-pretty">{hint}</p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {mine.map((file) => (
          <li key={file.path} className="bg-muted/40 ring-foreground/10 relative size-20 overflow-hidden rounded-lg ring-1">
            {file.path.endsWith(".pdf") ? (
              <span className="text-muted-foreground flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px]">
                <FileTextIcon className="size-6" aria-hidden />
                <span className="w-full truncate" dir="auto">
                  {file.name}
                </span>
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a thumbnail of the file just uploaded
              <img src={file.url} alt={file.name} className="size-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => onRemove(file.path)}
              className="bg-background/90 hover:bg-background absolute end-1 top-1 flex size-6 items-center justify-center rounded-full shadow-sm"
              aria-label={t("remove", { name: file.name })}
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
        {pending.map((p) => (
          <li
            key={p.key}
            className="bg-muted/40 ring-foreground/10 flex size-20 flex-col items-center justify-center gap-1 rounded-lg p-1 text-center ring-1"
          >
            <Spinner aria-hidden />
            <span className="text-muted-foreground w-full truncate text-[10px]" dir="auto">
              {p.name}
            </span>
          </li>
        ))}
        {room > 0 && (
          <li>
            <Button
              type="button"
              variant="outline"
              className="text-muted-foreground size-20 flex-col gap-1 border-dashed text-xs"
              onClick={() => input.current?.click()}
            >
              <ImagePlusIcon className="size-5" />
              {t("add")}
            </Button>
          </li>
        )}
      </ul>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={RECEIPT_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ""
          void add(files)
        }}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
