export type Speaker = 'customer' | 'me' | 'unknown';

export interface Utterance {
  id: string;
  text: string;
  speaker: Speaker;
  /** Epoch ms. */
  at: number;
}

export interface Detection {
  isQuestion: boolean;
  /** The question rewritten as a clean, standalone sentence. */
  question: string;
  topic: string;
  /** e.g. "objection", "comparison", "how-to", "pricing", "risk", "clarification" */
  intent: string;
  /** e.g. "Azure • Infrastructure as Code" */
  domain: string;
  /** 0..1 — below 0.55 we stay silent rather than distract the presenter. */
  confidence: number;
}

export interface KnowledgeHit {
  source: string;
  heading: string;
  text: string;
  score: number;
}

/** Where the facts in an answer came from, in descending order of trust. */
export type Grounding = 'notes' | 'official' | 'model';

export interface Suggestion extends Detection {
  id: string;
  /** 2–3 sentences, customer friendly, no jargon dumps. */
  answer: string;
  talkingPoints: string[];
  sources: string[];
  grounding: Grounding;
  createdAt: number;
}
