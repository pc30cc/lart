import { notFound } from "next/navigation"

// Unknown paths under a language show the friendly, translated not-found page.
export default function CatchAll() {
  notFound()
}
