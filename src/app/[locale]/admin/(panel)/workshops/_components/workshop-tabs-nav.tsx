"use client"

import { useEffect, useRef } from "react"

/**
 * The scrolling strip of workshop tabs: on a narrow screen it scrolls the
 * active tab into view (in either direction, so RTL works too) without
 * moving the page vertically.
 */
export function WorkshopTabsNav({ label, active, children }: { label: string; active: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [active])
  return (
    <nav ref={ref} aria-label={label} className="-mx-4 scroll-px-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      {children}
    </nav>
  )
}
