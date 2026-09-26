/** Approximate coordinates for well-known cities (no geocoding API). Client-safe. */
const CITIES: Record<string, [number, number]> = {
  // India
  vadodara: [22.3072, 73.1812],
  baroda: [22.3072, 73.1812],
  ahmedabad: [23.0225, 72.5714],
  surat: [21.1702, 72.8311],
  rajkot: [22.3039, 70.8022],
  gandhinagar: [23.2156, 72.6369],
  mumbai: [19.076, 72.8777],
  pune: [18.5204, 73.8567],
  delhi: [28.6139, 77.209],
  "new delhi": [28.6139, 77.209],
  noida: [28.5355, 77.391],
  gurgaon: [28.4595, 77.0266],
  gurugram: [28.4595, 77.0266],
  bangalore: [12.9716, 77.5946],
  bengaluru: [12.9716, 77.5946],
  chennai: [13.0827, 80.2707],
  hyderabad: [17.385, 78.4867],
  kolkata: [22.5726, 88.3639],
  jaipur: [26.9124, 75.7873],
  lucknow: [26.8467, 80.9462],
  indore: [22.7196, 75.8577],
  kochi: [9.9312, 76.2673],
  chandigarh: [30.7333, 76.7794],
  // United States
  "new york": [40.7128, -74.006],
  brooklyn: [40.6782, -73.9442],
  "los angeles": [34.0522, -118.2437],
  chicago: [41.8781, -87.6298],
  houston: [29.7604, -95.3698],
  phoenix: [33.4484, -112.074],
  philadelphia: [39.9526, -75.1652],
  "san antonio": [29.4241, -98.4936],
  "san diego": [32.7157, -117.1611],
  dallas: [32.7767, -96.797],
  austin: [30.2672, -97.7431],
  "san francisco": [37.7749, -122.4194],
  seattle: [47.6062, -122.3321],
  denver: [39.7392, -104.9903],
  boston: [42.3601, -71.0589],
  miami: [25.7617, -80.1918],
  atlanta: [33.749, -84.388],
  // Rest of world
  london: [51.5074, -0.1278],
  manchester: [53.4808, -2.2426],
  birmingham: [52.4862, -1.8904],
  toronto: [43.6532, -79.3832],
  vancouver: [49.2827, -123.1207],
  montreal: [45.5017, -73.5673],
  sydney: [-33.8688, 151.2093],
  melbourne: [-37.8136, 144.9631],
  brisbane: [-27.4698, 153.0251],
  berlin: [52.52, 13.405],
  munich: [48.1351, 11.582],
  paris: [48.8566, 2.3522],
  madrid: [40.4168, -3.7038],
  barcelona: [41.3874, 2.1686],
  rome: [41.9028, 12.4964],
  milan: [45.4642, 9.19],
  amsterdam: [52.3676, 4.9041],
  dubai: [25.2048, 55.2708],
  "abu dhabi": [24.4539, 54.3773],
  singapore: [1.3521, 103.8198],
  johannesburg: [-26.2041, 28.0473],
  "cape town": [-33.9249, 18.4241],
  dublin: [53.3498, -6.2603],
  auckland: [-36.8485, 174.7633],
  manila: [14.5995, 120.9842],
  stockholm: [59.3293, 18.0686],
  tokyo: [35.6762, 139.6503],
  "mexico city": [19.4326, -99.1332],
  "sao paulo": [-23.5505, -46.6333],
};

/** Capital / main business hub per regional database. */
const COUNTRY_HUB: Record<string, string> = {
  US: "new york",
  GB: "london",
  IN: "mumbai",
  CA: "toronto",
  AU: "sydney",
  DE: "berlin",
  FR: "paris",
  ES: "madrid",
  IT: "rome",
  BR: "sao paulo",
  MX: "mexico city",
  JP: "tokyo",
  NL: "amsterdam",
  AE: "dubai",
  SG: "singapore",
  ZA: "johannesburg",
  IE: "dublin",
  NZ: "auckland",
  PH: "manila",
  SE: "stockholm",
};

export type GeoPoint = { lat: number; lng: number; approximate: boolean; basis: string };

/** Coordinates from explicit lat/lng, else a known city, else the market's main hub. */
export function locate(input: { lat?: number | null; lng?: number | null; city?: string | null; country: string }): GeoPoint {
  if (input.lat != null && input.lng != null) return { lat: input.lat, lng: input.lng, approximate: false, basis: "Business coordinates" };
  const city = (input.city || "").toLowerCase().split(",")[0].trim();
  if (city && CITIES[city]) return { lat: CITIES[city][0], lng: CITIES[city][1], approximate: true, basis: `${city.replace(/\b[a-z]/g, (c) => c.toUpperCase())} city centre` };
  const hub = COUNTRY_HUB[input.country] ?? "new york";
  return { lat: CITIES[hub][0], lng: CITIES[hub][1], approximate: true, basis: `${hub.replace(/\b[a-z]/g, (c) => c.toUpperCase())} (market default)` };
}

/** Offset a point by dx/dy kilometres (east/north). */
export function offsetKm(p: { lat: number; lng: number }, dxKm: number, dyKm: number) {
  const lat = p.lat + dyKm / 110.574;
  const lng = p.lng + dxKm / (111.32 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}
