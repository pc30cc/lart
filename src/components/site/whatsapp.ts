/**
 * The WhatsApp chat link of a phone number (wa.me, which opens the app on a
 * phone and WhatsApp Web on a computer): international digits only, a
 * Turkish number written as 05xx… read as +90 5xx…. Empty when it has too
 * few digits to be a number.
 */
export function whatsappHref(phone: string): string {
  let digits = phone.replace(/\D/g, "")
  if (digits.startsWith("00")) digits = digits.slice(2)
  else if (digits.startsWith("0")) digits = `90${digits.slice(1)}`
  return digits.length >= 8 ? `https://wa.me/${digits}` : ""
}
