import { brandPhrase } from "@/lib/seo/engine";

const WORDS = ["dental", "dentist", "dentistry", "smile", "smiles", "care", "clinic", "health", "medical", "hospital", "law", "legal", "homes", "realty", "properties", "pizza", "cafe", "coffee", "bakery", "auto", "motors", "cars", "pets", "vet", "salon", "spa", "fitness", "gym", "studio", "university", "college", "school", "academy", "institute", "hotel", "hotels", "travel", "tours", "foods", "kitchen", "grill", "bank", "finance", "insurance", "labs", "tech", "media", "digital", "group", "store", "shop", "wear", "fashion", "beauty"];

/** Display name for a domain's brand: "aspendental.com" -> "Aspen Dental". */
export function brandName(domain: string) {
  let phrase = brandPhrase(domain);
  if (!phrase.includes(" ")) {
    for (const w of WORDS) {
      if (phrase.length - w.length >= 3 && phrase.endsWith(w)) {
        phrase = `${phrase.slice(0, -w.length)} ${w}`;
        break;
      }
    }
  }
  return phrase.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
