/**
 * URL search params of a DataTable, parsed and validated on the server:
 * ?q=<search>&sort=<column>&dir=asc|desc&page=<n>&<filter>=<value>
 * Anything unknown or out of range falls back to the defaults.
 */
export type SortDir = "asc" | "desc"

export type TableParams<S extends string = string, F extends string = string> = {
  q: string
  sort: S
  dir: SortDir
  page: number
  pageSize: number
  offset: number
  filters: Partial<Record<F, string>>
}

export type SearchParams = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export function parseTableParams<S extends string, F extends string = never>(
  searchParams: SearchParams,
  options: {
    sort: readonly S[]
    defaultSort: S
    defaultDir?: SortDir
    pageSize?: number
    /** Allowed values per filter key. */
    filters?: { [K in F]: readonly string[] }
  },
): TableParams<S, F> {
  const pageSize = options.pageSize ?? 20
  const q = (first(searchParams.q) ?? "").trim().slice(0, 100)
  const sortParam = first(searchParams.sort)
  const sort = options.sort.includes(sortParam as S) ? (sortParam as S) : options.defaultSort
  const dirParam = first(searchParams.dir)
  const dir: SortDir = dirParam === "asc" || dirParam === "desc" ? dirParam : (options.defaultDir ?? "asc")
  const pageNumber = Number.parseInt(first(searchParams.page) ?? "1", 10)
  const page = Number.isSafeInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 100_000 ? pageNumber : 1

  const filters: Partial<Record<F, string>> = {}
  for (const [key, allowed] of Object.entries(options.filters ?? {}) as [F, readonly string[]][]) {
    const value = first(searchParams[key])
    if (value && allowed.includes(value)) filters[key] = value
  }

  return { q, sort, dir, page, pageSize, offset: (page - 1) * pageSize, filters }
}

/** A safe ILIKE pattern for "contains": escapes %, _ and \ typed by the user. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
