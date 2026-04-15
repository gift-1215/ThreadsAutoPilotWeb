import { generatePostDraftFromContext } from "./gemini";
import { resolveRunDate } from "./posting";
import { getPendingDraft, insertRun, upsertPendingDraft } from "./runs";
import {
  Env,
  NewsPreviewArticle,
  NewsQueryAttemptResult,
  NewsRunPreview,
  RunResult,
  StoredSettings
} from "./types";
import { DEFAULT_NEWS_PROVIDER, getLocalDateTime, safeErrorMessage, sanitizeNewsProvider } from "./utils";

const NEWS_LOOKBACK_DAYS = 2;
const MAX_QUERY_ATTEMPTS = 5;
type NewsRunType = "scheduled_news_prefill" | "manual_news_prefill";
type RequestedNewsProvider = "google_rss" | "gnews" | "auto";
type ConcreteNewsProvider = "google_rss" | "gnews";

interface NewsArticle {
  title?: string;
  description?: string;
  content?: string;
  url?: string;
  publishedAt?: string;
  source?: {
    name?: string;
    url?: string;
  };
}

interface GNewsResponse {
  totalArticles?: number;
  articles?: NewsArticle[];
}

interface GNewsQueryPreset {
  label: string;
  query: string;
  lang?: string;
  country?: string;
}

interface RssQueryPreset {
  label: string;
  query: string;
}

interface NewsFetchError extends Error {
  status?: number;
  attempts?: NewsQueryAttemptResult[];
  providerUsed?: ConcreteNewsProvider;
  rateLimited?: boolean;
}

interface NewsFetchResult {
  articles: NewsArticle[];
  attempts: NewsQueryAttemptResult[];
  rateLimited: boolean;
  providerUsed: ConcreteNewsProvider;
  requestedProvider: RequestedNewsProvider;
}

