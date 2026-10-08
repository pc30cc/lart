"use client"

import { useLayoutEffect, useRef } from "react"

/** How much of the capitals' height shows above the footer's bottom bar. */
const SHOWN = 0.86
/** Room above the letters, as a share of their height. */
const ABOVE = 0.04
/** The most the wordmark may take in height, as a share of its width. */
const MAX_HEIGHT = 0.3
/** The size the letters are measured at (px). */
const SIZE = 100

/**
 * The brand as a giant wordmark spanning the footer's width, its feet cut off
 * by the bar under it (like throttlehaus.ca's footer); a script without
 * capitals (Persian) shows whole, its dots and tails under the baseline
 * included, or the word would read as another one. The letters are
 * measured (the ink that shows, not their boxes) to fill the width exactly, for any
 * brand and any heading font; before that, and without JavaScript, a guess
 * from the brand's length shows. Decorative: the brand is in the header and
 * in the bottom bar.
 */
export function Wordmark({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null)
  const word = useRef<HTMLSpanElement>(null)
  const baseline = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const wrap = box.current
    const el = word.current
    const probe = baseline.current
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
    if (!wrap || !el || !probe || !canvas) return

    const fit = () => {
      const pad = parseFloat(getComputedStyle(wrap).paddingLeft)
      const width = wrap.clientWidth - 2 * pad
      const css = getComputedStyle(el)
      // The canvas does not apply text-transform: do it here, in the page's language (Turkish İ).
      const letters = css.textTransform === "uppercase" ? text.toLocaleUpperCase(document.documentElement.lang) : text
      const spacing = `${((parseFloat(css.letterSpacing) || 0) * SIZE) / parseFloat(css.fontSize)}px`
      const setup = () => {
        canvas.font = `${css.fontStyle} ${css.fontWeight} ${SIZE}px ${css.fontFamily}`
        canvas.direction = css.direction === "rtl" ? "rtl" : "ltr"
        canvas.textAlign = "left"
        if ("letterSpacing" in canvas) canvas.letterSpacing = spacing
      }
      setup()
      const metrics = canvas.measureText(letters)
      const ascent = metrics.actualBoundingBoxAscent
      const descent = Math.max(0, metrics.actualBoundingBoxDescent)
      if (!width || !ascent) return
      // The share of the height above the baseline that shows: Latin capitals lose their feet,
      // anything else keeps what hangs under its baseline, with the same room under it as above.
      const whole = css.textTransform !== "uppercase"
      const shown = whole ? 1 + descent / ascent : SHOWN
      // The wordmark's height, as a share of the letters' height above the baseline.
      const tall = ABOVE + shown + (whole ? ABOVE : 0)

      // Draw the letters and find where their ink starts and ends in the part that shows
      // (a letter's foot, like R's leg, may reach further out below the cut).
      const x0 = SIZE
      const y0 = Math.ceil(ascent) + 2
      canvas.canvas.width = Math.ceil(metrics.width + 2 * SIZE)
      canvas.canvas.height = y0 + Math.ceil(descent) + 2
      setup()
      canvas.fillText(letters, x0, y0)
      const top = Math.max(0, Math.floor(y0 - ascent))
      const rows = Math.max(1, Math.round(ascent * shown))
      const { data } = canvas.getImageData(0, top, canvas.canvas.width, rows)
      let left = Infinity
      let right = -1
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 96) continue
        const x = ((i - 3) / 4) % canvas.canvas.width
        if (x < left) left = x
        if (x > right) right = x
      }
      if (right < left) return

      // As wide as the page, unless that makes it too tall (a short Persian brand): then it keeps to the start side.
      const scale = Math.min(width / (right - left + 1), (width * MAX_HEIGHT) / (ascent * tall))
      const inkWidth = (right - left + 1) * scale
      el.style.fontSize = `${SIZE * scale}px`
      el.style.left = `${(css.direction === "rtl" ? pad + width - inkWidth : pad) - (left - x0) * scale}px`
      // From just above the letters' top to the cut (or to just under their ink).
      el.style.top = `${ascent * scale * ABOVE - (probe.offsetTop - ascent * scale)}px`
      wrap.style.height = `${ascent * scale * tall}px`
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(wrap)
    document.fonts?.addEventListener("loadingdone", fit)
    return () => {
      observer.disconnect()
      document.fonts?.removeEventListener("loadingdone", fit)
    }
  }, [text])

  // A first guess for the server's HTML: wide capitals take about 0.72em each.
  const length = Array.from(text).length * 0.72
  const guess = `min(${(100 / length).toFixed(2)}vw, ${Math.round(1280 / length)}px)`

  return (
    <div
      ref={box}
      aria-hidden
      className="at-container relative h-[0.66em] overflow-hidden select-none"
      style={{ fontSize: guess }}
    >
      <span
        ref={word}
        className="at-heading absolute -top-[0.2em] left-5 leading-none whitespace-nowrap md:left-10 xl:left-20 ltr:tracking-[0.02em]!"
        style={{ fontSize: guess }}
      >
        {text}
        <span ref={baseline} className="inline-block h-0 w-0 align-baseline" />
      </span>
    </div>
  )
}
