import "server-only";
import * as fs from "fs";
import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricWithDelta = { value: number; deltaPct: number | null };

export type Ga4Summary = {
  activeUsers: MetricWithDelta;
  newUsers: MetricWithDelta;
  sessions: MetricWithDelta;
  screenPageViews: MetricWithDelta;
  engagementRate: MetricWithDelta;
  averageSessionDuration: MetricWithDelta;
  bounceRate: MetricWithDelta;
  engagedSessions: MetricWithDelta;
};

export type Ga4Result =
  | {
      ok: true;
      days: number;
      summary: Ga4Summary;
      topPages: { path: string; views: number }[];
      sourceMedium: { name: string; sessions: number }[];
      devices: { name: string; sessions: number }[];
      newVsReturning: { name: string; users: number }[];
      countries: { name: string; users: number }[];
      trend: { date: string; users: number }[];
      alerts: string[];
      fetchedAt: string;
    }
  | { ok: false; reason: "not-configured" }
  | { ok: false; reason: "error"; error: string };

export type GscTotals = {
  clicks: MetricWithDelta;
  impressions: MetricWithDelta;
  ctr: MetricWithDelta;
  position: MetricWithDelta;
};

export type GscQuickWin = {
  query: string;
  impressions: number;
  position: number;
  ctr: number;
  clicks: number;
};

export type GscQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscPageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  lowCtr: boolean;
};

export type GscGainerLoser = {
  query: string;
  clicks: number;
  prevClicks: number;
  delta: number;
};

export type GscBranded = {
  branded: { clicks: number; impressions: number };
  nonBranded: { clicks: number; impressions: number };
};

export type GscResult =
  | {
      ok: true;
      days: number;
      totals: GscTotals;
      topQueries: GscQueryRow[];
      topPages: GscPageRow[];
      quickWins: GscQuickWin[];
      branded: GscBranded;
      gainers: GscGainerLoser[];
      losers: GscGainerLoser[];
      trend: { date: string; clicks: number; impressions: number }[];
      fetchedAt: string;
    }
  | { ok: false; reason: "not-configured" }
  | { ok: false; reason: "error"; error: string };

// ---------------------------------------------------------------------------
// Service-account resolution
// ---------------------------------------------------------------------------

function resolveServiceAccount(envValue: string): Record<string, unknown> {
  const trimmed = envValue.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  return JSON.parse(fs.readFileSync(trimmed, "utf8")) as Record<string, unknown>;
}

function getServiceAccountJson(project: ProjectConfig): Record<string, unknown> {
  const prefixKey = `${project.agent.gatewayEnvPrefix}_GOOGLE_SERVICE_ACCOUNT_JSON`;
  const raw = process.env[prefixKey] ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error(`No Google service account env found (tried ${prefixKey} and GOOGLE_SERVICE_ACCOUNT_JSON)`);
  return resolveServiceAccount(raw);
}

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes

