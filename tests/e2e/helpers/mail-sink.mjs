// A stand-in for the Resend API, for end-to-end runs of a production build.
//
// `next start` runs with NODE_ENV=production, where the app refuses to print
// emails to the log without RESEND_API_KEY. Point the app's Resend client here
// instead and every email lands in a JSON-lines file the specs can read:
//
//   node tests/e2e/helpers/mail-sink.mjs .e2e/mail.jsonl 3199 &
//   RESEND_API_KEY=re_e2e RESEND_BASE_URL=http://127.0.0.1:3199 EMAIL_FROM="Lart <noreply@lart.test>" pnpm start
import fs from "node:fs"
import http from "node:http"

const file = process.argv[2] ?? ".e2e/mail.jsonl"
const port = Number(process.argv[3] ?? 3199)
let n = 0

http
  .createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      const id = `e2e-${Date.now()}-${++n}`
      if (req.method === "POST" && req.url?.startsWith("/emails")) {
        let email = {}
        try {
          email = JSON.parse(body)
        } catch {
          email = { raw: body }
        }
        const record = {
          id,
          at: new Date().toISOString(),
          idempotencyKey: req.headers["idempotency-key"] ?? null,
          ...email,
        }
        fs.appendFileSync(file, JSON.stringify(record) + "\n")
        console.log(`[mail-sink] ${record.to} · ${record.subject}`)
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ id }))
    })
  })
  .listen(port, "127.0.0.1", () => console.log(`[mail-sink] listening on ${port}, writing ${file}`))
