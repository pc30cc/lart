import type { CSSProperties } from "react"
import { Body, Button, Column, Container, Head, Heading, Hr, Html, Link, Preview, Row, Section, Text } from "react-email"

/**
 * The one branded layout every email uses: brand wordmark, a calm card with a
 * heading, short paragraphs, an optional details box, optional small blocks
 * (e.g. the ways to pay) and one main button, then a small footer. When a
 * block has its own button (e.g. "Pay online"), the main button is drawn as
 * the quieter, outlined one, so there is still one obvious action. Inline
 * styles for every client; a small <style> block adds dark mode (clients that
 * support it) and a phone layout.
 */

export type EmailLayoutProps = {
  locale: "fa" | "tr" | "en"
  brand: string
  /** Site home page, linked in the footer. */
  siteUrl: string
  preview: string
  heading: string
  greeting: string
  paragraphs: string[]
  details: { label: string; value: string }[]
  /** Small titled blocks under the details (e.g. one per way to pay). */
  sections?: EmailBlock[]
  cta: { label: string; href: string }
  note?: string
  /** Makes the note a link (a second, quieter way on). */
  noteHref?: string
  linkHint: string
  signoff: string
  team: string
  footer: string
}

export type EmailBlock = {
  title: string
  /** Lines before the rows. */
  text: string[]
  rows: { label: string; value: string; ltr?: boolean }[]
  /** Lines after the rows. */
  after: string[]
  button?: { label: string; href: string }
}

const light = {
  page: "#f5efe6",
  card: "#ffffff",
  border: "#ece3d6",
  box: "#faf6f0",
  text: "#2a211c",
  muted: "#75685d",
  accent: "#9b4a2e",
}

