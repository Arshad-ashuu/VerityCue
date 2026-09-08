import type { KnowledgeHit } from '../types.js';

const LEARN_MCP_URL = 'https://learn.microsoft.com/api/mcp';
/** Learn answers in ~1s typically; this only bounds the rare slow tail. */
const TIMEOUT_MS = 5000;

interface LearnResult {
  title?: string;
  contentUrl?: string;
  content?: string;
}

/**
 * Fallback grounding from official Microsoft Learn documentation, used when the
 * local knowledge base has nothing relevant. Public endpoint, no auth required.
 */
export async function searchOfficialDocs(query: string, topK = 3): Promise<KnowledgeHit[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(LEARN_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'microsoft_docs_search', arguments: { query } },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return [];

    // The endpoint answers with an SSE frame even for a single response.
    const body = await response.text();
    const line = body.split('\n').find((l) => l.startsWith('data: '));
    if (!line) return [];

    const envelope = JSON.parse(line.slice(6));
    const payload = envelope?.result?.content?.[0]?.text;
    if (!payload) return [];

    const results = (JSON.parse(payload)?.results ?? []) as LearnResult[];
    const usable = results.filter((r) => r.contentUrl && r.content);
    console.log(
      `[learn] ${Date.now() - started}ms results=${results.length} usable=${usable.length}`,
    );

    return usable
      .slice(0, topK)
      .map((r) => ({
        source: r.contentUrl!,
        heading: r.title ?? 'Microsoft Learn',
        text: (r.content ?? '').slice(0, 1500),
        score: 0,
      }));
  } catch (error) {
    console.warn(`[learn] failed after ${Date.now() - started}ms: ${(error as Error).name}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
