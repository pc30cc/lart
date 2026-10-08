"use client"

import { useEffect } from "react"

/**
 * Fades the home page's sections up as they scroll into view: every element
 * with `data-reveal` (`data-reveal-fade`: fade only; `--reveal-delay` for a
 * stagger). What is already on screen when the page opens stays as it is, so
 * nothing flashes; without JavaScript, or with reduced motion, everything
 * simply shows (theme.css). One observer for the whole page; render it once.
 */
export function RevealObserver() {
  useEffect(() => {
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          ;(entry.target as HTMLElement).dataset.reveal = "in"
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    )
    for (const el of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
      const box = el.getBoundingClientRect()
      if (box.top < window.innerHeight && box.bottom > 0) continue
      el.dataset.reveal = "wait"
      observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])
  return null
}
