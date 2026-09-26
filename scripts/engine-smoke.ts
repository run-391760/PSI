import { domainFacts, domainKeywords, domainCompetitors, keywordMetrics, serp, referringDomains, backlinks, anchors, trafficFacts, countryDistribution, paidKeywordRows, positionOn, expandSeed, brandPhrase, domainEntity } from "../src/lib/seo/engine";

const t0 = performance.now();
for (const d of ["paruluniversity.ac.in", "nike.com", "example.com", "zillow.com"]) {
  const t = performance.now();
  const f = domainFacts(d, "US");
  const e = domainEntity(d);
  const kws = domainKeywords(d, "US");
  console.log(d, e.kind, e.topicId, e.homeDb, "brand:", brandPhrase(d), "AS", f.authorityScore, "traffic", f.organicTraffic, "kws", f.organicKeywords, "sample", kws.length, "RD", f.referringDomains, "BL", f.backlinks, "paid", f.paidKeywords, `${Math.round(performance.now() - t)}ms`);
  console.log("   top:", kws.slice(0, 5).map((k) => `${k.keyword}#${k.position} v${k.metrics.volume} t${k.traffic}`).join(" | "));
  console.log("   comps:", domainCompetitors(d, "US", 5).map((c) => `${c.domain}(${c.commonKeywords},${c.competitionLevel})`).join(" "));
}
const fi = domainFacts("paruluniversity.ac.in", "IN");
console.log("parul IN traffic", fi.organicTraffic, "kws", fi.organicKeywords, domainKeywords("paruluniversity.ac.in", "IN").slice(0, 6).map((k) => `${k.keyword}#${k.position} v${k.metrics.volume}`).join(" | "));
console.log("countries", countryDistribution("paruluniversity.ac.in").slice(0, 4));
for (const k of ["running shoes", "best running shoes for women", "how to lose weight fast", "parul university admission", "seo tools", "amazon"]) {
  const m = keywordMetrics(k, "US");
  console.log(k, "vol", m.volume, "kd", m.kd, "cpc", m.cpc, m.intents.join(","), m.serpFeatures.join(","), "trend", m.trend.join(","));
  console.log("   serp:", serp(k, "US", { depth: 5 }).map((s) => s.domain).join(", "));
}
const t = performance.now();
console.log("refdomains", referringDomains("nike.com").length, "backlinks", backlinks("nike.com").length, "anchors", anchors("nike.com").slice(0, 5).map((a) => a.anchor), `${Math.round(performance.now() - t)}ms`);
console.log("traffic", JSON.stringify(trafficFacts("nike.com")).slice(0, 400));
console.log("paid", paidKeywordRows("nike.com", "US").slice(0, 3).map((p) => p.keyword + " " + p.adTitle));
console.log("pos", ["2026-09-01", "2026-09-10", "2026-09-20"].map((d) => positionOn("nike.com", "running shoes", "US", "desktop", d)));
console.log("expand", expandSeed("running shoes").candidates.length, "total", Math.round(performance.now() - t0), "ms");
