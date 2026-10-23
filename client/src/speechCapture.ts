import type { MicVAD as VoiceDetector } from '@ricky0123/vad-web';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import {
  END_SILENCE_MS,
  hasSpeechText,
  SPEECH_OPTIONS,
  SPEECH_SAMPLE_RATE,
  SpeechAudioBuffer,
} from './speechAudio';

export interface SpeechCapture {
  updateToken(token: string): void;
  close(): Promise<void>;
}

interface CaptureOptions {
  stream: MediaStream;
  token: string;
  region: string;
  onTranscript(id: string, text: string): void;
  onError(error: Error): void;
}

interface Recognition {
  recognizer: SpeechSDK.SpeechRecognizer;
  input: SpeechSDK.PushAudioInputStream;
  ended: boolean;
  timer?: number;
  closing?: Promise<void>;
}

const RECOGNITION_TIMEOUT_MS = 15000;

export async function createSpeechCapture(options: CaptureOptions): Promise<SpeechCapture> {
  const context = new AudioContext();
  const sessions = new Set<Recognition>();
  let token = options.token;
  let current: Recognition | null = null;
  let vad: VoiceDetector | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let frameQueue = Promise.resolve();

  const dispose = (session: Recognition): Promise<void> => {
    if (session.closing) return session.closing;
    window.clearTimeout(session.timer);
    if (current === session) current = null;
    if (!session.ended) {
      session.ended = true;
      session.input.close();
    }
    session.closing = new Promise<void>((resolve, reject) => {
      session.recognizer.close(resolve, (error) => reject(new Error(String(error))));
    }).finally(() => {
      sessions.delete(session);
    });
    return session.closing;
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    buffer.reset();
    options.stream.getTracks().forEach((track) => track.stop());
    closePromise = (async () => {
      const cleanup = [...sessions].map(dispose);
      cleanup.push(
        (async () => {
          await frameQueue;
          try {
            await vad?.destroy();
          } finally {
            if (context.state !== 'closed') await context.close();
          }
        })(),
      );
      const results = await Promise.allSettled(cleanup);
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length) {
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Could not fully close speech capture',
        );
      }
    })();
    return closePromise;
  };

  const fail = (error: unknown) => {
    if (closed) return;
    options.onError(error instanceof Error ? error : new Error(String(error)));
    void close().catch((cleanupError) => console.error('[speech] cleanup failed', cleanupError));
  };

  const setTimeoutFor = (session: Recognition, message: string) => {
    if (closed || !sessions.has(session)) return;
    window.clearTimeout(session.timer);
    session.timer = window.setTimeout(() => fail(new Error(message)), RECOGNITION_TIMEOUT_MS);
  };

  const buffer = new SpeechAudioBuffer({
    start: () => {
      if (closed) return;
      const config = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, options.region);
      config.speechRecognitionLanguage = 'en-US';
      config.setProperty(
        SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs,
        String(END_SILENCE_MS),
      );
      const input = SpeechSDK.AudioInputStream.createPushStream(
        SpeechSDK.AudioStreamFormat.getWaveFormatPCM(SPEECH_SAMPLE_RATE, 16, 1),
      );
      const audio = SpeechSDK.AudioConfig.fromStreamInput(input);
      let recognizer: SpeechSDK.SpeechRecognizer;
      try {
        recognizer = new SpeechSDK.SpeechRecognizer(config, audio);
      } catch (error) {
        input.close();
        throw error;
      }
      const session: Recognition = { recognizer, input, ended: false };
      current = session;
      sessions.add(session);

      recognizer.recognized = (_sender, event) => {
        if (closed || session.closing || !sessions.has(session)) return;
        const text = event.result.text?.trim() ?? '';
        if (
          event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech &&
          hasSpeechText(text)
        ) {
          options.onTranscript(event.result.resultId, text);
        }
      };
      recognizer.canceled = (_sender, event) => {
        if (
          !session.closing &&
          sessions.has(session) &&
          event.reason === SpeechSDK.CancellationReason.Error
        ) {
          fail(new Error(event.errorDetails || 'Transcription was cancelled'));
        }
      };
      recognizer.sessionStopped = () => {
        if (closed || session.closing || !sessions.has(session)) return;
        if (!session.ended) {
          fail(new Error('Transcription stopped before the speech segment finished'));
          return;
        }
        void dispose(session).catch(fail);
      };
      setTimeoutFor(session, 'Speech recognition took too long to start. Please try again.');
      recognizer.startContinuousRecognitionAsync(
        () => {
          if (!session.ended) window.clearTimeout(session.timer);
        },
        (error) => {
          if (sessions.has(session)) fail(new Error(String(error)));
        },
      );
    },
    write: (audio) => {
      if (closed) return;
      if (!current) throw new Error('Speech audio arrived without an active recognition stream');
      current.input.write(audio);
    },
    end: () => {
      if (closed) return;
      if (!current) throw new Error('Speech ended without an active recognition stream');
      const session = current;
      current = null;
      session.ended = true;
      // EOF flushes the final result; stopping the recognizer here can lose it.
      session.input.close();
      setTimeoutFor(session, 'Speech recognition took too long to finish. Please try again.');
    },
  });

  try {
    const assetPath = new URL(`${import.meta.env.BASE_URL}speech/`, window.location.href).href;
    await context.resume();
    await context.audioWorklet.addModule(`${assetPath}vad.worklet.bundle.min.js`);
    const { MicVAD } = await import('@ricky0123/vad-web');
    vad = await MicVAD.new({
      ...SPEECH_OPTIONS,
      model: 'v5',
      startOnLoad: false,
      audioContext: context,
      processorType: 'AudioWorklet',
      baseAssetPath: assetPath,
      onnxWASMBasePath: assetPath,
      getStream: async () => options.stream,
      ortConfig: (ort) => {
        ort.env.wasm.numThreads = 1;
        ort.env.logLevel = 'error';
      },
      onFrameProcessed: (_probabilities, frame) => buffer.push(frame),
      onSpeechStart: () => buffer.markCandidate(),
      onSpeechRealStart: () => buffer.confirm(),
      onSpeechEnd: () => buffer.finish(),
      onVADMisfire: () => buffer.reset(),
    });
    const processFrame = vad.processFrame;
    vad.processFrame = (frame) => {
      frameQueue = frameQueue
        .then(async () => {
          if (!closed) await processFrame(frame);
        })
        .catch(fail);
      return frameQueue;
    };
    await vad.start();
  } catch (error) {
    await close().catch((cleanupError) => console.error('[speech] cleanup failed', cleanupError));
    throw error;
  }

  return {
    close,
    updateToken: (updated) => {
      token = updated;
      for (const session of sessions) session.recognizer.authorizationToken = updated;
    },
  };
}
