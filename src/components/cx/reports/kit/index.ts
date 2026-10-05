/**
 * WP-K4 interactive report kit. Wrap a page in <ReportProvider brand ai>, put widgets in <Widget id title …>,
 * and give every chart a declarative DrillMap (see @/lib/cx/reports/model) so clicks open the drawer.
 */
export { ReportProvider, useReport, useSeriesToggle } from "./context";
export { Widget, type TableData, type InsightData } from "./widget";
export { LineChartK, ColumnChartK, PieChartK, type KSeries } from "./charts";
export { Change, TileRow, StatsColumn, WordCloudK, DrillTableK, PostListK, type Tile, type KCell, type PostRow } from "./blocks";
export { ReportFilterBar, IntervalSelect, ParamSelect, useUrlParams } from "./filter-bar";
export { DrillDrawer, ticketHref } from "./drawer";
export { NetworkAvatar, NetworkGlyph, networkLabel } from "./avatar";
