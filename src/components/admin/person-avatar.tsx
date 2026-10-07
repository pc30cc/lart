import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

/**
 * First letters of the first two words: "Elif Yılmaz" → "EY". A zero-width
 * non-joiner keeps Persian letters apart ("م‌ر", not the word "مر").
 */
export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase())
      .join("‌") || "?"
  )
}

/**
 * A person's photo, or their initials on a soft tint while there is none (or
 * while it loads, or when it cannot be shown). Decorative: the name is always
 * written next to it, so screen readers skip it (and a `<label>` around it
 * keeps just the name).
 */
export function PersonAvatar({ name, url, className }: { name: string; url: string | null | undefined; className?: string }) {
  return (
    <Avatar aria-hidden className={cn("size-10", className)}>
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className="bg-primary/10 text-primary font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