function cleanSnippet(input: string, maxLength = 140) {
  const normalized = String(input || "")
    .replace(/\[\+\d+\schars\]$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function providerLabel(provider: string) {
  const value = String(provider || "").toLowerCase();
  if (value === "google_rss") {
    return "Google News RSS";
  }
  if (value === "gnews") {
    return "GNews";
  }
  if (value === "auto") {
    return "自動（RSS 優先）";
  }
  return "新聞來源";
}

function createNewsFetchError(message: string, status?: number) {
  const error = new Error(message) as NewsFetchError;
  error.status = status;
  return error;
}

function withAttemptContext(
  error: Error,
  attempts: NewsQueryAttemptResult[],
  options: { status?: number; providerUsed?: ConcreteNewsProvider; rateLimited?: boolean } = {}
) {
  const wrapped = error as NewsFetchError;
  wrapped.attempts = attempts;
  if (typeof options.status === "number" && options.status > 0) {
    wrapped.status = options.status;
  }
  if (options.providerUsed) {
    wrapped.providerUsed = options.providerUsed;
  }
  if (typeof options.rateLimited === "boolean") {
    wrapped.rateLimited = options.rateLimited;
  }
  return wrapped;
}

function formatPublishedAt(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "-";
  }

  try {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    return formatter.format(date);
  } catch {
    return date.toISOString();
  }
}

function buildNewsDigest(articles: NewsArticle[], timezone: string) {
  return articles
    .map((article, index) => {
      const title = cleanSnippet(article.title || "(無標題)", 90);
      const sourceName = cleanSnippet(article.source?.name || "未知來源", 36);
      const publishedAt = formatPublishedAt(article.publishedAt || "", timezone);
      const detail = cleanSnippet(article.description || article.content || "(無摘要)", 160);
      const url = cleanSnippet(article.url || "", 220);
      return [
        `${index + 1}. ${title}`,
        `來源：${sourceName}｜時間：${publishedAt}`,
        `重點：${detail}`,
        `連結：${url}`
      ].join("\n");
    })
    .join("\n\n");
}

function buildNewsContext(settings: StoredSettings, articles: NewsArticle[], provider: ConcreteNewsProvider) {
  const keywordText = settings.newsKeywords.join("、") || "(未提供關鍵字)";
  const digest = buildNewsDigest(articles, settings.timezone);
  return [
    `以下是由 ${providerLabel(provider)} 抓到的近兩天新聞摘要，請以此為素材產文。`,
    `追蹤關鍵字：${keywordText}`,
    `新聞則數：${articles.length}`,
    digest
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5800);
}

function fromIsoByLookbackDays(now: Date, days: number) {
  const target = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return target.toISOString();
}

function normalizeArticles(rawArticles: NewsArticle[], maxItems: number) {
  const deduped = new Map<string, NewsArticle>();
  for (const article of rawArticles) {
    const title = String(article.title || "").trim();
    const url = String(article.url || "").trim();
    if (!title || !url) {
      continue;
    }

    if (!deduped.has(url)) {
      deduped.set(url, article);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => {
      const timeA = new Date(String(a.publishedAt || "")).getTime();
      const timeB = new Date(String(b.publishedAt || "")).getTime();
      const safeA = Number.isNaN(timeA) ? 0 : timeA;
      const safeB = Number.isNaN(timeB) ? 0 : timeB;
      return safeB - safeA;
    })
    .slice(0, maxItems);
}

function sanitizeKeyword(token: string) {
  return String(token || "")
    .replace(/"/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKeywordQuery(keywords: string[], useQuotedTerms: boolean) {
  const terms = keywords.map(sanitizeKeyword).filter(Boolean);
  if (!terms.length) {
    return "";
  }

  return terms
    .map((term) => {
      if (!useQuotedTerms) {
        return term;
      }
      return `"${term}"`;
    })
    .join(" OR ");
}

function buildGNewsQueryPresets(keywords: string[]) {
  const quotedQuery = buildKeywordQuery(keywords, true);
  const plainOrQuery = buildKeywordQuery(keywords, false);
  const whitespaceQuery = keywords.map(sanitizeKeyword).filter(Boolean).join(" ");

  const presets: GNewsQueryPreset[] = [
    { label: "GNews（關鍵字 OR）", query: plainOrQuery },
    { label: "GNews（關鍵字空白）", query: whitespaceQuery },
    { label: "GNews（關鍵字精確）", query: quotedQuery }
  ];

  const deduped = new Map<string, GNewsQueryPreset>();
  for (const preset of presets) {
    const query = String(preset.query || "").trim();
    if (!query) {
      continue;
    }
    const key = [query, preset.lang || "", preset.country || ""].join("|");
    if (!deduped.has(key)) {
      deduped.set(key, { ...preset, query });
    }
  }

  return [...deduped.values()].slice(0, MAX_QUERY_ATTEMPTS);
}

function buildGoogleRssQueryPresets(keywords: string[]) {
  const quotedQuery = buildKeywordQuery(keywords, true);
  const plainOrQuery = buildKeywordQuery(keywords, false);
  const whitespaceQuery = keywords.map(sanitizeKeyword).filter(Boolean).join(" ");

  const withWhen = (query: string) => String(query || "").trim().replace(/\s+/g, " ").trim();

  const presets: RssQueryPreset[] = [
    { label: "Google RSS（關鍵字 OR）", query: withWhen(`${plainOrQuery} when:${NEWS_LOOKBACK_DAYS}d`) },
    {
      label: "Google RSS（關鍵字空白）",
      query: withWhen(`${whitespaceQuery} when:${NEWS_LOOKBACK_DAYS}d`)
    },
    {
      label: "Google RSS（關鍵字精確）",
      query: withWhen(`${quotedQuery} when:${NEWS_LOOKBACK_DAYS}d`)
    }
  ];

  const deduped = new Map<string, RssQueryPreset>();
  for (const preset of presets) {
    const query = String(preset.query || "").trim();
    if (!query) {
      continue;
    }
    if (!deduped.has(query)) {
      deduped.set(query, { ...preset, query });
    }
  }

  return [...deduped.values()].slice(0, MAX_QUERY_ATTEMPTS);
}

function decodeXmlEntities(input: string) {
  const text = String(input || "");
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function stripHtml(input: string) {
  return decodeXmlEntities(input).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTagContent(block: string, tag: string) {
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = String(block || "").match(regex);
  if (!match) {
    return "";
  }
  return decodeXmlEntities(match[1] || "").trim();
}

function withinLookbackRange(value: string, now: Date, lookbackDays: number) {
  const parsed = new Date(String(value || "")).getTime();
  if (Number.isNaN(parsed)) {
    return true;
  }
  const cutoff = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  return parsed >= cutoff;
}

function parseGoogleRssArticles(xmlText: string, now: Date) {
  const itemBlocks = String(xmlText || "").match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const articles: NewsArticle[] = [];

  for (const block of itemBlocks) {
    const title = stripHtml(extractTagContent(block, "title"));
    const url = extractTagContent(block, "link");
    const publishedAt = extractTagContent(block, "pubDate");
    const description = stripHtml(extractTagContent(block, "description"));
    const source = stripHtml(extractTagContent(block, "source"));

    if (!title || !url) {
      continue;
    }
    if (!withinLookbackRange(publishedAt, now, NEWS_LOOKBACK_DAYS)) {
      continue;
    }

    articles.push({
      title,
      description,
      content: description,
      url,
      publishedAt,
      source: {
        name: source || "Google News",
        url: ""
      }
    });
  }

  return articles;
}

function isFatalFetchStatus(status: number) {
  return [401, 403, 429].includes(status);
}

function buildNewsPreview(
  settings: StoredSettings,
  attempts: NewsQueryAttemptResult[],
  articles: NewsArticle[],
  provider: string
): NewsRunPreview {
  const previewArticles: NewsPreviewArticle[] = articles.map((article) => ({
    title: cleanSnippet(article.title || "(無標題)", 120),
    source: cleanSnippet(article.source?.name || "未知來源", 40),
    publishedAt: formatPublishedAt(article.publishedAt || "", settings.timezone),
    snippet: cleanSnippet(article.description || article.content || "(無摘要)", 200),
    url: String(article.url || "").trim()
  }));

  return {
    lookbackDays: NEWS_LOOKBACK_DAYS,
    keywords: [...settings.newsKeywords],
    provider,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      query: cleanSnippet(attempt.query, 180)
    })),
    articles: previewArticles
  };
}

function buildAttemptSummary(attempts: NewsQueryAttemptResult[]) {
  return attempts
    .map((attempt) => {
      const stat =
        attempt.status === "success" ? `${attempt.matched} 則` : `失敗（${attempt.error || "未知錯誤"}）`;
      return `${attempt.label}${stat}`;
    })
    .join("、");
}

function resolveRequestedProvider(settings: StoredSettings): RequestedNewsProvider {
  return sanitizeNewsProvider(settings.newsProvider || DEFAULT_NEWS_PROVIDER);
}

async function requestGNewsByPreset(
  apiKey: string,
  preset: GNewsQueryPreset,
  now: Date,
  fetchLimit: number,
  normalizeLimit: number
) {
  const endpoint = new URL("https://gnews.io/api/v4/search");
  endpoint.searchParams.set("q", preset.query);
  if (preset.lang) {
    endpoint.searchParams.set("lang", preset.lang);
  }
  if (preset.country) {
    endpoint.searchParams.set("country", preset.country);
  }
  endpoint.searchParams.set("max", String(fetchLimit));
  endpoint.searchParams.set("sortby", "publishedAt");
  endpoint.searchParams.set("from", fromIsoByLookbackDays(now, NEWS_LOOKBACK_DAYS));
  endpoint.searchParams.set("apikey", apiKey);

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  const payload = (await response.json().catch(() => ({}))) as GNewsResponse & {
    errors?: Array<{ message?: string }>;
    message?: string;
  };

  if (!response.ok) {
    const errorMessage =
      payload.errors?.[0]?.message || payload.message || `GNews request failed: ${response.status}`;
    throw createNewsFetchError(errorMessage, response.status);
  }

  const rawArticles = Array.isArray(payload.articles) ? payload.articles : [];
  return normalizeArticles(rawArticles, normalizeLimit);
}

async function requestGoogleRssByPreset(
  preset: RssQueryPreset,
  now: Date,
  normalizeLimit: number
): Promise<NewsArticle[]> {
  const endpoint = new URL("https://news.google.com/rss/search");
  endpoint.searchParams.set("q", preset.query);

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      accept: "application/rss+xml, application/xml, text/xml"
    }
  });

  if (!response.ok) {
    throw createNewsFetchError(`Google RSS request failed: ${response.status}`, response.status);
  }

  const xmlText = await response.text();
  const articles = parseGoogleRssArticles(xmlText, now);
  return normalizeArticles(articles, normalizeLimit);
}

