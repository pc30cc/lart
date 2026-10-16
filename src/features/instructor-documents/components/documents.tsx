"use client"

import { AwardIcon, ExternalLinkIcon, FileTextIcon, FilePlus2Icon, PencilIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import type { LocalizedText } from "@/db/schema"
import { profileText } from "@/features/instructors/schema"
import { useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Form, SubmitButton } from "@/components/admin/form/form"
import { LocalizedInput } from "@/components/admin/form/localized-input"
import { useActionForm } from "@/components/admin/form/use-action-form"
import { checkFile, failureCode, uploadFile, useMediaText, type ClientUploadError } from "@/components/admin/upload/upload-client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { addDocumentAction, adminDeleteDocumentAction, deleteDocumentAction, editDocumentAction } from "@/features/instructor-documents/actions"
import {
  addDocumentSchema,
  editDocumentSchema,
  MAX_DOCUMENTS,
  type AddDocumentValues,
  type EditDocumentValues,
} from "@/features/instructor-documents/schema"
import { useRouter } from "@/i18n/navigation"
import { DOCUMENT_ACCEPT, MAX_IMAGE_BYTES, type UploadResult } from "@/lib/storage/shared"
import { cn } from "@/lib/utils"

/** A document as the instructor and the admins see it (with the full file). */
export type DocumentItem = {
  id: string
  title: LocalizedText
  isPdf: boolean
  url: string | null
  thumbUrl: string | null
}

const texts = (t: LocalizedText) => ({ fa: t.fa ?? "", tr: t.tr ?? "", en: t.en ?? "" })

/** The title in each language it has: the page's own first. */
function Titles({ title }: { title: LocalizedText }) {
  const locale = useLocale()
  const own = profileText(title, locale)
  const others = (["fa", "tr", "en"] as const).filter((l) => title[l]?.trim() && title[l]?.trim() !== own)
  return (
    <div className="space-y-0.5">
      <p className="font-medium" dir="auto">
        {own}
      </p>
      {others.map((l) => (
        <p key={l} lang={l} dir="auto" className="text-muted-foreground text-sm">
          <span className="bg-muted me-1.5 rounded px-1 py-px font-mono text-[0.65rem] uppercase">{l}</span>
          {title[l]}
        </p>
      ))}
    </div>
  )
}

/** A document's little picture: the photo, or a page icon for a PDF. */
function Preview({ doc, className }: { doc: DocumentItem; className?: string }) {
  const src = doc.isPdf ? null : (doc.url ?? doc.thumbUrl)
  return (
    <div className={cn("bg-muted ring-foreground/10 flex shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- the CDN, any host
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <FileTextIcon className="text-primary/70 size-7" aria-hidden />
      )}
    </div>
  )
}

/**
 * My certificates and licences (instructor panel), or an instructor's (admin
 * page, `admin`: view and remove only). Each one: its picture, title, who
 * gave it and when, the description, "Open" for the full file.
 */
export function DocumentsList({ documents, admin = false }: { documents: DocumentItem[]; admin?: boolean }) {
  const t = useTranslations("instructorPanel.documents")
  return (
    <div className="space-y-4">
      {documents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center">
          <AwardIcon className="text-primary/60 size-8" aria-hidden />
          <p className="text-muted-foreground max-w-sm text-sm text-pretty">{admin ? t("emptyAdmin") : t("empty")}</p>
        </div>
      ) : (
        <ul className="divide-y">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
              <Preview doc={d} className="size-20 sm:size-24" />
              <div className="min-w-0 flex-1 space-y-1">
                <Titles title={d.title} />
                <div className="-ms-2 flex flex-wrap items-center gap-1 pt-1">
                  {d.url && (
                    <Button asChild variant="ghost" size="sm">
                      <a href={d.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLinkIcon />
                        {t("open")}
                      </a>
                    </Button>
                  )}
                  {!admin && <EditDocument doc={d} />}
                  <DeleteDocument doc={d} admin={admin} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!admin && documents.length < MAX_DOCUMENTS && <AddDocument />}
    </div>
  )
}

function DeleteDocument({ doc, admin }: { doc: DocumentItem; admin: boolean }) {
  const t = useTranslations("instructorPanel.documents")
  const locale = useLocale()
  const tc = useTranslations("common")
  const router = useRouter()
  const [pending, start] = useTransition()
  function run() {
    start(async () => {
      try {
        const result = await (admin ? adminDeleteDocumentAction : deleteDocumentAction)({ id: doc.id })
        if (!result.ok) return void toast.error(result.error)
        toast.success(t("deleted"))
        router.refresh()
      } catch {
        toast.error(tc("errors.network"))
      }
    })
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="hover:text-destructive" disabled={pending}>
          {pending ? <Spinner /> : <Trash2Icon />}
          {t("delete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deleteDescription", { title: profileText(doc.title, locale) })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={run}>
            {t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function TitleField() {
  const t = useTranslations("instructorPanel.documents.fields")
  return (
    <LocalizedInput
      name="title"
      label={t("title")}
      description={t("titleHint")}
      maxLength={120}
      className="[&_input]:h-11 [&_input]:text-base [&_[data-slot=tabs-list]]:h-10!"
    />
  )
}

function FormButtons({ pending, label }: { pending: boolean; label: string }) {
  const tc = useTranslations("common")
  return (
    <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
      <DialogClose asChild>
        <Button type="button" variant="ghost" size="lg" disabled={pending}>
          {tc("actions.cancel")}
        </Button>
      </DialogClose>
      <SubmitButton pending={pending}>{label}</SubmitButton>
    </div>
  )
}

function EditDocument({ doc }: { doc: DocumentItem }) {
  const t = useTranslations("instructorPanel.documents")
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <PencilIcon />
          {t("edit")}
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("editTitle")}</DialogTitle>
          <DialogDescription>{t("editDescription")}</DialogDescription>
        </DialogHeader>
        {open && <EditForm doc={doc} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({ doc, onDone }: { doc: DocumentItem; onDone: () => void }) {
  const t = useTranslations("instructorPanel.documents")
  const router = useRouter()
  const { form, submit, pending } = useActionForm({
    schema: editDocumentSchema,
    action: editDocumentAction,
    defaultValues: { id: doc.id, title: texts(doc.title) } as EditDocumentValues,
    successMessage: t("saved"),
    onSuccess: () => {
      onDone()
      router.refresh()
    },
  })
  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <TitleField />
      <FormButtons pending={pending} label={t("save")} />
    </Form>
  )
}

function AddDocument() {
  const t = useTranslations("instructorPanel.documents")
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 rounded-xl px-4">
          <FilePlus2Icon />
          {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>{t("addTitle")}</DialogTitle>
          <DialogDescription className="text-pretty">{t("addDescription")}</DialogDescription>
        </DialogHeader>
        {open && <AddForm onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

type Phase = { kind: "idle" } | { kind: "uploading"; progress: number } | { kind: "error"; message: string }

function AddForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("instructorPanel.documents")
  const tp = useTranslations("instructorPanel.profile.photo")
  const { size, error: mediaError } = useMediaText()
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<(UploadResult & { name: string }) | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const { form, submit, pending } = useActionForm({
    schema: addDocumentSchema,
    action: addDocumentAction,
    defaultValues: { path: "", title: { fa: "", tr: "", en: "" } } as AddDocumentValues,
    successMessage: t("added"),
    onSuccess: () => {
      onDone()
      router.refresh()
    },
  })

  async function start(chosen: File) {
    const problem = checkFile(chosen, "instructor_document")
    if (problem) return setPhase({ kind: "error", message: mediaError(problem, "instructor_document") })
    setPhase({ kind: "uploading", progress: 0 })
    try {
      const result = await uploadFile(chosen, "instructor_document", {
        endpoint: "/api/instructor/uploads",
        onProgress: (progress) => setPhase({ kind: "uploading", progress }),
      })
      setFile({ ...result, name: chosen.name })
      form.setValue("path", result.path, { shouldValidate: true, shouldDirty: true })
      setPhase({ kind: "idle" })
    } catch (error) {
      const code = failureCode(error) as ClientUploadError | "rate_limited" | "aborted"
      if (code === "aborted") return setPhase({ kind: "idle" })
      const own = code === "rate_limited" || code === "unauthorized" || code === "storage" || code === "server"
      setPhase({ kind: "error", message: own ? tp(`errors.${code}`) : mediaError(code, "instructor_document") })
    }
  }

  const pdf = file?.contentType === "application/pdf"
  return (
    <Form form={form} onSubmit={submit} className="space-y-5">
      <input
        ref={input}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const chosen = e.target.files?.[0]
          e.target.value = ""
          if (chosen) void start(chosen)
        }}
      />
      {file ? (
        <div className="bg-muted/40 flex items-center gap-3 rounded-xl border p-3">
          <div className="bg-muted flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            {pdf ? (
              <FileTextIcon className="text-primary/70 size-7" aria-hidden />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- the CDN, any host
              <img src={file.url} alt="" className="size-full object-cover" />
            )}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm" dir="auto">
            {file.name}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => input.current?.click()}>
            {t("replace")}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={phase.kind === "uploading"}
          className="hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-ring/50 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center outline-none focus-visible:ring-3 disabled:opacity-70"
        >
          {phase.kind === "uploading" ? <Spinner className="text-primary size-6" /> : <UploadIcon className="text-primary size-6" aria-hidden />}
          <span className="text-sm font-medium">{phase.kind === "uploading" ? t("uploading") : t("choose")}</span>
          <span className="text-muted-foreground text-xs">{t("chooseHint", { size: size(MAX_IMAGE_BYTES) })}</span>
          {phase.kind === "uploading" && <Progress value={Math.round(phase.progress * 100)} className="mt-1 h-1.5 w-40 rtl:-scale-x-100" />}
        </button>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {phase.message}
        </p>
      )}
      {form.formState.errors.path && !file && (
        <p role="alert" className="text-destructive text-sm">
          {t("errors.needFile")}
        </p>
      )}
      <TitleField />
      <p className="text-muted-foreground text-xs text-pretty">{t("privacy")}</p>
      <FormButtons pending={pending || phase.kind === "uploading"} label={t("addConfirm")} />
    </Form>
  )
}
