import type { Metadata } from "next"
import { notFound } from "next/navigation"

/** Unknown paths of the panel: its not-found page, inside the panel ((panel)/not-found.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  notFound()
}

export default function CatchAll() {
  notFound()
}