async function fetchGNewsArticles(
  env: Env,
  settings: StoredSettings,
  now: Date,
  requestedProvider: RequestedNewsProvider
): Promise<NewsFetchResult> {
  const apiKey = String(env.GNEWS_API_KEY || "").trim();
  if (!apiKey) {
    throw createNewsFetchError("缺少 GNEWS_API_KEY，無法抓取 GNews。", 400);
  }

  if (!settings.newsKeywords.length) {
    return {
      articles: [],
      attempts: [],
      rateLimited: false,
      providerUsed: "gnews",
      requestedProvider
    };
  }

  const queryPresets = buildGNewsQueryPresets(settings.newsKeywords);
  const fetchLimit = Math.min(10, Math.max(2, settings.newsMaxItems * 2));
  const normalizeLimit = Math.max(settings.newsMaxItems * 3, settings.newsMaxItems);
  const attempts: NewsQueryAttemptResult[] = [];
  const combinedArticles: NewsArticle[] = [];
  let rateLimited = false;

  for (const preset of queryPresets) {
    try {
      const articles = await requestGNewsByPreset(apiKey, preset, now, fetchLimit, normalizeLimit);
      attempts.push({
        label: preset.label,
        query: preset.query,
        lang: preset.lang || null,
        country: preset.country || null,
        matched: articles.length,
        status: "success"
      });

      if (articles.length > 0) {
        combinedArticles.push(...articles);
        const normalized = normalizeArticles(combinedArticles, settings.newsMaxItems);
        return {
          articles: normalized,
          attempts,
          rateLimited,
          providerUsed: "gnews",
          requestedProvider
        };
      }
    } catch (error) {
      const message = safeErrorMessage(error);
      const status = Number((error as NewsFetchError)?.status || 0);
      attempts.push({
        label: preset.label,
        query: preset.query,
        lang: preset.lang || null,
        country: preset.country || null,
        matched: 0,
        status: "error",
        error: message
      });

      if (status === 429) {
        rateLimited = true;
        break;
      }

      if (isFatalFetchStatus(status)) {
        throw withAttemptContext(new Error(message), attempts, {
          status,
          providerUsed: "gnews",
          rateLimited
        });
      }
    }
  }

  const successCount = attempts.filter((attempt) => attempt.status === "success").length;
  if (!successCount && attempts.length > 0) {
    if (rateLimited) {
      return {
        articles: [],
        attempts,
        rateLimited,
        providerUsed: "gnews",
        requestedProvider
      };
    }
    const failureSummary = attempts
      .map((attempt, index) => `#${index + 1} ${attempt.label}: ${attempt.error || "未知錯誤"}`)
      .join("；");
    throw withAttemptContext(new Error(`GNews 查詢失敗：${failureSummary}`), attempts, {
      providerUsed: "gnews",
      rateLimited
    });
  }

  return {
    articles: [],
    attempts,
    rateLimited,
    providerUsed: "gnews",
    requestedProvider
  };
}

