/**
 * The plain-text format of a contract (client-safe, no server code).
 * A rendered contract is plain text with a few line markers, the same ones the
 * editable template uses: "# " title, "## " section heading, "- " list item;
 * every other non-empty line is a paragraph. Blank lines separate blocks.
 */
export type ContractBlock = { type: "title" | "heading" | "item" | "paragraph"; text: string }

export function parseContractText(text: string): ContractBlock[] {
  const blocks: ContractBlock[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("# ")) blocks.push({ type: "title", text: line.slice(2).trim() })
    else if (/^#{2,6} /.test(line)) blocks.push({ type: "heading", text: line.replace(/^#{2,6} /, "").trim() })
    else if (/^[-*•] /.test(line)) blocks.push({ type: "item", text: line.slice(2).trim() })
    else blocks.push({ type: "paragraph", text: line })
  }
  return blocks
}

/** The contract placeholders an admin may use in the template text. */
export const contractPlaceholders = [
  "brand",
  "instructor_name",
  "instructor_id_number",
  "workshop_title",
  "date",
  "weekday",
  "start_time",
  "end_time",
  "venue",
  "min_participants",
  "max_participants",
  "fee_type",
  "fee_amount",
  "advance_amount",
  "decision_deadline",
] as const
export type ContractPlaceholder = (typeof contractPlaceholders)[number]

/**
 * Replace `{placeholder}` with its value. Unknown names and stray braces are
 * left as they are (the template is free text, not an ICU message).
 */
export function fillPlaceholders(template: string, values: Record<ContractPlaceholder, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? values[name as ContractPlaceholder] : match,
  )
}
