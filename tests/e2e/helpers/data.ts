import { RUN } from "./app"

/** Names used across the specs. Every value carries this run's suffix. */
export const CATEGORIES = {
  candles: { fa: `شمع‌سازی ${RUN}`, tr: `Mum yapımı ${RUN}`, en: `Candle making ${RUN}`, slug: `mum-yapimi-${RUN}` },
  ceramics: { fa: `سفال ${RUN}`, tr: `Seramik ${RUN}`, en: `Ceramics ${RUN}`, slug: `seramik-${RUN}` },
  temp: { fa: `موقت ${RUN}`, tr: `Geçici ${RUN}`, en: `Temporary ${RUN}`, slug: `gecici-${RUN}` },
}

export const INSTRUCTORS = {
  elif: {
    displayName: { fa: `الیف ${RUN}`, tr: `Elif Yılmaz ${RUN}`, en: `Elif Yilmaz ${RUN}` },
    teachingField: { fa: "شمع‌سازی", tr: "Mum yapımı", en: "Candle making" },
    officialName: `Elif Yılmaz Demir ${RUN}`,
    idNumber: "12345678901",
    mobile: "+90 532 123 45 67",
    email: `elif.${RUN}@lart.test`,
    bio: { fa: "مربی شمع‌سازی با ده سال تجربه.", tr: "On yıllık deneyime sahip mum ustası.", en: "Candle maker with ten years of experience." },
    website: `@elif_${RUN}`,
  },
  sara: {
    displayName: { fa: `سارا ${RUN}`, tr: `Sara Kaya ${RUN}`, en: `Sara Kaya ${RUN}` },
    teachingField: { fa: "سفال", tr: "Seramik", en: "Ceramics" },
    officialName: `Sara Kaya ${RUN}`,
    idNumber: "U12345678",
    mobile: "+98 912 345 6789",
    email: `sara.${RUN}@lart.test`,
    bio: { fa: "هنرمند سفال.", tr: "Seramik sanatçısı.", en: "Ceramic artist." },
    website: `https://sara-${RUN}.example.com`,
  },
}

export const WORKSHOPS = {
  /** Fixed fee + advance; confirmed, held and closed, then the gallery. */
  held: {
    title: { fa: `کارگاه شمع ${RUN}`, tr: `Soya mumu atölyesi ${RUN}`, en: `Soy candle workshop ${RUN}` },
    slug: `soya-mumu-atolyesi-${RUN}`,
  },
  /** Per-participant fee; cancelled at the go / no-go decision. */
  cancelled: {
    title: { fa: `کارگاه سفال ${RUN}`, tr: `Çömlek atölyesi ${RUN}`, en: `Pottery workshop ${RUN}` },
    slug: `comlek-atolyesi-${RUN}`,
  },
  /** Per-participant fee; signed and open for registration (an upcoming workshop for the dashboard and screenshots). */
  open: {
    title: { fa: `کارگاه آبرنگ ${RUN}`, tr: `Suluboya atölyesi ${RUN}`, en: `Watercolour workshop ${RUN}` },
    slug: `suluboya-atolyesi-${RUN}`,
  },
}
