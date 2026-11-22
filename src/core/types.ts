export interface TabInfo {
  id: number;
  windowId: number;
  cookieStoreId?: string;
  title: string;
  url: string;
  favIconUrl?: string;
  active: boolean;
  attached: boolean;
  openedByAgent: boolean;
  scriptable: boolean;
}

export interface TabSummary {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
  openedByAgent: boolean;
}

export interface TabsListResult {
  bridgeConnected: boolean;
  readOnly: boolean;
  attachedWindows: number[];
  tabs: TabInfo[];
}

export interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  selected?: boolean;
  disabled?: boolean;
}

export interface InteractiveSnapshotResult {
  tabId: number;
  windowId: number;
  mode: "interactive";
  scope?: string;
  url: string;
  title: string;
  refCount: number;
  truncated: boolean;
  elements?: SnapshotElement[];
  content: string;
}

export interface MarkdownSnapshotRawResult {
  tabId: number;
  windowId: number;
  mode: "markdown";
  url: string;
  title: string;
  truncated: boolean;
  html: string;
}

export interface ScreenshotRawResult {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  mimeType?: "image/png" | "image/jpeg";
  dataUrl: string;
}

export interface ScreenshotResult {
  tabId: number;
  path: string;
  mime: string;
  title: string;
  url: string;
}

export interface CloseResult {
  action: "closed" | "detached";
  tabId: number;
}

export interface FetchResult {
  tabId: number;
  status: number;
  ok: boolean;
  url: string;
  contentType: string;
  truncated: boolean;
  json?: unknown;
  text?: string;
}

export interface NetworkEntry {
  url: string;
  method: string;
  statusCode: number | null;
  timestamp: number;
  headers: Record<string, string>;
  requestBody?: string;
  error?: string;
}

export interface NetworkResult {
  tabId: number;
  totalBuffered: number;
  count: number;
  entries: NetworkEntry[];
}

export interface InteractResult {
  tabId: number;
  action: string;
  ref?: string;
  tag?: string;
  label?: string;
  url?: string;
  title?: string;
  length?: number;
  submitted?: boolean;
  target?: string;
  direction?: string;
  scrollTop?: number;
  scrollY?: number;
  scrollHeight?: number;
  found?: boolean;
  text?: string;
  waitedMs?: number;
}
