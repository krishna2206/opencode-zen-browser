import { describe, expect, test } from "bun:test";
import { htmlToReadableMarkdown } from "../src/markdown.js";

describe("htmlToReadableMarkdown", () => {
  test("extracts main article content via Readability and strips nav/script noise", () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>Senior AI Engineer — Acme</title></head>
        <body>
          <nav><a href="/home">Home</a><a href="/login">Login</a></nav>
          <article>
            <h1>Senior AI Engineer</h1>
            <p>We are building deterministic agent tooling in TypeScript and Go for developer workflows across distributed teams.</p>
            <h2>Requirements</h2>
            <ul>
              <li>Strong experience with TypeScript and Node.js</li>
              <li>Experience designing reliable LLM tool interfaces</li>
            </ul>
            <p>More details on our engineering blog and architecture notes covering latency, reliability, and testing strategies.</p>
          </article>
          <script>window.__secret = 1;</script>
        </body>
      </html>
    `;

    const res = htmlToReadableMarkdown(html, {
      url: "https://example.com/jobs/123",
      title: "Fallback Title",
    });

    expect(res.title).toContain("Senior AI Engineer");
    expect(res.markdown).toContain("## Requirements");
    expect(res.markdown).toContain("Strong experience with TypeScript and Node.js");
    expect(res.markdown).not.toContain("__secret");
    expect(res.truncated).toBe(false);
  });

  test("falls back cleanly on app-like markup and respects maxChars", () => {
    const html = `
      <html>
        <body>
          <main>
            <h2>Job List</h2>
            <p>${"Detail item ".repeat(60)}</p>
          </main>
        </body>
      </html>
    `;

    const res = htmlToReadableMarkdown(html, {
      url: "https://linkedin.com/jobs",
      title: "LinkedIn Jobs",
      maxChars: 120,
    });

    expect(res.truncated).toBe(true);
    expect(res.markdown).toContain("[truncated at 120 chars]");
    expect(res.title).toBe("LinkedIn Jobs");
  });
});
