/**
 * Sample data for trying the site out: a few workshops (three held and closed,
 * two coming up and full, so no visitor can register), their instructors,
 * students, photos and a whole month of money (capital, rent, materials,
 * payments, closings, instructor payments, a withdrawal).
 * Costs are recorded by the first partner and paid from the wallet.
 *
 *   pnpm tsx scripts/demo-data.ts seed <photos-dir> <manifest.json>
 *   pnpm tsx scripts/demo-data.ts remove <manifest.json>
 *
 * Against a database whose APP_URL is not on this computer (the live site),
 * add --production: without it the script refuses. `remove` also refuses a
 * manifest naming a person whose address is not one of the demo's.
 *
 * Everything is written through the app's own functions (storage, ledger,
 * payments, closing), so the figures are what the real flows would give. Every
 * row and file it creates is listed in the manifest; `remove` deletes exactly
 * those (the ledger rows through the factory-reset switch of drizzle/0013) and
 * nothing else. No email is sent: students use addresses that cannot receive
 * mail, and the reminder and decision jobs are marked as already done.
 *
 * Photos: `<photos-dir>/<workshop>-cover.jpg` and `<workshop>-g<n>.jpg`
 * (gallery, held workshops) or `<workshop>-s<n>.jpg` (samples).
 */
import "dotenv/config"

import Module, { createRequire } from "node:module"
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const load = createRequire(__filename)
const marker = load.resolve("server-only")
load.cache[marker] = Object.assign(new Module(marker), { filename: marker, loaded: true, exports: {} })

type Manifest = {
  createdAt: string
  categories: string[]
  instructors: string[]
  members: string[]
  courses: string[]
  transactions: string[]
  files: string[]
}

const DAY = 86_400_000
const lira = (n: number) => Math.round(n * 100)

/** Istanbul time (UTC+3) on a day relative to today. */
function at(days: number, hour: number, minute = 0): Date {
  const d = new Date(Date.now() + days * DAY)
  d.setUTCHours(hour - 3, minute, 0, 0)
  return d
}

type L = { fa: string; tr: string; en: string }

type Workshop = {
  key: string
  slug: string
  category: string
  instructor: number
  title: L
  intro: L
  includes: L
  bring: L
  venue: L
  /** Days from today; held ones are in the past. */
  day: number
  hours: [number, number]
  price: number
  capacity: number
  students: number
  fee: { type: "fixed" | "per_participant"; amount: number; advance?: number }
  materials: number
  held: boolean
  /** Coming up: "confirmed" (go decision taken) or "published". */
  status?: "confirmed" | "published"
  /** Coming up: how many have paid so far. */
  paid?: number
}

const VENUE: L = {
  fa: "استودیو لیمر، مُدا، کادیکوی، استانبول",
  tr: "Limer Atölye, Moda, Kadıköy, İstanbul",
  en: "Limer Studio, Moda, Kadıköy, Istanbul",
}

const CATEGORIES: Record<string, { slug: string; name: L }> = {
  candle: { slug: "mum", name: { fa: "شمع سازی", tr: "MUM WORKSHOP", en: "CANDLE WORKSHOP" } },
  pottery: { slug: "seramik", name: { fa: "سفال", tr: "Seramik", en: "Pottery" } },
  macrame: { slug: "makrome", name: { fa: "ماکرامه", tr: "Makrome", en: "Macramé" } },
  flowers: { slug: "cicek-tasarimi", name: { fa: "گل‌آرایی", tr: "Çiçek tasarımı", en: "Flower arranging" } },
  painting: { slug: "suluboya", name: { fa: "نقاشی آبرنگ", tr: "Suluboya", en: "Watercolour" } },
}

