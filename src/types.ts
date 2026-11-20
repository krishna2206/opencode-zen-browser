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
