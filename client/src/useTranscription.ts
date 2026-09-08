import { useCallback, useEffect, useRef, useState } from 'react';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { getSpeechToken } from './api';

export type Speaker = 'me' | 'customer';

export interface Line {
  id: string;
  speaker: Speaker;
  text: string;
  at: number;
}

/**
 * `system` taps what Teams is playing (the customer). It is a copy of the render
 * stream, so audio keeps playing to your headset untouched.
 */
export type CaptureMode = 'system' | 'mic' | 'both';

export type ListeningState = 'idle' | 'starting' | 'listening' | 'error';

/** Auth tokens last 10 minutes; refresh comfortably inside that. */
const TOKEN_REFRESH_MS = 8 * 60 * 1000;

interface Source {
  recognizer: SpeechSDK.SpeechRecognizer;
  config: SpeechSDK.SpeechConfig;
  stream: MediaStream;
}

export function useTranscription(onLine: (line: Line) => void) {
  const [state, setState] = useState<ListeningState>('idle');
  const [error, setError] = useState<string | null>(null);

  const sourcesRef = useRef<Source[]>([]);
  const refreshRef = useRef<number | null>(null);
  // Keeps the callback fresh without restarting the recognizers on every render.
  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;

  const stop = useCallback(() => {
    if (refreshRef.current) {
      window.clearInterval(refreshRef.current);
      refreshRef.current = null;
    }
    for (const source of sourcesRef.current) {
      source.recognizer.stopContinuousRecognitionAsync(
        () => source.recognizer.close(),
        () => undefined,
      );
      source.stream.getTracks().forEach((track) => track.stop());
    }
    sourcesRef.current = [];
    setState('idle');
  }, []);

  const start = useCallback(
    async (mode: CaptureMode) => {
      setError(null);
      setState('starting');

      try {
        const wanted: { speaker: Speaker; stream: MediaStream }[] = [];

        if (mode === 'system' || mode === 'both') {
          wanted.push({ speaker: 'customer', stream: await captureSystemAudio() });
        }
        if (mode === 'mic' || mode === 'both') {
          wanted.push({
            speaker: 'me',
            stream: await navigator.mediaDevices.getUserMedia({ audio: true }),
          });
        }

        const { token, region } = await getSpeechToken();

        for (const { speaker, stream } of wanted) {
          const config = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
          config.speechRecognitionLanguage = 'en-US';

          const recognizer = new SpeechSDK.SpeechRecognizer(
            config,
            SpeechSDK.AudioConfig.fromStreamInput(stream),
          );

          // Only final results — partials would spam the analyzer.
          recognizer.recognized = (_sender, event) => {
            const text = event.result.text?.trim();
            if (!text || event.result.reason !== SpeechSDK.ResultReason.RecognizedSpeech) return;
            onLineRef.current({ id: event.result.resultId, speaker, text, at: Date.now() });
          };

          recognizer.canceled = (_sender, event) => {
            if (event.reason === SpeechSDK.CancellationReason.Error) {
              setError(event.errorDetails || 'Transcription was cancelled');
              setState('error');
            }
          };

          // Fires when the user clicks the browser's "Stop sharing" bar.
          stream.getAudioTracks()[0]?.addEventListener('ended', () => stop());

          await new Promise<void>((resolve, reject) => {
            recognizer.startContinuousRecognitionAsync(
              () => resolve(),
              (e) => reject(new Error(String(e))),
            );
          });

          sourcesRef.current.push({ recognizer, config, stream });
        }

        setState('listening');

        refreshRef.current = window.setInterval(async () => {
          try {
            const refreshed = await getSpeechToken();
            for (const source of sourcesRef.current) {
              source.config.authorizationToken = refreshed.token;
            }
          } catch {
            /* a genuine failure surfaces as a cancellation on the next result */
          }
        }, TOKEN_REFRESH_MS);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not start listening');
        setState('error');
      }
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return { state, error, start, stop };
}

/**
 * Browsers only expose system audio alongside a screen capture, so we ask for video
 * too and then ignore it. Playback is unaffected: this is a tap, not a redirect.
 */
async function captureSystemAudio(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    // Mic-oriented processing would damage far-end speech, so turn it off.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      'No system audio was shared. Pick "Entire Screen" and tick "Also share system audio".',
    );
  }

  return stream;
}
