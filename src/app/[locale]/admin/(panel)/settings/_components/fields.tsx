"use client"

import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

/** Radio choices shown as cards (icon, title, one line of help). */
export function ChoiceCards<V extends string>({
  id,
  value,
  onChange,
  choices,
  describedBy,
  className,
}: {
  id: string
  value: V
  onChange: (value: V) => void
  choices: { value: V; title: string; description?: string; icon?: React.ComponentType<{ className?: string }>; lang?: string }[]
  describedBy?: string
  className?: string
}) {
  return (
    <RadioGroup
      id={id}
      value={value}
      onValueChange={(v) => onChange(v as V)}
      aria-describedby={describedBy}
      className={cn("grid gap-3 sm:grid-cols-3", className)}
    >
      {choices.map((choice) => (
        <FieldLabel key={choice.value} htmlFor={`${id}-${choice.value}`} className="cursor-pointer">
          <Field orientation="horizontal">
            {choice.icon && <choice.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />}
            <FieldContent>
              <FieldTitle lang={choice.lang}>{choice.title}</FieldTitle>
              {choice.description && <FieldDescription className="text-start">{choice.description}</FieldDescription>}
            </FieldContent>
            <RadioGroupItem value={choice.value} id={`${id}-${choice.value}`} />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}

/** A card with a title and a line of help, for pages that don't use the two-column FormSection. */
export function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("bg-card ring-foreground/8 space-y-5 rounded-xl p-5 shadow-xs ring-1 md:p-6", className)}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-muted-foreground text-sm text-pretty">{description}</p>}
      </div>
      {children}
    </section>
  )
}
