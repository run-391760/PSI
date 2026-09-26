/**
 * Demo data engine. Deterministic synthetic SEO data: every function returns the same output for
 * the same input, and tools agree with each other (a keyword's volume is identical in Keyword
 * Overview, Organic Research and Position Tracking). Output must be labelled "Demo data" in the UI.
 */
export * from "./random";
export * from "./keywords";
export * from "./domains";
export * from "./backlinks";
export * from "./traffic";
export { TOPICS, GIANTS, MONTHS } from "./vocab";