async function fetchGoogleRssArticles(
  settings: StoredSettings,
  now: Date,
  requestedProvider: RequestedNewsProvider
): Promise<NewsFetchResult> {
  if (!settings.newsKeywords.length) {
    return {
      articles: [],
      attempts: [],
      rateLimited: false,
      providerUsed: "google_rss",
      requestedProvider
    };
  }

  const queryPresets = buildGoogleRssQueryPresets(settings.newsKeywords);
  const normalizeLimit = Math.max(settings.newsMaxItems * 3, settings.newsMaxItems);
  const attempts: NewsQueryAttemptResult[] = [];
  const combinedArticles: NewsArticle[] = [];
  let rateLimited = false;

  for (const preset of queryPresets) {
    try {
      const articles = await requestGoogleRssByPreset(preset, now, normalizeLimit);
      attempts.push({
        label: preset.label,
        query: preset.query,
        lang: null,
        country: null,
        matched: articles.length,
        status: "success"
      });

      if (articles.length > 0) {
        combinedArticles.push(...articles);
        const normalized = normalizeArticles(combinedArticles, settings.newsMaxItems);
        return {
          articles: normalized,
          attempts,
          rateLimited,
          providerUsed: "google_rss",
          requestedProvider
        };
      }
    } catch (error) {
      const message = safeErrorMessage(error);
      const status = Number((error as NewsFetchError)?.status || 0);
      attempts.push({
        label: preset.label,
        query: preset.query,
        lang: null,
        country: null,
        matched: 0,
        status: "error",
        error: message
      });

      if (status === 429) {
        rateLimited = true;
        break;
      }

      if (isFatalFetchStatus(status)) {
        throw withAttemptContext(new Error(message), attempts, {
          status,
          providerUsed: "google_rss",
          rateLimited
        });
      }
    }
  }

  const successCount = attempts.filter((attempt) => attempt.status === "success").length;
  if (!successCount && attempts.length > 0) {
    if (rateLimited) {
      return {
        articles: [],
        attempts,
        rateLimited,
        providerUsed: "google_rss",
        requestedProvider
      };
    }
    const failureSummary = attempts
      .map((attempt, index) => `#${index + 1} ${attempt.label}: ${attempt.error || "未知錯誤"}`)
      .join("；");
    throw withAttemptContext(new Error(`Google RSS 查詢失敗：${failureSummary}`), attempts, {
      providerUsed: "google_rss",
      rateLimited
    });
  }

  return {
    articles: [],
    attempts,
    rateLimited,
    providerUsed: "google_rss",
    requestedProvider
  };
}

