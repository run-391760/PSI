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
import { cxSchema } from "./cx";
import { cxListeningSchema } from "./cx-listening";
import { cxInboxSchema } from "./cx-inbox";
import { cxPublishingSchema } from "./cx-publishing";
import { cxInsightsSchema } from "./cx-insights";
import { cxAdminSchema } from "./cx-admin";
import { cxOpsSchema } from "./cx-ops";
import { cxUiSchema } from "./cx-ui";
import { cxSettingsSchema } from "./cx-settings";
import { optimizerSchema } from "./optimizer";

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
  cxSchema,
  cxListeningSchema,
  cxInboxSchema,
  cxPublishingSchema,
  cxInsightsSchema,
  cxAdminSchema,
  cxUiSchema,
  cxOpsSchema,
  cxSettingsSchema,
  optimizerSchema,
].join("\n");
