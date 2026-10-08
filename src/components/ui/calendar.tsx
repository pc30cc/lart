"use client"

import * as React from "react"
import {
  addMonths,
  addYears,
  differenceInCalendarMonths,
  eachMonthOfInterval,
  eachYearOfInterval,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  getMonth,
  getWeek,
  getYear,
  isSameMonth,
  isSameYear,
  setMonth,
  setYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns-jalali"
import { faIR as jalaliFaIR } from "date-fns-jalali/locale"
import { useLocale } from "next-intl"
import {
  DateLib,
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type DayPickerLocale,
} from "react-day-picker"
import { enGB, faIR, tr } from "react-day-picker/locale"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

/**
 * Persian in the Solar Hijri (Jalali) calendar, as every date of the app in
 * Persian (lib/format): Jalali months and years from date-fns-jalali, weeks
 * from Saturday, Persian digits, DayPicker's Persian labels. The day the
 * picker returns is an ordinary Date, so stored values stay Gregorian ISO.
 */
const persian: DayPickerLocale = { ...jalaliFaIR, labels: faIR.labels }
// The functions that depend on the calendar's months and years; days and weeks are the same in both.
const jalali = {
  addMonths,
  addYears,
  differenceInCalendarMonths,
  eachMonthOfInterval,
  eachYearOfInterval,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  getMonth,
  getWeek,
  getYear,
  isSameMonth,
  isSameYear,
  setMonth,
  setYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
}
const jalaliLib = new DateLib({ locale: persian, numerals: "arabext", weekStartsOn: 6 }, jalali)

/** What each language's calendar needs: its locale, digits, direction and date library. */
function calendarProps(appLocale: string) {
  if (appLocale === "fa") {
    return { locale: persian, numerals: "arabext" as const, dir: "rtl" as const, dateLib: jalaliLib, weekStartsOn: 6 as const }
  }
  return { locale: appLocale === "en" ? enGB : tr, dir: "ltr" as const, weekStartsOn: 1 as const }
}

/** A day's own date as "YYYY-MM-DD" (Gregorian), whatever the calendar shows: `data-day`, for tests. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** `Omit` for each member of a union (DayPicker's props differ by `mode`). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * The app's date picker, in the page's language and its calendar (Persian:
 * Jalali; Turkish, English: Gregorian). The language comes from next-intl;
 * callers do not pass a locale.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: DistributiveOmit<React.ComponentProps<typeof DayPicker>, "locale" | "numerals" | "dir" | "dateLib" | "weekStartsOn"> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()
  const appLocale = useLocale()
  const own = calendarProps(appLocale)

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)] group/calendar bg-background in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      {...own}
      formatters={{
        // "مهر ۱۴۰۵", "Ekim 2026", "October 2026": month then year, in the calendar's own months.
        formatCaption: (month, _options, lib) => (lib ?? new DateLib()).format(month, "LLLL y"),
        formatMonthDropdown: (month, lib) => (lib ?? new DateLib()).format(month, appLocale === "fa" ? "LLLL" : "LLL"),
        // Persian weekdays as one letter (ش ی د س چ پ ج), as Persian calendars write them.
        ...(appLocale === "fa" ? { formatWeekdayName: (date: Date, _options?: unknown, lib?: DateLib) => (lib ?? jalaliLib).format(date, "ccccc") } : {}),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "has-focus:border-ring border-input has-focus:ring-ring/50 border has-focus:ring-3 relative rounded-(--cell-radius)",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute inset-0 bg-popover opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "font-medium select-none",
          captionLayout === "label"
            ? "text-sm"
            : "h-6 pe-1 ps-1.5 flex items-center gap-1 rounded-(--cell-radius) text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
          defaultClassNames.caption_label
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 rounded-(--cell-radius) text-[0.8rem] font-normal text-muted-foreground select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-(--cell-size) select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-[0.8rem] text-muted-foreground select-none",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-e-(--cell-radius)",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-s-(--cell-radius)"
            : "[&:first-child[data-selected=true]_button]:rounded-s-(--cell-radius)",
          defaultClassNames.day
        ),
        range_start: cn(
          "relative isolate z-0 rounded-s-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:end-0 after:w-4 after:bg-muted",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn(
          "relative isolate z-0 rounded-e-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:start-0 after:w-4 after:bg-muted",
          defaultClassNames.range_end
        ),
        today: cn(
          "rounded-(--cell-radius) bg-muted text-foreground data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon
                className={cn("rtl:rotate-180 size-4", className)}
                {...props}
              />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("rtl:rotate-180 size-4", className)}
                {...props}
              />
            )
          }

          return (
            <ChevronDownIcon
              className={cn("size-4", className)}
              {...props}
            />
          )
        },
        DayButton: ({ ...props }) => <CalendarDayButton {...props} />,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...(props as React.ComponentProps<typeof DayPicker>)}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={isoDay(day.date)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-ring/50 data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-e-(--cell-radius) data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-s-(--cell-radius) data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-foreground [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
