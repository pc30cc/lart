"use client"

import { KeyRoundIcon, LogOutIcon, UserRoundPenIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"

import { ChangePasswordDialog } from "@/components/admin/change-password-dialog"
import { PersonAvatar } from "@/components/admin/person-avatar"
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
import { Link } from "@/i18n/navigation"
import { adminLogoutAction } from "@/lib/auth/actions"

/** Avatar menu with the signed-in admin, "My profile", "Change password" and "Sign out". */
export function UserMenu({ admin }: { admin: { name: string; email: string; photoUrl?: string | null } }) {
  const t = useTranslations()
  const [pending, startTransition] = useTransition()
  const [changingPassword, setChangingPassword] = useState(false)

  return (
    <>
      {/* Non-modal, so the password dialog can take focus cleanly. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full" aria-label={t("admin.shell.userMenu")}>
            <PersonAvatar name={admin.name} url={admin.photoUrl} className="size-7 text-[0.7rem] font-semibold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-56">
          <DropdownMenuLabel className="flex items-center gap-2.5 py-1.5 font-normal">
            <PersonAvatar name={admin.name} url={admin.photoUrl} className="size-9 text-xs" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-foreground truncate text-sm font-medium">{admin.name}</span>
              <span className="text-muted-foreground truncate text-xs rtl:text-right" dir="ltr">
                {admin.email}
              </span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/admin/profile">
              <UserRoundPenIcon />
              {t("partners.menu.profile")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setChangingPassword(true)}>
            <KeyRoundIcon />
            {t("auth.password.menu")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pending}
            onSelect={(event) => {
              event.preventDefault()
              startTransition(() => adminLogoutAction())
            }}
          >
            {pending ? <Spinner aria-hidden /> : <LogOutIcon className="rtl:-scale-x-100" />}
            {t("auth.logout.action")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog email={admin.email} open={changingPassword} onOpenChange={setChangingPassword} />
    </>
  )
}
