"use client"

import { createContext, useContext } from "react"

/**
 * Who may press "Translate" by the fields in three languages, which picks the
 * server action that runs it: the admin panel, the instructor panel, or the
 * instructor sign-up form (rate limited per network). Each one's layout or
 * page provides it; without a provider the button is not shown.
 */
export type TranslateAudience = "admin" | "instructor" | "signup"

const TranslateContext = createContext<TranslateAudience | null>(null)

export function TranslateProvider({ audience, children }: { audience: TranslateAudience; children: React.ReactNode }) {
  return <TranslateContext.Provider value={audience}>{children}</TranslateContext.Provider>
}

export const useTranslateAudience = () => useContext(TranslateContext)
