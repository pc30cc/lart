import { NextIntlClientProvider } from "next-intl"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { PaymentSettingsForm } from "@/app/[locale]/admin/(panel)/settings/payments/payment-form"
import { MarkRefundedButton, RegistrationActions } from "./dialogs"

// Outside a Next.js request: plain links.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/admin/settings/payments",
}))

const load = async (l: string) => ({
  common: (await import(`../../../../../messages/${l}/common.json`)).default,
  settings: (await import(`../../../../../messages/${l}/settings.json`)).default,
  workshops: (await import(`../../../../../messages/${l}/workshops.json`)).default,
  money: (await import(`../../../../../messages/${l}/money.json`)).default,
  registration: (await import(`../../../../../messages/${l}/registration.json`)).default,
})

const saved = {
  cash: true,
  transfer: {
    enabled: true,
    accountHolder: "Lart Sanat",
    bankName: "Ziraat Bankası",
    iban: "TR33 0006 1005 1978 6457 8413 26",
    note: { fa: "نام شرکت‌کننده را بنویسید", tr: "Açıklamaya adınızı yazın", en: "" },
  },
  online: { enabled: true, note: { fa: "", tr: "", en: "Receipt by email" } },
}

/** The admin's payment components render on the server in each language with the real texts (a missing text throws). */
describe.each(["fa", "en", "tr"])("renders in %s", (locale) => {
  const render = async (node: React.ReactNode) =>
    renderToString(
      <NextIntlClientProvider
        locale={locale}
        messages={await load(locale)}
        timeZone="Europe/Istanbul"
        onError={(error) => {
          throw error
        }}
      >
        {node}
      </NextIntlClientProvider>,
    )

  it("the payment settings with the live preview of what students see", async () => {
    const html = await render(<PaymentSettingsForm saved={saved} />)
    expect(html).toContain("TR33 0006 1005 1978 6457 8413 26") // the IBAN in groups of four, in the preview too
    expect(html).toContain("Ziraat Bankası")
    expect(html).toContain("https://iyzi.link/")
    expect(html).toContain("inert")
    if (locale === "fa") expect(html).toContain("۱٬۵۰۰")
  })

  it("a registration's actions and the refund button", async () => {
    const html = await render(
      <>
        <RegistrationActions
          registration={{ id: "11111111-1111-4111-8111-111111111111", participantName: "Deniz", memberName: "Ayşe", status: "pending", amount: 150_000 }}
          startsAt={new Date(Date.now() + 5 * 86_400_000).toISOString()}
          defaultMethod="cash"
        />
        <MarkRefundedButton id="11111111-1111-4111-8111-111111111111" amount={75_000} name="Ayşe" workshop="Mum" />
      </>,
    )
    expect(html).toContain("Deniz")
    const cancelled = await render(
      <RegistrationActions
        registration={{ id: "11111111-1111-4111-8111-111111111111", participantName: "Deniz", memberName: "Ayşe", status: "cancelled", amount: 150_000 }}
        startsAt={new Date().toISOString()}
        defaultMethod="cash"
      />,
    )
    expect(cancelled).toBe("")
  })
})
