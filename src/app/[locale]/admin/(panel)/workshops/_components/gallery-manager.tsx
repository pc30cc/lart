"use client"

import { CheckIcon, CloudAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { MediaGrid, type MediaItem } from "@/components/admin/upload"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { saveGallery } from "@/features/workshops/actions"

type SaveState = "idle" | "saving" | "saved" | "error"

/**
 * The gallery of a closed workshop. Every change (an upload finishing, a
 * reorder, a removal) is saved right away; the latest list always wins.
 */
export function GalleryManager({ id, initial }: { id: string; initial: MediaItem[] }) {
  const t = useTranslations("workshops.gallery")
  const tc = useTranslations("common")
  const [items, setItems] = useState(initial)
  const [state, setState] = useState<SaveState>("idle")
  const latest = useRef(0)

  async function save(next: MediaItem[]) {
    setItems(next)
    setState("saving")
    const run = ++latest.current
    try {
      const result = await saveGallery({
        id,
        items: next.map((item) =>
          item.kind === "video"
            ? { kind: "video" as const, path: item.path }
            : { kind: "image" as const, path: item.path, originalPath: item.originalPath, width: item.width, height: item.height },
        ),
      })
      if (run !== latest.current || !result) return
      if (result.ok) setState("saved")
      else {
        setState("error")
        toast.error(result.error)
      }
    } catch {
      if (run !== latest.current) return
      setState("error")
      toast.error(tc("errors.network"))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-8 items-center justify-end gap-2 text-sm" aria-live="polite">
        {state === "saving" && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            <Spinner aria-hidden className="size-3.5" />
            {t("saving")}
          </span>
        )}
        {state === "saved" && (
          <span className="text-success inline-flex items-center gap-1.5">
            <CheckIcon className="size-4" />
            {t("saved")}
          </span>
        )}
        {state === "error" && (
          <>
            <span className="text-destructive inline-flex items-center gap-1.5">
              <CloudAlertIcon className="size-4" />
              {t("notSaved")}
            </span>
            <Button size="sm" variant="outline" onClick={() => void save(items)}>
              {t("retry")}
            </Button>
          </>
        )}
      </div>
      <MediaGrid value={items} onChange={(next) => void save(next)} imagePurpose="gallery_photo" allowVideos max={200} />
    </div>
  )
}
