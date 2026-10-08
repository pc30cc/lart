"use client"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  GripVerticalIcon,
  ImagePlusIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { AnimatePresence, motion, MotionConfig } from "motion/react"
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"
import { useFormatter } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  IMAGE_ACCEPT,
  MAX_IMAGE_BYTES,
  maxUploadBytes,
  videoAccept,
  type UploadResult,
  type UploadTarget,
  type VideoPurpose,
} from "@/lib/storage/shared"
import { cn } from "@/lib/utils"
import { Dropzone, OverlayButton, UploadMessage, UploadOverlay } from "./parts"
import { checkFile, failureCode, fileKind, isVideoFile, uploadFile, useFileDrop, useMediaText, type ClientUploadError } from "./upload-client"

export type MediaItem = Pick<UploadResult, "path" | "url" | "width" | "height"> & {
  kind: "image" | "video"
}

type Pending = {
  id: string
  file: File
  kind: MediaItem["kind"]
  preview: string
  progress: number
  status: "queued" | "uploading" | "error"
  code?: ClientUploadError
  controller: AbortController
}

export type MediaGridProps = {
  /** The items in order (the form field value). */
  value: MediaItem[]
  onChange: (items: MediaItem[]) => void
  /** gallery_photo (watermarked, default), course_sample or site_image (the home page's photos). */
  imagePurpose?: "gallery_photo" | "course_sample" | "site_image"
  /** Accept videos as well. Default: true for the gallery. */
  allowVideos?: boolean
  /** The purpose of videos, when they are allowed: gallery_video unless given. */
  videoPurpose?: VideoPurpose
  /** Whose folder the files go to: the saved workshop, or the slug of a new one. */
  target?: UploadTarget
  max?: number
  disabled?: boolean
  className?: string
}

let lastId = 0

/** Errors worth a retry (the file itself was fine). */
const RETRYABLE: ClientUploadError[] = ["network", "server", "storage", "bad_request", "unauthorized"]
const tile = "relative aspect-square overflow-hidden rounded-xl border bg-muted shadow-xs"

/**
 * A grid of photos (and videos): drop or choose many files at once (they
 * upload one by one with progress), drag or use the arrows to reorder, remove.
 */
