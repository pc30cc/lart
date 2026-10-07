/**
 * The calm, centred card of the account pages (log in, sign up, passwords,
 * confirm email) and the instructor's sign-in pages: an optional icon, a
 * heading, one short sentence, the form, and an optional line under the card.
 */
export function AuthCard({
  icon,
  title,
  subtitle,
  children,
  footer,
}: {
  icon?: React.ReactNode
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 mx-auto w-full max-w-md px-4 py-10 duration-500 sm:py-16">
      <div className="mb-7 flex flex-col items-center gap-3 text-center">
        {icon && (
          <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl [&_svg]:size-6">
            {icon}
          </span>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-base text-pretty">{subtitle}</p>}
      </div>
      <div className="bg-card ring-foreground/8 rounded-2xl p-5 shadow-sm ring-1 sm:p-8">{children}</div>
      {footer && <div className="text-muted-foreground mt-6 text-center text-base">{footer}</div>}
    </div>
  )
}
