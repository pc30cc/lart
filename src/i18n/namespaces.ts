/**
 * Message namespaces. Each one is a file per locale: messages/<locale>/<ns>.json.
 * A module owns its own namespace file, so modules never edit each other's text.
 */
export const namespaces = [
  "common",
  "auth",
  "admin",
  "dashboard",
  "categories",
  "instructors",
  "workshops",
  "contracts",
  "money",
  "settings",
  "templates",
  "emails",
  "media",
  "site",
  "account",
  "instructorPanel",
  "registration",
  "partners",
  "students",
] as const
