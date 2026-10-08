import { NextIntlClientProvider } from "next-intl"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { WorkshopCard } from "@/themes/default/workshop-card"
import type { MyRegistration } from "../member"
import { CancelRegistration } from "./cancel-registration"
import { PaymentBadge } from "./payment-badge"
import { PaymentInstructions } from "./payment-instructions"
import { ProfileForm } from "./profile-form"
import { RegisterForm } from "./register-form"
import { RegistrationCard } from "./registration-card"

// Outside a Next.js request: plain links and a router that does nothing.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
  usePathname: () => "/account",
}))

const load = async (l: string) => ({
  common: (await import(`../../../../messages/${l}/common.json`)).default,
  account: (await import(`../../../../messages/${l}/account.json`)).default,
  registration: (await import(`../../../../messages/${l}/registration.json`)).default,
})

const DAY = 86_400_000
const startsAt = new Date(Date.now() + 5 * DAY)
const endsAt = new Date(startsAt.getTime() + 2 * 3_600_000)
const ways = {
  cash: true as const,
  transfer: { accountHolder: "Lart Sanat", bankName: "Ziraat", iban: "TR330006100519786457841326", note: "Teşekkürler" },
  paymentUrl: "https://iyzi.link/AK",
  onlineNote: "Kart",
}
const registration: MyRegistration = {
  id: "11111111-1111-4111-8111-111111111111",
  participantName: "Deniz",
  status: "pending",
  amount: 150_000,
  paymentMethod: null,
  paidAt: null,
  cancelledAt: null,
  refundAmount: null,
  refundedAt: null,
  photoConsent: true,
  videoConsent: false,
  termsAcceptedAt: new Date(),
  createdAt: new Date(),
  course: { id: "c", slug: "mum", status: "published", title: "Mum Yapımı", venue: "Moda", startsAt, endsAt, closedAt: null },
  ways,
}
const terms = { text: "Terms\n\n- one\n- two\n\nEnd", sha256: "a".repeat(64) }

/** Every component of the module renders on the server in each language with the real texts (a missing text throws). */
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

  it("every component, with the IBAN in groups of four", async () => {
    const html = (
      await Promise.all([
        render(<PaymentInstructions ways={ways} amount={150_000} participantName="Deniz" />),
        render(<PaymentInstructions ways={{}} amount={150_000} participantName="Deniz" />),
        render(
          <RegisterForm
            courseId={registration.id}
            defaultName="Ayşe"
            terms={terms}
            brand="Lart"
            ageRange={{ min: 7, max: 12 }}
            price={150_000}
            ways={["cash", "transfer", "online"]}
          />,
        ),
        render(
          <RegisterForm courseId={registration.id} defaultName="Ayşe" terms={terms} brand="Lart" ageRange={null} price={0} ways={[]} />,
        ),
        render(<CancelRegistration id={registration.id} participantName="Deniz" preview={{ paid: 150_000, percent: 50, refund: 75_000 }} />),
        render(<CancelRegistration id={registration.id} participantName="Deniz" preview={{ paid: 0, percent: 100, refund: 0 }} free />),
        render(<ProfileForm name="Ayşe" phone={null} locale="fa" />),
        render(<RegistrationCard registration={registration} now={new Date()} />),
        render(<RegistrationCard registration={{ ...registration, status: "cancelled", refundAmount: 75_000 }} now={new Date()} />),
        render(<RegistrationCard registration={{ ...registration, status: "confirmed", amount: 0 }} now={new Date()} />),
        render(<PaymentBadge registration={{ status: "cancelled", amount: 1, refundAmount: 500, refundedAt: new Date() }} />),
        render(
          <WorkshopCard
            workshop={{
              id: "x",
              slug: "mum",
              title: "Mum",
              venue: "Moda",
              category: "Mum",
              categorySlug: "mum",
              instructorName: "Zeynep",
              coverUrl: null,
              startsAt,
              endsAt,
              registrationDeadline: startsAt,
              price: 150_000,
              maxCapacity: 10,
              seatsLeft: 2,
              ageMin: 7,
              ageMax: 12,
              window: "open",
            }}
          />,
        ),
      ])
    ).join("\n")

    // The IBAN in groups of four that never break inside (one nowrap span each).
    expect(html).toContain(
      ["TR33", "0006", "1005", "1978", "6457", "8413", "26"].map((g) => `<span class="whitespace-nowrap">${g}</span>`).join(" "),
    )
    expect(html).not.toContain("break-all")
    expect(html).toContain('href="https://iyzi.link/AK" target="_blank" rel="noopener noreferrer"')
    if (locale === "fa") {
      expect(html).toContain("ورکشاپ")
      expect(html).toContain("۱٬۵۰۰")
    }
  })

  it("a free workshop's registration says Free, never a zero price", async () => {
    const free = (await load(locale)).registration.price.free as string
    const html = await render(<RegistrationCard registration={{ ...registration, status: "confirmed", amount: 0 }} now={new Date()} />)
    expect(html).toContain(free)
    expect(html).not.toContain("data-money")
  })
})
