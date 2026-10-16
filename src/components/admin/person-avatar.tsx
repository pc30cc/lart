import { UserRoundIcon } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

/**
 * A person's photo, or a person in a circle on a soft tint while there is none (or
 * while it loads, or when it cannot be shown). Decorative: the name is always
 * written next to it, so screen readers skip it (and a `<label>` around it
 * keeps just the name).
 */
export function PersonAvatar({ url, className }: { name: string; url: string | null | undefined; className?: string }) {
  return (
    <Avatar aria-hidden className={cn("size-10", className)}>
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className="bg-primary/10 text-primary/70">
        <UserRoundIcon className="size-[55%]" strokeWidth={1.75} />
      </AvatarFallback>
    </Avatar>
  )
}