export function MediaGrid({
  value,
  onChange,
  imagePurpose = "gallery_photo",
  allowVideos = imagePurpose === "gallery_photo",
  videoPurpose = "gallery_video",
  target,
  max = 200,
  disabled,
  className,
}: MediaGridProps) {
  const { t, size, error } = useMediaText()
  const format = useFormatter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPendingState] = useState<Pending[]>([])
  const [limitNotice, setLimitNotice] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // The upload loop runs across renders, so it reads the latest values from refs.
  const pendingRef = useRef<Pending[]>([])
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const targetRef = useRef(target)
  const running = useRef(false)
  useEffect(() => {
    valueRef.current = value
    onChangeRef.current = onChange
    targetRef.current = target
  })
  useEffect(() => {
    const list = pendingRef
    return () =>
      list.current.forEach((p) => {
        p.controller.abort()
        URL.revokeObjectURL(p.preview)
      })
  }, [])

  const setPending = useCallback((update: (list: Pending[]) => Pending[]) => {
    pendingRef.current = update(pendingRef.current)
    setPendingState(pendingRef.current)
  }, [])
  const patch = useCallback(
    (id: string, changes: Partial<Pending>) => setPending((list) => list.map((p) => (p.id === id ? { ...p, ...changes } : p))),
    [setPending],
  )
  const drop = useCallback(
    (id: string) =>
      setPending((list) =>
        list.filter((p) => {
          if (p.id === id) URL.revokeObjectURL(p.preview)
          return p.id !== id
        }),
      ),
    [setPending],
  )
  const purposeOf = useCallback((kind: MediaItem["kind"]) => (kind === "video" ? videoPurpose : imagePurpose), [imagePurpose, videoPurpose])

  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      for (;;) {
        const item = pendingRef.current.find((p) => p.status === "queued")
        if (!item) break
        patch(item.id, { status: "uploading", progress: 0 })
        try {
          const { path, url, width, height } = await uploadFile(item.file, purposeOf(item.kind), {
            signal: item.controller.signal,
            target: targetRef.current,
            onProgress: (progress) => patch(item.id, { progress }),
          })
          const items = [...valueRef.current, { path, url, width, height, kind: item.kind }]
          valueRef.current = items
          onChangeRef.current(items)
          drop(item.id)
        } catch (failure) {
          const code = failureCode(failure)
          if (code === "aborted") drop(item.id)
          else patch(item.id, { status: "error", code })
        }
      }
    } finally {
      running.current = false
    }
  }, [drop, patch, purposeOf])

  const addFiles = (files: File[]) => {
    const room = Math.max(0, max - valueRef.current.length - pendingRef.current.length)
    setLimitNotice(files.length > room)
    const added = files.slice(0, room).map((file): Pending => {
      const kind = allowVideos && isVideoFile(file) ? "video" : "image"
      const code = checkFile(file, purposeOf(kind)) ?? undefined
      return {
        id: String(++lastId),
        file,
        kind,
        preview: URL.createObjectURL(file),
        progress: 0,
        status: code ? "error" : "queued",
        code,
        controller: new AbortController(),
      }
    })
    if (!added.length) return
    setPending((list) => [...list, ...added])
    void run()
  }

  const { dragging, dropProps } = useFileDrop(addFiles, disabled)
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= value.length) return
    const items = [...value]
    items.splice(to, 0, ...items.splice(from, 1))
    onChange(items)
  }
  const endDrag = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  const reorderProps = (index: number) => ({
    draggable: !disabled,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", String(index))
      setDragIndex(index)
    },
    onDragOver: (event: DragEvent) => {
      if (dragIndex === null) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      setOverIndex(index)
    },
    onDrop: (event: DragEvent) => {
      if (dragIndex === null) return
      event.preventDefault()
      move(dragIndex, index)
      endDrag()
    },
    onDragEnd: endDrag,
  })

  const canAdd = !disabled && value.length + pending.length < max
  const label = (kind: MediaItem["kind"], index: number) =>
    t(kind === "video" ? "upload.videoN" : "upload.photoN", { index: format.number(index + 1) })

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("grid gap-3", className)} {...dropProps}>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={allowVideos ? `${IMAGE_ACCEPT},${videoAccept[videoPurpose]}` : IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          disabled={disabled}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ""
            if (files.length) addFiles(files)
          }}
        />

        {value.length + pending.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t("upload.count", { count: value.length })}</span>
              {value.length > 1 && !disabled && <span className="hidden sm:inline"> · {t("upload.reorder")}</span>}
            </p>
            <Button type="button" variant="outline" size="sm" disabled={!canAdd} onClick={() => inputRef.current?.click()}>
              <PlusIcon />
              {t("upload.add")}
            </Button>
          </div>
        )}

        {limitNotice && (
          <UploadMessage
            tone="info"
            action={
              <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => setLimitNotice(false)}>
                {t("upload.dismiss")}
              </Button>
            }
          >
            {t("upload.limitReached", { max: format.number(max) })}
          </UploadMessage>
        )}

        {value.length + pending.length === 0 ? (
          <Dropzone
            icon={<ImagePlusIcon />}
            title={dragging ? t("upload.dropToUpload") : t(allowVideos ? "upload.chooseMany" : "upload.chooseManyImages")}
            hint={
              <>
                {t("upload.imageHint", { size: size(MAX_IMAGE_BYTES) })}
                {allowVideos && (
                  <>
                    <br />
                    {t(fileKind(videoPurpose) === "webVideo" ? "upload.webVideoHint" : "upload.videoHint", {
                      size: size(maxUploadBytes(videoPurpose)),
                    })}
                  </>
                )}
              </>
            }
            dragging={dragging}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="min-h-48"
          />
        ) : (
          <ul className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", dragging && "rounded-xl ring-3 ring-primary/30 ring-offset-4 ring-offset-background")}>
            <AnimatePresence initial={false}>
              {value.map((item, index) => (
                <motion.li
                  key={item.path}
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.2 }}
                >
                  <div
                    {...reorderProps(index)}
                    className={cn(
                      tile,
                      "group/tile transition-[opacity,box-shadow] duration-200",
                      !disabled && "cursor-grab active:cursor-grabbing",
                      dragIndex === index && "opacity-40",
                      overIndex === index && dragIndex !== index && "ring-3 ring-primary/50",
                    )}
                  >
                    {item.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- CDN URL, any host
                      <img
                        src={item.url}
                        alt={label(item.kind, index)}
                        loading="lazy"
                        draggable={false}
                        className="size-full object-cover transition-transform duration-500 group-hover/tile:scale-[1.03]"
                      />
                    ) : (
                      <>
                        <video
                          src={`${item.url}#t=0.1`}
                          aria-label={label(item.kind, index)}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover"
                        />
                        <span className="pointer-events-none absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm">
                          <PlayIcon className="size-4 fill-current" />
                        </span>
                      </>
                    )}

                    <span className="pointer-events-none absolute start-2 bottom-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
                      {format.number(index + 1)}
                    </span>

                    {!disabled && (
                      <>
                        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2 transition-opacity duration-200 focus-within:opacity-100 sm:opacity-0 sm:group-hover/tile:opacity-100">
                          <span className="flex size-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm" title={t("upload.reorder")}>
                            <GripVerticalIcon className="size-4" />
                          </span>
                          <OverlayButton
                            onClick={() => onChange(value.filter((other) => other.path !== item.path))}
                            aria-label={`${t("upload.remove")}: ${label(item.kind, index)}`}
                            title={t("upload.remove")}
                            className="hover:text-destructive"
                          >
                            <Trash2Icon />
                          </OverlayButton>
                        </div>
                        <div className="absolute end-2 bottom-2 flex gap-1 transition-opacity duration-200 focus-within:opacity-100 sm:opacity-0 sm:group-hover/tile:opacity-100">
                          <OverlayButton
                            size="icon-xs"
                            disabled={index === 0}
                            onClick={() => move(index, index - 1)}
                            aria-label={`${t("upload.moveEarlier")}: ${label(item.kind, index)}`}
                            title={t("upload.moveEarlier")}
                          >
                            <ChevronLeftIcon className="rtl:rotate-180" />
                          </OverlayButton>
                          <OverlayButton
                            size="icon-xs"
                            disabled={index === value.length - 1}
                            onClick={() => move(index, index + 1)}
                            aria-label={`${t("upload.moveLater")}: ${label(item.kind, index)}`}
                            title={t("upload.moveLater")}
                          >
                            <ChevronRightIcon className="rtl:rotate-180" />
                          </OverlayButton>
                        </div>
                      </>
                    )}
                  </div>
                </motion.li>
              ))}

              {pending.map((p) => (
                <motion.li key={p.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                  <div className={cn(tile, p.status === "error" && "border-destructive/40")}>
                    {p.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
                      <img
                        src={p.preview}
                        alt=""
                        className="size-full scale-105 object-cover blur-[2px]"
                        onError={(event) => (event.currentTarget.style.visibility = "hidden")}
                      />
                    ) : (
                      <video src={p.preview} muted playsInline preload="metadata" className="size-full object-cover opacity-70" />
                    )}
                    {p.status === "error" ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 p-3 text-center backdrop-blur-sm">
                        <CircleAlertIcon className="size-5 shrink-0 text-destructive" />
                        <p className="line-clamp-4 text-xs text-pretty text-destructive" role="alert">
                          {error(p.code ?? "server", purposeOf(p.kind))}
                        </p>
                        <div className="flex gap-1">
                          {p.code && RETRYABLE.includes(p.code) && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => {
                                patch(p.id, { status: "queued", code: undefined, progress: 0, controller: new AbortController() })
                                void run()
                              }}
                            >
                              {t("upload.retry")}
                            </Button>
                          )}
                          <Button type="button" size="xs" variant="ghost" onClick={() => drop(p.id)}>
                            {t("upload.dismiss")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <UploadOverlay
                        progress={p.status === "queued" ? 0 : p.progress}
                        label={
                          p.status === "queued"
                            ? t("upload.waiting")
                            : p.progress < 1
                              ? t("upload.uploading", { progress: p.progress })
                              : t(p.kind === "video" ? "upload.processingVideo" : "upload.processingImage")
                        }
                        cancelLabel={t("upload.cancel")}
                        onCancel={() => (p.status === "queued" ? drop(p.id) : p.controller.abort())}
                      />
                    )}
                  </div>
                </motion.li>
              ))}

              {canAdd && (
                <motion.li key="add" layout>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 text-sm text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:bg-muted/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <PlusIcon className="size-5" />
                    {t("upload.add")}
                  </button>
                </motion.li>
              )}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </MotionConfig>
  )
}
