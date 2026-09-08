import { DETECT_MODEL, openai } from '../openaiClient.js';
import type { Detection } from '../types.js';

const QUESTION_CUES =
  /\b(what|why|how|when|where|which|who|whom|whose|can|could|would|should|do|does|did|is|are|was|were|will|isn't|aren't|don't|doesn't|any|about|wondering|curious|clarify|explain|difference|compare|versus|vs|instead of|cost|price|licen[cs]e|secure|security|support|migrate|scale)\b/i;

/**
 * Cheap gate so we do not pay for an LLM call on every "yeah, exactly".
 * Deliberately lenient — transcripts rarely contain question marks.
 */
export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) return false;
  if (trimmed.includes('?')) return true;
  return QUESTION_CUES.test(trimmed);
}

const DETECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isQuestion', 'question', 'topic', 'intent', 'domain', 'confidence'],
  properties: {
    isQuestion: {
      type: 'boolean',
      description: 'True only if the customer is asking something that deserves an answer.',
    },
    question: {
      type: 'string',
      description: 'The question rewritten as one clear standalone sentence. Empty if isQuestion is false.',
    },
    topic: { type: 'string', description: 'Short subject label, max 4 words.' },
    intent: {
      type: 'string',
      enum: [
        'objection',
        'comparison',
        'how-to',
        'pricing',
        'security',
        'risk',
        'timeline',
        'clarification',
        'feasibility',
        'other',
      ],
    },
    domain: { type: 'string', description: 'Technical domain, e.g. "Azure • Infrastructure as Code".' },
    confidence: { type: 'number', description: 'Between 0 and 1.' },
  },
} as const;

const SYSTEM_PROMPT = `You classify live meeting transcript snippets for a sales/solution engineer.
Decide whether the LAST line contains a genuine question or challenge from the customer that the engineer should answer.

Return isQuestion = false for:
- small talk, greetings, logistics ("can everyone see my screen?", "should we start?")
- the engineer's own rhetorical questions
- statements of agreement or acknowledgement
- an incomplete fragment where the question is not yet clear

Use the earlier lines only to resolve pronouns and rewrite the question so it stands alone.`;

export async function detectQuestion(
  transcript: string,
  latest: string,
): Promise<Detection> {
  const response = await openai.chat.completions.create({
    model: DETECT_MODEL,
    temperature: 0,
    max_tokens: 200,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Recent transcript:\n${transcript}\n\nLAST LINE to classify:\n${latest}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'detection', strict: true, schema: DETECTION_SCHEMA },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return blank();
  }

  try {
    const parsed = JSON.parse(content) as Detection;
    return { ...blank(), ...parsed };
  } catch {
    return blank();
  }
}

function blank(): Detection {
  return {
    isQuestion: false,
    question: '',
    topic: '',
    intent: 'other',
    domain: '',
    confidence: 0,
  };
}
