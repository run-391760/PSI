/**
 * Lexicon-based sentiment heuristic (no ML): sums word polarities with negation and intensifier
 * handling, then squashes to -1..1. Deterministic and explainable; used for news headlines,
 * social mentions, reviews and AI answers. Pure: safe on server and client.
 */
export type Sentiment = "positive" | "neutral" | "negative";

const POS = `good great excellent amazing awesome best better love loved lovely wonderful fantastic outstanding superb brilliant
helpful friendly professional clean recommend recommended recommends perfect happy pleased satisfied impressive impressed
reliable trusted trust quality affordable reasonable fast quick smooth easy efficient courteous polite caring knowledgeable
expert experienced skilled thorough attentive welcoming comfortable spacious modern fresh delicious tasty beautiful nice
enjoy enjoyed enjoyable exceptional incredible fabulous top leading award awarded awards wins win won winner honoured honored
ranked ranking accredited accreditation launch launches launched partnership partners collaboration record growth growing
success successful achieve achieves achieved achievement milestone celebrate celebrates celebrated boost boosts improved
improves improvement innovative innovation opportunity opportunities scholarship scholarships placement placements hired
excellence proud prestigious recognised recognized recognition praise praised applaud gold bright breakthrough expands
expansion invest investment funding secures secured strong robust support supportive grateful thanks thank thankful
positive benefit benefits valuable transparent seamless convenient flexible genuine fair responsive`;

const NEG = `bad poor terrible awful horrible worst worse hate hated rude unprofessional dirty slow expensive overpriced
disappointed disappointing disappointment problem problems issue issues complaint complaints complain complained scam fraud
fake cheated cheat mislead misleading misled refund refused waste wasted useless broken damaged delay delayed delays late
unhelpful ignored ignore careless crowded noisy smelly unsafe dangerous negligent negligence lawsuit sued sue arrested arrest
probe investigation raid protest protests protested controversy controversial allegation allegations alleged accused
harassment ragging suicide death died dies dead injured injury accident fire fined fine penalty ban banned suspended
suspension shut closure closed strike violence clash clashes fail failed failure fails crisis collapse losses loss decline
declines declined drop drops dropped layoffs layoff fired leak leaked breach hack hacked outage error errors bug bugs
unreliable nightmare avoid pathetic worthless mess messy chaos chaotic confusing confused hidden rip ripoff overcharged
charged extra unanswered cancelled canceled cancellation stolen theft cold rotten stale wrong mistake mistakes irresponsible
concern concerns worried warning warns threat threats risk risky fear angry anger upset frustrating frustrated frustration`;

const LEXICON = new Map<string, number>();
for (const w of POS.split(/\s+/)) if (w) LEXICON.set(w, 1);
for (const w of NEG.split(/\s+/)) if (w) LEXICON.set(w, -1);
// Stronger cues.
for (const w of ["scam", "fraud", "worst", "terrible", "horrible", "awful", "suicide", "death", "arrested", "lawsuit", "nightmare", "pathetic", "harassment", "ragging"]) LEXICON.set(w, -2);
for (const w of ["excellent", "outstanding", "amazing", "exceptional", "fantastic", "superb", "brilliant", "award", "wins", "prestigious"]) LEXICON.set(w, 2);
// Words that read positive but are neutral/negative in context.
for (const w of ["fine", "closed"]) LEXICON.set(w, -0.5);

const NEGATORS = new Set(["not", "no", "never", "without", "hardly", "barely", "nothing", "none", "neither", "nor", "cannot", "dont", "didnt", "doesnt", "wasnt", "isnt", "arent", "werent", "wont", "couldnt", "shouldnt", "wouldnt", "hasnt", "havent"]);
const INTENSIFIERS = new Map([
  ["very", 1.5],
  ["extremely", 1.8],
  ["really", 1.3],
  ["so", 1.3],
  ["highly", 1.5],
  ["totally", 1.4],
  ["absolutely", 1.6],
  ["super", 1.4],
  ["quite", 1.1],
  ["most", 1.3],
]);

export function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/n't\b/g, "nt")
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Score in -1..1 plus a label. Rating (1–5 stars) can nudge the score when available. */
export function analyzeSentiment(text: string, rating?: number): { score: number; label: Sentiment; hits: { word: string; weight: number }[] } {
  const words = tokenize(text);
  let sum = 0;
  let count = 0;
  const hits: { word: string; weight: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    const base = LEXICON.get(words[i]);
    if (base == null) continue;
    let weight = base;
    // Look back up to 3 tokens for negators/intensifiers.
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (NEGATORS.has(words[j])) weight = -weight * 0.8;
      const boost = INTENSIFIERS.get(words[j]);
      if (boost && j === i - 1) weight *= boost;
    }
    sum += weight;
    count++;
    hits.push({ word: words[i], weight: Math.round(weight * 100) / 100 });
  }
  let score = count ? Math.tanh(sum / Math.sqrt(count + 1)) : 0;
  if (rating != null) score = 0.55 * score + 0.45 * ((rating - 3) / 2);
  score = Math.round(score * 100) / 100;
  const label: Sentiment = score >= 0.15 ? "positive" : score <= -0.15 ? "negative" : "neutral";
  return { score, label, hits };
}

export const SENTIMENT_META: Record<Sentiment, { label: string; tone: "good" | "neutral" | "critical"; color: string }> = {
  positive: { label: "Positive", tone: "good", color: "var(--good)" },
  neutral: { label: "Neutral", tone: "neutral", color: "var(--text-3)" },
  negative: { label: "Negative", tone: "critical", color: "var(--critical)" },
};
