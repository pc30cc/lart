"use server"

import { revalidatePath } from "next/cache"

import { impersonate, setPasswordAsAdmin } from "@/features/accounts/admin-access"
import { adminPasswordSchema } from "@/features/accounts/schema"
import { localeRedirect } from "@/i18n/redirect"
import { adminAction } from "@/lib/action"
import { studentIdSchema } from "./schema"

function revalidate() {
  revalidatePath("/[locale]/admin/students", "page")
  revalidatePath("/[locale]/admin/students/[id]", "page")
}

/**
 * "Change password": a new password for the student, typed by the admin or
 * generated (then returned once to show). Signs them out everywhere, ends
 * their reset links and emails them.
 */
export const setStudentPassword = adminAction(adminPasswordSchema, async (input, ctx) => {
  const result = await setPasswordAsAdmin("member", input, ctx)
  revalidate()
  return result
})

/** "Enter their account": this browser uses the site as the student for one hour. */
export const impersonateMember = adminAction(studentIdSchema, async ({ id }, ctx) => {
  await impersonate("member", id, ctx)
  await localeRedirect("/account")
})
