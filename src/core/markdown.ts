import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export interface MarkdownConversionOptions {
  url: string;
  title?: string;
  maxChars?: number;
}

export interface MarkdownConversionOutput {
  title: string;
  byline: string | null;
  usedReadability: boolean;
  truncated: boolean;
  markdown: string;
}

function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  td.remove(["script", "style", "noscript", "svg", "template"]);
  return td;
}

export function htmlToReadableMarkdown(
  html: string,
  options: MarkdownConversionOptions
): MarkdownConversionOutput {
  const maxChars = options.maxChars ?? 24_000;
  const { document } = parseHTML(html);

  // Set document URI so Readability resolves relative links cleanly when available
  try {
    Object.defineProperty(document, "baseURI", { value: options.url, configurable: true });
  } catch {
    // Ignore if readonly in current linkedom version
  }

  let article: ReturnType<Readability["parse"]> = null;
  try {
    const reader = new Readability(
      document.cloneNode(true) as unknown as ConstructorParameters<typeof Readability>[0]
    );
    article = reader.parse();
  } catch {
    article = null;
  }

  const turndown = createTurndown();
  const title = article?.title?.trim() || options.title?.trim() || document.title?.trim() || "";
  const usedReadability = Boolean(article?.content && article.content.trim().length > 0);

  let rawHtml = "";
  if (usedReadability && article?.content) {
    rawHtml = article.content;
  } else {
    const main = document.querySelector("main") ?? document.body ?? document.documentElement;
    rawHtml = main ? main.innerHTML : html;
  }

  let markdown = turndown.turndown(rawHtml).replace(/\n{3,}/g, "\n\n").trim();
  const truncated = markdown.length > maxChars;
  if (truncated) {
    markdown = `${markdown.slice(0, maxChars).trimEnd()}\n\n[truncated at ${maxChars} chars]`;
  }

  return {
    title,
    byline: article?.byline ?? null,
    usedReadability,
    truncated,
    markdown,
  };
}
