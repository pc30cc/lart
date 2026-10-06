"use client"

import { FilmIcon, RefreshCwIcon, Trash2Icon, VideoIcon } from "lucide-react"
import { useId, useRef, useState, type Ref } from "react"

import { Button } from "@/components/ui/button"
import { MAX_VIDEO_BYTES, VIDEO_ACCEPT, type UploadResult } from "@/lib/storage/shared"
import { cn } from "@/lib/utils"
import { Dropzone, OverlayButton, UploadMessage, UploadOverlay } from "./parts"
import { useFileDrop, useMediaText, useSingleUpload } from "./upload-client"

export type VideoUploadProps = {
  /** Storage path (the form field value). */
  value: string | null | undefined
  onChange: (path: string | null, result?: UploadResult) => void
  /** URL of the current value (from publicUrl() on the server). */
  previewUrl?: string | null
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

/** One video (MP4, MOV or WebM, stored as a plain CDN file): drag and drop or click, progress, replace and remove. */
export function VideoUpload({ value, onChange, previewUrl, onBlur, disabled, id, name, ref, className, ...aria }: VideoUploadProps) {
  const { t, size, error } = useMediaText()
  const inputRef = useRef<HTMLInputElement>(null)
  const messageId = useId()
  const [uploaded, setUploaded] = useState<UploadResult | null>(null)
  const { phase, start, cancel, dismiss } = useSingleUpload("gallery_video", (result) => {
    setUploaded(result)
    onChange(result.path, result)
    onBlur?.()
  })
  const { dragging, dropProps } = useFileDrop((files) => start(files[0]), disabled)

  const url = value ? (uploaded?.path === value ? uploaded.url : previewUrl) || null : null
  const choose = () => inputRef.current?.click()

  return (
    <div className={cn("grid gap-2", className)} {...dropProps}>
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_ACCEPT}
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

      {phase.kind === "uploading" ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border bg-black shadow-xs">
          <video src={phase.preview} muted playsInline preload="metadata" className="size-full object-contain opacity-60" />
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3 text-xs text-white/90">
            <FilmIcon className="size-4 shrink-0" />
            <span className="truncate font-medium" dir="auto">
              {phase.file.name}
            </span>
            <span className="ms-auto shrink-0 tabular-nums text-white/70">{size(phase.file.size)}</span>
          </div>
          <UploadOverlay
            progress={phase.progress}
            label={phase.progress < 1 ? t("upload.uploading", { progress: phase.progress }) : t("upload.processingVideo")}
            cancelLabel={t("upload.cancel")}
            onCancel={cancel}
          />
        </div>
      ) : value ? (
        <div className={cn("group/preview relative aspect-video w-full overflow-hidden rounded-xl border bg-black shadow-xs", dragging && "ring-3 ring-primary/40")}>
          {url ? (
            <video src={url} controls playsInline preload="metadata" className="size-full object-contain animate-in fade-in-0 duration-300" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-white/70">
              <VideoIcon className="size-6" />
              <span className="text-xs">{t("upload.uploaded")}</span>
            </div>
          )}
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
        </div>
      ) : (
        <Dropzone
          ref={ref}
          id={id}
          icon={<VideoIcon />}
          title={dragging ? t("upload.dropToUpload") : t("upload.chooseVideo")}
          hint={t("upload.videoHint", { size: size(MAX_VIDEO_BYTES) })}
          dragging={dragging}
          disabled={disabled}
          onClick={choose}
          onBlur={onBlur}
          className="aspect-video"
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
          {error(phase.code, "gallery_video")}
        </UploadMessage>
      )}
    </div>
  )
}