const INSTRUCTORS = [
  { email: "ayla.yildiz", official: "Ayla Yıldız", name: { fa: "آیلا ییلدیز", tr: "Ayla Yıldız", en: "Ayla Yıldız" }, field: { fa: "شمع‌سازی و رایحه", tr: "Mum ve koku tasarımı", en: "Candles and scents" }, langs: ["tr", "en"] },
  { email: "elif.demir", official: "Elif Demir", name: { fa: "الیف دمیر", tr: "Elif Demir", en: "Elif Demir" }, field: { fa: "سفال و چرخ", tr: "Seramik ve çark", en: "Pottery and wheel" }, langs: ["tr", "en"] },
  { email: "zeynep.arslan", official: "Zeynep Arslan", name: { fa: "زینب آرسلان", tr: "Zeynep Arslan", en: "Zeynep Arslan" }, field: { fa: "ماکرامه و بافت", tr: "Makrome ve dokuma", en: "Macramé and weaving" }, langs: ["tr"] },
  { email: "selin.kaya", official: "Selin Kaya", name: { fa: "سلین کایا", tr: "Selin Kaya", en: "Selin Kaya" }, field: { fa: "گل‌آرایی", tr: "Çiçek tasarımı", en: "Floristry" }, langs: ["tr", "en"] },
  { email: "neda.rahimi", official: "Neda Rahimi", name: { fa: "ندا رحیمی", tr: "Neda Rahimi", en: "Neda Rahimi" }, field: { fa: "نقاشی آبرنگ", tr: "Suluboya resim", en: "Watercolour painting" }, langs: ["fa", "tr", "en"] },
]

const STUDENTS: [name: string, locale: "fa" | "tr" | "en"][] = [
  ["Deniz Aydın", "tr"], ["Merve Şahin", "tr"], ["Canan Öztürk", "tr"], ["Burak Çelik", "tr"], ["Ece Koç", "tr"],
  ["Gizem Yılmaz", "tr"], ["Seda Kurt", "tr"], ["Emre Aksoy", "tr"], ["Ceren Polat", "tr"], ["Pelin Erdoğan", "tr"],
  ["Hande Kılıç", "tr"], ["Tuğba Arslan", "tr"], ["Oğuz Doğan", "tr"], ["İrem Güneş", "tr"], ["Nil Karaca", "tr"],
  ["سارا محمدی", "fa"], ["نگار حسینی", "fa"], ["مهسا کریمی", "fa"], ["پریسا رضایی", "fa"], ["آرش احمدی", "fa"],
  ["الناز موسوی", "fa"], ["شیما جعفری", "fa"], ["Anna Müller", "en"], ["Sophie Martin", "en"], ["Laura Bianchi", "en"],
  ["Elena Petrova", "en"], ["Hannah Clarke", "en"], ["Yasemin Uçar", "tr"], ["Damla Bulut", "tr"], ["Aylin Tekin", "tr"],
]

