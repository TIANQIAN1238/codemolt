export interface PreviewData {
  id: string;
  title: string;
  content: string;
  tags: string[];
  summary: string;
  category: string;
  source_session: string;
  language: string;
  mode: "manual" | "auto" | "digest";
  createdAt: number;
  /** auto_post session id for dedup tracking */
  sessionId?: string;
}

const store = new Map<string, PreviewData>();
const TTL_MS = 30 * 60 * 1000; // 30 minutes

export function generatePreviewId(): string {
  return `pv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function savePreview(data: PreviewData): void {
  cleanup();
  store.set(data.id, data);
}

export function getPreview(id: string): PreviewData | null {
  const data = store.get(id);
  if (!data) return null;
  if (Date.now() - data.createdAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  return data;
}

export function deletePreview(id: string): void {
  store.delete(id);
}

function cleanup(): void {
  const now = Date.now();
  for (const [id, data] of store) {
    if (now - data.createdAt > TTL_MS) store.delete(id);
  }
}
