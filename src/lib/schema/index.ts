import { coreSchema } from "./core";
import { positionTrackingSchema } from "./position-tracking";
import { siteAuditSchema } from "./site-audit";
import { backlinksSchema } from "./backlinks";
import { keywordsSchema } from "./keywords";
import { contentSchema } from "./content";
import { localSchema } from "./local";
import { monitoringSchema } from "./monitoring";
import { aiVisibilitySchema } from "./ai-visibility";
import { reportsSchema } from "./reports";
import { integrationsSchema } from "./integrations";

export const schema = [
  coreSchema,
  positionTrackingSchema,
  siteAuditSchema,
  backlinksSchema,
  keywordsSchema,
  contentSchema,
  localSchema,
  monitoringSchema,
  aiVisibilitySchema,
  reportsSchema,
  integrationsSchema,
].join("\n");
