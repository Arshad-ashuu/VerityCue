export type Grounding = 'notes' | 'official' | 'model';

export interface Suggestion {
  id: string;
  question: string;
  topic: string;
  intent: string;
  domain: string;
  confidence: number;
  answer: string;
  talkingPoints: string[];
  sources: string[];
  grounding: Grounding;
  streaming: boolean;
  createdAt: number;
}

export type SuggestionMeta = Omit<
  Suggestion,
  'answer' | 'talkingPoints' | 'streaming' | 'createdAt'
>;

/** Empty by default: requests go to /api on the same origin and Vite proxies them. */
const BASE = import.meta.env.VITE_API_BASE ?? '';

export async function getSpeechToken(): Promise<{ token: string; region: string }> {
  const response = await fetch(`${BASE}/api/speech-token`);
  if (!response.ok) throw new Error('Could not get a speech token');
  return response.json();
}

export interface StreamHandlers {
  onMeta: (meta: SuggestionMeta) => void;
  onDelta: (id: string, raw: string) => void;
  onDone: (id: string, answer: string, talkingPoints: string[]) => void;
}

/** Splits streamed text into the spoken answer and its bullets, mirroring the server. */
export function parseAnswer(raw: string): { answer: string; talkingPoints: string[] } {
  const answer: string[] = [];
  const talkingPoints: string[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-•*]\s+/.test(trimmed)) talkingPoints.push(trimmed.replace(/^[-•*]\s+/, ''));
    else answer.push(trimmed);
  }

  return { answer: answer.join(' '), talkingPoints: talkingPoints.slice(0, 3) };
}

export async function analyze(
  meetingId: string,
  text: string,
  speaker: 'customer' | 'me' | 'unknown',
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId, text, speaker }),
  });
  if (!response.ok || !response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentId = '';
  let raw = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; keep any partial tail for next read.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const lines = frame.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))?.slice(7).trim();
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (!event || !dataLine) continue;

      const data = JSON.parse(dataLine.slice(6));
      if (event === 'meta') {
        currentId = data.id;
        raw = '';
        handlers.onMeta(data as SuggestionMeta);
      } else if (event === 'delta') {
        raw += data.text;
        handlers.onDelta(currentId, raw);
      } else if (event === 'done') {
        handlers.onDone(currentId, data.answer, data.talkingPoints);
      }
    }
  }
}

export async function resetMeeting(meetingId: string): Promise<void> {
  await fetch(`${BASE}/api/meetings/${encodeURIComponent(meetingId)}/reset`, { method: 'POST' });
}
