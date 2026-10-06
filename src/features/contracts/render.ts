import "server-only"
import { eq } from "drizzle-orm"
import { createTranslator } from "next-intl"

import { db, type Db, type Tx } from "@/db"
import { contracts, courses, instructors, templates, type Locale, type LocalizedText } from "@/db/schema"
import { decrypt } from "@/lib/crypto"
import { formatDate, formatDateTime, formatNumber, formatTime, formatWeekday, localized } from "@/lib/format"
import { formatLira } from "@/lib/money"
import { getBrand } from "@/lib/settings"
import en from "../../../messages/en/contracts.json"
import fa from "../../../messages/fa/contracts.json"
import tr from "../../../messages/tr/contracts.json"
import { fillPlaceholders, type ContractPlaceholder } from "./text"

/** Everything a contract text is made from. */
export type ContractData = {
  version: number
  /** The fixed clauses (template body, three languages). */
  templateBody: LocalizedText
  instructor: { officialName: string; idNumber: string }
  course: {
    title: LocalizedText
    startsAt: Date
    endsAt: Date
    venue: LocalizedText
    minCapacity: number
    maxCapacity: number
    decisionAt: Date
  }
  fee: { feeType: "per_participant" | "fixed"; feeAmount: number; advanceAmount: number }
}

const messages = { fa, tr, en }

/** Read a contract with its workshop, instructor (ID number decrypted) and template. */
export async function loadContractData(contractId: string, tx: Tx | Db = db): Promise<ContractData | null> {
  const [row] = await tx
    .select({
      version: contracts.version,
      feeType: contracts.feeType,
      feeAmount: contracts.feeAmount,
      advanceAmount: contracts.advanceAmount,
      templateBody: templates.body,
      officialName: instructors.officialName,
      idNumberEnc: instructors.idNumberEnc,
      title: courses.title,
      startsAt: courses.startsAt,
      endsAt: courses.endsAt,
      venue: courses.venue,
      minCapacity: courses.minCapacity,
      maxCapacity: courses.maxCapacity,
      decisionAt: courses.decisionAt,
    })
    .from(contracts)
    .innerJoin(courses, eq(courses.id, contracts.courseId))
    .innerJoin(instructors, eq(instructors.id, contracts.instructorId))
    .innerJoin(templates, eq(templates.id, contracts.templateId))
    .where(eq(contracts.id, contractId))
    .limit(1)
  if (!row) return null
  return {
    version: row.version,
    templateBody: row.templateBody,
    instructor: { officialName: row.officialName, idNumber: decrypt(row.idNumberEnc) },
    course: {
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      venue: row.venue,
      minCapacity: row.minCapacity,
      maxCapacity: row.maxCapacity,
      decisionAt: row.decisionAt,
    },
    fee: { feeType: row.feeType, feeAmount: row.feeAmount, advanceAmount: row.advanceAmount },
  }
}

/** The placeholder values of a contract in a language (dates in Istanbul time, local digits). */
export function contractValues(data: ContractData, locale: Locale, brand: string): Record<ContractPlaceholder, string> {
  const t = createTranslator({ locale, messages: messages[locale], namespace: "document" })
  const { course, fee } = data
  return {
    brand,
    instructor_name: data.instructor.officialName,
    instructor_id_number: data.instructor.idNumber,
    workshop_title: localized(course.title, locale),
    date: formatDate(course.startsAt, locale, "long"),
    weekday: formatWeekday(course.startsAt, locale),
    start_time: formatTime(course.startsAt, locale),
    end_time: formatTime(course.endsAt, locale),
    venue: localized(course.venue, locale),
    min_participants: formatNumber(course.minCapacity, locale),
    max_participants: formatNumber(course.maxCapacity, locale),
    fee_type: t(`feeType.${fee.feeType}`),
    fee_amount: formatLira(fee.feeAmount, locale),
    advance_amount: formatLira(fee.advanceAmount, locale),
    decision_deadline: formatDateTime(course.decisionAt, locale, "long"),
  }
}

/**
 * The full contract text in a language: a header with the variable part
 * (parties, workshop, fee, advance) built from the fields, then the template's
 * fixed clauses with every {placeholder} filled. Pass a contract id (read from
 * the database) or the data itself. Plain text with "#", "##" and "- " line
 * markers (see `parseContractText`); this exact text is what gets signed.
 */
export async function renderContract(
  source: string | ContractData,
  locale: Locale,
  options: { brand?: string; tx?: Tx | Db } = {},
): Promise<string> {
  const data = typeof source === "string" ? await loadContractData(source, options.tx) : source
  if (!data) throw new Error(`Contract ${String(source)} not found`)
  const brand = options.brand ?? (await getBrand(locale))
  const values = contractValues(data, locale, brand)
  const t = createTranslator({ locale, messages: messages[locale], namespace: "document" })
  const v = { ...values, version: formatNumber(data.version, locale) }

  const header = [
    `# ${t("title")}`,
    t("subtitle", v),
    "",
    `## ${t("parties")}`,
    t("partiesText", v),
    "",
    `## ${t("workshop")}`,
    `- ${t("workshopTitle", v)}`,
    `- ${t("date", v)}`,
    `- ${t("time", v)}`,
    `- ${t("venue", v)}`,
    `- ${t("capacity", v)}`,
    `- ${t("decision", v)}`,
    "",
    `## ${t("fee")}`,
    t("feeLine", { ...v, kind: data.fee.feeType }),
    "",
    `## ${t("advance")}`,
    t("advanceLine", { ...v, has: data.fee.advanceAmount > 0 ? "yes" : "no" }),
  ]
  const clauses = fillPlaceholders(localized(data.templateBody, locale), values).trim()
  return [...header, "", clauses, ""].join("\n")
}
