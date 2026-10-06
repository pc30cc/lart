"use client"

import { PrinterIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Opens the browser's print dialog (also "Save as PDF"). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="outline" size="lg" className="px-4" onClick={() => window.print()}>
      <PrinterIcon />
      {label}
    </Button>
  )
}
