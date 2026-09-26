/**
 * Vocabulary for the demo engine. Leader domains are real, well-known sites so demo screens look
 * familiar; every number the engine attaches to them is synthetic and labelled "Demo data".
 * A leader written "site.com@IN" has India as its home market.
 */
export type Topic = {
  id: string;
  name: string;
  /** Head terms (the topic's main keyword families). */
  heads: string[];
  /** Topic-specific modifiers appended to heads. */
  modifiers: string[];
  /** Category leaders in the SERPs. */
  leaders: string[];
  /** Word stems for generated niche domains. */
  stems: string[];
  /** Relative CPC level (USD) for a commercial keyword in this topic. */
  cpc: number;
  /** 12 monthly multipliers, Jan..Dec. */
  season: number[];
  /** Topic popularity multiplier for volumes. */
  popularity: number;
  /** Tokens that identify the topic in a domain or keyword. */
  signals: string[];
};

const flat = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

export const TOPICS: Topic[] = [
  {
    id: "education",
    name: "Education",
    heads: ["online courses", "mba", "engineering colleges", "university admission", "scholarships", "b tech", "data science course", "mba colleges", "nursing course", "law school", "medical college", "distance learning", "study abroad", "entrance exam", "phd programs", "certificate courses", "mbbs", "college rankings", "computer science degree", "business school", "online degree", "diploma courses", "pharmacy college", "hotel management course", "fashion design course", "ielts coaching", "gre preparation", "bba", "bca", "cyber security course"],
    modifiers: ["admission", "fees", "eligibility", "syllabus", "placements", "ranking", "cut off", "scholarship", "hostel", "courses", "application form", "last date", "entrance exam", "duration", "salary after", "scope", "colleges in india", "online", "near me", "for international students"],
    leaders: ["coursera.org", "udemy.com", "edx.org", "khanacademy.org", "shiksha.com@IN", "collegedunia.com@IN", "careers360.com@IN", "topuniversities.com", "usnews.com", "timeshighereducation.com", "harvard.edu", "mit.edu", "upgrad.com@IN", "simplilearn.com", "collegedekho.com@IN", "niche.com", "princetonreview.com", "unacademy.com@IN"],
    stems: ["study", "edu", "learn", "campus", "course", "class", "tutor", "college", "scholar", "exam", "degree", "academy"],
    cpc: 3.2,
    season: [0.95, 0.9, 0.95, 1.0, 1.15, 1.3, 1.25, 1.1, 0.95, 0.85, 0.8, 0.8],
    popularity: 1,
    signals: ["university", "college", "school", "edu", "academy", "institute", "learn", "course", "study", "campus", "tutor", "exam", "ac"],
  },
  {
    id: "fashion",
    name: "Fashion & Apparel",
    heads: ["running shoes", "sneakers", "dresses", "jeans", "t shirts", "handbags", "watches", "sunglasses", "jackets", "boots", "kurta", "saree", "hoodies", "sandals", "wallets", "backpacks", "jewelry", "leggings", "formal shoes", "sports bra", "swimsuits", "winter coats", "linen shirts", "wedding dresses"],
    modifiers: ["for women", "for men", "for kids", "sale", "online", "brands", "size chart", "under 50", "black", "white", "leather", "cotton", "near me", "discount code", "outfit ideas", "wide fit", "waterproof", "casual", "designer", "plus size"],
    leaders: ["amazon.com", "nike.com", "adidas.com", "zara.com", "hm.com", "myntra.com@IN", "asos.com@GB", "nordstrom.com", "macys.com", "flipkart.com@IN", "ajio.com@IN", "shein.com", "uniqlo.com", "zappos.com", "footlocker.com", "farfetch.com@GB"],
    stems: ["style", "wear", "closet", "fashion", "thread", "stitch", "vogue", "outfit", "trend", "chic", "attire", "boutique"],
    cpc: 1.4,
    season: [0.9, 0.85, 0.95, 1.0, 1.0, 0.95, 0.95, 1.0, 1.0, 1.05, 1.35, 1.4],
    popularity: 1.3,
    signals: ["shoe", "shoes", "fashion", "wear", "cloth", "apparel", "style", "boutique", "dress", "jeans", "shop", "store", "outfit"],
  },
  {
    id: "software",
    name: "Software & SaaS",
    heads: ["crm software", "project management tool", "email marketing software", "vpn", "antivirus", "web hosting", "website builder", "password manager", "cloud storage", "accounting software", "video editing software", "note taking app", "hr software", "help desk software", "ai writing tool", "chatbot", "invoice software", "payroll software", "time tracking app", "erp software", "screen recorder", "pdf editor"],
    modifiers: ["for small business", "free", "pricing", "reviews", "alternatives", "open source", "for mac", "for windows", "comparison", "features", "trial", "enterprise", "api", "integrations", "for startups", "download", "login", "tutorial", "vs", "best"],
    leaders: ["hubspot.com", "salesforce.com", "monday.com", "asana.com", "g2.com", "capterra.com", "zapier.com", "atlassian.com", "notion.so", "mailchimp.com", "nordvpn.com", "bluehost.com", "wix.com", "squarespace.com", "techradar.com", "pcmag.com", "zoho.com", "microsoft.com"],
    stems: ["soft", "app", "cloud", "stack", "flow", "desk", "base", "sync", "logic", "byte", "dev", "code"],
    cpc: 8.5,
    season: [1.05, 1.05, 1.05, 1.0, 1.0, 0.95, 0.9, 0.95, 1.0, 1.05, 1.0, 0.9],
    popularity: 0.9,
    signals: ["app", "soft", "software", "cloud", "tech", "saas", "hq", "dev", "code", "io", "ai", "data", "labs", "stack"],
  },
  {
    id: "marketing",
    name: "Digital Marketing",
    heads: ["seo", "keyword research", "backlinks", "digital marketing", "content marketing", "social media marketing", "google ads", "link building", "local seo", "technical seo", "seo audit", "ppc", "marketing automation", "conversion rate optimization", "google analytics", "on page seo", "affiliate marketing", "influencer marketing", "landing page", "email marketing"],
    modifiers: ["tools", "course", "agency", "services", "strategy", "checklist", "tips", "for beginners", "certification", "examples", "salary", "jobs", "pricing", "near me", "free", "template", "report", "software", "company", "tutorial"],
    leaders: ["semrush.com", "ahrefs.com", "moz.com", "searchenginejournal.com", "backlinko.com", "neilpatel.com", "hubspot.com", "searchengineland.com", "wordstream.com", "yoast.com", "similarweb.com", "google.com", "sproutsocial.com", "hootsuite.com"],
    stems: ["rank", "seo", "growth", "market", "lead", "funnel", "click", "serp", "brand", "promo", "digital", "traffic"],
    cpc: 7.2,
    season: [1.05, 1.05, 1.05, 1.0, 1.0, 0.95, 0.9, 0.95, 1.0, 1.05, 1.0, 0.9],
    popularity: 0.7,
    signals: ["seo", "marketing", "agency", "digital", "media", "rank", "growth", "ads", "brand", "social"],
  },
  {
    id: "travel",
    name: "Travel",
    heads: ["cheap flights", "hotels", "vacation packages", "travel insurance", "car rental", "things to do", "beach resorts", "honeymoon destinations", "visa", "cruise", "hostels", "tour packages", "road trip", "travel deals", "best time to visit", "itinerary", "train tickets", "holiday homes", "all inclusive resorts", "weekend getaways"],
    modifiers: ["in goa", "in paris", "in bali", "in dubai", "in london", "in new york", "near me", "for couples", "for families", "cheap", "luxury", "last minute", "deals", "booking", "reviews", "2026", "from delhi", "from london", "packages", "with pool"],
    leaders: ["booking.com", "expedia.com", "tripadvisor.com", "airbnb.com", "kayak.com", "skyscanner.net@GB", "lonelyplanet.com", "makemytrip.com@IN", "hotels.com", "agoda.com", "trivago.com", "travelandleisure.com", "cntraveler.com", "timeout.com"],
    stems: ["trip", "travel", "tour", "wander", "journey", "voyage", "roam", "getaway", "holiday", "nomad", "jet", "passport"],
    cpc: 1.9,
    season: [0.85, 0.85, 1.0, 1.05, 1.15, 1.3, 1.35, 1.2, 0.95, 0.85, 0.8, 0.95],
    popularity: 1.2,
    signals: ["travel", "trip", "tour", "hotel", "holiday", "vacation", "flight", "resort", "journey", "voyage", "stay"],
  },
  {
    id: "finance",
    name: "Finance",
    heads: ["credit card", "personal loan", "mortgage rates", "home loan", "savings account", "stock market", "mutual funds", "life insurance", "car insurance", "bitcoin price", "tax calculator", "retirement planning", "budgeting", "credit score", "investing", "fixed deposit", "gold price", "health insurance", "trading app", "business loan", "student loan"],
    modifiers: ["interest rates", "calculator", "for bad credit", "online", "apply", "eligibility", "today", "comparison", "best", "for beginners", "rewards", "no annual fee", "emi", "benefits", "for students", "tax benefits", "documents required", "rates", "near me", "app"],
    leaders: ["nerdwallet.com", "bankrate.com", "investopedia.com", "forbes.com", "fool.com", "moneycontrol.com@IN", "cnbc.com", "bloomberg.com", "yahoo.com", "policybazaar.com@IN", "creditkarma.com", "experian.com", "coinmarketcap.com", "zerodha.com@IN", "chase.com"],
    stems: ["money", "cash", "fin", "wealth", "invest", "credit", "loan", "fund", "capital", "coin", "budget", "bank"],
    cpc: 14,
    season: [1.15, 1.1, 1.05, 1.0, 0.95, 0.95, 0.95, 0.95, 1.0, 1.0, 0.95, 0.95],
    popularity: 1.1,
    signals: ["bank", "finance", "money", "loan", "credit", "invest", "capital", "fund", "wealth", "pay", "insurance", "coin", "tax"],
  },
  {
    id: "health",
    name: "Health & Wellness",
    heads: ["weight loss", "diabetes", "high blood pressure", "back pain", "anxiety", "keto diet", "vitamin d", "headache", "pregnancy", "sleep", "hair loss", "yoga", "meditation", "protein", "cholesterol", "thyroid", "migraine", "therapy", "intermittent fasting", "gut health"],
    modifiers: ["symptoms", "treatment", "causes", "diet", "exercises", "home remedies", "medicine", "test", "in women", "in men", "foods", "tips", "chart", "levels", "doctor near me", "supplements", "natural", "for beginners", "side effects", "how to"],
    leaders: ["healthline.com", "webmd.com", "mayoclinic.org", "clevelandclinic.org", "medicalnewstoday.com", "nih.gov", "cdc.gov", "verywellhealth.com", "everydayhealth.com", "who.int", "practo.com@IN", "1mg.com@IN", "nhs.uk@GB", "psychologytoday.com"],
    stems: ["health", "care", "well", "vital", "cure", "med", "body", "life", "fit", "clinic", "heal", "pulse"],
    cpc: 3.8,
    season: [1.3, 1.15, 1.05, 1.0, 1.0, 0.95, 0.9, 0.9, 0.95, 0.95, 0.9, 0.85],
    popularity: 1.3,
    signals: ["health", "care", "clinic", "hospital", "med", "doctor", "pharma", "wellness", "cure", "dental", "therapy", "fit"],
  },
  {
    id: "food",
    name: "Food & Recipes",
    heads: ["recipes", "chicken recipes", "pasta", "pizza", "cake recipe", "vegan recipes", "air fryer recipes", "biryani", "soup", "salad", "breakfast ideas", "smoothie", "cookies", "bread", "curry", "dinner ideas", "meal prep", "food delivery", "coffee", "restaurants"],
    modifiers: ["recipe", "easy", "healthy", "near me", "without oven", "for kids", "indian style", "quick", "vegetarian", "calories", "ingredients", "at home", "step by step", "with chicken", "for weight loss", "keto", "gluten free", "best", "open now", "delivery"],
    leaders: ["allrecipes.com", "foodnetwork.com", "bonappetit.com", "seriouseats.com", "delish.com", "tasty.co", "simplyrecipes.com", "bbcgoodfood.com@GB", "epicurious.com", "hebbarskitchen.com@IN", "zomato.com@IN", "swiggy.com@IN", "doordash.com", "ubereats.com"],
    stems: ["cook", "kitchen", "chef", "recipe", "taste", "spice", "bake", "feast", "bite", "flavor", "dish", "yum"],
    cpc: 0.9,
    season: [1.0, 0.95, 0.95, 0.95, 0.95, 0.9, 0.9, 0.9, 0.95, 1.05, 1.25, 1.3],
    popularity: 1.4,
    signals: ["food", "recipe", "kitchen", "cook", "chef", "bake", "restaurant", "cafe", "eat", "taste", "pizza", "coffee"],
  },
  {
    id: "real-estate",
    name: "Real Estate",
    heads: ["homes for sale", "apartments for rent", "real estate agent", "house prices", "mortgage calculator", "condos", "land for sale", "commercial property", "plots", "villa", "2 bhk flat", "home value", "realtor", "property management", "first time home buyer", "housing market", "luxury homes", "studio apartment"],
    modifiers: ["near me", "in bangalore", "in mumbai", "in austin", "in london", "for sale", "for rent", "under 50 lakhs", "prices", "listings", "by owner", "cheap", "new", "with garden", "furnished", "2026", "trends", "agents", "investment", "resale"],
    leaders: ["zillow.com", "realtor.com", "redfin.com", "trulia.com", "apartments.com", "rightmove.co.uk@GB", "zoopla.co.uk@GB", "magicbricks.com@IN", "99acres.com@IN", "housing.com@IN", "homes.com", "loopnet.com"],
    stems: ["home", "house", "realty", "estate", "property", "nest", "dwell", "key", "roof", "land", "haven", "abode"],
    cpc: 4.1,
    season: [0.9, 0.95, 1.05, 1.1, 1.15, 1.1, 1.05, 1.0, 0.95, 0.95, 0.9, 0.85],
    popularity: 1,
    signals: ["realty", "estate", "home", "homes", "property", "house", "realtor", "rent", "land", "builders", "developers"],
  },
  {
    id: "automotive",
    name: "Automotive",
    heads: ["used cars", "electric cars", "suv", "car insurance quotes", "car loan", "tesla", "car price", "bike", "scooter", "tyres", "car service", "hybrid cars", "best cars", "car accessories", "motorcycle", "ev charging", "car wash", "car parts", "pickup truck"],
    modifiers: ["for sale", "near me", "price", "on road price", "mileage", "reviews", "2026", "under 10 lakhs", "for family", "specs", "top speed", "range", "colors", "dealers", "finance", "lease deals", "comparison", "interior", "problems", "maintenance cost"],
    leaders: ["cars.com", "autotrader.com", "edmunds.com", "kbb.com", "caranddriver.com", "motortrend.com", "cardekho.com@IN", "carwale.com@IN", "carmax.com", "tesla.com", "bikewale.com@IN", "carvana.com", "topgear.com@GB"],
    stems: ["auto", "car", "motor", "drive", "wheel", "gear", "rev", "ride", "garage", "turbo", "fleet", "torque"],
    cpc: 2.6,
    season: [0.95, 0.95, 1.1, 1.05, 1.05, 1.0, 1.0, 1.0, 0.95, 1.0, 0.95, 0.9],
    popularity: 1,
    signals: ["auto", "car", "cars", "motor", "motors", "drive", "garage", "tyre", "bike", "vehicle", "ev"],
  },
  {
    id: "home",
    name: "Home & Garden",
    heads: ["kitchen remodel", "bathroom ideas", "paint colors", "flooring", "roofing", "plumber", "electrician", "furniture", "sofa", "mattress", "curtains", "lighting", "garden", "landscaping", "home decor", "wallpaper", "tiles", "air conditioner", "water heater", "solar panels"],
    modifiers: ["ideas", "near me", "cost", "for small spaces", "modern", "diy", "cheap", "installation", "reviews", "best", "for living room", "for bedroom", "online", "sale", "designs", "contractors", "2026 trends", "brands", "repair", "price"],
    leaders: ["homedepot.com", "lowes.com", "houzz.com", "wayfair.com", "ikea.com", "bhg.com", "thespruce.com", "hgtv.com", "angi.com", "thisoldhouse.com", "pepperfry.com@IN", "urbanladder.com@IN", "architecturaldigest.com"],
    stems: ["home", "decor", "nest", "cozy", "casa", "habitat", "interior", "craft", "build", "fix", "garden", "room"],
    cpc: 3.1,
    season: [0.85, 0.9, 1.05, 1.15, 1.2, 1.15, 1.05, 1.0, 0.95, 0.95, 0.9, 0.85],
    popularity: 1,
    signals: ["home", "decor", "interior", "furniture", "garden", "build", "roof", "paint", "plumb", "design", "living", "casa"],
  },
  {
    id: "fitness",
    name: "Fitness & Sports",
    heads: ["workout", "home workout", "gym", "running", "cycling", "protein powder", "yoga mat", "dumbbells", "treadmill", "football", "cricket", "basketball", "tennis", "marathon", "fitness tracker", "abs workout", "hiit", "pilates", "swimming", "creatine"],
    modifiers: ["for beginners", "plan", "near me", "at home", "for women", "for men", "equipment", "benefits", "schedule", "shoes", "tips", "app", "classes", "membership", "price", "results", "routine", "training", "diet", "score"],
    leaders: ["menshealth.com", "womenshealthmag.com", "runnersworld.com", "bodybuilding.com", "espn.com", "cricbuzz.com@IN", "espncricinfo.com", "strava.com", "myfitnesspal.com", "verywellfit.com", "decathlon.com", "garmin.com"],
    stems: ["fit", "gym", "muscle", "sport", "strong", "active", "pulse", "stride", "flex", "core", "sweat", "power"],
    cpc: 1.6,
    season: [1.45, 1.2, 1.05, 1.0, 1.0, 0.95, 0.95, 0.9, 0.9, 0.9, 0.85, 0.85],
    popularity: 1.1,
    signals: ["fit", "gym", "sport", "sports", "athletic", "yoga", "run", "muscle", "cricket", "football", "club"],
  },
  {
    id: "gaming",
    name: "Gaming & Entertainment",
    heads: ["games", "ps5", "xbox", "nintendo switch", "minecraft", "fortnite", "gaming laptop", "gaming pc", "gta 6", "pc games", "free games", "mobile games", "steam deck", "valorant", "roblox", "movies", "netflix", "anime", "tv shows", "music"],
    modifiers: ["release date", "price", "reviews", "download", "online", "free", "for pc", "for android", "best", "2026", "trailer", "tips", "codes", "update", "system requirements", "deals", "cast", "streaming", "wiki", "upcoming"],
    leaders: ["ign.com", "gamespot.com", "polygon.com", "steampowered.com", "epicgames.com", "imdb.com", "rottentomatoes.com", "netflix.com", "kotaku.com", "pcgamer.com", "twitch.tv", "fandom.com", "spotify.com"],
    stems: ["game", "play", "pixel", "quest", "arcade", "level", "boss", "loot", "respawn", "gamer", "stream", "clip"],
    cpc: 0.8,
    season: [1.0, 0.95, 0.95, 0.9, 0.9, 0.95, 1.0, 1.0, 0.95, 1.0, 1.15, 1.25],
    popularity: 1.4,
    signals: ["game", "games", "gaming", "play", "movie", "film", "music", "stream", "tv", "anime", "esports"],
  },
  {
    id: "legal",
    name: "Legal Services",
    heads: ["lawyer", "divorce lawyer", "personal injury lawyer", "immigration lawyer", "will", "power of attorney", "trademark registration", "company registration", "llc", "contract template", "tenant rights", "criminal lawyer", "patent", "gst registration", "legal advice", "notary", "employment law", "bankruptcy", "small claims court"],
    modifiers: ["near me", "cost", "fees", "free consultation", "online", "process", "documents required", "form", "how to", "in india", "in california", "in texas", "uk", "for small business", "template", "requirements", "timeline", "rules", "best", "reviews"],
    leaders: ["findlaw.com", "avvo.com", "justia.com", "nolo.com", "legalzoom.com", "cornell.edu", "martindale.com", "rocketlawyer.com", "lawyers.com", "uscis.gov", "indiafilings.com@IN", "vakilsearch.com@IN"],
    stems: ["law", "legal", "counsel", "justice", "attorney", "brief", "verdict", "advocate", "court", "rights", "claim", "firm"],
    cpc: 22,
    season: [1.1, 1.05, 1.05, 1.0, 1.0, 0.95, 0.95, 0.95, 1.0, 1.0, 0.95, 0.9],
    popularity: 0.7,
    signals: ["law", "legal", "attorney", "lawyer", "advocate", "counsel", "firm", "justice", "court"],
  },
  {
    id: "pets",
    name: "Pets",
    heads: ["dog food", "cat food", "puppy", "dog breeds", "cat breeds", "pet insurance", "dog training", "vet", "dog bed", "cat litter", "aquarium", "dog toys", "pet grooming", "dog harness", "kitten", "adopt a dog", "dog treats", "bird cage"],
    modifiers: ["for puppies", "near me", "best", "for small dogs", "for large dogs", "price", "reviews", "grain free", "homemade", "online", "for sale", "tips", "cost", "for seniors", "natural", "brands", "subscription", "delivery", "list", "names"],
    leaders: ["chewy.com", "petco.com", "petsmart.com", "akc.org", "rover.com", "thesprucepets.com", "petmd.com", "dogster.com", "catster.com", "petfinder.com", "supertails.com@IN"],
    stems: ["pet", "paw", "pup", "furry", "tail", "whisker", "bark", "purr", "critter", "kennel", "fetch", "buddy"],
    cpc: 1.7,
    season: [0.95, 0.95, 1.0, 1.0, 1.05, 1.05, 1.05, 1.0, 0.95, 0.95, 1.0, 1.05],
    popularity: 0.9,
    signals: ["pet", "pets", "dog", "cat", "paw", "vet", "puppy", "animal", "kennel"],
  },
  {
    id: "beauty",
    name: "Beauty & Personal Care",
    heads: ["skincare routine", "moisturizer", "sunscreen", "lipstick", "foundation", "hair color", "shampoo", "serum", "face wash", "nail art", "makeup", "perfume for women", "hair oil", "retinol", "acne treatment", "eyeliner", "mascara", "hairstyles", "beard oil", "body lotion"],
    modifiers: ["for oily skin", "for dry skin", "for sensitive skin", "best", "under 500", "for men", "for women", "natural", "organic", "reviews", "shades", "how to apply", "at home", "dermatologist recommended", "korean", "brands", "for acne", "benefits", "online", "near me"],
    leaders: ["sephora.com", "ulta.com", "allure.com", "byrdie.com", "nykaa.com@IN", "purplle.com@IN", "paulaschoice.com", "cosmopolitan.com", "vogue.com", "elle.com", "loreal.com", "maccosmetics.com"],
    stems: ["glow", "beauty", "skin", "radiant", "bloom", "blush", "luxe", "pure", "silk", "velvet", "glam", "dew"],
    cpc: 1.5,
    season: [0.95, 1.0, 1.0, 1.0, 1.05, 1.05, 1.0, 0.95, 0.95, 1.0, 1.05, 1.1],
    popularity: 1.1,
    signals: ["beauty", "skin", "cosmetic", "glow", "salon", "spa", "hair", "makeup", "care"],
  },
  {
    id: "careers",
    name: "Jobs & Careers",
    heads: ["jobs", "remote jobs", "resume", "cover letter", "interview questions", "salary", "internship", "work from home jobs", "part time jobs", "government jobs", "freelance", "career change", "job search", "resume template", "software engineer jobs", "data analyst jobs", "nursing jobs", "teacher jobs"],
    modifiers: ["near me", "for freshers", "for students", "in bangalore", "in london", "in new york", "remote", "entry level", "sample", "examples", "format", "tips", "2026", "hiring", "online", "no experience", "apply", "salary", "questions and answers", "for experienced"],
    leaders: ["indeed.com", "linkedin.com", "glassdoor.com", "naukri.com@IN", "monster.com", "ziprecruiter.com", "simplyhired.com", "careerbuilder.com", "themuse.com", "upwork.com", "fiverr.com", "foundit.in@IN"],
    stems: ["job", "career", "hire", "work", "talent", "resume", "staff", "recruit", "gig", "skill", "role", "path"],
    cpc: 2.2,
    season: [1.2, 1.1, 1.05, 1.0, 1.0, 0.95, 0.95, 0.95, 1.0, 1.0, 0.9, 0.85],
    popularity: 1.1,
    signals: ["job", "jobs", "career", "careers", "hire", "hiring", "recruit", "talent", "work", "staffing"],
  },
  {
    id: "news",
    name: "News & Media",
    heads: ["news", "weather", "election results", "stock news", "sports news", "breaking news", "technology news", "world news", "local news", "cricket score", "live score", "horoscope", "business news", "entertainment news", "politics", "gold rate today", "petrol price", "olympics", "budget"],
    modifiers: ["today", "live", "updates", "headlines", "in hindi", "tomorrow", "this week", "near me", "2026", "latest", "app", "channel", "online", "highlights", "analysis", "podcast", "in english", "radar", "forecast", "results"],
    leaders: ["cnn.com", "bbc.com@GB", "nytimes.com", "theguardian.com@GB", "reuters.com", "apnews.com", "ndtv.com@IN", "indiatimes.com@IN", "hindustantimes.com@IN", "foxnews.com", "washingtonpost.com", "weather.com", "accuweather.com"],
    stems: ["news", "daily", "times", "post", "herald", "tribune", "report", "wire", "chronicle", "bulletin", "gazette", "today"],
    cpc: 0.6,
    season: flat,
    popularity: 1.6,
    signals: ["news", "times", "daily", "post", "media", "herald", "tribune", "report", "journal", "tv"],
  },
];

