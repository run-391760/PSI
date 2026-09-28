/** PII masking and email-domain allow lists (pure, fixture-tested). */
export function maskEmail(email: string | null | undefined) {
  if (!email) return email ?? null;
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  const d = domain.split(".");
  const tld = d.pop();
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${d.join(".").slice(0, 1)}•••.${tld}`;
}
export function maskPhone(phone: string | null | undefined) {
  if (!phone) return phone ?? null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `${phone.trim().startsWith("+") ? "+" : ""}${"•".repeat(Math.max(3, digits.length - 2))}${digits.slice(-2)}`;
}
/** Mask emails and phone numbers inside free text (message bodies). */
export function maskText(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (m) => maskEmail(m) ?? "•••")
    .replace(/(?<![\w])\+?\d[\d\s().-]{7,}\d(?![\w])/g, (m) => maskPhone(m) ?? "•••");
}

export function normalizeDomains(input: string | string[]) {
  const list = Array.isArray(input) ? input : input.split(/[\s,;]+/);
  return [...new Set(list.map((d) => d.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)))];
}
/** True when no list is configured, or the address's domain (or a parent domain) is listed. */
export function emailDomainAllowed(email: string, allowed: string[]) {
  if (!allowed.length) return true;
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  return allowed.some((a) => domain === a || domain.endsWith(`.${a}`));
}
