import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { parseHTML } from "linkedom";

describe("extension content script snapshot and interactions", () => {
  test("builds @ref tree, skips hidden nodes, clicks and types into inputs", async () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>Jobs</title></head>
        <body>
          <main>
            <h1>Recommended Jobs</h1>
            <div style="display:none">
              <button>Hidden Button</button>
            </div>
            <label for="search">Search title</label>
            <input id="search" type="text" value="" />
            <a href="/jobs/42">Senior AI Engineer</a>
            <button id="save-btn" aria-pressed="false">Save Job</button>
          </main>
        </body>
      </html>
    `;

    const { window, document, Node, Event, HTMLInputElement, HTMLTextAreaElement } =
      parseHTML(html);

    let listener: ((msg: unknown) => Promise<unknown> | undefined) | null = null;
    let clickedCount = 0;
    document.getElementById("save-btn")!.addEventListener("click", () => {
      clickedCount++;
    });

    // Patch minimal DOM APIs expected by content.js under linkedom
    for (const el of document.querySelectorAll("*")) {
      (el as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
      (el as unknown as { focus: () => void }).focus = () => {};
      (el as unknown as { getBoundingClientRect: () => { width: number; height: number; left: number; top: number } }).getBoundingClientRect = () => ({
        width: 100,
        height: 24,
        left: 0,
        top: 0,
      });
    }

    const prevGlobals = {
      document: globalThis.document,
      window: globalThis.window,
      location: globalThis.location,
      Node: globalThis.Node,
      CSS: globalThis.CSS,
      getComputedStyle: globalThis.getComputedStyle,
      browser: (globalThis as Record<string, unknown>).browser,
      __opencodeZenLoaded: (globalThis as Record<string, unknown>).__opencodeZenLoaded,
    };

    try {
      Object.assign(globalThis, {
        document,
        window,
        location: { href: "https://linkedin.com/jobs" },
        Node,
        Event,
        MouseEvent: Event,
        KeyboardEvent: Event,
        HTMLInputElement,
        HTMLTextAreaElement,
        CSS: { escape: (s: string) => s },
        getComputedStyle: (el: Element) => {
          const styleAttr = el.getAttribute("style") || "";
          return {
            display: styleAttr.includes("display:none") ? "none" : "block",
            visibility: "visible",
            opacity: "1",
          };
        },
        browser: {
          runtime: {
            onMessage: {
              addListener: (fn: (msg: unknown) => Promise<unknown> | undefined) => {
                listener = fn;
              },
            },
          },
        },
        __opencodeZenLoaded: false,
      });

      const scriptPath = path.resolve(import.meta.dir, "../extension/content.js");
      const code = fs.readFileSync(scriptPath, "utf8");
      new Function(code)();

      expect(listener).not.toBeNull();

      const snap = (await listener!({ type: "zen:snapshot", mode: "interactive" })) as {
        refCount: number;
        elements: Array<{ ref: string; role: string; name: string }>;
        content: string;
      };

      expect(snap.content).toContain('heading(h1) "Recommended Jobs"');
      expect(snap.content).toContain('textbox "Search title" [@1]');
      expect(snap.content).toContain('link "Senior AI Engineer" [@2]');
      expect(snap.content).toContain('button "Save Job" [@3]');
      expect(snap.content).not.toContain("Hidden Button");
      expect(snap.elements).toEqual([
        { ref: "@1", role: "textbox", name: "Search title" },
        { ref: "@2", role: "link", name: "Senior AI Engineer" },
        { ref: "@3", role: "button", name: "Save Job" },
      ]);

      const typed = (await listener!({
        type: "zen:type",
        ref: "@1",
        text: "Go Developer",
        clear: true,
      })) as { action: string; length: number };
      expect(typed.action).toBe("type");
      expect((document.getElementById("search") as HTMLInputElement).value).toBe("Go Developer");

      const clicked = (await listener!({ type: "zen:click", ref: "@3" })) as {
        action: string;
        ref: string;
      };
      expect(clicked.action).toBe("click");
      expect(clickedCount).toBe(1);
    } finally {
      Object.assign(globalThis, prevGlobals);
    }
  });

  test("focuses open dialog inside 0x0 portal wrapper and exposes styled radios", async () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>Profile</title></head>
        <body>
          <nav><a href="/feed">Feed</a></nav>
          <main><p>Main content that should be skipped while modal is open and has enough text.</p></main>
          <div id="portal" style="zero-box">
            <div role="dialog" aria-modal="true">
              <h2>Edit activity</h2>
              <label for="r-posts"><input id="r-posts" type="radio" name="act" style="opacity-zero" />Posts</label>
              <button>Save</button>
            </div>
          </div>
        </body>
      </html>
    `;

    const { window, document, Node, Event, HTMLInputElement, HTMLTextAreaElement } =
      parseHTML(html);

    for (const el of document.querySelectorAll("*")) {
      const styleAttr = el.getAttribute("style") || "";
      const isZero = styleAttr.includes("zero-box") || styleAttr.includes("opacity-zero");
      (el as unknown as { getBoundingClientRect: () => { width: number; height: number; left: number; top: number } }).getBoundingClientRect = () =>
        isZero ? { width: 0, height: 0, left: 0, top: 0 } : { width: 120, height: 28, left: 0, top: 0 };
    }

    const prevGlobals = {
      document: globalThis.document,
      window: globalThis.window,
      location: globalThis.location,
      Node: globalThis.Node,
      CSS: globalThis.CSS,
      getComputedStyle: globalThis.getComputedStyle,
      browser: (globalThis as Record<string, unknown>).browser,
      __opencodeZenLoaded: (globalThis as Record<string, unknown>).__opencodeZenLoaded,
    };

    try {
      let listener: ((msg: unknown) => Promise<unknown> | undefined) | null = null;
      Object.assign(globalThis, {
        document,
        window,
        location: { href: "https://linkedin.com/in/test" },
        Node,
        Event,
        MouseEvent: Event,
        KeyboardEvent: Event,
        HTMLInputElement,
        HTMLTextAreaElement,
        CSS: { escape: (s: string) => s },
        getComputedStyle: (el: Element) => {
          const styleAttr = el.getAttribute("style") || "";
          return {
            display: "block",
            visibility: "visible",
            opacity: styleAttr.includes("opacity-zero") ? "0" : "1",
          };
        },
        browser: {
          runtime: {
            onMessage: {
              addListener: (fn: (msg: unknown) => Promise<unknown> | undefined) => {
                listener = fn;
              },
            },
          },
        },
        __opencodeZenLoaded: false,
      });

      const scriptPath = path.resolve(import.meta.dir, "../extension/content.js");
      new Function(fs.readFileSync(scriptPath, "utf8"))();

      const snap = (await listener!({ type: "zen:snapshot", mode: "interactive", scope: "auto" })) as {
        scope: string;
        content: string;
      };

      expect(snap.scope).toBe("dialog");
      expect(snap.content).toContain('heading(h2) "Edit activity"');
      expect(snap.content).toContain('radio "Posts" [@1]');
      expect(snap.content).toContain('button "Save" [@2]');
      expect(snap.content).not.toContain("Main content");
      expect(snap.content).not.toContain("Feed");
    } finally {
      Object.assign(globalThis, prevGlobals);
    }
  });

  test("executes same-site fetch with JSON parsing and blocks cross-site requests", async () => {
    const { window, document, Node, Event, HTMLInputElement, HTMLTextAreaElement } =
      parseHTML("<html><body></body></html>");

    const prevGlobals = {
      document: globalThis.document,
      window: globalThis.window,
      location: globalThis.location,
      Node: globalThis.Node,
      fetch: globalThis.fetch,
      browser: (globalThis as Record<string, unknown>).browser,
      __opencodeZenLoaded: (globalThis as Record<string, unknown>).__opencodeZenLoaded,
    };

    const calls: Array<{ url: string; init: RequestInit }> = [];

    try {
      let listener: ((msg: unknown) => Promise<unknown> | undefined) | null = null;
      Object.assign(globalThis, {
        document,
        window,
        location: { href: "https://www.x.com/home", origin: "https://www.x.com" },
        Node,
        Event,
        MouseEvent: Event,
        KeyboardEvent: Event,
        HTMLInputElement,
        HTMLTextAreaElement,
        fetch: async (url: string, init: RequestInit) => {
          calls.push({ url, init });
          if (url.includes("graphql")) {
            return new Response(JSON.stringify({ data: { user: "krishna" } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response("hello ".repeat(400), {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        },
        browser: {
          runtime: {
            onMessage: {
              addListener: (fn: (msg: unknown) => Promise<unknown> | undefined) => {
                listener = fn;
              },
            },
          },
        },
        __opencodeZenLoaded: false,
      });

      const scriptPath = path.resolve(import.meta.dir, "../extension/content.js");
      new Function(fs.readFileSync(scriptPath, "utf8"))();

      const jsonRes = (await listener!({
        type: "zen:fetch",
        url: "https://api.x.com/i/api/graphql/123",
        method: "POST",
        headers: { "x-csrf-token": "abc" },
        body: { queryId: "123" },
      })) as { status: number; ok: boolean; json: { data: { user: string } } };

      expect(jsonRes.status).toBe(200);
      expect(jsonRes.ok).toBe(true);
      expect(jsonRes.json).toEqual({ data: { user: "krishna" } });
      expect(calls[0].init.credentials).toBe("include");

      const textRes = (await listener!({
        type: "zen:fetch",
        url: "/plain",
        credentials: "omit",
        maxChars: 1000,
      })) as { truncated: boolean; text: string };
      expect(textRes.truncated).toBe(true);
      expect(textRes.text.length).toBe(1000);
      expect(calls[1].init.credentials).toBe("omit");

      await expect(
        listener!({ type: "zen:fetch", url: "https://mail.google.com/mail/u/0/" })
      ).rejects.toThrow("Cross-site fetch blocked");
    } finally {
      Object.assign(globalThis, prevGlobals);
    }
  });

  test("supports refStart numbering and skips tiny child iframes", async () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>Embedded</title></head>
        <body>
          <button id="pay-btn">Pay now</button>
          <a href="/terms">Terms</a>
        </body>
      </html>
    `;

    const { window, document, Node, Event, HTMLInputElement, HTMLTextAreaElement } =
      parseHTML(html);

    let clicked = 0;
    document.getElementById("pay-btn")!.addEventListener("click", () => {
      clicked++;
    });

    for (const el of document.querySelectorAll("*")) {
      (el as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
      (el as unknown as { focus: () => void }).focus = () => {};
      (el as unknown as { getBoundingClientRect: () => { width: number; height: number; left: number; top: number } }).getBoundingClientRect = () => ({
        width: 140,
        height: 32,
        left: 0,
        top: 0,
      });
    }

    const prevGlobals = {
      document: globalThis.document,
      window: globalThis.window,
      location: globalThis.location,
      Node: globalThis.Node,
      CSS: globalThis.CSS,
      getComputedStyle: globalThis.getComputedStyle,
      browser: (globalThis as Record<string, unknown>).browser,
      __opencodeZenLoaded: (globalThis as Record<string, unknown>).__opencodeZenLoaded,
    };

    try {
      let listener: ((msg: unknown) => Promise<unknown> | undefined) | null = null;
      const fakeTop = {};
      Object.assign(window, { top: fakeTop, innerWidth: 30, innerHeight: 14 });

      Object.assign(globalThis, {
        document,
        window,
        location: { href: "https://checkout.example.com/frame" },
        Node,
        Event,
        MouseEvent: Event,
        KeyboardEvent: Event,
        HTMLInputElement,
        HTMLTextAreaElement,
        CSS: { escape: (s: string) => s },
        getComputedStyle: () => ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          position: "static",
          zIndex: "auto",
        }),
        browser: {
          runtime: {
            onMessage: {
              addListener: (fn: (msg: unknown) => Promise<unknown> | undefined) => {
                listener = fn;
              },
            },
          },
        },
        __opencodeZenLoaded: false,
      });

      const scriptPath = path.resolve(import.meta.dir, "../extension/content.js");
      new Function(fs.readFileSync(scriptPath, "utf8"))();

      const skipped = (await listener!({
        type: "zen:snapshot",
        mode: "interactive",
        refStart: 18,
      })) as { skipped?: boolean; refCount: number; nextRef: number; content: string };

      expect(skipped.skipped).toBe(true);
      expect(skipped.refCount).toBe(0);
      expect(skipped.nextRef).toBe(18);
      expect(skipped.content).toBe("");

      // Single-line hosted field iframe (300x28) with interactive elements is kept
      Object.assign(window, { innerWidth: 300, innerHeight: 28 });
      const singleLineSnap = (await listener!({
        type: "zen:snapshot",
        mode: "interactive",
        refStart: 18,
      })) as { skipped?: boolean; refCount: number; nextRef: number };
      expect(singleLineSnap.skipped).toBeUndefined();
      expect(singleLineSnap.refCount).toBe(2);

      Object.assign(window, { innerWidth: 500, innerHeight: 400 });

      const snap = (await listener!({
        type: "zen:snapshot",
        mode: "interactive",
        refStart: 18,
      })) as {
        skipped?: boolean;
        refCount: number;
        nextRef: number;
        elements: Array<{ ref: string; name: string }>;
        content: string;
      };

      expect(snap.skipped).toBeUndefined();
      expect(snap.refCount).toBe(2);
      expect(snap.nextRef).toBe(20);
      expect(snap.elements.map((e) => e.ref)).toEqual(["@18", "@19"]);
      expect(snap.content).toContain('button "Pay now" [@18]');

      await listener!({ type: "zen:click", ref: "@18" });
      expect(clicked).toBe(1);
    } finally {
      Object.assign(globalThis, prevGlobals);
    }
  });

  test("detects non-ARIA fixed modals without triggering on fullscreen app shells", async () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>App</title></head>
        <body>
          <div id="app-shell" data-box="full" style="position:fixed; z-index:1000">
            <main data-box="full">
              <p>Main application workspace with plenty of content so main scope is active.</p>
              <button>Dashboard Action</button>
            </main>
          </div>
          <div id="floating-modal" data-box="panel" style="position:fixed; z-index:1050; display:none">
            <h2>Confirm Export</h2>
            <button>Export CSV</button>
          </div>
          <div id="backdrop" data-box="full" style="position:fixed; z-index:1060; display:none">
            <div id="centered-panel" data-box="panel">
              <h2>Invite Member</h2>
              <button>Send Invite</button>
            </div>
          </div>
        </body>
      </html>
    `;

    const { window, document, Node, Event, HTMLInputElement, HTMLTextAreaElement } =
      parseHTML(html);

    for (const el of document.querySelectorAll("*")) {
      const box = el.getAttribute("data-box");
      (el as unknown as { getBoundingClientRect: () => { width: number; height: number; left: number; top: number } }).getBoundingClientRect = () => {
        if (box === "full") return { width: 1280, height: 800, left: 0, top: 0 };
        if (box === "panel") return { width: 460, height: 300, left: 410, top: 250 };
        return { width: 200, height: 32, left: 0, top: 0 };
      };
    }

    const prevGlobals = {
      document: globalThis.document,
      window: globalThis.window,
      location: globalThis.location,
      Node: globalThis.Node,
      CSS: globalThis.CSS,
      getComputedStyle: globalThis.getComputedStyle,
      browser: (globalThis as Record<string, unknown>).browser,
      __opencodeZenLoaded: (globalThis as Record<string, unknown>).__opencodeZenLoaded,
    };

    try {
      let listener: ((msg: unknown) => Promise<unknown> | undefined) | null = null;
      Object.assign(window, { innerWidth: 1280, innerHeight: 800 });

      Object.assign(globalThis, {
        document,
        window,
        location: { href: "https://app.example.com" },
        Node,
        Event,
        MouseEvent: Event,
        KeyboardEvent: Event,
        HTMLInputElement,
        HTMLTextAreaElement,
        CSS: { escape: (s: string) => s },
        getComputedStyle: (el: Element) => {
          const styleAttr = el.getAttribute("style") || "";
          const zMatch = styleAttr.match(/z-index:\s*(\d+)/);
          return {
            display: styleAttr.includes("display:none") ? "none" : "block",
            visibility: "visible",
            opacity: "1",
            position: styleAttr.includes("position:fixed") ? "fixed" : "static",
            zIndex: zMatch ? zMatch[1] : "auto",
          };
        },
        browser: {
          runtime: {
            onMessage: {
              addListener: (fn: (msg: unknown) => Promise<unknown> | undefined) => {
                listener = fn;
              },
            },
          },
        },
        __opencodeZenLoaded: false,
      });

      const scriptPath = path.resolve(import.meta.dir, "../extension/content.js");
      new Function(fs.readFileSync(scriptPath, "utf8"))();

      const noModalSnap = (await listener!({
        type: "zen:snapshot",
        mode: "interactive",
        scope: "auto",
      })) as { scope: string; content: string };
      expect(noModalSnap.scope).toBe("main");
      expect(noModalSnap.content).toContain("Dashboard Action");

      const hasDlg0 = (await listener!({ type: "zen:hasDialog" })) as { found: boolean; count: number };
      expect(hasDlg0).toEqual({ found: false, count: 0 });

      // Enable direct floating fixed modal
      document.getElementById("floating-modal")!.setAttribute("style", "position:fixed; z-index:1050");
      const floatingSnap = (await listener!({
        type: "zen:snapshot",
        mode: "interactive",
        scope: "auto",
      })) as { scope: string; content: string };
      expect(floatingSnap.scope).toBe("dialog");
      expect(floatingSnap.content).toContain("Export CSV");
      expect(floatingSnap.content).not.toContain("Dashboard Action");
      expect(await listener!({ type: "zen:hasDialog" })).toEqual({ found: true, count: 1 });

      // Switch to fullscreen backdrop with smaller centered panel
      document.getElementById("floating-modal")!.setAttribute("style", "position:fixed; z-index:1050; display:none");
      document.getElementById("backdrop")!.setAttribute("style", "position:fixed; z-index:1060");
      const backdropSnap = (await listener!({
        type: "zen:snapshot",
        mode: "interactive",
        scope: "auto",
      })) as { scope: string; content: string };
      expect(backdropSnap.scope).toBe("dialog");
      expect(backdropSnap.content).toContain("Send Invite");
      expect(backdropSnap.content).not.toContain("Dashboard Action");
      expect(await listener!({ type: "zen:hasDialog" })).toEqual({ found: true, count: 1 });
    } finally {
      Object.assign(globalThis, prevGlobals);
    }
  });
});
