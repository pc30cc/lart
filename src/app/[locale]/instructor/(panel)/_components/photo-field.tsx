"use client"

import { ImagePlusIcon, RefreshCwIcon, Trash2Icon, UserRoundIcon, XIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useId, useRef, useState } from "react"

import type { FieldControlProps } from "@/components/admin/form/form"
import { Dropzone, UploadMessage } from "@/components/admin/upload/parts"
import { checkFile, useFileDrop, useMediaText, type ClientUploadError } from "@/components/admin/upload/upload-client"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, type UploadResult } from "@/lib/storage/shared"

type Problem = ClientUploadError | "rate_limited"
type Phase = { kind: "idle" } | { kind: "uploading"; preview: string; progress: number } | { kind: "error"; code: Problem; file?: File }

/** Codes the media texts word for admins: the panel says them in its own words. */
const OWN_MESSAGES = new Set<Problem>(["unauthorized", "storage", "server", "rate_limited"])

/** One POST to the instructor's own upload route, with upload progress (fetch cannot report it). */
function send(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/instructor/uploads")
    xhr.responseType = "json"
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total)
    xhr.onload = () => {
      const body = xhr.response as (UploadResult & { error?: Problem }) | null
      if (xhr.status === 201 && body?.path) resolve(body)
      else reject(body?.error ?? (xhr.status === 413 ? "too_large" : "server"))
    }
    xhr.onerror = () => reject("network")
    xhr.onabort = () => reject("aborted")
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    // The purpose first, then the file: the server streams the file.
    const form = new FormData()
    form.append("purpose", "instructor_photo")
    form.append("file", file, file.name)
    xhr.send(form)
  })
}

/**
 * The profile photo: a round preview, "Choose a photo" (or drop one), replace
 * and remove. Uploads to `/api/instructor/uploads`, which crops it square; the
 * field's value is the storage path, saved with the profile.
 */
export function PhotoField({
  value,
  onChange,
  onBlur,
  ref,
  id,
  disabled,
  previewUrl,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: FieldControlProps & { previewUrl: string | null }) {
  const t = useTranslations("instructorPanel.profile.photo")
  const { size, error: mediaError } = useMediaText()
  const inputRef = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const messageId = useId()
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [uploaded, setUploaded] = useState<UploadResult | null>(null)
  const path = typeof value === "string" ? value : null
  const url = path ? (uploaded?.path === path ? uploaded.url : previewUrl) : null

  useEffect(() => () => controller.current?.abort(), [])

  async function start(file: File) {
    const problem = checkFile(file, "instructor_photo")
    if (problem) return setPhase({ kind: "error", code: problem })
    controller.current?.abort()
    const own = new AbortController()
    controller.current = own
    const preview = URL.createObjectURL(file)
    setPhase({ kind: "uploading", preview, progress: 0 })
    try {
      const result = await send(file, (progress) => setPhase((p) => (p.kind === "uploading" ? { ...p, progress } : p)), own.signal)
      if (controller.current !== own) return
      setUploaded(result)
      setPhase({ kind: "idle" })
      onChange(result.path)
      onBlur()
    } catch (code) {
      if (controller.current !== own) return
      setPhase(code === "aborted" ? { kind: "idle" } : { kind: "error", code: code as Problem, file })
    } finally {
      URL.revokeObjectURL(preview)
    }
  }

  const { dragging, dropProps } = useFileDrop((files) => void start(files[0]), disabled)
  const choose = () => inputRef.current?.click()
  const busy = phase.kind === "uploading"
  const message =
    phase.kind === "error" ? (OWN_MESSAGES.has(phase.code) ? t(`errors.${phase.code}`) : mediaError(phase.code as ClientUploadError, "instructor_photo")) : null

  return (
    <div className="grid gap-3" {...dropProps}>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) void start(file)
        }}
      />
      {busy || path ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="bg-muted text-muted-foreground flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/5">
            {busy || url ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview or the CDN, any host
              <img
                src={busy ? phase.preview : (url ?? "")}
                alt={busy ? "" : t("alt")}
                className={busy ? "size-full scale-105 object-cover blur-[2px]" : "animate-in fade-in-0 size-full object-cover"}
              />
            ) : (
              <UserRoundIcon className="size-10" aria-hidden />
            )}
          </div>
          {busy ? (
            <div className="min-w-40 flex-1 space-y-2.5">
              <p aria-live="polite" className="text-muted-foreground text-sm">
                {phase.progress < 1 ? t("uploading", { progress: phase.progress }) : t("processing")}
              </p>
              <Progress value={Math.round(phase.progress * 100)} className="h-1.5 max-w-60 rtl:-scale-x-100" />
              <Button type="button" variant="ghost" className="-ms-2.5 h-10 px-2.5" onClick={() => controller.current?.abort()}>
                <XIcon />
                {t("cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button ref={ref} id={id} type="button" variant="outline" className="h-11 rounded-xl px-4" onClick={choose} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy}>
                <RefreshCwIcon />
                {t("replace")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="hover:text-destructive h-11 rounded-xl px-4"
                disabled={disabled}
                onClick={() => {
                  setUploaded(null)
                  onChange(null)
                  onBlur()
                }}
              >
                <Trash2Icon />
                {t("remove")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Dropzone
          ref={ref}
          id={id}
          icon={dragging ? <ImagePlusIcon /> : <UserRoundIcon />}
          title={t(dragging ? "drop" : "choose")}
          hint={t("hint", { size: size(MAX_IMAGE_BYTES) })}
          dragging={dragging}
          disabled={disabled}
          onClick={choose}
          onBlur={onBlur}
          className="max-w-sm"
          aria-invalid={invalid}
          aria-describedby={[describedBy, message && messageId].filter(Boolean).join(" ") || undefined}
        />
      )}
      {message && phase.kind === "error" && (
        <UploadMessage
          id={messageId}
          action={
            <Button
              type="button"
              variant="link"
              size="xs"
              className="text-destructive h-auto p-0"
              onClick={() => (phase.file ? void start(phase.file) : setPhase({ kind: "idle" }))}
            >
              {t(phase.file ? "retry" : "dismiss")}
            </Button>
          }
        >
          {message}
        </UploadMessage>
      )}
    </div>
  )
}
