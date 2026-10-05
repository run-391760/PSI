import type { CategoryId, ModuleId, Priority, Stage } from "./types";

/**
 * Catalogue of the optimizer (from "PSI Feature List 2026"): the 17 modules shown as top-navigation
 * tabs, the 8 weighted scoring categories and all 70 features. `kind: "check"` features audit the
 * draft and are scored; `kind: "tool"` features are the workflow, reporting, AI and planning tools.
 */

export type ModuleDef = { id: ModuleId; label: string; description: string };

export const MODULES: ModuleDef[] = [
  { id: "search-intent", label: "Search Intent", description: "Does the article match what searchers of the target query want?" },
  { id: "content-quality", label: "Content Quality", description: "People-first usefulness, completeness, depth, originality, claims, readability and structure." },
  { id: "on-page", label: "On-Page SEO", description: "Keyword mapping and placement, title, meta description, headings and URL." },
  { id: "serp-ai", label: "SERP & AI Search", description: "Featured snippets, People Also Ask and answers that AI search can extract." },
  { id: "topical", label: "Topical SEO", description: "Entities, subtopics, questions and gaps against competing pages." },
  { id: "eeat", label: "E-E-A-T & Trust", description: "Author expertise, first-hand experience, trust signals, risky claims and freshness." },
  { id: "links-ux", label: "Links & UX", description: "Relevance and quality of outbound links." },
  { id: "internal-linking", label: "Internal Linking", description: "Contextual links to your own pages and their anchor text." },
  { id: "conversion", label: "Conversion", description: "A next step for the reader that fits their stage in the funnel." },
  { id: "media-ux", label: "Media & UX", description: "Image SEO and where media would make the article more useful." },
  { id: "schema", label: "Schema", description: "Recommended structured data, JSON-LD generation and validation." },
  { id: "technical", label: "Technical SEO", description: "Article metadata, canonical and indexability before publishing." },
  { id: "ux", label: "UX", description: "Mobile reading, page experience and accessibility of the content." },
  { id: "workflow", label: "Workflow", description: "Pre-publish checklist, publication blockers, change history and publishing." },
  { id: "reporting", label: "Reporting", description: "Overall and category scores, issue severity, recommendations and before-vs-after." },
  { id: "ai-optimization", label: "AI Optimization", description: "Fix-it recommendations applied in one click, then re-scored." },
  { id: "content-planning", label: "Content Planning", description: "Content briefs with intent, outline, entities and questions before writing." },
];

export const moduleById = (id: string) => MODULES.find((m) => m.id === id) ?? null;

export type CategoryDef = { id: CategoryId; label: string; short: string; weight: number; measures: string };

export const CATEGORIES: CategoryDef[] = [
  { id: "intent", label: "Search Intent", short: "Search Intent", weight: 0.2, measures: "Does the article satisfy the user's actual query intent?" },
  { id: "quality", label: "Content Quality & Usefulness", short: "Content Quality", weight: 0.2, measures: "Depth, originality, information gain, readability and people-first usefulness" },
  { id: "topical", label: "Topical Coverage", short: "Topical Coverage", weight: 0.15, measures: "Subtopics, entities, questions and competitor content gaps" },
  { id: "onpage", label: "On-Page SEO", short: "On-Page SEO", weight: 0.15, measures: "Title, H1, headings, keyword relevance, metadata and URL" },
  { id: "eeat", label: "E-E-A-T & Trust", short: "E-E-A-T & Trust", weight: 0.1, measures: "Experience, expertise, source quality, claims and freshness" },
  { id: "serp", label: "SERP & AI Search Readiness", short: "AI / SERP Readiness", weight: 0.1, measures: "Answerability, SERP feature opportunities and clear extractable answers" },
  { id: "linking", label: "Internal Linking / UX / Conversion", short: "Linking / UX / Conversion", weight: 0.05, measures: "Internal links, CTA alignment, media and user experience" },
  { id: "technical", label: "Technical / Schema", short: "Technical / Schema", weight: 0.05, measures: "Indexability, canonical, metadata and structured data" },
];

export type FeatureDef = {
  id: string;
  name: string;
  module: ModuleId;
  description: string;
  priority: Priority;
  stage: Stage;
  kind: "check" | "tool";
  category?: CategoryId;
  /** Why it matters (shown with every recommendation). */
  why: string;
};

const f = (id: string, name: string, module: ModuleId, priority: Priority, stage: Stage, kind: "check" | "tool", category: CategoryId | undefined, description: string, why: string): FeatureDef => ({
  id,
  name,
  module,
  priority,
  stage,
  kind,
  category,
  description,
  why,
});