async function getAccessToken(project: ProjectConfig): Promise<string> {
  const cached = tokenCache.get(project.slug);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const { JWT } = await import("google-auth-library");
  const sa = getServiceAccountJson(project);
  const jwt = new JWT({
    email: sa.client_email as string,
    key: sa.private_key as string,
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ],
  });
  const credentials = await jwt.authorize();
  const token = credentials.access_token;
  if (!token) throw new Error("Failed to obtain access token");

  tokenCache.set(project.slug, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

// ---------------------------------------------------------------------------
// GA4 data cache (keyed by slug+days)
// ---------------------------------------------------------------------------

type CachedGa4 = { result: Ga4Result; expiresAt: number };
const ga4Cache = new Map<string, CachedGa4>();
const DATA_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// GA4 helpers
// ---------------------------------------------------------------------------

interface Ga4ReportRow {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}

interface Ga4ReportResponse {
  rows?: Ga4ReportRow[];
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
}

async function runGa4Report(
  propertyId: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Ga4ReportResponse> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA4 API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<Ga4ReportResponse>;
}

/** Compute delta percentage. Returns null if previous is 0 (no baseline). */
function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const SUMMARY_METRICS = [
  { name: "activeUsers" },
  { name: "newUsers" },
  { name: "sessions" },
  { name: "screenPageViews" },
  { name: "engagementRate" },
  { name: "averageSessionDuration" },
  { name: "bounceRate" },
  { name: "engagedSessions" },
];

function parseSummaryMetrics(rows: Ga4ReportRow[] | undefined, dateRangeIndex: number): number[] {
  // When two dateRanges are provided, GA4 returns rows for each range with the
  // same dimensionless report but adds a `dateRange` dimension — we use
  // dateRange_0 for current, dateRange_1 for previous when using dateRanges[].
  // However the cleanest approach for a summary (no dimensions) is to run two
  // separate requests. We do that below, so here we just read the first row.
  const row = rows?.[dateRangeIndex] ?? rows?.[0];
  const vals = row?.metricValues ?? [];
  return SUMMARY_METRICS.map((_, i) => parseFloat(vals[i]?.value ?? "0"));
}

// ---------------------------------------------------------------------------
// fetchGa4
// ---------------------------------------------------------------------------

export async function fetchGa4(project: ProjectConfig, days: 7 | 28 | 90 = 28): Promise<Ga4Result> {
  if (!project.analytics?.ga4PropertyId) return { ok: false, reason: "not-configured" };

  const cacheKey = `${project.slug}:${days}`;
  const cached = ga4Cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.result;

  try {
    const propertyId = project.analytics.ga4PropertyId;
    const token = await getAccessToken(project);

    // Exclude bot-heavy countries (e.g. Singapore) from every report via a
    // countryId dimensionFilter. Works even on reports not grouped by country.
    const excludeCountries = project.analytics.excludeCountries ?? [];
    const dimensionFilter =
      excludeCountries.length > 0
        ? {
            notExpression: {
              filter: {
                fieldName: "countryId",
                inListFilter: { values: excludeCountries },
              },
            },
          }
        : undefined;
    const filterPart = dimensionFilter ? { dimensionFilter } : {};

    // Date ranges:
    // Current:  [days]daysAgo → today
    // Previous: [2*days]daysAgo → [days+1]daysAgo
    const currentRange = { startDate: `${days}daysAgo`, endDate: "today" };
    const previousRange = { startDate: `${2 * days}daysAgo`, endDate: `${days + 1}daysAgo` };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const [
      currentSummaryData,
      previousSummaryData,
      topPagesData,
      sourceMediumData,
      devicesData,
      newVsReturningData,
      countriesData,
      trendData,
    ] = await Promise.all([
      // Current period summary
      runGa4Report(
        propertyId,
        token,
        { ...filterPart, dateRanges: [currentRange], metrics: SUMMARY_METRICS },
        controller.signal,
      ),
      // Previous period summary
      runGa4Report(
        propertyId,
        token,
        { ...filterPart, dateRanges: [previousRange], metrics: SUMMARY_METRICS },
        controller.signal,
      ),
      // Top pages
      runGa4Report(
        propertyId,
        token,
        {
          ...filterPart,
          dateRanges: [currentRange],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: 10,
        },
        controller.signal,
      ),
      // Source/medium
      runGa4Report(
        propertyId,
        token,
        {
          ...filterPart,
          dateRanges: [currentRange],
          dimensions: [{ name: "sessionSourceMedium" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 8,
        },
        controller.signal,
      ),
      // Devices
      runGa4Report(
        propertyId,
        token,
        {
          ...filterPart,
          dateRanges: [currentRange],
          dimensions: [{ name: "deviceCategory" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        },
        controller.signal,
      ),
      // New vs returning
      runGa4Report(
        propertyId,
        token,
        {
          ...filterPart,
          dateRanges: [currentRange],
          dimensions: [{ name: "newVsReturning" }],
          metrics: [{ name: "activeUsers" }],
          orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        },
        controller.signal,
      ),
      // Countries
      runGa4Report(
        propertyId,
        token,
        {
          ...filterPart,
          dateRanges: [currentRange],
          dimensions: [{ name: "country" }],
          metrics: [{ name: "activeUsers" }],
          orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
          limit: 5,
        },
        controller.signal,
      ),
      // Trend
      runGa4Report(
        propertyId,
        token,
        {
          ...filterPart,
          dateRanges: [currentRange],
          dimensions: [{ name: "date" }],
          metrics: [{ name: "activeUsers" }],
          orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
        },
        controller.signal,
      ),
    ]);

    clearTimeout(timeout);

    const curr = parseSummaryMetrics(currentSummaryData.rows, 0);
    const prev = parseSummaryMetrics(previousSummaryData.rows, 0);

    // [0]=activeUsers [1]=newUsers [2]=sessions [3]=screenPageViews
    // [4]=engagementRate [5]=averageSessionDuration [6]=bounceRate [7]=engagedSessions
    const summary: Ga4Summary = {
      activeUsers:           { value: curr[0], deltaPct: deltaPct(curr[0], prev[0]) },
      newUsers:              { value: curr[1], deltaPct: deltaPct(curr[1], prev[1]) },
      sessions:              { value: curr[2], deltaPct: deltaPct(curr[2], prev[2]) },
      screenPageViews:       { value: curr[3], deltaPct: deltaPct(curr[3], prev[3]) },
      engagementRate:        { value: curr[4], deltaPct: deltaPct(curr[4], prev[4]) },
      averageSessionDuration:{ value: curr[5], deltaPct: deltaPct(curr[5], prev[5]) },
      bounceRate:            { value: curr[6], deltaPct: deltaPct(curr[6], prev[6]) },
      engagedSessions:       { value: curr[7], deltaPct: deltaPct(curr[7], prev[7]) },
    };

    // Alerts
    const alerts: string[] = [];
    if (curr[6] > 0.6) {
      alerts.push(`High bounce rate (${(curr[6] * 100).toFixed(1)}%)`);
    }
    const userDelta = summary.activeUsers.deltaPct;
    if (userDelta !== null && userDelta <= -20) {
      alerts.push(`Traffic down ${Math.abs(userDelta)}% vs previous period`);
    }

    const result: Ga4Result = {
      ok: true,
      days,
      summary,
      topPages: (topPagesData.rows ?? []).map((r) => ({
        path: r.dimensionValues?.[0]?.value ?? "",
        views: parseFloat(r.metricValues?.[0]?.value ?? "0"),
      })),
      sourceMedium: (sourceMediumData.rows ?? []).map((r) => ({
        name: r.dimensionValues?.[0]?.value ?? "",
        sessions: parseFloat(r.metricValues?.[0]?.value ?? "0"),
      })),
      devices: (devicesData.rows ?? []).map((r) => ({
        name: r.dimensionValues?.[0]?.value ?? "",
        sessions: parseFloat(r.metricValues?.[0]?.value ?? "0"),
      })),
      newVsReturning: (newVsReturningData.rows ?? []).map((r) => ({
        name: r.dimensionValues?.[0]?.value ?? "",
        users: parseFloat(r.metricValues?.[0]?.value ?? "0"),
      })),
      countries: (countriesData.rows ?? []).map((r) => ({
        name: r.dimensionValues?.[0]?.value ?? "",
        users: parseFloat(r.metricValues?.[0]?.value ?? "0"),
      })),
      trend: (trendData.rows ?? []).map((r) => ({
        date: r.dimensionValues?.[0]?.value ?? "",
        users: parseFloat(r.metricValues?.[0]?.value ?? "0"),
      })),
      alerts,
      fetchedAt: new Date().toISOString(),
    };

    ga4Cache.set(cacheKey, { result, expiresAt: Date.now() + DATA_TTL_MS });
    return result;
  } catch (err) {
    return { ok: false, reason: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// GSC data cache (keyed by slug+days)
// ---------------------------------------------------------------------------

type CachedGsc = { result: GscResult; expiresAt: number };
const gscCache = new Map<string, CachedGsc>();

// ---------------------------------------------------------------------------
// GSC helpers
// ---------------------------------------------------------------------------

/** Compute absolute YYYY-MM-DD dates for a GSC window ending 3 days ago. */
function gscDateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  end.setDate(end.getDate() - 3); // 3-day GSC lag
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/** Previous window: the equal-length period immediately before the current one. */
function gscPreviousDateRange(days: number): { startDate: string; endDate: string } {
  const currEnd = new Date();
  currEnd.setDate(currEnd.getDate() - 3);
  // previous end = day before current start
  const prevEnd = new Date(currEnd);
  prevEnd.setDate(prevEnd.getDate() - days);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return {
    startDate: prevStart.toISOString().slice(0, 10),
    endDate: prevEnd.toISOString().slice(0, 10),
  };
}

interface GscRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscResponse {
  rows?: GscRow[];
}

async function runGscQuery(
  siteUrl: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<GscResponse> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<GscResponse>;
}

function isBranded(query: string, terms: string[]): boolean {
  const q = query.toLowerCase();
  return terms.some((t) => q.includes(t));
}

// ---------------------------------------------------------------------------
// fetchGsc
// ---------------------------------------------------------------------------

export async function fetchGsc(project: ProjectConfig, days: 7 | 28 | 90 = 28): Promise<GscResult> {
  if (!project.analytics?.gscSiteUrl) return { ok: false, reason: "not-configured" };

  const cacheKey = `${project.slug}:${days}`;
  const cached = gscCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.result;

  try {
    const siteUrl = project.analytics.gscSiteUrl;
    const token = await getAccessToken(project);

    const curr = gscDateRange(days);
    const prev = gscPreviousDateRange(days);

    const brandedTerms: string[] =
      project.analytics.brandedTerms ?? [project.name.toLowerCase()];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    // Run current-period queries and pages in parallel.
    // Previous-period queries are best-effort — don't fail if they error.
    const [totalsData, queriesData, pagesData, trendData] = await Promise.all([
      runGscQuery(siteUrl, token, { startDate: curr.startDate, endDate: curr.endDate, rowLimit: 1 }, controller.signal),
      runGscQuery(siteUrl, token, { startDate: curr.startDate, endDate: curr.endDate, dimensions: ["query"], rowLimit: 1000 }, controller.signal),
      runGscQuery(siteUrl, token, { startDate: curr.startDate, endDate: curr.endDate, dimensions: ["page"], rowLimit: 50 }, controller.signal),
      runGscQuery(siteUrl, token, { startDate: curr.startDate, endDate: curr.endDate, dimensions: ["date"], rowLimit: 90 }, controller.signal),
    ]);

    // Previous-period totals + queries — best-effort
    const [prevTotalsData, prevQueriesData] = await Promise.all([
      runGscQuery(siteUrl, token, { startDate: prev.startDate, endDate: prev.endDate, rowLimit: 1 }, controller.signal)
        .catch(() => ({ rows: undefined })),
      runGscQuery(siteUrl, token, { startDate: prev.startDate, endDate: prev.endDate, dimensions: ["query"], rowLimit: 1000 }, controller.signal)
        .catch(() => ({ rows: undefined })),
    ]);

    clearTimeout(timeout);

    // Totals
    const totalsRow = totalsData.rows?.[0];
    const currTotals = totalsRow
      ? { clicks: totalsRow.clicks, impressions: totalsRow.impressions, ctr: totalsRow.ctr, position: totalsRow.position }
      : { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    const prevTotalsRow = prevTotalsData.rows?.[0];
    const prevTotals = prevTotalsRow
      ? { clicks: prevTotalsRow.clicks, impressions: prevTotalsRow.impressions, ctr: prevTotalsRow.ctr, position: prevTotalsRow.position }
      : { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    const totals: GscTotals = {
      clicks:      { value: currTotals.clicks,      deltaPct: deltaPct(currTotals.clicks,      prevTotals.clicks) },
      impressions: { value: currTotals.impressions,  deltaPct: deltaPct(currTotals.impressions,  prevTotals.impressions) },
      ctr:         { value: currTotals.ctr,          deltaPct: deltaPct(currTotals.ctr,          prevTotals.ctr) },
      position:    { value: currTotals.position,     deltaPct: deltaPct(currTotals.position,     prevTotals.position) },
    };

    // All current queries (rowLimit 1000 = enough for branded split + quick wins + gainers)
    const allQueryRows: GscQueryRow[] = (queriesData.rows ?? []).map((r) => ({
      query: r.keys?.[0] ?? "",
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

    // Top 10 queries for the UI table
    const topQueries = allQueryRows.slice(0, 10);

    // Quick wins: position 4-20, impressions >= 20, sort by impressions desc, top 10
    const quickWins: GscQuickWin[] = allQueryRows
      .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10)
      .map((r) => ({ query: r.query, impressions: r.impressions, position: r.position, ctr: r.ctr, clicks: r.clicks }));

    // Branded vs non-branded
    const brandedAgg = { clicks: 0, impressions: 0 };
    const nonBrandedAgg = { clicks: 0, impressions: 0 };
    for (const r of allQueryRows) {
      if (isBranded(r.query, brandedTerms)) {
        brandedAgg.clicks += r.clicks;
        brandedAgg.impressions += r.impressions;
      } else {
        nonBrandedAgg.clicks += r.clicks;
        nonBrandedAgg.impressions += r.impressions;
      }
    }
    const branded: GscBranded = {
      branded: brandedAgg,
      nonBranded: nonBrandedAgg,
    };

    // Gainers / losers from previous-period query diff
    let gainers: GscGainerLoser[] = [];
    let losers: GscGainerLoser[] = [];
    if (prevQueriesData.rows?.length) {
      const prevMap = new Map<string, number>();
      for (const r of prevQueriesData.rows) {
        const q = r.keys?.[0] ?? "";
        if (q) prevMap.set(q, r.clicks);
      }
      const diffs: GscGainerLoser[] = allQueryRows
        .map((r) => ({
          query: r.query,
          clicks: r.clicks,
          prevClicks: prevMap.get(r.query) ?? 0,
          delta: r.clicks - (prevMap.get(r.query) ?? 0),
        }))
        .filter((d) => d.delta !== 0);

      gainers = diffs
        .filter((d) => d.delta > 0)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 5);
      losers = diffs
        .filter((d) => d.delta < 0)
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 5);
    }

    // Top pages — flag low CTR (high impressions, low CTR)
    const pageRows = (pagesData.rows ?? []);
    const medianImpressions = pageRows.length
      ? pageRows.map((r) => r.impressions).sort((a, b) => a - b)[Math.floor(pageRows.length / 2)]
      : 0;
    const topPages: GscPageRow[] = pageRows.map((r) => ({
      page: r.keys?.[0] ?? "",
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      lowCtr: r.impressions > medianImpressions && r.ctr < 0.03,
    }));

    const result: GscResult = {
      ok: true,
      days,
      totals,
      topQueries,
      topPages,
      quickWins,
      branded,
      gainers,
      losers,
      trend: (trendData.rows ?? []).map((r) => ({
        date: r.keys?.[0] ?? "",
        clicks: r.clicks,
        impressions: r.impressions,
      })),
      fetchedAt: new Date().toISOString(),
    };

    gscCache.set(cacheKey, { result, expiresAt: Date.now() + DATA_TTL_MS });
    return result;
  } catch (err) {
    return { ok: false, reason: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