const css = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.e-page,.e-page>table>tbody>tr>td{background-color:#151110!important}
.e-card{background-color:#211b18!important;border-color:#3a2f29!important}
.e-box{background-color:#2a221e!important}
.e-text{color:#f4ede5!important}
.e-muted{color:#b9ada1!important}
.e-link{color:#e8a584!important}
.e-btn{background-color:#b85c3c!important;color:#ffffff!important}
.e-btn-quiet{background-color:transparent!important;color:#e8a584!important;border-color:#e8a584!important}
.e-block{border-color:#3a2f29!important}
.e-rule{border-color:#3a2f29!important}
}
[data-ogsc] .e-text{color:#f4ede5!important}
[data-ogsc] .e-muted{color:#b9ada1!important}
[data-ogsc] .e-link{color:#e8a584!important}
@media only screen and (max-width:600px){
.e-card-td{padding:28px 20px!important}
.e-btn,.e-btn-quiet{display:block!important}
}
`

const fonts = {
  fa: 'Tahoma, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif',
  latin: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  wordmark: 'Georgia, "Times New Roman", serif',
}

function styles(rtl: boolean) {
  const font = rtl ? fonts.fa : fonts.latin
  const align = rtl ? "right" : "left"
  const base: CSSProperties = { fontFamily: font, color: light.text, textAlign: align }
  return {
    body: { backgroundColor: light.page, margin: 0, padding: "32px 12px", fontFamily: font },
    container: { maxWidth: 560, width: "100%", margin: "0 auto" },
    header: { textAlign: "center", padding: "0 0 24px" },
    wordmark: {
      fontFamily: rtl ? font : fonts.wordmark,
      fontSize: 26,
      lineHeight: "32px",
      fontWeight: rtl ? 700 : 400,
      // Letter spacing would break the joined letters of Persian script.
      letterSpacing: rtl ? 0 : "0.06em",
      color: light.text,
      textAlign: "center",
      margin: 0,
    },
    wordmarkRule: { width: 28, border: "none", borderTop: `2px solid ${light.accent}`, margin: "10px auto 0" },
    card: {
      backgroundColor: light.card,
      border: `1px solid ${light.border}`,
      borderRadius: 16,
      padding: "40px 36px",
    },
    heading: { ...base, fontSize: 24, lineHeight: rtl ? "38px" : "32px", fontWeight: 700, margin: "0 0 20px" },
    paragraph: { ...base, fontSize: 16, lineHeight: rtl ? "30px" : "26px", margin: "0 0 16px" },
    box: { backgroundColor: light.box, borderRadius: 12, padding: "14px 20px", margin: "8px 0 28px" },
    label: { ...base, color: light.muted, fontSize: 14, lineHeight: "22px", padding: "6px 0", width: "38%", verticalAlign: "top" },
    value: { ...base, fontSize: 15, lineHeight: rtl ? "26px" : "22px", fontWeight: 600, padding: "6px 0", verticalAlign: "top" },
    ctaWrap: { textAlign: "center", margin: "12px 0 28px" },
    button: {
      backgroundColor: light.accent,
      color: "#ffffff",
      fontFamily: font,
      fontSize: 16,
      fontWeight: 600,
      lineHeight: "22px",
      textAlign: "center",
      borderRadius: 12,
      padding: "14px 32px",
    },
    quietButton: {
      backgroundColor: "transparent",
      color: light.accent,
      border: `2px solid ${light.accent}`,
      fontFamily: font,
      fontSize: 16,
      fontWeight: 600,
      lineHeight: "22px",
      textAlign: "center",
      borderRadius: 12,
      padding: "12px 30px",
    },
    block: { border: `1px solid ${light.border}`, borderRadius: 12, padding: "16px 20px", margin: "0 0 16px" },
    blockTitle: { ...base, fontSize: 16, lineHeight: rtl ? "28px" : "24px", fontWeight: 700, margin: "0 0 6px" },
    blockText: { ...base, fontSize: 15, lineHeight: rtl ? "28px" : "24px", margin: "0 0 8px" },
    blockAfter: { ...base, fontSize: 15, lineHeight: rtl ? "28px" : "24px", margin: "10px 0 0" },
    blockLabel: { ...base, color: light.muted, fontSize: 14, lineHeight: "22px", padding: "4px 0", width: "38%", verticalAlign: "top" },
    blockValue: { ...base, fontSize: 15, lineHeight: rtl ? "26px" : "22px", fontWeight: 600, padding: "4px 0", verticalAlign: "top" },
    blockButtonWrap: { textAlign: "center", margin: "12px 0 4px" },
    blockLink: { color: light.muted, fontSize: 12, lineHeight: "18px", wordBreak: "break-all", textAlign: "center", margin: "8px 0 0" },
    note: { ...base, color: light.muted, fontSize: 14, lineHeight: rtl ? "26px" : "22px", margin: "0 0 24px" },
    noteLink: { color: light.accent, textDecoration: "underline" },
    signoff: { ...base, fontSize: 16, lineHeight: rtl ? "30px" : "26px", margin: 0 },
    rule: { border: "none", borderTop: `1px solid ${light.border}`, margin: "28px 0 20px" },
    hint: { ...base, color: light.muted, fontSize: 13, lineHeight: "20px", margin: 0 },
    rawLink: { color: light.accent, fontSize: 13, lineHeight: "20px", wordBreak: "break-all" },
    footer: { textAlign: "center", padding: "24px 8px 0" },
    footerText: { fontFamily: font, color: light.muted, fontSize: 13, lineHeight: "20px", textAlign: "center", margin: 0 },
    footerLink: { color: light.muted, textDecoration: "underline" },
  } satisfies Record<string, CSSProperties>
}

export function EmailLayout(props: EmailLayoutProps) {
  const rtl = props.locale === "fa"
  const dir = rtl ? "rtl" : "ltr"
  const s = styles(rtl)
  const host = new URL(props.siteUrl).host
  const quietCta = props.sections?.some((block) => block.button) ?? false

  return (
    <Html lang={props.locale} dir={dir}>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{css}</style>
      </Head>
      <Body className="e-page" lang={props.locale} dir={dir} style={s.body}>
        <Preview>{props.preview}</Preview>
        <Container dir={dir} style={s.container}>
          <Section style={s.header}>
            <Text className="e-text" style={s.wordmark}>
              {props.brand}
            </Text>
            <Hr style={s.wordmarkRule} />
          </Section>

          <Section className="e-card" tdClassName="e-card-td" dir={dir} style={s.card}>
            <Heading as="h1" className="e-text" style={s.heading}>
              {props.heading}
            </Heading>
            <Text className="e-text" style={s.paragraph}>
              {props.greeting}
            </Text>
            {props.paragraphs.map((p, i) => (
              <Text key={i} className="e-text" style={s.paragraph}>
                {p}
              </Text>
            ))}

            {props.details.length > 0 && (
              <Section className="e-box" dir={dir} style={s.box}>
                {props.details.map((d) => (
                  <Row key={d.label} dir={dir} data-text-format="dataTable">
                    <Column className="e-muted" style={s.label}>
                      {d.label}
                    </Column>
                    <Column className="e-text" style={s.value}>
                      {d.value}
                    </Column>
                  </Row>
                ))}
              </Section>
            )}

            {props.sections?.map((block, i) => (
              <Section key={i} className="e-block" dir={dir} style={s.block}>
                <Text className="e-text" style={s.blockTitle}>
                  {block.title}
                </Text>
                {block.text.map((line, j) => (
                  <Text key={j} className="e-text" style={s.blockText}>
                    {line}
                  </Text>
                ))}
                {block.rows.map((row) => (
                  <Row key={row.label} dir={dir} data-text-format="dataTable">
                    <Column className="e-muted" style={s.blockLabel}>
                      {row.label}
                    </Column>
                    <Column
                      className="e-text"
                      dir={row.ltr ? "ltr" : undefined}
                      style={row.ltr ? { ...s.blockValue, textAlign: rtl ? "right" : "left", unicodeBidi: "embed" } : s.blockValue}
                    >
                      {row.value}
                    </Column>
                  </Row>
                ))}
                {block.after.map((line, j) => (
                  <Text key={j} className="e-text" style={s.blockAfter}>
                    {line}
                  </Text>
                ))}
                {block.button && (
                  <>
                    <Section style={s.blockButtonWrap}>
                      <Button className="e-btn" href={block.button.href} style={s.button}>
                        {block.button.label}
                      </Button>
                    </Section>
                    <Text className="e-muted" dir="ltr" style={s.blockLink} data-skip-in-text="true">
                      <Link className="e-link" href={block.button.href} style={{ color: "inherit" }}>
                        {block.button.href}
                      </Link>
                    </Text>
                  </>
                )}
              </Section>
            ))}

            <Section style={s.ctaWrap}>
              {quietCta ? (
                <Button className="e-btn-quiet" href={props.cta.href} style={s.quietButton}>
                  {props.cta.label}
                </Button>
              ) : (
                <Button className="e-btn" href={props.cta.href} style={s.button}>
                  {props.cta.label}
                </Button>
              )}
            </Section>

            {props.note && (
              <Text className="e-muted" style={s.note}>
                {props.noteHref ? (
                  <Link className="e-link" href={props.noteHref} style={s.noteLink}>
                    {props.note}
                  </Link>
                ) : (
                  props.note
                )}
              </Text>
            )}
            <Text className="e-text" style={s.signoff}>
              {props.signoff}
              <br />
              {props.team}
            </Text>

            <Hr className="e-rule" style={s.rule} />
            <Text className="e-muted" style={s.hint}>
              {props.linkHint}
              <br />
              <Link className="e-link" href={props.cta.href} dir="ltr" style={s.rawLink}>
                {props.cta.href}
              </Link>
            </Text>
          </Section>

          <Section style={s.footer}>
            <Text className="e-muted" style={s.footerText}>
              {props.footer}
              <br />
              <Link className="e-muted e-footer" href={props.siteUrl} dir="ltr" style={s.footerLink}>
                {host}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
