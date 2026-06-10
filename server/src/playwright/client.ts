import { chromium, type Browser, type BrowserContext } from "playwright";

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  error?: string;
}

const NAVIGATION_TIMEOUT_MS = 60_000;
const MAX_URLS_PER_TURN = 3;
const MAX_PAGE_TEXT_CHARS = 12_000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; ModelAPITGBot/1.0; +https://github.com/model-api-tg-bot)";

let browser: Browser | null = null;
let browserInit: Promise<Browser> | null = null;

export async function closePlaywrightBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    browserInit = null;
  }
}

async function ensureBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (!browserInit) {
    browserInit = chromium
      .launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      })
      .then((b) => {
        browser = b;
        return b;
      })
      .catch((err) => {
        browserInit = null;
        throw err;
      });
  }
  return browserInit;
}

function trimPageText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT_CHARS);
}

async function fetchOnePage(
  context: BrowserContext,
  url: string,
): Promise<FetchedPage> {
  const page = await context.newPage();
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    const title = (await page.title()).trim();
    const rawText = await page.evaluate(() => {
      const body = document.body;
      if (!body) return "";
      return body.innerText ?? "";
    });
    return {
      url,
      title,
      text: trimPageText(rawText),
    };
  } catch (err) {
    return {
      url,
      title: "",
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await page.close();
  }
}

export async function fetchPages(urls: string[]): Promise<FetchedPage[]> {
  const limited = urls.slice(0, MAX_URLS_PER_TURN);
  if (limited.length === 0) return [];

  const browserInstance = await ensureBrowser();
  const context = await browserInstance.newContext({
    userAgent: USER_AGENT,
  });

  try {
    return await Promise.all(limited.map((url) => fetchOnePage(context, url)));
  } finally {
    await context.close();
  }
}

export function formatLinkFetchContext(pages: FetchedPage[]): string {
  const parts: string[] = [
    "The user's message included link(s). Page content fetched with Playwright:",
  ];

  for (const [i, page] of pages.entries()) {
    const header = `${i + 1}. ${page.url}`;
    if (page.error) {
      parts.push(`${header}\nFailed to load: ${page.error}`);
      continue;
    }
    const titleLine = page.title ? `\nTitle: ${page.title}` : "";
    const bodyLine = page.text
      ? `\nContent:\n${page.text}`
      : "\nContent: (page had no readable text)";
    parts.push(`${header}${titleLine}${bodyLine}`);
  }

  parts.push(
    "\nUse the fetched page content above in your reply. " +
      "Do not tell the user you cannot open links when this block is present.",
  );

  return parts.join("\n\n");
}

export function formatLinkFetchFailure(urls: string[], err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  const list = urls.join(", ");
  return (
    `The message included link(s) (${list}) but Playwright could not fetch them: ${detail}\n\n` +
    `Tell the user live page fetch failed. Do not pretend you opened the links successfully.`
  );
}
