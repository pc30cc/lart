"use client"

import { PauseIcon, PlayIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/** A photo behind a section's words: a URL, its size and the point that stays in view. */
export type HeroImage = { src: string; width?: number; height?: number; focus?: string }
/** The same with its description (a section's photo; the hero's are never described). */
export type HeroPhoto = HeroImage & { alt: string }

/** How long each photo shows, and how long two of them cross-fade (ms). */
const SLIDE_MS = 7000
const FADE_MS = 1800

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * The hero's background, filling its section: photos in turn (a slow
 * cross-fade and a gentle zoom, about 7 seconds each) or a looping silent
 * video, with a small button to pause and play them (WCAG 2.2.2). With
 * reduced motion the first photo (or the video's poster) stands still, the
 * video is never downloaded and the button is not needed. Only the first
 * photo loads with the page; the others follow once the page has settled, so
 * they never slow down its first paint. The photos are a backdrop behind the
 * hero's words: decorative (alt=""), whatever the admin uploads.
 */
export function HeroMedia({
  photos,
  video,
  labels,
}: {
  photos: HeroImage[]
  video?: { url: string; poster: HeroImage }
  labels: { pause: string; play: string }
}) {
  const [paused, setPaused] = useState(false)
  const moving = Boolean(video) || photos.length > 1

  return (
    <>
      {video ? <HeroVideo url={video.url} poster={video.poster} paused={paused} /> : <HeroSlides photos={photos} paused={paused} />}
      {moving && (
        // Above the veil (-z-10), on the end side of the page's column, out of the words' way.
        <div className="at-container pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-end motion-reduce:hidden sm:bottom-8">
          <button
            type="button"
            aria-label={paused ? labels.play : labels.pause}
            title={paused ? labels.play : labels.pause}
            onClick={() => setPaused((p) => !p)}
            className="border-at-cream/50 text-at-cream hover:bg-at-cream/15 focus-visible:ring-at-cream/70 pointer-events-auto flex size-11 items-center justify-center rounded-full border bg-[rgb(24_12_6/0.28)] backdrop-blur-sm transition-colors outline-none focus-visible:ring-3"
          >
            {paused ? (
              <PlayIcon className="size-3.5 translate-x-px fill-current" aria-hidden />
            ) : (
              <PauseIcon className="size-3.5 fill-current" aria-hidden />
            )}
          </button>
        </div>
      )}
    </>
  )
}

function HeroSlides({ photos, paused }: { photos: HeroImage[]; paused: boolean }) {
  const [{ active, previous }, setSlide] = useState({ active: 0, previous: -1 })
  const [loadAll, setLoadAll] = useState(false)
  const many = photos.length > 1

  useEffect(() => {
    if (!many || paused || reducedMotion()) return
    const load = window.setTimeout(() => setLoadAll(true), 1500)
    const timer = window.setInterval(
      () => setSlide((slide) => ({ active: (slide.active + 1) % photos.length, previous: slide.active })),
      SLIDE_MS,
    )
    return () => {
      window.clearTimeout(load)
      window.clearInterval(timer)
    }
  }, [many, paused, photos.length])

  return (
    <div className="absolute inset-0 -z-20 overflow-hidden">
      {photos.map((photo, i) => {
        if (i > 0 && !loadAll) return null
        const shown = i === active
        // The zoom keeps running while a photo fades out, so it never jumps back.
        const zooming = shown || i === previous
        return (
          // eslint-disable-next-line @next/next/no-img-element -- bundled or CDN photo, any size
          <img
            key={photo.src}
            src={photo.src}
            alt=""
            width={photo.width}
            height={photo.height}
            decoding={i === 0 ? "sync" : "async"}
            loading="eager"
            fetchPriority={i === 0 ? "high" : "low"}
            // Paused, the zoom stops where it is (inline: the animation's shorthand would reset a class).
            style={{ objectPosition: photo.focus, transitionDuration: `${FADE_MS}ms`, animationPlayState: paused ? "paused" : undefined }}
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity ease-in-out will-change-[opacity,transform]",
              shown ? "opacity-100" : "opacity-0",
              many && zooming && "motion-safe:animate-[at-ken-burns_10s_ease-out_both]",
            )}
          />
        )
      })}
    </div>
  )
}

function HeroVideo({ url, poster, paused }: { url: string; poster: HeroImage; paused: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)

  // Autoplay starts before the page is interactive. Paused (or with reduced motion, in a browser
  // that ignores the source's `media`) it stops on the frame it shows; played again, it goes on.
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (paused || reducedMotion()) v.pause()
    else if (v.paused) v.play().catch(() => {})
  }, [paused])

  return (
    <div className="absolute inset-0 -z-20 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled or CDN photo, any size */}
      <img
        src={poster.src}
        alt=""
        width={poster.width}
        height={poster.height}
        fetchPriority="high"
        style={{ objectPosition: poster.focus }}
        className="absolute inset-0 size-full object-cover"
      />
      <video
        ref={ref}
        poster={poster.src}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
        className="absolute inset-0 size-full object-cover motion-reduce:hidden"
      >
        {/* Only without reduced motion: otherwise no source matches and the file is never fetched (the poster shows). */}
        <source src={url} media="(prefers-reduced-motion: no-preference)" />
      </video>
    </div>
  )
}
