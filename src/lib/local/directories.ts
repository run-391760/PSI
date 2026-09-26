/** Directory network for listing distribution. Client-safe (no server imports). */
export type DirectoryKind = "maps" | "search" | "social" | "reviews" | "directory" | "navigation";
export type Directory = {
  id: string;
  name: string;
  domain: string;
  kind: DirectoryKind;
  /** Importance weight for the presence score (Google = 10). */
  weight: number;
  /** ISO markets where the directory matters; "global" = everywhere. */
  markets: "global" | string[];
  /** New listings go through manual verification before going live. */
  verification?: boolean;
  /** Probability that a business is missing here before any sync (demo). */
  missing: number;
};

const EN_WEST = ["US", "GB", "CA", "AU", "IE", "NZ"];

export const DIRECTORIES: Directory[] = [
  { id: "google", name: "Google Business Profile", domain: "google.com", kind: "maps", weight: 10, markets: "global", verification: true, missing: 0.04 },
  { id: "bing", name: "Bing Places", domain: "bingplaces.com", kind: "search", weight: 6, markets: "global", missing: 0.3 },
  { id: "apple", name: "Apple Business Connect", domain: "businessconnect.apple.com", kind: "maps", weight: 7, markets: "global", verification: true, missing: 0.38 },
  { id: "facebook", name: "Facebook", domain: "facebook.com", kind: "social", weight: 6, markets: "global", missing: 0.12 },
  { id: "yelp", name: "Yelp", domain: "yelp.com", kind: "reviews", weight: 6, markets: [...EN_WEST, "DE", "FR", "ES", "IT", "NL", "SE", "SG", "MX", "BR"], missing: 0.2 },
  { id: "foursquare", name: "Foursquare", domain: "foursquare.com", kind: "directory", weight: 4, markets: "global", missing: 0.28 },
  { id: "tripadvisor", name: "Tripadvisor", domain: "tripadvisor.com", kind: "reviews", weight: 4, markets: "global", missing: 0.34 },
  { id: "yellowpages", name: "Yellow Pages", domain: "yellowpages.com", kind: "directory", weight: 3, markets: ["US", "CA", "IN", "AU", "NZ", "AE", "SG", "PH", "ZA"], missing: 0.3 },
  { id: "yell", name: "Yell", domain: "yell.com", kind: "directory", weight: 4, markets: ["GB", "IE"], missing: 0.26 },
  { id: "nextdoor", name: "Nextdoor", domain: "nextdoor.com", kind: "social", weight: 3, markets: [...EN_WEST, "NL", "DE", "FR", "ES", "IT", "SE"], missing: 0.42 },
  { id: "justdial", name: "Justdial", domain: "justdial.com", kind: "directory", weight: 7, markets: ["IN"], verification: true, missing: 0.14 },
  { id: "sulekha", name: "Sulekha", domain: "sulekha.com", kind: "directory", weight: 4, markets: ["IN"], missing: 0.32 },
  { id: "indiamart", name: "IndiaMART", domain: "indiamart.com", kind: "directory", weight: 4, markets: ["IN"], missing: 0.4 },
  { id: "bbb", name: "Better Business Bureau", domain: "bbb.org", kind: "reviews", weight: 4, markets: ["US", "CA"], missing: 0.36 },
  { id: "manta", name: "Manta", domain: "manta.com", kind: "directory", weight: 2, markets: ["US"], missing: 0.4 },
  { id: "here", name: "HERE WeGo", domain: "here.com", kind: "navigation", weight: 3, markets: "global", missing: 0.33 },
  { id: "tomtom", name: "TomTom", domain: "tomtom.com", kind: "navigation", weight: 3, markets: "global", missing: 0.36 },
  { id: "waze", name: "Waze", domain: "waze.com", kind: "navigation", weight: 3, markets: "global", missing: 0.3 },
  { id: "trustpilot", name: "Trustpilot", domain: "trustpilot.com", kind: "reviews", weight: 3, markets: "global", missing: 0.4 },
  { id: "hotfrog", name: "Hotfrog", domain: "hotfrog.com", kind: "directory", weight: 2, markets: "global", missing: 0.45 },
  { id: "cylex", name: "Cylex", domain: "cylex.net", kind: "directory", weight: 2, markets: "global", missing: 0.45 },
];

export const KIND_LABELS: Record<DirectoryKind, string> = {
  maps: "Maps",
  search: "Search engine",
  social: "Social",
  reviews: "Reviews",
  directory: "Directory",
  navigation: "Navigation",
};

export function directoriesFor(country: string) {
  return DIRECTORIES.filter((d) => d.markets === "global" || d.markets.includes(country));
}
export const directoryById = (id: string) => DIRECTORIES.find((d) => d.id === id);