async function fetchNewsArticles(env: Env, settings: StoredSettings, now: Date): Promise<NewsFetchResult> {
  const requestedProvider = resolveRequestedProvider(settings);

  if (requestedProvider === "gnews") {
    return fetchGNewsArticles(env, settings, now, requestedProvider);
  }

  if (requestedProvider === "google_rss") {
    return fetchGoogleRssArticles(settings, now, requestedProvider);
  }

  const attempts: NewsQueryAttemptResult[] = [];

  try {
    const rssResult = await fetchGoogleRssArticles(settings, now, requestedProvider);
    attempts.push(...rssResult.attempts);
    if (rssResult.articles.length > 0 || rssResult.rateLimited) {
      return {
        ...rssResult,
        attempts,
        requestedProvider
      };
    }
  } catch (error) {
    const rssAttempts = Array.isArray((error as NewsFetchError)?.attempts)
      ? ((error as NewsFetchError).attempts as NewsQueryAttemptResult[])
      : [];
    attempts.push(...rssAttempts);
  }

  try {
    const gnewsResult = await fetchGNewsArticles(env, settings, now, requestedProvider);
    return {
      ...gnewsResult,
      attempts: [...attempts, ...gnewsResult.attempts],
      requestedProvider
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    if (message.includes("缺少 GNEWS_API_KEY")) {
      return {
        articles: [],
        attempts: [
          ...attempts,
          {
            label: "GNews（自動備援）",
            query: "-",
            lang: null,
            country: null,
            matched: 0,
            status: "error",
            error: message
          }
        ],
        rateLimited: false,
        providerUsed: "google_rss",
        requestedProvider
      };
    }
    const gnewsAttempts = Array.isArray((error as NewsFetchError)?.attempts)
      ? ((error as NewsFetchError).attempts as NewsQueryAttemptResult[])
      : [];
    const mergedAttempts = [...attempts, ...gnewsAttempts];
    throw withAttemptContext(new Error(message), mergedAttempts, {
      status: (error as NewsFetchError)?.status,
      providerUsed: (error as NewsFetchError)?.providerUsed || "gnews",
      rateLimited: (error as NewsFetchError)?.rateLimited
    });
  }
}

async function alreadyHandledNewsPrefillToday(env: Env, userId: number, runDate: string) {
  const row = await env.DB.prepare(
    `SELECT id
     FROM post_runs
     WHERE user_id = ?
       AND run_type = 'scheduled_news_prefill'
       AND run_date = ?
     LIMIT 1`
  )
    .bind(userId, runDate)
    .first<{ id: string }>();

  return Boolean(row?.id);
}

async function executeNewsPrefill(
  env: Env,
  userId: number,
  settings: StoredSettings,
  now: Date,
  runType: NewsRunType
): Promise<RunResult> {
  const runDate = resolveRunDate(settings, env, now);
  const selectedProvider = resolveRequestedProvider(settings);

  if (!settings.newsEnabled && runType === "scheduled_news_prefill") {
    const message = "新聞草稿功能未啟用";
    const runId = await insertRun(env, userId, runType, runDate, "skipped", message);
    return { runId, status: "skipped", message, runType, runDate };
  }

  if (!settings.newsKeywords.length) {
    const message = "新聞關鍵字為空，請先設定至少一個關鍵字";
    const runId = await insertRun(env, userId, runType, runDate, "failed", message);
    return {
      runId,
      status: "failed",
      message,
      runType,
      runDate,
      newsPreview: buildNewsPreview(settings, [], [], selectedProvider)
    };
  }

  if (!settings.geminiApiKey) {
    const message = "缺少 LLM API Key，無法根據新聞生成草稿";
    const runId = await insertRun(env, userId, runType, runDate, "failed", message);
    return {
      runId,
      status: "failed",
      message,
      runType,
      runDate,
      newsPreview: buildNewsPreview(settings, [], [], selectedProvider)
    };
  }

  if (runType === "scheduled_news_prefill") {
    const isAlreadyHandled = await alreadyHandledNewsPrefillToday(env, userId, runDate);
    if (isAlreadyHandled) {
      const message = "今天的新聞草稿已處理過，略過";
      const runId = await insertRun(env, userId, runType, runDate, "skipped", message);
      return { runId, status: "skipped", message, runType, runDate };
    }

    const pendingDraft = await getPendingDraft(env, userId);
    if (pendingDraft?.draft?.trim()) {
      const message = "目前已有待發草稿，暫不覆蓋新聞草稿";
      const runId = await insertRun(env, userId, runType, runDate, "skipped", message);
      return { runId, status: "skipped", message, runType, runDate };
    }
  }

  try {
    const localNow = getLocalDateTime(now, settings.timezone);
    const fetchResult = await fetchNewsArticles(env, settings, now);
    const newsPreview = buildNewsPreview(
      settings,
      fetchResult.attempts,
      fetchResult.articles,
      fetchResult.providerUsed
    );

    if (!fetchResult.articles.length) {
      const attemptSummary = buildAttemptSummary(fetchResult.attempts);
      const message = [
        `近 ${NEWS_LOOKBACK_DAYS} 天找不到符合關鍵字的新聞（${settings.newsKeywords.join("、")}）`,
        fetchResult.rateLimited
          ? `${providerLabel(fetchResult.providerUsed)} 回傳 429（速率或額度限制），已停止後續查詢，請稍後或隔日再試。`
          : "",
        attemptSummary ? `已嘗試：${attemptSummary}` : ""
      ]
        .filter(Boolean)
        .join("；");
      const runId = await insertRun(env, userId, runType, runDate, "skipped", message);
      return { runId, status: "skipped", message, runType, runDate, newsPreview };
    }

    const context = buildNewsContext(settings, fetchResult.articles, fetchResult.providerUsed);
    const draft = await generatePostDraftFromContext(settings, localNow.dateKey, context);
    await upsertPendingDraft(env, userId, draft, settings);

    const firstTitle = cleanSnippet(fetchResult.articles[0]?.title || "", 56);
    const message = [
      `已抓取近 ${NEWS_LOOKBACK_DAYS} 天新聞 ${fetchResult.articles.length} 則`,
      `來源：${providerLabel(fetchResult.providerUsed)}`,
      `關鍵字：${settings.newsKeywords.join("、")}`,
      firstTitle ? `最新：${firstTitle}` : "",
      "已產生新聞草稿"
    ]
      .filter(Boolean)
      .join("，");

    const runId = await insertRun(env, userId, runType, runDate, "success", message, draft);
    return {
      runId,
      status: "success",
      message,
      runType,
      runDate,
      draft,
      newsPreview
    };
  } catch (error) {
    const attempts = Array.isArray((error as NewsFetchError)?.attempts)
      ? ((error as NewsFetchError).attempts as NewsQueryAttemptResult[])
      : [];
    const provider = (error as NewsFetchError)?.providerUsed || selectedProvider;
    const newsPreview = buildNewsPreview(settings, attempts, [], provider);
    const message = `新聞草稿產生失敗：${safeErrorMessage(error)}`;
    const runId = await insertRun(env, userId, runType, runDate, "failed", message);
    return { runId, status: "failed", message, runType, runDate, newsPreview };
  }
}

export async function executeScheduledNewsPrefill(
  env: Env,
  userId: number,
  settings: StoredSettings,
  now = new Date()
) {
  return executeNewsPrefill(env, userId, settings, now, "scheduled_news_prefill");
}

export async function executeManualNewsPrefill(
  env: Env,
  userId: number,
  settings: StoredSettings,
  now = new Date()
) {
  return executeNewsPrefill(env, userId, settings, now, "manual_news_prefill");
}