const WORKSHOPS: Workshop[] = [
  {
    key: "candle", slug: "soya-mumu-ve-dogal-kokular", category: "candle", instructor: 0,
    title: { fa: "شمع سویا با رایحه‌های طبیعی", tr: "Soya Mumu ve Doğal Kokular", en: "Soy Candles with Natural Scents" },
    intro: {
      fa: "در این ورکشاپ با موم سویا و روغن‌های معطر طبیعی، دو شمع شیشه‌ای و یک شمع قوطی می‌سازید. از ذوب کردن موم و انتخاب فتیله تا ترکیب رایحه‌ها را قدم‌به‌قدم با هم پیش می‌رویم.",
      tr: "Bu atölyede soya mumu ve doğal esans yağlarıyla iki cam kavanoz mum ve bir teneke mum yapıyorsunuz. Mumu eritmekten fitil seçmeye, koku karışımlarına kadar her adımı birlikte yapıyoruz.",
      en: "Make two glass-jar candles and one travel tin with soy wax and natural essential oils. From melting the wax and choosing wicks to blending scents, we go step by step together.",
    },
    includes: { fa: "همهٔ مواد، شیشه‌ها، فتیله و جعبهٔ هدیه؛ چای و شیرینی", tr: "Tüm malzemeler, kavanozlar, fitiller ve hediye kutusu; çay ve ikram", en: "All materials, jars, wicks and a gift box; tea and treats" },
    bring: { fa: "لباس راحت؛ پیش‌بند داریم", tr: "Rahat kıyafet; önlük bizden", en: "Comfortable clothes; we provide aprons" },
    venue: VENUE, day: -25, hours: [14, 17], price: 1450, capacity: 10, students: 8,
    fee: { type: "per_participant", amount: 350 }, materials: 2600, held: true,
  },
  {
    key: "pottery", slug: "carkta-seramige-giris", category: "pottery", instructor: 1,
    title: { fa: "آشنایی با سفال روی چرخ", tr: "Çarkta Seramiğe Giriş", en: "Introduction to the Pottery Wheel" },
    intro: {
      fa: "اولین تجربهٔ کار با چرخ سفالگری: مرکز کردن گل، باز کردن فرم و ساختن یک کاسه و یک لیوان. کارها پس از پخت و لعاب، دو هفته بعد آمادهٔ تحویل‌اند.",
      tr: "Çarkla ilk deneyiminiz: çamuru ortalamak, formu açmak ve bir kase ile bir kupa yapmak. Eserleriniz pişirme ve sırlamadan sonra iki hafta içinde teslim edilir.",
      en: "Your first time at the wheel: centring the clay, opening the form and throwing a bowl and a cup. Your pieces are fired and glazed and ready two weeks later.",
    },
    includes: { fa: "گل، پخت و لعاب دو اثر، پیش‌بند و ابزار", tr: "Çamur, iki eserin pişirimi ve sırı, önlük ve aletler", en: "Clay, firing and glazing of two pieces, apron and tools" },
    bring: { fa: "ناخن کوتاه و لباسی که کثیف شدنش مهم نیست", tr: "Kısa tırnak ve kirlenebilecek kıyafet", en: "Short nails and clothes that can get muddy" },
    venue: VENUE, day: -18, hours: [11, 15], price: 2200, capacity: 6, students: 6,
    fee: { type: "fixed", amount: 4000 }, materials: 2100, held: true,
  },
  {
    key: "macrame", slug: "makrome-duvar-susu", category: "macrame", instructor: 2,
    title: { fa: "آویز دیواری ماکرامه", tr: "Makrome Duvar Süsü", en: "Macramé Wall Hanging" },
    intro: {
      fa: "با گره‌های پایهٔ ماکرامه آشنا می‌شوید و یک آویز دیواری بوهو با طناب کتان و چوب طبیعی می‌بافید که با خود به خانه می‌برید.",
      tr: "Temel makrome düğümlerini öğrenip pamuk ip ve doğal ahşapla eve götüreceğiniz bohem bir duvar süsü örüyorsunuz.",
      en: "Learn the basic macramé knots and weave a boho wall hanging in cotton cord on a piece of driftwood to take home.",
    },
    includes: { fa: "طناب کتان، چوب، قیچی و شانه", tr: "Pamuk ip, ahşap çubuk, makas ve tarak", en: "Cotton cord, wooden dowel, scissors and comb" },
    bring: { fa: "چیزی لازم نیست", tr: "Bir şey getirmenize gerek yok", en: "Nothing needed" },
    venue: VENUE, day: 9, hours: [14, 17], price: 1150, capacity: 8, students: 8,
    fee: { type: "per_participant", amount: 300, advance: 600 }, materials: 1400, held: false, status: "confirmed", paid: 8,
  },
  {
    key: "flowers", slug: "sonbahar-cicek-tasarimi", category: "flowers", instructor: 3,
    title: { fa: "گل‌آرایی پاییزی", tr: "Sonbahar Çiçek Tasarımı", en: "Autumn Flower Arranging" },
    intro: {
      fa: "با گل‌های فصل، شاخه‌های خشک و برگ‌های پاییزی یک دستهٔ گل و یک آرایش رومیزی می‌سازید و اصول ترکیب رنگ و فرم را یاد می‌گیرید.",
      tr: "Mevsim çiçekleri, kuru dallar ve sonbahar yapraklarıyla bir buket ve bir masa aranjmanı hazırlıyor, renk ve form dengesini öğreniyorsunuz.",
      en: "With seasonal blooms, dried stems and autumn leaves you make a hand-tied bouquet and a table arrangement, and learn how colour and form work together.",
    },
    includes: { fa: "همهٔ گل‌ها، گلدان، ابزار و کاغذ کادو", tr: "Tüm çiçekler, vazo, aletler ve ambalaj", en: "All flowers, vase, tools and wrapping" },
    bring: { fa: "کیسه یا جعبه برای بردن گل‌ها", tr: "Çiçekleri taşımak için bir çanta", en: "A bag to carry your flowers home" },
    venue: VENUE, day: -11, hours: [13, 16], price: 1600, capacity: 8, students: 7,
    fee: { type: "fixed", amount: 3500 }, materials: 3200, held: true,
  },
  {
    key: "painting", slug: "suluboya-ile-istanbul", category: "painting", instructor: 4,
    title: { fa: "استانبول با آبرنگ", tr: "Suluboya ile İstanbul", en: "Istanbul in Watercolour" },
    intro: {
      fa: "از روی عکس‌هایی از محله‌های قدیمی استانبول، تکنیک‌های خیس روی خیس، لایه‌گذاری و نور را تمرین می‌کنیم و هر نفر یک اثر کامل می‌کشد.",
      tr: "Eski İstanbul mahallelerinin fotoğraflarından yola çıkarak ıslak üzerine ıslak, katmanlama ve ışık tekniklerini çalışıyor, herkes bir eser tamamlıyor.",
      en: "Working from photos of old Istanbul neighbourhoods, we practise wet-on-wet, layering and light, and everyone finishes a painting of their own.",
    },
    includes: { fa: "کاغذ آبرنگ، رنگ، قلم‌مو و پالت", tr: "Suluboya kâğıdı, boyalar, fırçalar ve palet", en: "Watercolour paper, paints, brushes and palette" },
    bring: { fa: "اگر قلم‌موی شخصی دارید بیاورید", tr: "Varsa kendi fırçalarınız", en: "Your own brushes if you have them" },
    venue: VENUE, day: 17, hours: [11, 14], price: 1300, capacity: 10, students: 10,
    fee: { type: "per_participant", amount: 320 }, materials: 0, held: false, status: "published", paid: 6,
  },
]