/** Big sites that rank across topics; `intents` controls where they appear. */
export const GIANTS: { domain: string; strength: number; intents: string[] }[] = [
  { domain: "wikipedia.org", strength: 0.99, intents: ["informational", "navigational"] },
  { domain: "youtube.com", strength: 0.99, intents: ["informational", "commercial"] },
  { domain: "reddit.com", strength: 0.97, intents: ["commercial", "informational"] },
  { domain: "quora.com", strength: 0.9, intents: ["informational"] },
  { domain: "amazon.com", strength: 0.98, intents: ["transactional", "commercial"] },
  { domain: "pinterest.com", strength: 0.9, intents: ["informational", "commercial"] },
  { domain: "linkedin.com", strength: 0.95, intents: ["informational", "navigational"] },
  { domain: "medium.com", strength: 0.9, intents: ["informational"] },
  { domain: "forbes.com", strength: 0.93, intents: ["commercial", "informational"] },
  { domain: "facebook.com", strength: 0.97, intents: ["navigational"] },
  { domain: "instagram.com", strength: 0.96, intents: ["navigational"] },
  { domain: "nytimes.com", strength: 0.93, intents: ["informational"] },
];

/** Domains that commonly link to others (for backlink samples). */
export const LINK_PLATFORMS = [
  "medium.com", "reddit.com", "linkedin.com", "github.com", "wordpress.com", "blogspot.com", "quora.com", "pinterest.com",
  "x.com", "facebook.com", "wikipedia.org", "youtube.com", "tumblr.com", "substack.com", "producthunt.com", "trustpilot.com",
  "yelp.com", "crunchbase.com", "about.me", "issuu.com", "slideshare.net", "scribd.com", "behance.net", "dribbble.com",
];

