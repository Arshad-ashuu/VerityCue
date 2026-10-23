import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameProcessor } from '@ricky0123/vad-web/dist/frame-processor';
import { Message } from '@ricky0123/vad-web/dist/messages';
import {
  hasSpeechText,
  SPEECH_FRAME_SAMPLES,
  SPEECH_OPTIONS,
  SPEECH_SAMPLE_RATE,
  SpeechAudioBuffer,
  toPcm16,
} from '../src/speechAudio';

const FRAME_SAMPLES = SPEECH_FRAME_SAMPLES;
const FRAME_MS = (FRAME_SAMPLES / SPEECH_SAMPLE_RATE) * 1000;
const END_FRAMES = Math.ceil(SPEECH_OPTIONS.redemptionMs / FRAME_MS);

function harness() {
  const segments: { chunks: ArrayBuffer[]; ended: boolean }[] = [];
  const buffer = new SpeechAudioBuffer({
    start: () => segments.push({ chunks: [], ended: false }),
    write: (audio) => segments.at(-1)!.chunks.push(audio),
    end: () => {
      segments.at(-1)!.ended = true;
    },
  });
  let probability = 0;
  const processor = new FrameProcessor(
    async () => ({ isSpeech: probability, notSpeech: 1 - probability }),
    () => {},
    SPEECH_OPTIONS,
    FRAME_MS,
  );
  processor.resume();
  const feed = async (score: number, count: number, sample = 0) => {
    probability = score;
    for (let i = 0; i < count; i += 1) {
      await processor.process(new Float32Array(FRAME_SAMPLES).fill(sample), (event) => {
        switch (event.msg) {
          case Message.FrameProcessed:
            buffer.push(event.frame);
            break;
          case Message.SpeechStart:
            buffer.markCandidate();
            break;
          case Message.SpeechRealStart:
            buffer.confirm();
            break;
          case Message.SpeechEnd:
            buffer.finish();
            break;
          case Message.VADMisfire:
            buffer.reset();
            break;
        }
      });
    }
  };
  return { segments, feed, buffer };
}

test('two minutes of silence never opens a recognition stream', async () => {
  const { segments, feed } = harness();
  await feed(0, Math.ceil(120000 / FRAME_MS));
  assert.equal(segments.length, 0);
});

test('a short click or VAD misfire sends no audio', async () => {
  const { segments, feed } = harness();
  await feed(0.95, 1, 0.7);
  await feed(0, END_FRAMES);
  assert.equal(segments.length, 0);
});

test('confirmed speech streams before the utterance is finished', async () => {
  const { segments, feed } = harness();
  await feed(0, 20);
  await feed(0.95, SPEECH_OPTIONS.minSpeechMs / FRAME_MS, 0.2);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].ended, false);
  const firstBytes = segments[0].chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  await feed(0.95, 10, 0.2);
  const nextBytes = segments[0].chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  assert.equal(nextBytes - firstBytes, 10 * FRAME_SAMPLES * 2);
});

test('idle lead-in is bounded and the first speech frames are preserved', async () => {
  const { segments, feed } = harness();
  await feed(0, 300);
  await feed(0.95, 3, 0.25);
  const samples = segments[0].chunks.flatMap((chunk) => Array.from(new Int16Array(chunk)));
  assert.ok(samples.length <= (SPEECH_OPTIONS.preSpeechPadMs / 1000) * SPEECH_SAMPLE_RATE + 3 * FRAME_SAMPLES);
  assert.deepEqual(samples.slice(-3 * FRAME_SAMPLES), new Array(3 * FRAME_SAMPLES).fill(8192));
});

test('candidate buffering preserves early words while speech is being confirmed', async () => {
  const { segments, feed } = harness();
  await feed(0.95, 1, 0.25);
  await feed(0, 10);
  await feed(0.95, 2, 0.5);
  assert.equal(segments.length, 1);
  assert.equal(new DataView(segments[0].chunks[0]).getInt16(0, true), 8192);
});

test('end-of-speech is at least 600 ms and less than one frame later', async () => {
  const { segments, feed } = harness();
  await feed(0.95, 5, 0.2);
  await feed(0, END_FRAMES - 1);
  assert.equal(segments[0].ended, false);
  await feed(0, 1);
  assert.equal(segments[0].ended, true);
  assert.ok(END_FRAMES * FRAME_MS >= 600);
  assert.ok(END_FRAMES * FRAME_MS < 600 + FRAME_MS);
});

test('short pauses stay within the same speech segment', async () => {
  const { segments, feed } = harness();
  await feed(0.95, 5);
  await feed(0, END_FRAMES - 1);
  await feed(0.95, 5);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].ended, false);
  await feed(0, END_FRAMES);
  assert.equal(segments[0].ended, true);
});

test('silence after a completed segment produces no further audio', async () => {
  const { segments, feed } = harness();
  await feed(0.95, 5);
  await feed(0, END_FRAMES);
  const bytes = segments[0].chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  await feed(0, 300);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0), bytes);
});

test('speech resumes after long silence as a separate, bounded segment', async () => {
  const { segments, feed } = harness();
  await feed(0.95, 5);
  await feed(0, 2000);
  await feed(0.95, 5);
  await feed(0, END_FRAMES);
  assert.equal(segments.length, 2);
  assert.ok(segments.every((segment) => segment.ended));
  const samples = segments[1].chunks.reduce((sum, chunk) => sum + chunk.byteLength / 2, 0);
  assert.ok(samples <= 3200 + (5 + END_FRAMES) * FRAME_SAMPLES);
});

test('reset discards unconfirmed audio without starting recognition', () => {
  const { buffer, segments } = harness();
  buffer.push(new Float32Array(FRAME_SAMPLES).fill(1));
  buffer.markCandidate();
  buffer.reset();
  buffer.confirm();
  assert.equal(segments.length, 0);
});

test('empty frames never start recognition', () => {
  const { buffer, segments } = harness();
  buffer.push(new Float32Array());
  buffer.markCandidate();
  buffer.confirm();
  buffer.finish();
  assert.equal(segments.length, 0);
});

test('PCM conversion is signed 16-bit, little-endian, and clipped safely', () => {
  const pcm = toPcm16(Float32Array.from([-2, -1, -0.5, 0, 0.5, 1, 2]));
  const view = new DataView(pcm);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => view.getInt16(i * 2, true)),
    [-32768, -32768, -16384, 0, 16384, 32767, 32767],
  );
  assert.equal(view.getUint8(0), 0);
  assert.equal(view.getUint8(1), 128);
});

test('blank, whitespace, and punctuation-only recognition results are ignored', () => {
  for (const text of ['', '   ', '\n\t', '...?!', '--', '\u200b']) {
    assert.equal(hasSpeechText(text), false);
  }
  for (const text of ['Why Azure?', '42', '\u4f60\u597d']) {
    assert.equal(hasSpeechText(text), true);
  }
});
