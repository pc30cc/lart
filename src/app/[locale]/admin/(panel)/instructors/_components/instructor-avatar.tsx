import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

/** First letters of the first two words: "Elif Yılmaz" → "EY". */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase())
    .join("")
}

/** The instructor's photo, or their initials on a soft tint while there is none. */
export function InstructorAvatar({ name, url, className }: { name: string; url: string | null; className?: string }) {
  return (
    <Avatar className={cn("size-10", className)}>
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className="bg-primary/10 text-primary font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