export const FEATURES: FeatureDef[] = [
  // Search Intent
  f("intent-analyzer", "Search Intent Analyzer", "search-intent", "critical", "Pre-Publish", "check", "intent", "Determines whether the article matches the dominant search intent for the target query", "Google ranks the format searchers want. An article written for the wrong intent rarely ranks, however well optimized."),
  f("intent-match", "Primary Intent Match Score", "search-intent", "critical", "Pre-Publish", "check", "intent", "Scores how closely the content satisfies the identified search intent", "Matching intent is the strongest predictor of whether a page can rank and keep readers."),
  f("intent-mismatch", "Search Intent Mismatch Detector", "search-intent", "critical", "Pre-Publish", "check", "intent", "Flags cases where the keyword intent and article content do not align", "A mismatch wastes the article: readers bounce and the page is outranked by pages that fit the intent."),
  f("serp-content", "SERP Content Analyzer", "search-intent", "high", "Pre-Publish", "check", "intent", "Analyzes relevant SERP competitors for topics, formats, headings, entities and content patterns", "The pages already ranking show the format, depth and topics Google rewards for this query."),
  f("serp-features", "SERP Feature Analyzer", "search-intent", "high", "Pre-Publish", "check", "serp", "Identifies relevant SERP features such as snippets, PAA, video, image and local opportunities", "SERP features take clicks from plain results; preparing for them earns extra visibility."),
  // Content Quality
  f("people-first", "People-First Content Auditor", "content-quality", "critical", "Pre-Publish", "check", "quality", "Evaluates whether the article genuinely helps the intended reader rather than being written primarily for search engines", "Google's helpful content system demotes pages written for search engines instead of people."),
  f("completeness", "Content Completeness Score", "content-quality", "critical", "Pre-Publish", "check", "quality", "Measures whether the article sufficiently addresses the important aspects of the topic", "Readers return to search when an article skips an important aspect; complete pages satisfy the visit."),
  f("depth", "Content Depth Analyzer", "content-quality", "high", "Pre-Publish", "check", "quality", "Evaluates depth and usefulness without relying on arbitrary word-count targets", "Shallow sections that restate the obvious add length without value."),
  f("originality", "Originality Analyzer", "content-quality", "critical", "Pre-Publish", "check", "quality", "Flags generic, repetitive or derivative content and identifies opportunities for original value", "Derivative content has no reason to rank above the pages it repeats."),
  f("information-gain", "Information Gain Analyzer", "content-quality", "critical", "Pre-Publish", "check", "quality", "Evaluates whether the article adds useful information beyond competing content", "Search systems favour pages that add something new over the results already shown."),
  f("first-hand", "First-Hand Experience Detector", "content-quality", "high", "Pre-Publish", "check", "quality", "Checks for original examples, observations, testing, case studies and practical experience", "Experience is the first E in E-E-A-T and is hard for competitors to copy."),
  f("factual-claims", "Factual Claim Detector", "content-quality", "critical", "Pre-Publish", "check", "eeat", "Identifies factual statements that may require verification or supporting evidence", "Wrong or unverifiable facts damage trust and can trigger reputational or legal risk."),
  f("citations", "Source & Citation Auditor", "content-quality", "high", "Pre-Publish", "check", "eeat", "Checks whether important factual claims are supported by credible and relevant sources", "Cited claims are more trustworthy to readers, quality raters and AI answer engines."),
  f("ai-patterns", "AI/Generic Content Pattern Detector", "content-quality", "medium", "Pre-Publish", "check", "quality", "Flags repetitive, formulaic or low-value AI-style writing patterns for editorial review", "Formulaic phrasing reads as low effort and lowers reader trust."),
  // On-Page SEO
  f("keyword-url", "Keyword-to-URL Mapping", "on-page", "high", "Pre-Publish", "check", "onpage", "Maps the primary keyword and search intent to the intended target URL", "One keyword per URL avoids cannibalization between your own pages."),
  f("keyword-relevance", "Primary Keyword Relevance", "on-page", "critical", "Pre-Publish", "check", "onpage", "Checks whether the primary keyword accurately represents the article's topic and intent", "A keyword that does not describe the article attracts the wrong searchers."),
  f("keyword-placement", "Keyword Placement Auditor", "on-page", "high", "Pre-Publish", "check", "onpage", "Checks natural keyword usage across title, H1, introduction, headings and body", "Placement in prominent elements tells search engines and readers what the page is about."),
  f("keyword-overuse", "Keyword Overuse Detector", "on-page", "high", "Pre-Publish", "check", "onpage", "Detects unnatural repetition or keyword stuffing", "Stuffing reads badly and can be treated as spam."),
  f("semantic-coverage", "Semantic Topic Coverage", "on-page", "high", "Pre-Publish", "check", "onpage", "Checks relevant concepts and terminology without encouraging keyword stuffing", "Related terms show topical understanding beyond the exact keyword."),
  f("title", "Title Optimizer", "on-page", "critical", "Pre-Publish", "check", "onpage", "Scores the title for relevance, clarity, intent alignment and search-result appeal", "The title is the strongest on-page signal and the headline searchers click."),
  f("meta-description", "Meta Description Optimizer", "on-page", "high", "Pre-Publish", "check", "onpage", "Evaluates relevance, clarity and usefulness of the meta description", "A clear description earns the click from the results page."),
  f("headings", "H1-H6 Hierarchy Auditor", "on-page", "high", "Pre-Publish", "check", "onpage", "Checks heading hierarchy, missing headings and structural consistency", "A clean hierarchy helps readers scan and helps machines understand the outline."),
  f("slug", "URL Slug Analyzer", "on-page", "medium", "Pre-Publish", "check", "onpage", "Evaluates URL relevance, readability and unnecessary parameters or complexity", "Short, descriptive URLs are easier to share and understand."),
  // SERP & AI Search
  f("featured-snippet", "Featured Snippet Optimizer", "serp-ai", "high", "Pre-Publish", "check", "serp", "Identifies content sections that could be structured clearly for snippet eligibility", "Concise answers, lists and tables under clear headings are what snippets extract."),
  f("paa-coverage", "PAA Question Coverage", "serp-ai", "high", "Pre-Publish", "check", "serp", "Identifies relevant People Also Ask questions that should potentially be addressed", "Answering the questions searchers ask widens the queries the page can rank for."),
  f("answerability", "AI Search Answerability Analyzer", "serp-ai", "high", "Pre-Publish", "check", "serp", "Checks whether important answers are clear, direct, well-supported and easy to extract", "AI Overviews and answer engines cite passages that answer directly and stand on their own."),
  // Topical SEO
  f("entities", "Entity Coverage Analyzer", "topical", "high", "Pre-Publish", "check", "topical", "Identifies important entities associated with the primary topic", "Entities (people, organizations, places, concepts) anchor the topic for search engines."),
  f("topic-cluster", "Topic Cluster Coverage", "topical", "critical", "Pre-Publish", "check", "topical", "Evaluates coverage of important subtopics surrounding the primary topic", "Covering the subtopics around a topic builds topical authority."),
  f("subtopic-gaps", "Subtopic Gap Finder", "topical", "critical", "Pre-Publish", "check", "topical", "Identifies important subtopics missing from the article", "Missing subtopics are the most common reason a page is outranked by a more complete one."),
  f("competitor-gaps", "Competitor Content Gap Analyzer", "topical", "high", "Pre-Publish", "check", "topical", "Compares article coverage against selected SERP competitors", "Knowing what ranking pages cover that you don't shows the cheapest improvements."),
  f("question-gaps", "Question Gap Analyzer", "topical", "high", "Pre-Publish", "check", "topical", "Finds relevant unanswered questions related to the target topic", "Unanswered questions send readers back to the results page."),
  // Content Quality (structure & style)
  f("structure", "Content Structure Analyzer", "content-quality", "high", "Pre-Publish", "check", "quality", "Evaluates introduction, sections, conclusion, lists, tables and overall flow", "Readers scan before they read; structure decides whether they stay."),
  f("readability", "Readability Score", "content-quality", "high", "Pre-Publish", "check", "quality", "Checks sentence complexity, paragraph length, jargon and overall readability", "Hard-to-read text loses readers, especially on mobile."),
  f("redundancy", "Redundancy Detector", "content-quality", "medium", "Pre-Publish", "check", "quality", "Finds repetitive sentences, paragraphs and concepts", "Repetition wastes the reader's time and signals padding."),
  f("filler", "Filler Content Detector", "content-quality", "high", "Pre-Publish", "check", "quality", "Identifies content that adds little value to the reader", "Filler dilutes useful content and lowers perceived quality."),
  f("introduction", "Introduction Analyzer", "content-quality", "high", "Pre-Publish", "check", "quality", "Checks whether the introduction quickly establishes the problem and value for the reader", "Most readers decide in the first few lines whether to keep reading."),
  f("conclusion", "Conclusion Analyzer", "content-quality", "medium", "Pre-Publish", "check", "quality", "Checks whether the conclusion summarizes useful takeaways and provides an appropriate next step", "A clear ending turns a read into an action."),
  // E-E-A-T & Trust
  f("author", "Author Expertise Auditor", "eeat", "high", "Pre-Publish", "check", "eeat", "Checks author information, credentials and topical relevance where appropriate", "Named, qualified authors make content more trustworthy, especially on YMYL topics."),
  f("experience-signals", "Experience Signal Analyzer", "eeat", "high", "Pre-Publish", "check", "eeat", "Looks for evidence of direct experience, examples, testing, case studies or original observations", "Evidence of real experience separates expert content from summaries."),
  f("trust-signals", "Trust Signal Auditor", "eeat", "high", "Pre-Publish", "check", "eeat", "Checks author, organization, contact, transparency and credibility signals", "Trust is the most important part of E-E-A-T."),
  f("claim-risk", "Claim Risk Analyzer", "eeat", "critical", "Pre-Publish", "check", "eeat", "Flags unsupported or high-risk claims, including absolute claims and sensitive factual assertions", "Absolute or unsupported claims create reputational, regulatory and legal risk."),
  f("freshness", "Freshness Analyzer", "eeat", "high", "Pre-Publish", "check", "eeat", "Identifies outdated statistics, dates, examples and references", "Outdated facts erode trust and lose to fresher pages."),
  // Links & UX
  f("external-links", "External Link Auditor", "links-ux", "medium", "Pre-Publish", "check", "eeat", "Checks external links for relevance, usefulness and source quality", "Linking to credible sources supports claims; broken or weak links undermine them."),
  // Internal Linking
  f("internal-opportunities", "Internal Link Opportunity Finder", "internal-linking", "high", "Pre-Publish", "check", "linking", "Recommends relevant internal pages that should be linked contextually", "Internal links pass authority and help readers and crawlers find related pages."),
  f("anchor-text", "Internal Anchor Text Optimizer", "internal-linking", "medium", "Pre-Publish", "check", "linking", "Suggests descriptive and contextually relevant anchor text", "Descriptive anchors tell users and search engines what the linked page is about."),
  // Conversion
  f("cta", "CTA Analyzer", "conversion", "medium", "Pre-Publish", "check", "linking", "Checks whether the article has an appropriate next action for the reader", "Without a next step, the traffic the article earns leaves without converting."),
  f("conversion-alignment", "Conversion Intent Alignment", "conversion", "high", "Pre-Publish", "check", "linking", "Checks whether CTA and conversion path match the user's stage in the funnel", "Asking for a hard conversion too early, or offering only a newsletter at the decision stage, loses conversions."),
  // Media & UX
  f("image-seo", "Image SEO Auditor", "media-ux", "medium", "Pre-Publish", "check", "linking", "Checks image relevance, alt text, filenames, captions and placement", "Alt text and descriptive filenames make images accessible and searchable."),
  f("media-opportunities", "Media Opportunity Finder", "media-ux", "medium", "Pre-Publish", "check", "linking", "Recommends where charts, videos, screenshots, tables or infographics could improve usefulness", "The right visual explains faster than text and earns image and video results."),
  // Schema
  f("schema-recommend", "Schema Recommendation Engine", "schema", "high", "Pre-Publish", "check", "technical", "Recommends applicable structured data based on the content and page type", "Structured data makes the page eligible for rich results."),
  f("schema-generate", "Schema Generator", "schema", "high", "Pre-Publish", "check", "technical", "Generates JSON-LD for applicable structured data", "Generated JSON-LD avoids hand-written syntax errors."),
  f("schema-validate", "Schema Validation", "schema", "high", "Pre-Publish", "check", "technical", "Validates schema properties and checks consistency with visible content", "Invalid or misleading structured data is ignored or can lead to a manual action."),
  // Technical SEO
  f("article-metadata", "Article Metadata Auditor", "technical", "medium", "Pre-Publish", "check", "technical", "Checks article metadata such as author and publication/update dates", "Dates and authorship are shown in results and used to judge freshness."),
  f("canonical", "Canonical Recommendation", "technical", "high", "Pre-Publish", "check", "technical", "Recommends appropriate canonical configuration", "A wrong canonical can remove the page from search entirely."),
  f("indexability", "Indexability Checklist", "technical", "critical", "Pre-Publish", "check", "technical", "Checks important indexability requirements such as noindex, robots and canonical considerations", "A page that cannot be indexed cannot rank, whatever its quality."),
  // UX
  f("mobile", "Mobile Content Check", "ux", "medium", "Pre-Publish", "check", "linking", "Checks content structure and readability for mobile users", "Most searches happen on phones; walls of text and wide tables fail there."),
  f("page-experience", "Page Experience Checklist", "ux", "medium", "Pre-Publish", "check", "linking", "Checks important page experience considerations before publication", "Navigation aids and light media keep the page fast and easy to use."),
  f("accessibility", "Accessibility Content Check", "ux", "medium", "Pre-Publish", "check", "linking", "Checks headings, alt text, link text, tables and other content accessibility basics", "Accessible content serves every reader and is easier for machines to parse."),
  // Workflow & reporting tools
  f("checklist", "Pre-Publish SEO Checklist", "workflow", "critical", "Pre-Publish", "tool", undefined, "Converts all findings into an actionable checklist before publication", ""),
  f("seo-score", "SEO Score", "reporting", "critical", "Reporting", "tool", undefined, "Generates the overall pre-publish SEO and content score out of 10", ""),
  f("category-scores", "Category Scores", "reporting", "critical", "Reporting", "tool", undefined, "Shows scores by major category such as intent, content, topical coverage and technical SEO", ""),
  f("severity", "Issue Severity Engine", "reporting", "critical", "Reporting", "tool", undefined, "Classifies findings into Critical, High, Medium and Low severity", ""),
  f("ai-recommendations", "AI Recommendations", "reporting", "critical", "Reporting", "tool", undefined, "Explains what to fix, why it matters and how to improve it", ""),
  f("before-after", "Before vs After Score", "reporting", "high", "Reporting", "tool", undefined, "Shows how the score changes after content improvements", ""),
  f("readiness", "Publish Readiness Score", "reporting", "critical", "Reporting", "tool", undefined, "Indicates whether major pre-publish issues remain", ""),
  f("history", "SEO Change History", "workflow", "medium", "Monitoring", "tool", undefined, "Tracks content revisions and score changes over time", ""),
  f("blockers", "Critical SEO Errors / Publication Blockers", "workflow", "critical", "Pre-Publish", "tool", undefined, "Flags issues that should prevent publication regardless of the overall score", ""),
  f("fix-it", "Fix-It Recommendations", "ai-optimization", "critical", "Pre-Publish", "tool", undefined, "Provides rewritten text, structure suggestions or specific fixes for detected issues", ""),
  f("apply-rescore", "One-Click AI Apply & Re-score", "ai-optimization", "critical", "Pre-Publish", "tool", undefined, "Applies an approved recommendation and immediately recalculates affected scores", ""),
  f("brief", "AI Content Brief Generator", "content-planning", "high", "Pre-Writing", "tool", undefined, "Generates a content brief with intent, outline, entities, questions and recommended coverage before writing", ""),
];

