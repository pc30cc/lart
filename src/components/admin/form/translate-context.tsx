"use client"

import { createContext, useContext } from "react"

/**
 * Whether the fields in three languages show a "Translate" button: only in
 * the admin panel (its layout provides it), where `translateTextAction` may run.
 */
const TranslateContext = createContext(false)

export function TranslateProvider({ children }: { children: React.ReactNode }) {
  return <TranslateContext.Provider value>{children}</TranslateContext.Provider>
}

export const useCanTranslate = () => useContext(TranslateContext)
