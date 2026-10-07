"use client"

import { ImageIcon, ImagePlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { useId, useRef, useState, type Ref } from "react"

import { Button } from "@/components/ui/button"
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, type ImagePurpose, type UploadResult } from "@/lib/storage/shared"
import { cn } from "@/lib/utils"
import { Dropzone, OverlayButton, UploadMessage, UploadOverlay } from "./parts"
import { useFileDrop, useMediaText, useSingleUpload, type UploadEndpoint } from "./upload-client"

const frames: Record<ImagePurpose, string> = {
  instructor_photo: "aspect-square w-full max-w-56",
  course_cover: "aspect-video w-full",
  course_sample: "aspect-[4/3] w-full",
  gallery_photo: "aspect-[4/3] w-full",
  watermark_logo: "aspect-[3/1] w-full max-w-md",
  admin_photo: "aspect-square w-full max-w-40",
}

/** Checkerboard behind transparent logos, in the current text colour (works in light and dark). */
const checkerboard = {
  backgroundImage:
    "conic-gradient(color-mix(in oklch, currentColor 9%, transparent) 25%, transparent 0 50%, color-mix(in oklch, currentColor 9%, transparent) 0 75%, transparent 0)",
  backgroundSize: "16px 16px",
}

export type ImageUploadProps = {
  /** Decides processing (crop, size, watermark) and where the file is stored. */
  purpose: ImagePurpose
  /** Storage path (the form field value). */
  value: string | null | undefined
  /** New path after an upload, or null after "Remove". */
  onChange: (path: string | null, result?: UploadResult) => void
  /** URL of the current value (from publicUrl() on the server) to show it before any new upload. */
  previewUrl?: string | null
  /** Upload route: the admin one by default; the instructor panel passes "/api/instructor/uploads". */
  endpoint?: UploadEndpoint
  onBlur?: () => void
  disabled?: boolean
  id?: string
  name?: string
  /** Focus target (react-hook-form focuses the field on errors). */
  ref?: Ref<HTMLButtonElement>
  className?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
}

/**
 * One image: drag and drop or click, preview, progress, replace and remove.
 * Plugs into react-hook-form through value / onChange, e.g.
 * <ImageUpload purpose="course_cover" {...field} previewUrl={coverUrl} />
 */
export function ImageUpload({
  purpose,
  value,
  onChange,
  previewUrl,
  endpoint,
  onBlur,
  disabled,
  id,
  name,
  ref,
  className,
  ...aria
}: ImageUploadProps) {
  const { t, size, error } = useMediaText()
  const inputRef = useRef<HTMLInputElement>(null)
  const messageId = useId()
  const [uploaded, setUploaded] = useState<UploadResult | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const { phase, start, cancel, dismiss } = useSingleUpload(
    purpose,
    (result) => {
      setUploaded(result)
      onChange(result.path, result)
      onBlur?.()
    },
    endpoint,
  )
  const { dragging, dropProps } = useFileDrop((files) => start(files[0]), disabled)

  const url = value ? (uploaded?.path === value ? uploaded.url : previewUrl) || null : null
  const busy = phase.kind === "uploading"
  const choose = () => inputRef.current?.click()
  const isLogo = purpose === "watermark_logo"
  const hint = t(isLogo ? "upload.logoHint" : "upload.imageHint", { size: size(MAX_IMAGE_BYTES) })

  return (
    <div className={cn("grid gap-2", className)} {...dropProps}>
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
      {name && <input type="hidden" name={name} value={value ?? ""} />}

      {busy || url || value ? (
        <div
          className={cn(
            "group/preview relative overflow-hidden rounded-xl border bg-muted text-foreground shadow-xs transition-shadow",
            dragging && "ring-3 ring-primary/40",
            frames[purpose],
          )}
          style={isLogo ? checkerboard : undefined}
        >
          {busy ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
            <img
              src={phase.preview}
              alt=""
              onError={(event) => (event.currentTarget.style.visibility = "hidden")}
              className={cn("size-full scale-105 blur-[2px]", isLogo ? "object-contain p-4" : "object-cover")}
            />
          ) : url && broken !== url ? (
            // eslint-disable-next-line @next/next/no-img-element -- CDN or admin-only URL, any host
            <img
              src={url}
              alt={t("upload.photoAlt")}
              onError={() => setBroken(url)}
              className={cn("size-full animate-in fade-in-0 duration-300", isLogo ? "object-contain p-4" : "object-cover")}
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageIcon className="size-6" />
              <span className="text-xs">{t("upload.uploaded")}</span>
            </div>
          )}

          {busy ? (
            <UploadOverlay
              progress={phase.progress}
              label={phase.progress < 1 ? t("upload.uploading", { progress: phase.progress }) : t("upload.processingImage")}
              cancelLabel={t("upload.cancel")}
              onCancel={cancel}
            />
          ) : (
            <div className="absolute inset-x-0 top-0 flex justify-end gap-1.5 p-2 transition-opacity duration-200 focus-within:opacity-100 sm:opacity-0 sm:group-hover/preview:opacity-100">
              <OverlayButton ref={ref} id={id} onClick={choose} disabled={disabled} aria-label={t("upload.replace")} title={t("upload.replace")} {...aria}>
                <RefreshCwIcon />
              </OverlayButton>
              <OverlayButton
                onClick={() => {
                  setUploaded(null)
                  onChange(null)
                  onBlur?.()
                }}
                disabled={disabled}
                aria-label={t("upload.remove")}
                title={t("upload.remove")}
                className="hover:text-destructive"
              >
                <Trash2Icon />
              </OverlayButton>
            </div>
          )}
        </div>
      ) : (
        <Dropzone
          ref={ref}
          id={id}
          icon={<ImagePlusIcon />}
          title={dragging ? t("upload.dropToUpload") : t("upload.chooseImage")}
          hint={hint}
          dragging={dragging}
          disabled={disabled}
          onClick={choose}
          onBlur={onBlur}
          className={frames[purpose]}
          aria-describedby={cn(aria["aria-describedby"], phase.kind === "error" && messageId) || undefined}
          aria-invalid={aria["aria-invalid"]}
        />
      )}

      {phase.kind === "error" && (
        <UploadMessage
          id={messageId}
          action={
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto p-0 text-destructive"
              onClick={() => (phase.file ? start(phase.file) : dismiss())}
            >
              {phase.file ? t("upload.retry") : t("upload.dismiss")}
            </Button>
          }
        >
          {error(phase.code, purpose)}
        </UploadMessage>
      )}
    </div>
  )
}
