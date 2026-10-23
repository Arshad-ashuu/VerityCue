import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpeechToken } from './api';
import { createSpeechCapture, type SpeechCapture } from './speechCapture';

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

interface ListeningSession {
  streams: MediaStream[];
  captures: SpeechCapture[];
  refresh: number | null;
}

function releaseSession(session: ListeningSession): void {
  if (session.refresh !== null) window.clearInterval(session.refresh);
  for (const stream of session.streams) {
    stream.getTracks().forEach((track) => track.stop());
  }
  for (const capture of session.captures) {
    void capture.close().catch((error) => console.error('[speech] cleanup failed', error));
  }
}

export function useTranscription(onLine: (line: Line) => void) {
  const [state, setState] = useState<ListeningState>('idle');
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<ListeningSession | null>(null);
  // Keeps the callback fresh without restarting the recognizers on every render.
  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;

  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) releaseSession(session);
    setState('idle');
  }, []);

  const start = useCallback(
    async (mode: CaptureMode) => {
      if (sessionRef.current) return;
      const session: ListeningSession = { streams: [], captures: [], refresh: null };
      sessionRef.current = session;
      setError(null);
      setState('starting');

      const fail = (caught: unknown) => {
        if (sessionRef.current !== session) return;
        sessionRef.current = null;
        releaseSession(session);
        setError(caught instanceof Error ? caught.message : 'Could not start listening');
        setState('error');
      };

      const addStream = (stream: MediaStream) => {
        if (sessionRef.current !== session) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        session.streams.push(stream);
        stream.getAudioTracks()[0]?.addEventListener('ended', () => {
          if (sessionRef.current === session) stop();
        });
        return true;
      };

      try {
        const wanted: { speaker: Speaker; stream: MediaStream }[] = [];

        if (mode === 'system' || mode === 'both') {
          const stream = await captureSystemAudio();
          if (!addStream(stream)) return;
          wanted.push({ speaker: 'customer', stream });
        }
        if (mode === 'mic' || mode === 'both') {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          if (!addStream(stream)) return;
          wanted.push({ speaker: 'me', stream });
        }

        const { token, region } = await getSpeechToken();
        if (sessionRef.current !== session) return;

        for (const { speaker, stream } of wanted) {
          const capture = await createSpeechCapture({
            token,
            region,
            stream,
            onTranscript: (id, text) => {
              if (sessionRef.current === session) {
                onLineRef.current({ id, speaker, text, at: Date.now() });
              }
            },
            onError: fail,
          });
          if (sessionRef.current !== session) {
            await capture.close();
            return;
          }
          session.captures.push(capture);
        }

        setState('listening');

        session.refresh = window.setInterval(async () => {
          try {
            const refreshed = await getSpeechToken();
            if (sessionRef.current !== session) return;
            for (const capture of session.captures) capture.updateToken(refreshed.token);
          } catch (caught) {
            fail(caught);
          }
        }, TOKEN_REFRESH_MS);
      } catch (caught) {
        fail(caught);
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
