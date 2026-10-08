"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/** One photo of the hero: a URL, its description and the point that stays in view. */
export type HeroPhoto = { src: string; alt: string; width?: number; height?: number; focus?: string }

/** How long each photo shows, and how long two of them cross-fade (ms). */
const SLIDE_MS = 7000
const FADE_MS = 1800

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * The hero's background, filling its section: photos in turn (a slow
 * cross-fade and a gentle zoom, about 7 seconds each) or a looping silent
 * video. With reduced motion the first photo (or the video's poster) stands
 * still. Only the first photo loads with the page; the others follow once the
 * page has settled, so they never slow down its first paint.
 */
export function HeroMedia({ photos, video }: { photos: HeroPhoto[]; video?: { url: string; poster: HeroPhoto } }) {
  if (video) return <HeroVideo url={video.url} poster={video.poster} />
  return <HeroSlides photos={photos} />
}

function HeroSlides({ photos }: { photos: HeroPhoto[] }) {
  const [{ active, previous }, setSlide] = useState({ active: 0, previous: -1 })
  const [loadAll, setLoadAll] = useState(false)
  const many = photos.length > 1

  useEffect(() => {
    if (!many || reducedMotion()) return
    const load = window.setTimeout(() => setLoadAll(true), 1500)
    const timer = window.setInterval(
      () => setSlide((slide) => ({ active: (slide.active + 1) % photos.length, previous: slide.active })),
      SLIDE_MS,
    )
    return () => {
      window.clearTimeout(load)
      window.clearInterval(timer)
    }
  }, [many, photos.length])

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
            alt={i === 0 ? photo.alt : ""}
            width={photo.width}
            height={photo.height}
            decoding={i === 0 ? "sync" : "async"}
            loading="eager"
            fetchPriority={i === 0 ? "high" : "low"}
            style={{ objectPosition: photo.focus, transitionDuration: `${FADE_MS}ms` }}
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

function HeroVideo({ url, poster }: { url: string; poster: HeroPhoto }) {
  const ref = useRef<HTMLVideoElement>(null)

  // Autoplay starts before the page is interactive; stop it for reduced motion (the poster shows instead).
  useEffect(() => {
    if (reducedMotion()) ref.current?.pause()
  }, [])

  return (
    <div className="absolute inset-0 -z-20 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled or CDN photo, any size */}
      <img
        src={poster.src}
        alt={poster.alt}
        width={poster.width}
        height={poster.height}
        fetchPriority="high"
        style={{ objectPosition: poster.focus }}
        className="absolute inset-0 size-full object-cover"
      />
      <video
        ref={ref}
        src={url}
        poster={poster.src}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
        className="absolute inset-0 size-full object-cover motion-reduce:hidden"
      />
    </div>
  )
}
