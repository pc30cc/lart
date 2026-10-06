"use client"

import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useMemo, useState } from "react"

import type { FieldControlProps } from "@/components/admin/form/form"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { languageName, teachingLanguageCodes, type TeachingLanguage } from "@/features/instructors/schema"
import { cn } from "@/lib/utils"

/** The site's own languages first, then the rest by name in the UI language. */
const PINNED: readonly string[] = ["fa", "tr", "en"]

/**
 * Multiple choice of teaching languages: a searchable list (names in the UI
 * language, plus each language's own name) and removable chips for the choice.
 */
export function LanguagePicker({
  value,
  onChange,
  onBlur,
  ref,
  id,
  disabled,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: FieldControlProps) {
  const t = useTranslations("instructors.languages")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const selected = (Array.isArray(value) ? value : []) as TeachingLanguage[]

  const options = useMemo(() => {
    const all = teachingLanguageCodes.map((code) => ({
      code,
      name: languageName(code, locale),
      own: languageName(code, code),
    }))
    const rank = (code: string) => (PINNED.includes(code) ? PINNED.indexOf(code) : PINNED.length)
    return all.sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name, locale))
  }, [locale])
  const nameOf = (code: string) => options.find((o) => o.code === code)?.name ?? code

  const toggle = (code: TeachingLanguage) =>
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code])

  return (
    <div className="grid gap-2.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onBlur()
        }}
      >
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="text-muted-foreground h-9 w-full justify-between font-normal sm:max-w-sm"
          >
            {t("placeholder")}
            <ChevronsUpDownIcon className="opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <Command>
            <CommandInput placeholder={t("search")} />
            <CommandList>
              <CommandEmpty>{t("empty")}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const checked = selected.includes(option.code)
                  return (
                    <CommandItem
                      key={option.code}
                      value={option.code}
                      keywords={[option.name, option.own]}
                      onSelect={() => toggle(option.code)}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                        )}
                      >
                        {checked && <CheckIcon className="size-3! stroke-3" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{option.name}</span>
                      {option.own !== option.name && (
                        <span lang={option.code} className="text-muted-foreground truncate text-xs">
                          {option.own}
                        </span>
                      )}
                      {checked && <span className="sr-only">{t("selected")}</span>}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((code) => (
            <li
              key={code}
              className="bg-muted text-foreground animate-in fade-in-0 zoom-in-95 inline-flex h-7 items-center gap-1 rounded-full ps-3 pe-1 text-sm duration-150"
            >
              {nameOf(code)}
              <button
                type="button"
                onClick={() => onChange(selected.filter((c) => c !== code))}
                disabled={disabled}
                aria-label={t("remove", { language: nameOf(code) })}
                className="text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-ring/50 flex size-5 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2"
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
