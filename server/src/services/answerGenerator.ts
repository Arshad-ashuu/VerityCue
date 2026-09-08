import { ANSWER_MODEL, openai } from '../openaiClient.js';
import type { Detection, KnowledgeHit } from '../types.js';

const SYSTEM_PROMPT = `You are a private co-presenter feeding an answer to a solution engineer mid-call.
They will read your answer out loud within seconds.

Reply in EXACTLY this shape and nothing else:
<2-3 short sentences they can say out loud>
- <follow-up point, max 12 words>
- <follow-up point, max 12 words>

Rules:
- Conversational and confident, no filler. Lead with the benefit in the customer's terms, then the reason. Never open with "It depends".
- Plain language. Expand an acronym the first time. No markdown, no headings, no emojis.
- Prefer the supplied notes for facts, numbers, names and limits.
- Never mention "the notes", "sources" or that you are an AI.`;

const NO_NOTES = `No notes were found for this question. Answer from general knowledge, but stay high level:
avoid specific numbers, limits, pricing or feature claims you cannot be sure of.`;

export interface GeneratedAnswer {
  answer: string;
  talkingPoints: string[];
}

export async function* streamAnswer(
  detection: Detection,
  hits: KnowledgeHit[],
  transcript: string,
): AsyncGenerator<string> {
  const notes = hits.length
    ? hits.map((h, i) => `[${i + 1}] ${h.heading}\n${h.text}`).join('\n\n')
    : NO_NOTES;

  const stream = await openai.chat.completions.create({
    model: ANSWER_MODEL,
    temperature: 0.3,
    max_tokens: 260,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Customer question: ${detection.question}`,
          `Topic: ${detection.topic} | Intent: ${detection.intent} | Domain: ${detection.domain}`,
          '',
          hits.length ? 'Notes you may use:' : 'Guidance:',
          notes,
          '',
          'Recent conversation (for tone and context only):',
          transcript,
        ].join('\n'),
      },
    ],
  });

  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/** Splits the streamed text into the spoken answer and its follow-up bullets. */
export function parseAnswer(raw: string): GeneratedAnswer {
  const answer: string[] = [];
  const talkingPoints: string[] = [];

  for (const line of raw.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-•*]\s+/.test(trimmed)) talkingPoints.push(trimmed.replace(/^[-•*]\s+/, ''));
    else answer.push(trimmed);
  }

  return { answer: answer.join(' '), talkingPoints: talkingPoints.slice(0, 3) };
}
