import { legalRoute } from "@/features/legal/page"

/** The privacy policy and KVKK notice (/privacy). */
const route = legalRoute("privacy", "/privacy")

export const generateMetadata = route.generateMetadata
export default route.LegalPage
