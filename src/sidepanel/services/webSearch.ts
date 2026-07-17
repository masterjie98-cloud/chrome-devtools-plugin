export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  query: string;
  source: string;
  searchedAt: string;
  results: WebSearchResultItem[];
}

interface BingRssItem {
  title: string;
  link: string;
  description: string;
}

interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
  Result?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

const SEARCH_TIMEOUT_MS = 10000;

export async function runWebSearch(
  args: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<WebSearchResult> {
  const query = readString(args.query) || readString(args.q);
  if (!query) {
    throw new Error("web_search requires query.");
  }

  const maxResults = clampInteger(args.max_results ?? args.limit, 1, 8, 5);
  const searchedAt = new Date().toISOString();

  try {
    const results = await searchBingRss(query, maxResults, options.signal);
    if (results.length > 0) {
      return { query, source: "bing-rss", searchedAt, results };
    }
  } catch {
    throwIfSearchAborted(options.signal);
    // Fall back to DuckDuckGo's JSON endpoint below.
  }

  const results = await searchDuckDuckGo(query, maxResults, options.signal);
  return { query, source: "duckduckgo-instant-answer", searchedAt, results };
}

async function searchBingRss(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResultItem[]> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");

  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
  }, signal);
  if (!response.ok) {
    throw new Error(`Bing RSS search failed with HTTP ${response.status}.`);
  }

  const xml = await response.text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const items: BingRssItem[] = Array.from(doc.querySelectorAll("item")).map(
    (item) => ({
      title: textContent(item, "title"),
      link: textContent(item, "link"),
      description: textContent(item, "description"),
    }),
  );

  return items
    .filter((item) => item.title && item.link)
    .slice(0, maxResults)
    .map((item) => ({
      title: item.title,
      url: item.link,
      snippet: stripHtml(item.description),
    }));
}

async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResultItem[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("no_html", "1");

  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: "application/json" },
  }, signal);
  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as DuckDuckGoResponse;
  const results: WebSearchResultItem[] = [];

  if (payload.AbstractText && payload.AbstractURL) {
    results.push({
      title: payload.Heading || query,
      url: payload.AbstractURL,
      snippet: payload.AbstractText,
    });
  }

  for (const topic of flattenTopics(payload.RelatedTopics ?? [])) {
    if (!topic.Text || !topic.FirstURL) {
      continue;
    }
    results.push({
      title: topic.Text.split(" - ")[0] || topic.Text,
      url: topic.FirstURL,
      snippet: topic.Text,
    });
    if (results.length >= maxResults) {
      break;
    }
  }

  return results.slice(0, maxResults);
}

function flattenTopics(topics: DuckDuckGoTopic[]): DuckDuckGoTopic[] {
  return topics.flatMap((topic) =>
    topic.Topics ? flattenTopics(topic.Topics) : [topic],
  );
}

function textContent(item: Element, selector: string): string {
  return item.querySelector(selector)?.textContent?.trim() ?? "";
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(max, Math.max(min, value)))
    : fallback;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SEARCH_TIMEOUT_MS);
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (externalSignal?.aborted && !timedOut) {
        throw new Error("联网搜索已取消。");
      }
      throw new Error("联网搜索超时，请稍后重试或关闭联网。");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function throwIfSearchAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("联网搜索已取消。");
  }
}
