import { parseContractText } from "@/features/contracts/text"
import { cn } from "@/lib/utils"

/** A contract text set as a calm, printable document (RTL for Persian). */
export function ContractDocument({
  text,
  locale,
  className,
  children,
}: {
  text: string
  locale: "fa" | "tr" | "en"
  className?: string
  /** Shown under the text (e.g. the signature record). */
  children?: React.ReactNode
}) {
  const blocks = parseContractText(text)
  const rtl = locale === "fa"

  return (
    <article
      lang={locale}
      dir={rtl ? "rtl" : "ltr"}
      data-contract
      className={cn(
        "bg-card ring-foreground/8 text-card-foreground rounded-xl px-6 py-8 text-start shadow-xs ring-1 sm:px-10 sm:py-12",
        "print:bg-white print:p-0 print:text-black print:shadow-none print:ring-0",
        rtl ? "font-(family-name:--font-iransans) leading-loose" : "leading-relaxed",
        className,
      )}
    >
      <div className="mx-auto max-w-[68ch] text-[0.95rem]">
        {blocks.map((block, i) => {
          switch (block.type) {
            case "title":
              return (
                <h2 key={i} className={cn("text-center text-2xl font-semibold text-balance", !rtl && "tracking-tight")}>
                  {block.text}
                </h2>
              )
            case "heading":
              return (
                <h3
                  key={i}
                  className="mt-8 mb-2 border-b pb-1.5 text-base font-semibold break-after-avoid print:border-black/20"
                >
                  {block.text}
                </h3>
              )
            case "item":
              return (
                <p key={i} className="relative my-1 ps-5 break-inside-avoid">
                  <span aria-hidden className="bg-foreground/40 absolute start-1 top-[0.7em] size-1.5 rounded-full print:bg-black" />
                  {block.text}
                </p>
              )
            default:
              // The first paragraph after the title is its subtitle.
              return i === 1 && blocks[0]?.type === "title" ? (
                <p key={i} className="text-muted-foreground mt-1 mb-6 text-center text-sm print:text-black/70">
                  {block.text}
                </p>
              ) : (
                <p key={i} className="my-2.5 text-pretty break-inside-avoid">
                  {block.text}
                </p>
              )
          }
        })}
        {children}
      </div>
    </article>
  )
}
