import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDING_MODEL, openai } from '../openaiClient.js';
import type { KnowledgeHit } from '../types.js';

const KNOWLEDGE_DIR = fileURLToPath(new URL('../../knowledge/', import.meta.url));
const MAX_CHUNK_CHARS = 1200;
/**
 * Measured on this corpus: a genuinely covered question tops ~0.79, while an
 * on-topic but uncovered one plateaus around ~0.50. 0.55 separates them.
 */
const MIN_RELEVANCE = 0.55;
/** Drop hits much weaker than the best one, so we never cite padding. */
const RELATIVE_CUTOFF = 0.08;

interface Chunk {
  source: string;
  heading: string;
  text: string;
  embedding: number[];
}

let chunks: Chunk[] = [];
let ready: Promise<void> | null = null;

/** Splits a markdown file on `##` headings, then on size. */
function splitMarkdown(source: string, markdown: string): Omit<Chunk, 'embedding'>[] {
  const sections = markdown.split(/^##\s+/m);
  const out: Omit<Chunk, 'embedding'>[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const [firstLine, ...rest] = trimmed.split('\n');
    const heading = firstLine.replace(/^#+\s*/, '').trim();
    const body = rest.join('\n').trim() || heading;

    for (let i = 0; i < body.length; i += MAX_CHUNK_CHARS) {
      out.push({ source, heading, text: body.slice(i, i + MAX_CHUNK_CHARS) });
    }
  }
  return out;
}

async function build(): Promise<void> {
  // README.md documents how to write knowledge files; its examples are not facts.
  const files = (await readdir(KNOWLEDGE_DIR)).filter(
    (f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md',
  );
  const raw: Omit<Chunk, 'embedding'>[] = [];

  for (const file of files) {
    const markdown = await readFile(path.join(KNOWLEDGE_DIR, file), 'utf8');
    raw.push(...splitMarkdown(file, markdown));
  }

  if (raw.length === 0) {
    console.warn('[knowledge] no markdown found in server/knowledge — answers will be ungrounded');
    return;
  }

  // Azure OpenAI caps inputs per request; batch to stay well inside it.
  const batchSize = 64;
  const built: Chunk[] = [];
  for (let i = 0; i < raw.length; i += batchSize) {
    const batch = raw.slice(i, i + batchSize);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((c) => `${c.heading}\n${c.text}`),
    });
    response.data.forEach((item, index) => {
      built.push({ ...batch[index], embedding: item.embedding });
    });
  }

  chunks = built;
  console.log(`[knowledge] indexed ${chunks.length} chunks from ${files.length} file(s)`);
}

export function initKnowledgeBase(): Promise<void> {
  ready ??= build().catch((error) => {
    console.error('[knowledge] index build failed', error);
  });
  return ready;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

export async function search(query: string, topK = 4): Promise<KnowledgeHit[]> {
  await initKnowledgeBase();
  if (chunks.length === 0) return [];

  const tEmbed = Date.now();
  const embedded = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: query });
  const queryVector = embedded.data[0].embedding;
  console.log(`[perf] embed=${Date.now() - tEmbed}ms`);

  const scored = chunks
    .map((chunk) => ({
      source: chunk.source,
      heading: chunk.heading,
      text: chunk.text,
      score: cosine(queryVector, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score);

  console.log(
    `[knowledge] "${query.slice(0, 50)}" -> ${scored
      .slice(0, 4)
      .map((h) => `${h.heading.slice(0, 28)}=${h.score.toFixed(3)}`)
      .join(', ')}`,
  );

  const relevant = scored.filter((hit) => hit.score >= MIN_RELEVANCE);
  if (relevant.length === 0) return [];

  const best = relevant[0].score;
  return relevant.slice(0, topK).filter((hit) => hit.score >= best - RELATIVE_CUTOFF);
}
