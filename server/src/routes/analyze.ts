import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { getAccessToken } from '../openaiClient.js';
import { parseAnswer, streamAnswer } from '../services/answerGenerator.js';
import { search } from '../services/knowledgeBase.js';
import { searchOfficialDocs } from '../services/officialDocs.js';
import { detectQuestion, looksLikeQuestion } from '../services/questionDetector.js';
import {
  addUtterance,
  clearMeeting,
  isDuplicateQuestion,
  recentTranscript,
  rememberQuestion,
} from '../services/transcriptBuffer.js';
import type { Grounding, Speaker } from '../types.js';

export const analyzeRouter = Router();

const MIN_CONFIDENCE = 0.55;
const SPEAKERS: Speaker[] = ['customer', 'me', 'unknown'];

/**
 * One recognized utterance in, at most one suggestion out.
 * Returns `{ suggestion: null }` for the common case of ordinary conversation.
 */
analyzeRouter.post('/analyze', async (req, res) => {
  const meetingId = String(req.body?.meetingId ?? '').trim();
  const text = String(req.body?.text ?? '').trim();
  const speaker: Speaker = SPEAKERS.includes(req.body?.speaker) ? req.body.speaker : 'unknown';

  if (!meetingId || !text) {
    return res.status(400).json({ error: 'meetingId and text are required' });
  }

  addUtterance(meetingId, { id: randomUUID(), text, speaker, at: Date.now() });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const skip = (reason: string) => {
    send('skip', { reason });
    res.end();
  };

  // The presenter's own speech is context, never something to answer.
  if (speaker === 'me' || !looksLikeQuestion(text)) return skip('not-a-question');

  const transcript = recentTranscript(meetingId);
  const t0 = Date.now();

  // Retrieval is ~2.7s of network, so start it on the raw utterance now and let it
  // run behind detection instead of after it.
  const notesPromise = search(text).catch(() => []);
  const officialPromise = searchOfficialDocs(text).catch(() => []);

  try {
    const detection = await detectQuestion(transcript, text);
    const tDetect = Date.now();

    if (!detection.isQuestion || detection.confidence < MIN_CONFIDENCE) {
      void officialPromise;
      return skip('low-confidence');
    }
    if (isDuplicateQuestion(meetingId, detection.question)) {
      void officialPromise;
      return skip('duplicate');
    }
    rememberQuestion(meetingId, detection.question);

    let hits = await notesPromise;
    let grounding: Grounding = 'notes';
    if (hits.length === 0) {
      hits = await officialPromise;
      grounding = hits.length > 0 ? 'official' : 'model';
    }
    const tSearch = Date.now();

    const id = randomUUID();
    send('meta', {
      id,
      question: detection.question,
      topic: detection.topic,
      intent: detection.intent,
      domain: detection.domain,
      confidence: detection.confidence,
      grounding,
      sources: [...new Set(hits.map((h) => h.source))],
    });

    let raw = '';
    let firstToken = 0;
    for await (const delta of streamAnswer(detection, hits, transcript)) {
      if (!firstToken) firstToken = Date.now();
      raw += delta;
      send('delta', { text: delta });
    }

    const timings = {
      detect: tDetect - t0,
      search: tSearch - tDetect,
      firstToken: (firstToken || Date.now()) - tSearch,
      total: Date.now() - t0,
    };
    console.log(`[perf] ${JSON.stringify(timings)} grounding=${grounding}`);

    send('done', { ...parseAnswer(raw), timings });
    return res.end();
  } catch (error) {
    console.error('[analyze] failed', error);
    send('error', { message: 'analysis failed' });
    return res.end();
  }
});

/** Called when the presenter stops listening or leaves, so nothing lingers in memory. */
analyzeRouter.post('/meetings/:meetingId/reset', (req, res) => {
  clearMeeting(req.params.meetingId);
  res.json({ ok: true });
});

/** Short-lived token so no long-lived credential ever reaches the browser. */
analyzeRouter.get('/speech-token', async (_req, res) => {
  try {
    if (config.speech.key) {
      const response = await fetch(
        `https://${config.speech.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
        { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': config.speech.key } },
      );
      if (!response.ok) throw new Error(`issueToken returned ${response.status}`);
      return res.json({ token: await response.text(), region: config.speech.region });
    }

    if (!config.speech.resourceId) {
      throw new Error('Set AZURE_SPEECH_RESOURCE_ID to use Speech without a key');
    }
    const token = await getAccessToken();
    if (!token) throw new Error('Entra ID returned no token for Speech');

    // The Speech SDK expects this exact composite format for Entra auth.
    return res.json({
      token: `aad#${config.speech.resourceId}#${token}`,
      region: config.speech.region,
    });
  } catch (error) {
    console.error('[speech-token] failed', error);
    return res.status(502).json({ error: 'could not issue speech token' });
  }
});
