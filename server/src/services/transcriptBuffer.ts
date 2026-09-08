import { config } from '../config.js';
import type { Utterance } from '../types.js';

/**
 * Rolling per-meeting context. In memory only and evicted after inactivity so we
 * never persist meeting content.
 */
const IDLE_EVICTION_MS = 4 * 60 * 60 * 1000;

interface Meeting {
  utterances: Utterance[];
  answeredQuestions: string[];
  lastTouched: number;
}

const meetings = new Map<string, Meeting>();

function get(meetingId: string): Meeting {
  let meeting = meetings.get(meetingId);
  if (!meeting) {
    meeting = { utterances: [], answeredQuestions: [], lastTouched: Date.now() };
    meetings.set(meetingId, meeting);
  }
  meeting.lastTouched = Date.now();
  return meeting;
}

export function addUtterance(meetingId: string, utterance: Utterance): Utterance[] {
  const meeting = get(meetingId);
  meeting.utterances.push(utterance);
  if (meeting.utterances.length > config.transcriptWindow) {
    meeting.utterances.splice(0, meeting.utterances.length - config.transcriptWindow);
  }
  return meeting.utterances;
}

export function recentTranscript(meetingId: string): string {
  return get(meetingId)
    .utterances.map((u) => `${u.speaker}: ${u.text}`)
    .join('\n');
}

/** Suppresses near-duplicate follow-ups so the panel does not repeat itself. */
export function isDuplicateQuestion(meetingId: string, question: string): boolean {
  const normalized = normalize(question);
  return get(meetingId).answeredQuestions.some(
    (previous) => jaccard(normalize(previous), normalized) > 0.8,
  );
}

export function rememberQuestion(meetingId: string, question: string): void {
  const meeting = get(meetingId);
  meeting.answeredQuestions.push(question);
  if (meeting.answeredQuestions.length > 30) meeting.answeredQuestions.shift();
}

export function clearMeeting(meetingId: string): void {
  meetings.delete(meetingId);
}

function normalize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

setInterval(() => {
  const cutoff = Date.now() - IDLE_EVICTION_MS;
  for (const [id, meeting] of meetings) {
    if (meeting.lastTouched < cutoff) meetings.delete(id);
  }
}, 15 * 60 * 1000).unref();
