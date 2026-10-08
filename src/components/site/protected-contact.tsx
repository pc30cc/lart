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
const listeners = new Set<() => void>()
const SIGNS = ["scroll", "pointermove", "pointerdown", "touchstart", "keydown", "focusin"] as const

function arrive() {
  if (present) return
  present = true
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
 * browser writes the link once a person is there. Until then, and without
 * JavaScript, a button stands in for it (`label`, e.g. "Show email address"),
 * which shows it when pressed (a screen reader's user, who may never scroll).
 */
export function ProtectedContact({
  kind,
  code,
  label,
  icon,
  className,
}: {
  kind: "email" | "phone"
  /** `conceal(address)`. */
  code: string
  label: string
  icon?: React.ReactNode
  className?: string
}) {
  const shown = useSyncExternalStore(subscribe, () => present, () => false)
  const value = useMemo(() => (shown ? reveal(code) : ""), [shown, code])

  if (!value) {
    return (
      <button type="button" onClick={arrive} className={cn("cursor-pointer text-start", className)}>
        {icon}
        <span>{label}</span>
      </button>
    )
  }
  const href = kind === "email" ? `mailto:${value}` : `tel:${value.replace(/[^\d+]/g, "")}`
  return (
    <a href={href} className={className}>
      {icon}
      <span dir="ltr">{value}</span>
    </a>
  )
}