const STUDENT_DOMAIN = "demo.limer.invalid"

async function seed(photosDir: string, manifestPath: string) {
  if (existsSync(manifestPath)) throw new Error(`${manifestPath} exists: the sample data is already there (remove it first)`)
  const { db } = await import("../src/db")
  const { eq, and } = await import("drizzle-orm")
  const S = await import("../src/db/schema")
  const { getSetting } = await import("../src/lib/settings")
  const { getStorage } = await import("../src/lib/storage")
  const { storeImage } = await import("../src/lib/storage/upload")
  const { encrypt } = await import("../src/lib/crypto")
  const { workshopTerms } = await import("../src/features/registrations/public")
  const { recordPayment } = await import("../src/features/registrations/admin/payments")
  const { activePartners, closeCourse } = await import("../src/features/money/closing")
  const L = await import("../src/features/money/ledger")

  const m: Manifest = { createdAt: new Date().toISOString(), categories: [], instructors: [], members: [], courses: [], transactions: [], files: [] }
  const save = () => writeFileSync(manifestPath, JSON.stringify(m, null, 2))
  save()

  const partners = await activePartners(db)
  if (partners.length === 0) throw new Error("no active partner")
  const admin = partners[0].adminId
  const storage = await getStorage()
  const watermark = await getSetting("watermark")
  const photos = readdirSync(photosDir)

  async function photo(file: string, purpose: "course_cover" | "course_sample" | "gallery_photo", folder: string) {
    const bytes = readFileSync(path.join(photosDir, file))
    const stored = await storeImage({ storage, purpose, file: new Blob([bytes]).stream(), watermark, folder })
    m.files.push(stored.path)
    save()
    return stored
  }

  // Categories (an existing one with the same slug is reused, and kept by `remove`).
  const categoryId: Record<string, string> = {}
  for (const [key, c] of Object.entries(CATEGORIES)) {
    const [found] = await db.select({ id: S.categories.id }).from(S.categories).where(eq(S.categories.slug, c.slug))
    if (found) categoryId[key] = found.id
    else {
      const [row] = await db.insert(S.categories).values({ slug: c.slug, name: c.name }).returning({ id: S.categories.id })
      categoryId[key] = row.id
      m.categories.push(row.id)
    }
  }
  save()

  // Instructors: approved, no password (they never sign in), no email goes to them.
  const instructorId: string[] = []
  for (const [i, p] of INSTRUCTORS.entries()) {
    const [row] = await db
      .insert(S.instructors)
      .values({
        email: `${p.email}@${STUDENT_DOMAIN}`,
        officialName: p.official,
        idNumberEnc: encrypt(String(10000000000 + i * 1234567 + 146)),
        mobile: `+90 53${i} ${400 + i * 37} ${10 + i * 11} ${20 + i * 7}`,
        displayName: p.name,
        teachingField: p.field,
        teachingLanguages: p.langs,
        approvedAt: at(-60, 10),
        emailVerifiedAt: at(-60, 10),
      })
      .returning({ id: S.instructors.id })
    instructorId.push(row.id)
    m.instructors.push(row.id)
  }
  save()

  // Students: addresses that cannot receive mail; a password nobody knows.
  const memberIds: string[] = []
  for (const [i, [name, locale]] of STUDENTS.entries()) {
    const [row] = await db
      .insert(S.members)
      .values({
        email: `student${String(i + 1).padStart(2, "0")}@${STUDENT_DOMAIN}`,
        passwordHash: "!demo",
        name,
        phone: `+90 5${30 + (i % 9)} ${100 + i * 13} ${10 + (i % 80)} ${20 + ((i * 7) % 70)}`,
        locale,
        emailVerifiedAt: at(-45 + (i % 20), 12),
        createdAt: at(-45 + (i % 20), 12),
      })
      .returning({ id: S.members.id })
    memberIds.push(row.id)
    m.members.push(row.id)
  }
  save()

  const [contractTemplate] = await db
    .select({ id: S.templates.id })
    .from(S.templates)
    .where(and(eq(S.templates.kind, "contract"), eq(S.templates.isDefault, true)))
  if (!contractTemplate) throw new Error("no default contract template")

  // ── Capital and the business's own costs ──
  const post = async (fn: () => Promise<string>) => {
    const id = await fn()
    m.transactions.push(id)
    save()
    return id
  }
  for (const [i, p] of partners.entries()) {
    await db.transaction((tx) =>
      post(() => L.postContribution(tx, { partnerId: p.adminId, amount: lira(50_000), occurredOn: L.today(at(-40 + i, 12)), description: "Başlangıç sermayesi", createdBy: p.adminId })),
    )
  }
  await db.transaction((tx) => post(() => L.postExpense(tx, { amount: lira(9_000), source: "wallet", occurredOn: L.today(at(-35, 12)), description: "Atölye kirası (Eylül)", createdBy: admin })))
  await db.transaction((tx) => post(() => L.postExpense(tx, { amount: lira(6_500), source: "wallet", occurredOn: L.today(at(-33, 12)), description: "Masa, sandalye ve raflar", createdBy: admin })))
  await db.transaction((tx) => post(() => L.postExpense(tx, { amount: lira(1_200), source: "wallet", occurredOn: L.today(at(-20, 12)), description: "Instagram reklamı", createdBy: admin })))
  await db.transaction((tx) => post(() => L.postExpense(tx, { amount: lira(9_000), source: "wallet", occurredOn: L.today(at(-5, 12)), description: "Atölye kirası (Ekim)", createdBy: admin })))

  // ── Workshops ──
  let nextStudent = 0
  const methods = ["transfer", "cash", "online", "transfer", "cash"] as const
  for (const w of WORKSHOPS) {
    const startsAt = at(w.day, w.hours[0])
    const endsAt = at(w.day, w.hours[1])
    const deadline = new Date(startsAt.getTime() - DAY)
    const decisionAt = new Date(startsAt.getTime() - 3 * DAY)
    const cover = photos.find((f) => f === `${w.key}-cover.jpg`)
    const coverPath = cover ? (await photo(cover, "course_cover", w.slug)).path : null

    const [course] = await db
      .insert(S.courses)
      .values({
        slug: w.slug,
        status: w.held ? "confirmed" : w.status!,
        categoryId: categoryId[w.category],
        instructorId: instructorId[w.instructor],
        title: w.title,
        intro: w.intro,
        includes: w.includes,
        bring: w.bring,
        venue: w.venue,
        startsAt,
        endsAt,
        minCapacity: Math.min(4, w.capacity),
        maxCapacity: w.capacity,
        price: lira(w.price),
        registrationDeadline: deadline,
        decisionAt,
        coverPath,
        // The decision job has nothing to tell the partners about these.
        decisionNotifiedAt: w.held || w.status === "confirmed" ? decisionAt : at(0, 9),
        finalParticipants: w.held || w.status === "confirmed" ? w.students : null,
        publishedAt: at(w.day - 30, 10),
        createdBy: admin,
        createdAt: at(w.day - 32, 10),
      })
      .returning({ id: S.courses.id })
    m.courses.push(course.id)
    save()

    await db.insert(S.contracts).values({
      courseId: course.id,
      instructorId: instructorId[w.instructor],
      status: "signed",
      templateId: contractTemplate.id,
      feeType: w.fee.type,
      feeAmount: lira(w.fee.amount),
      advanceAmount: lira(w.fee.advance ?? 0),
      sentAt: at(w.day - 32, 10),
      signedAt: at(w.day - 31, 18),
      signedName: INSTRUCTORS[w.instructor].official,
      signedLocale: "tr",
    })

    // Samples (both kinds of workshop) and the gallery (held ones).
    let sort = 0
    for (const f of photos.filter((f) => new RegExp(`^${w.key}-s\\d+\\.jpg$`).test(f)).sort()) {
      const s = await photo(f, "course_sample", w.slug)
      await db.insert(S.media).values({ courseId: course.id, kind: "sample", path: s.path, width: s.width, height: s.height, sort: sort++ })
    }
    if (w.held) {
      sort = 0
      for (const f of photos.filter((f) => new RegExp(`^${w.key}-g\\d+\\.jpg$`).test(f)).sort()) {
        // Gallery photos are stored only watermarked: without a watermark logo there is no gallery.
        const g = await photo(f, "gallery_photo", w.slug).catch((err) => {
          console.warn(`[demo] gallery photo skipped (${f}):`, err?.code ?? err?.message)
          return null
        })
        if (!g) continue
        await db.insert(S.media).values({ courseId: course.id, kind: "gallery_photo", path: g.path, width: g.width, height: g.height, sort: sort++ })
      }
    }

    // Registrations, a few days to two weeks before.
    const regIds: string[] = []
    for (let i = 0; i < w.students; i++) {
      const memberId = memberIds[nextStudent++ % memberIds.length]
      const [member] = await db.select({ name: S.members.name, locale: S.members.locale }).from(S.members).where(eq(S.members.id, memberId))
      const terms = await workshopTerms(null, member.locale)
      if (!terms) throw new Error("no default terms template")
      // Two weeks to a few days before, and never later than two days ago.
      const registeredAt = new Date(Math.min(at(w.day - 14 + (i % 10), 10 + (i % 8)).getTime(), Date.now() - 2 * DAY - i * 3_600_000))
      const [reg] = await db
        .insert(S.registrations)
        .values({
          courseId: course.id,
          memberId,
          participantName: member.name,
          status: "pending",
          amount: lira(w.price),
          termsTemplateId: terms.templateId,
          termsSha256: terms.sha256,
          termsAcceptedAt: registeredAt,
          photoConsent: i % 3 !== 2,
          videoConsent: i % 4 === 0,
          // The day-before reminder job has nothing to send.
          reminderSentAt: w.held ? null : at(0, 9),
          createdAt: registeredAt,
        })
        .returning({ id: S.registrations.id })
      regIds.push(reg.id)
    }

    // Materials, the advance, payments.
    if (w.materials > 0) {
      await db.transaction((tx) =>
        post(() => L.postExpense(tx, { courseId: course.id, amount: lira(w.materials), source: "wallet", occurredOn: L.today(at(Math.min(w.day - 2, -1), 12)), description: "Malzeme", createdBy: admin })),
      )
    }
    if (w.fee.advance) {
      await db.transaction((tx) =>
        post(() => L.postAdvance(tx, { courseId: course.id, amount: lira(w.fee.advance!), direction: "paid", occurredOn: L.today(at(-2, 12)), description: "Eğitmen avansı", createdBy: admin })),
      )
    }
    const paying = w.held ? regIds.length : (w.paid ?? 0)
    for (const [i, regId] of regIds.slice(0, paying).entries()) {
      const [reg] = await db.select({ createdAt: S.registrations.createdAt }).from(S.registrations).where(eq(S.registrations.id, regId))
      // A day after registering (an hour ago at the latest).
      const paidAt = new Date(Math.min(reg.createdAt.getTime() + DAY, Date.now() - 3_600_000))
      await db.transaction(async (tx) => {
        const r = await recordPayment(tx, { registrationId: regId, method: methods[i % methods.length], amount: lira(w.price), paidAt, createdBy: admin }, new Date())
        m.transactions.push(r.transactionId)
      })
    }
    save()

    // Held: close the books two days after, then pay the instructor.
    if (w.held) {
      await db.transaction((tx) => closeCourse(tx, course.id, admin, undefined, new Date(endsAt.getTime() + 2 * DAY)))
      const [owed] = await db.select({ totals: S.courses.closedTotals }).from(S.courses).where(eq(S.courses.id, course.id))
      const fee = owed.totals?.instructorFee ?? 0
      if (fee > 0) {
        await db.transaction((tx) =>
          post(() => L.postInstructorPayment(tx, { courseId: course.id, amount: fee, occurredOn: L.today(new Date(endsAt.getTime() + 3 * DAY)), description: "Eğitmen ücreti", createdBy: admin })),
        )
      }
    }
    console.info(`[demo] ${w.slug}: ${w.students} students`)
  }

  // One partner takes some money out.
  const taker = partners[partners.length - 1]
  await db.transaction((tx) =>
    post(() => L.postWithdrawal(tx, { partnerId: taker.adminId, amount: lira(4_000), occurredOn: L.today(at(-3, 12)), description: "Kişisel çekim", createdBy: taker.adminId })),
  )

  console.info(`[demo] done: ${m.courses.length} workshops, ${m.members.length} students, ${m.transactions.length} transactions, ${m.files.length} files`)
}