/** Spam-like domains used by Backlink Audit samples. */
export const SPAM_STEMS = ["seo-links", "free-backlinks", "casino-bonus", "cheap-pills", "link-directory", "article-spinner", "web-dir", "bestbuy-links", "top-rank", "crypto-profit", "loan-fast", "replica-watch", "rank-booster", "pr-network"];
export const SPAM_TLDS = [".xyz", ".top", ".info", ".biz", ".click", ".site", ".online", ".icu", ".work", ".ru"];

export const NICHE_SUFFIXES = ["hub", "pro", "guide", "zone", "world", "daily", "insider", "planet", "base", "nation", "pedia", "wise", "central", "point", "corner", "lab", "now", "spot", "mag", "life", "list", "geek", "boss", "direct"];
export const NICHE_PREFIXES = ["the", "my", "go", "get", "true", "smart", "simply", "all", "best", "top", "real", "just", "prime", "urban", "happy", "bright"];
export const NICHE_TLDS = [".com", ".com", ".com", ".com", ".net", ".org", ".io", ".co", ".in", ".co.uk", ".com.au", ".ca"];

/** Generic modifiers that can follow any seed keyword. */
export const SUFFIX_MODIFIERS = [
  "near me", "online", "for beginners", "for kids", "for women", "for men", "2026", "reviews", "price", "cost", "free", "ideas",
  "tips", "guide", "course", "app", "software", "list", "types", "benefits", "vs", "alternatives", "examples", "meaning",
  "definition", "template", "jobs", "salary", "in india", "uk", "usa", "at home", "for sale", "deals", "coupon", "comparison",
  "pros and cons", "requirements", "tutorial", "pdf", "images", "logo", "open now", "delivery", "rental", "services", "company",
  "brands", "under 100", "for small business", "for students", "checklist", "calculator", "chart", "history", "facts",
  "statistics", "trends", "quotes", "book", "reddit", "youtube", "wholesale", "subscription", "kit", "set", "diy", "near by", "for seniors", "australia", "canada", "dubai", "london", "bangalore", "mumbai", "new york",
];
export const PREFIX_MODIFIERS = [
  "best", "top", "cheap", "affordable", "buy", "types of", "free", "online", "local", "professional", "luxury", "used", "new",
  "custom", "portable", "organic", "natural", "small", "easy", "simple", "premium", "top rated", "how to choose",
];
export const QUESTION_TEMPLATES = [
  "what is {k}", "what is the best {k}", "how much does {k} cost", "is {k} worth it", "how to choose {k}", "where to buy {k}",
  "how does {k} work", "which {k} is best", "why is {k} important", "how to find {k}", "how to get {k}",
  "what are the benefits of {k}", "how long does {k} take", "can you get {k} online", "who offers the best {k}", "are {k} good",
  "how to use {k}", "what to look for in {k}", "when to buy {k}", "is {k} safe", "how to start {k}", "what is {k} used for",
];

