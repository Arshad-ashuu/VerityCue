export const SPEECH_SAMPLE_RATE = 16000;
export const SPEECH_FRAME_SAMPLES = 512;
export const END_SILENCE_MS = 600;
const FRAME_MS = (SPEECH_FRAME_SAMPLES / SPEECH_SAMPLE_RATE) * 1000;
export const SPEECH_OPTIONS = {
  positiveSpeechThreshold: 0.6,
  negativeSpeechThreshold: 0.35,
  minSpeechMs: 96,
  preSpeechPadMs: 200,
  // The VAD rounds down to whole frames; round up to preserve the pause target.
  redemptionMs: Math.ceil(END_SILENCE_MS / FRAME_MS) * FRAME_MS,
  submitUserSpeechOnPause: false,
} as const;

interface SpeechSink {
  start(): void;
  write(audio: ArrayBuffer): void;
  end(): void;
}

/** Holds the lead-in locally until the VAD confirms speech, then streams live. */
export class SpeechAudioBuffer {
  private frames: Float32Array[] = [];
  private samples = 0;
  private candidate = false;
  private active = false;

  constructor(private readonly sink: SpeechSink) {}

  push(frame: Float32Array): void {
    if (frame.length === 0) return;
    if (this.active) {
      this.sink.write(toPcm16(frame));
      return;
    }

    this.frames.push(frame.slice());
    this.samples += frame.length;
    if (this.candidate) return;

    const limit = (SPEECH_SAMPLE_RATE * SPEECH_OPTIONS.preSpeechPadMs) / 1000;
    while (this.samples > limit && this.frames.length > 0) {
      const first = this.frames[0];
      const excess = this.samples - limit;
      if (first.length <= excess) {
        this.frames.shift();
        this.samples -= first.length;
      } else {
        this.frames[0] = first.slice(excess);
        this.samples -= excess;
      }
    }
  }

  markCandidate(): void {
    this.candidate = true;
  }

  confirm(): void {
    if (this.active || this.samples === 0) return;
    this.active = true;
    this.candidate = false;
    this.sink.start();
    for (const frame of this.frames) this.sink.write(toPcm16(frame));
    this.frames = [];
    this.samples = 0;
  }

  finish(): void {
    if (this.active) this.sink.end();
    this.reset();
  }

  reset(): void {
    this.frames = [];
    this.samples = 0;
    this.candidate = false;
    this.active = false;
  }
}

export function toPcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 0x8000 : 0x7fff)), true);
  }
  return buffer;
}

export function hasSpeechText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
