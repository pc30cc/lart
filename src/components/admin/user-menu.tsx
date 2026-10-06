"use client"

import { LogOutIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTransition } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { adminLogoutAction } from "@/lib/auth/actions"

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}

/** Avatar menu with the signed-in admin and "Sign out". */
export function UserMenu({ admin }: { admin: { name: string; email: string } }) {
  const t = useTranslations()
  const [pending, startTransition] = useTransition()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={t("admin.shell.userMenu")}>
          <Avatar size="sm">
            <AvatarFallback className="bg-primary/12 text-primary text-[0.7rem] font-semibold">
              {initials(admin.name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-1.5 font-normal">
          <span className="text-foreground truncate text-sm font-medium">{admin.name}</span>
          <span className="text-muted-foreground truncate text-xs" dir="ltr">
            {admin.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault()
            startTransition(() => adminLogoutAction())
          }}
        >
          {pending ? <Spinner aria-hidden /> : <LogOutIcon />}
          {t("auth.logout.action")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