async function remove(manifestPath: string) {
  const m: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const { db } = await import("../src/db")
  const { inArray, sql, or } = await import("drizzle-orm")
  const S = await import("../src/db/schema")
  const { remove: removeFile } = await import("../src/lib/storage")

  // Only the demo's own people: a wrong or edited manifest must never delete real members or instructors.
  const people = [
    ...(m.members.length ? await db.select({ email: S.members.email }).from(S.members).where(inArray(S.members.id, m.members)) : []),
    ...(m.instructors.length ? await db.select({ email: S.instructors.email }).from(S.instructors).where(inArray(S.instructors.id, m.instructors)) : []),
  ]
  const stranger = people.find((p) => !p.email?.endsWith(`@${STUDENT_DOMAIN}`))
  if (stranger) throw new Error(`the manifest names ${stranger.email}, who is not demo data: nothing removed`)

  const counts = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lart.factory_reset', 'on', true)`)
    const courseIds = m.courses.length ? m.courses : ["00000000-0000-0000-0000-000000000000"]
    const txIds = m.transactions.length ? m.transactions : ["00000000-0000-0000-0000-000000000000"]
    const ledger = await tx
      .select({ id: S.ledgerTransactions.id })
      .from(S.ledgerTransactions)
      .where(or(inArray(S.ledgerTransactions.id, txIds), inArray(S.ledgerTransactions.courseId, courseIds)))
    const ledgerIds = ledger.map((r) => r.id)
    if (ledgerIds.length) {
      await tx.delete(S.ledgerLines).where(inArray(S.ledgerLines.transactionId, ledgerIds))
      await tx.delete(S.ledgerTransactions).where(inArray(S.ledgerTransactions.id, ledgerIds))
    }
    await tx.delete(S.media).where(inArray(S.media.courseId, courseIds))
    await tx.delete(S.registrations).where(inArray(S.registrations.courseId, courseIds))
    await tx.delete(S.contracts).where(inArray(S.contracts.courseId, courseIds))
    await tx.delete(S.courses).where(inArray(S.courses.id, courseIds))
    if (m.members.length) await tx.delete(S.members).where(inArray(S.members.id, m.members))
    if (m.instructors.length) await tx.delete(S.instructors).where(inArray(S.instructors.id, m.instructors))
    if (m.categories.length) await tx.delete(S.categories).where(inArray(S.categories.id, m.categories))
    await tx.execute(sql`select set_config('lart.factory_reset', 'off', true)`)
    return { transactions: ledgerIds.length, courses: m.courses.length, members: m.members.length }
  })
  let removed = 0
  for (const file of m.files) {
    await removeFile(file).then(() => removed++, (err) => console.warn(`[demo] file not removed: ${file}`, err?.message))
  }
  console.info(`[demo] removed: ${counts.courses} workshops, ${counts.members} students, ${counts.transactions} transactions, ${removed} files`)
}

const args = process.argv.slice(2)
const production = args.includes("--production")
const [mode, a, b] = args.filter((arg) => arg !== "--production")
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(process.env.APP_URL ?? "")
const run = !local && !production
  ? Promise.reject(new Error(`APP_URL is ${process.env.APP_URL ?? "not set"}, not this computer: add --production if this is meant for the live site`))
  : mode === "seed" && a && b ? seed(a, b) : mode === "remove" && a ? remove(a) : Promise.reject(new Error("usage: seed <photos-dir> <manifest> | remove <manifest>"))
run.then(
  () => process.exit(0),
  (err) => {
    console.error("[demo] failed:", err)
    process.exit(1)
  },
)
