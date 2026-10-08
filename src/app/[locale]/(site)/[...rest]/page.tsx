import type { Metadata } from "next"
import { notFound } from "next/navigation"

/**
 * Unknown paths under a language: the site's not-found page, inside the
 * site's frame ((site)/not-found.tsx). Its metadata throws too, so the title
 * is the not-found page's on the server and in the browser alike.
 */
export async function generateMetadata(): Promise<Metadata> {
  notFound()
}

export default function CatchAll() {
  notFound()
}