export const CHECKS = FEATURES.filter((x) => x.kind === "check");
export const featureById = (id: string) => FEATURES.find((x) => x.id === id);
export const featuresOf = (module: ModuleId) => FEATURES.filter((x) => x.module === module);
export const PRIORITY_WEIGHT: Record<Priority, number> = { critical: 3, high: 2, medium: 1 };

/** The 10-step workflow (PDF page 3). */
export const WORKFLOW_STEPS = [
  { n: 1, label: "Content Brief", input: "Keyword / Topic", does: "Generate intent, outline, entities, questions and content requirements" },
  { n: 2, label: "Write / Paste", input: "Draft Content", does: "Write or paste the blog into the editor" },
  { n: 3, label: "Audit", input: "Draft Content + SERP Data", does: "Run all pre-publish checks" },
  { n: 4, label: "Score", input: "Audit Results", does: "Overall score out of 10 and category-wise scores" },
  { n: 5, label: "Prioritize", input: "Issues", does: "Critical / High / Medium / Low issues" },
  { n: 6, label: "Optimize", input: "AI Recommendations", does: "Explain issues and provide specific fixes or rewrite suggestions" },
  { n: 7, label: "Apply", input: "Approved Fixes", does: "Apply selected recommendations" },
  { n: 8, label: "Re-score", input: "Updated Content", does: "Recalculate the score and show before-vs-after improvement" },
  { n: 9, label: "Pre-Publish Check", input: "Final Draft", does: "Run publication blockers and the final SEO checklist" },
  { n: 10, label: "Publish", input: "Approved Content", does: "Publish only after critical issues are resolved" },
] as const;
