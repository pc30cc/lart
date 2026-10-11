import { legalRoute } from "@/features/legal/page"

/** The cancellation and refund policy (/cancellation): the registration terms' rules, in full. */
const route = legalRoute("cancellation", "/cancellation")

export const generateMetadata = route.generateMetadata
export default route.LegalPage
