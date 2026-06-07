import { logEvent, logEventError } from "../event-log.js";
import {
  fetchPages,
  formatLinkFetchContext,
  formatLinkFetchFailure,
} from "../playwright/client.js";
import { extractUrls } from "./link-extract.js";

export interface LinkFetchInput {
  userMessage: string;
  replyContext?: string | null;
}

export interface LinkFetchResult {
  context: string | null;
  urlCount: number;
  /** At least one detected URL returned page content. */
  resolved: boolean;
}

/**
 * Detect http(s) links in the addressed turn, visit them with Playwright,
 * and format context for the main reply (similar to Tavily web search).
 */
export async function resolveLinkFetchContext(
  input: LinkFetchInput,
): Promise<LinkFetchResult> {
  const urls = extractUrls(input.userMessage, input.replyContext);
  if (urls.length === 0) {
    return { context: null, urlCount: 0, resolved: false };
  }

  try {
    const pages = await fetchPages(urls);
    const loaded = pages.filter((p) => !p.error).length;
    logEvent("link_fetch_done", {
      urlCount: urls.length,
      loadedCount: loaded,
      failedCount: pages.length - loaded,
    });
    return {
      context: formatLinkFetchContext(pages),
      urlCount: urls.length,
      resolved: loaded > 0,
    };
  } catch (err) {
    logEventError("link_fetch_failed", err, { urlCount: urls.length });
    return {
      context: formatLinkFetchFailure(urls, err),
      urlCount: urls.length,
      resolved: false,
    };
  }
}
