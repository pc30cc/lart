"use client"

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

type Changes = Record<string, string | null>

const NavContext = createContext<{ pending: boolean; navigate: (changes: Changes, resetPage?: boolean) => void } | null>(
  null,
)

function useTableNav() {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error("DataTable parts must be inside <DataTableRoot>")
  return ctx
}

/** Holds URL navigation for the table; the content fades while new rows load. */
export function DataTableRoot({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function navigate(changes: Changes, resetPage = true) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key)
      else next.set(key, value)
    }
    if (resetPage) next.delete("page")
    const query = next.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  return (
    <NavContext.Provider value={{ pending, navigate }}>
      <div
        data-pending={pending || undefined}
        aria-busy={pending}
        className="space-y-3 [&_[data-slot=table-body]]:transition-opacity data-pending:[&_[data-slot=table-body]]:opacity-55"
      >
        {children}
      </div>
    </NavContext.Provider>
  )
}

export type FilterDef = { key: string; label: string; options: { value: string; label: string }[] }

/** Search box (debounced) and filter selects, all kept in the URL. */
export function DataTableToolbar({
  q,
  searchPlaceholder,
  filters = [],
  values = {},
}: {
  q: string
  searchPlaceholder?: string
  filters?: FilterDef[]
  values?: Record<string, string | undefined>
}) {
  const t = useTranslations("common.table")
  const { navigate } = useTableNav()
  const [value, setValue] = useState(q)
  const [syncedQ, setSyncedQ] = useState(q)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Follow the URL when it changes from elsewhere (e.g. "Clear filters").
  if (q !== syncedQ) {
    setSyncedQ(q)
    setValue(q)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  function search(next: string, delay = 350) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => navigate({ q: next.trim() || null }), delay)
  }

  if (!searchPlaceholder && filters.length === 0) return null

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {searchPlaceholder && (
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={value}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            maxLength={100}
            className="bg-card h-9 ps-8 pe-8 [&::-webkit-search-cancel-button]:hidden"
            onChange={(e) => {
              setValue(e.target.value)
              search(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") search(value, 0)
            }}
          />
          {value && (
            <button
              type="button"
              aria-label={t("clearSearch")}
              className="text-muted-foreground hover:text-foreground absolute end-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5"
              onClick={() => {
                setValue("")
                search("", 0)
              }}
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      )}
      {filters.map((filter) => (
        <Select
          key={filter.key}
          value={values[filter.key] ?? "__all"}
          onValueChange={(v) => navigate({ [filter.key]: v === "__all" ? null : v })}
        >
          <SelectTrigger className="bg-card h-9 w-full sm:w-auto sm:min-w-40" aria-label={filter.label}>
            <span className="text-muted-foreground">{filter.label}:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("all")}</SelectItem>
            {filter.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  )
}

/** A sortable column header. Clicking toggles asc/desc; another column starts at asc. */
export function SortButton({
  column,
  active,
  dir,
  children,
}: {
  column: string
  active: boolean
  dir: "asc" | "desc"
  children: React.ReactNode
}) {
  const { navigate } = useTableNav()
  const Icon = !active ? ArrowUpDownIcon : dir === "asc" ? ArrowUpIcon : ArrowDownIcon
  return (
    <button
      type="button"
      onClick={() => navigate({ sort: column, dir: active && dir === "asc" ? "desc" : "asc" })}
      className={cn(
        "hover:text-foreground -mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
      <Icon className={cn("size-3.5", !active && "opacity-50")} />
    </button>
  )
}

/** "1–20 of 57" with previous / next. */
export function DataTablePagination({
  page,
  pages,
  summary,
}: {
  page: number
  pages: number
  summary: string
}) {
  const t = useTranslations("common.table")
  const { navigate, pending } = useTableNav()
  const go = (p: number) => navigate({ page: p > 1 ? String(p) : null }, false)

  return (
    <nav aria-label={t("pagination")} className="flex items-center justify-between gap-3 px-1">
      <p className="text-muted-foreground text-sm tabular-nums">{summary}</p>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" disabled={page <= 1 || pending} onClick={() => go(page - 1)}>
          <ChevronLeftIcon className="rtl:rotate-180" />
          <span className="hidden sm:inline">{t("previous")}</span>
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages || pending} onClick={() => go(page + 1)}>
          <span className="hidden sm:inline">{t("next")}</span>
          <ChevronRightIcon className="rtl:rotate-180" />
        </Button>
      </div>
    </nav>
  )
}

/** Shown when a search or filter matches nothing. */
export function ClearFilters({ keys }: { keys: string[] }) {
  const t = useTranslations("common.table")
  const { navigate } = useTableNav()
  return (
    <Button variant="outline" size="sm" onClick={() => navigate(Object.fromEntries(keys.map((k) => [k, null])))}>
      {t("clearFilters")}
    </Button>
  )
}
