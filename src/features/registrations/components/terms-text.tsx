import { parseContractText, type ContractBlock } from "@/features/contracts/text"
import { cn } from "@/lib/utils"

/**
 * A terms text as people read it before registering, in full: "# " title,
 * "## " heading, "- " list items and paragraphs (the template format). Plain
 * text only (no HTML), so a template can never inject markup.
 */
export function TermsText({ text, className }: { text: string; className?: string }) {
  const groups: (ContractBlock | ContractBlock[])[] = []
  for (const block of parseContractText(text)) {
    const last = groups[groups.length - 1]
    if (block.type === "item" && Array.isArray(last)) last.push(block)
    else groups.push(block.type === "item" ? [block] : block)
  }

  return (
    <div className={cn("space-y-3 text-[0.95rem] leading-relaxed text-pretty", className)}>
      {groups.map((group, i) => {
        if (Array.isArray(group)) {
          return (
            <ul key={i} className="marker:text-primary/70 list-disc space-y-1.5 ps-5">
              {group.map((item, j) => (
                <li key={j}>{item.text}</li>
              ))}
            </ul>
          )
        }
        if (group.type === "title") return <h3 key={i} className="text-base font-semibold">{group.text}</h3>
        if (group.type === "heading") return <h4 key={i} className="pt-1 font-semibold">{group.text}</h4>
        return <p key={i}>{group.text}</p>
      })}
    </div>
  )
}