/** Navigational modifiers for branded keywords. */
export const BRAND_MODIFIERS = [
  "", "login", "reviews", "contact number", "customer care", "near me", "app", "careers", "jobs", "address", "website",
  "official website", "hours", "coupon code", "price", "vs", "complaints", "email", "location", "portal",
];
export const TOPIC_BRAND_MODIFIERS: Record<string, string[]> = {
  education: ["admission", "admission 2026", "fees", "fees structure", "courses", "placement", "ranking", "hostel", "result", "scholarship", "cut off", "campus", "student portal", "erp login", "exam date", "notice", "recruitment", "nirf ranking", "reviews", "distance education"],
  fashion: ["sale", "store near me", "shoes", "online shopping", "size guide", "return policy", "gift card", "outlet", "new arrivals", "discount code"],
  software: ["pricing", "login", "download", "api", "free trial", "support", "integrations", "alternatives", "documentation", "status"],
  finance: ["login", "customer care number", "credit card", "net banking", "interest rates", "share price", "app download", "branch near me", "ifsc code", "loan"],
  travel: ["booking", "customer care", "flight status", "check in", "refund", "offers", "coupon code", "cancellation", "app", "rewards"],
  health: ["appointment", "doctors", "near me", "contact number", "reviews", "lab test", "pharmacy", "insurance", "careers", "locations"],
  food: ["menu", "near me", "delivery", "order online", "coupon", "franchise", "hours", "prices", "reservations", "offers"],
};

/** Common English words used to split concatenated brand labels ("paruluniversity" -> "parul university"). */
export const SEGMENT_WORDS = [
  "university", "college", "school", "academy", "institute", "global", "online", "digital", "media", "news", "times", "daily",
  "shop", "store", "market", "tech", "soft", "software", "cloud", "labs", "health", "care", "clinic", "travel", "tours",
  "trip", "home", "homes", "realty", "estate", "auto", "cars", "motors", "food", "kitchen", "cafe", "fashion", "style",
  "beauty", "fitness", "sports", "games", "gaming", "finance", "bank", "capital", "money", "legal", "law", "pets", "jobs",
  "career", "careers", "world", "group", "india", "hub", "pro", "zone", "point", "central", "solutions", "services",
  "systems", "network", "design", "studio", "agency", "marketing", "seo", "consulting", "learning", "education", "edu",
  "the", "my", "best", "top", "smart", "green", "blue", "red", "star", "sun", "city", "land", "life", "live", "info",
];

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
