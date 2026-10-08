"use client"

import { useMemo, useSyncExternalStore } from "react"

import { reveal } from "@/lib/conceal"
import { cn } from "@/lib/utils"

/**
 * Whether a person is on the page: the first scroll, pointer move, touch, key
 * press or focus says so (address harvesters only read the page). Shared by
 * every contact on the page, and kept while moving around the site.
 */
let present = false
/** When the person was first seen: a click right after it is the one that showed the address, not one to follow it. */
let arrivedAt = 0
const listeners = new Set<() => void>()
const SIGNS = ["scroll", "pointermove", "pointerdown", "touchstart", "keydown", "focusin"] as const

function arrive() {
  if (present) return
  present = true
  arrivedAt = Date.now()
  for (const sign of SIGNS) window.removeEventListener(sign, arrive, true)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!present && listeners.size === 1) {
    for (const sign of SIGNS) window.addEventListener(sign, arrive, { capture: true, passive: true })
  }
  return () => {
    listeners.delete(listener)
  }
}

/**
 * An email address or phone number that spam harvesters cannot read: the
 * page (its HTML and data) holds it only concealed (lib/conceal), and the
 * browser writes the link once a person is there. Until then a stand-in
 * (`label`, e.g. "Show email address") shows it when pressed: a screen
 * reader's user may never scroll. One element throughout, so focus stays on
 * it when the address appears, and the press (or touch) that shows it never
 * also opens the mail app or the dialer. Without JavaScript nothing is shown
 * (the stand-in could not work).
 */
export function ProtectedContact({
  kind,
  code,
  label,
  icon,
  className,
  valueClassName,
}: {
  kind: "email" | "phone"
  /** `conceal(address)`. */
  code: string
  label: string
  icon?: React.ReactNode
  className?: string
  /** The address's own text (e.g. a phone number that must not break). */
  valueClassName?: string
}) {
  const shown = useSyncExternalStore(subscribe, () => present, () => false)
  const value = useMemo(() => (shown ? reveal(code) : ""), [shown, code])
  const href = value ? (kind === "email" ? `mailto:${value}` : `tel:${value.replace(/[^\d+]/g, "")}`) : undefined

  return (
    <a
      href={href}
      role={href ? undefined : "button"}
      tabIndex={href ? undefined : 0}
      onClick={(event) => {
        if (!href) {
          arrivedAt ||= Date.now()
          arrive()
        }
        // The press that showed it: show, do not follow.
        if (!href || Date.now() - arrivedAt < 700) event.preventDefault()
      }}
      onKeyDown={(event) => {
        if (href || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        arrive()
      }}
      className={cn(!href && "cursor-pointer [@media(scripting:none)]:hidden", className)}
    >
      {icon}
      {value ? (
        <span dir="ltr" className={valueClassName}>
          {value}
        </span>
      ) : (
        <span>{label}</span>
      )}
    </a>
  )
}
