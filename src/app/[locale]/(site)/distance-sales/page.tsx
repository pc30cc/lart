import { legalRoute } from "@/features/legal/page"

/** The distance sales agreement and pre-information form (/distance-sales), accepted with the registration terms. */
const route = legalRoute("distanceSales", "/distance-sales")

export const generateMetadata = route.generateMetadata
export default route.LegalPage
