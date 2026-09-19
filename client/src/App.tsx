import { useCallback, useEffect, useRef, useState } from 'react';
import { analyze, parseAnswer, resetMeeting, type Suggestion } from './api';
import { SuggestionCard } from './components/SuggestionCard';
import { TranscriptFeed } from './components/TranscriptFeed';
import { initTeams, notifyAppLoaded, type TeamsContext } from './teams';
import { useTranscription, type CaptureMode, type Line } from './useTranscription';

export function App() {
  const [teams, setTeams] = useState<TeamsContext | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [mode, setMode] = useState<CaptureMode>('system');
  const [showTranscript, setShowTranscript] = useState(false);

  const teamsRef = useRef<TeamsContext | null>(null);

  useEffect(() => {
    void initTeams().then((context) => {
      teamsRef.current = context;
      setTeams(context);
      notifyAppLoaded();
    });
  }, []);

  const handleLine = useCallback(async (line: Line) => {
    setLines((previous) => [...previous, line]);

    const meetingId = teamsRef.current?.meetingId;
    if (!meetingId) return;

    await analyze(meetingId, line.text, line.speaker, {
      onMeta: (meta) => {
        setSuggestions((previous) =>
          [
            { ...meta, answer: '', talkingPoints: [], streaming: true, createdAt: Date.now() },
            ...previous,
          ].slice(0, 20),
        );
      },
      onDelta: (id, raw) => {
        const partial = parseAnswer(raw);
        setSuggestions((previous) =>
          previous.map((s) => (s.id === id ? { ...s, ...partial } : s)),
        );
      },
      onDone: (id, answer, talkingPoints) => {
        setSuggestions((previous) =>
          previous.map((s) =>
            s.id === id ? { ...s, answer, talkingPoints, streaming: false } : s,
          ),
        );
      },
    });
  }, []);

  const { state, error, start, stop } = useTranscription(handleLine);

  const clear = async () => {
    setSuggestions([]);
    setLines([]);
    if (teamsRef.current) await resetMeeting(teamsRef.current.meetingId);
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>VerityCue</h1>
          <span className="subtitle">
            {state === 'listening' ? 'Listening — only you can see this' : 'Private to you'}
          </span>
        </div>
        <button
          className={state === 'listening' ? 'btn stop' : 'btn start'}
          onClick={() => (state === 'listening' ? stop() : void start(mode))}
          disabled={state === 'starting' || !teams}
        >
          {state === 'listening' ? 'Stop' : state === 'starting' ? 'Starting…' : 'Start listening'}
        </button>
      </header>

      {state !== 'listening' && (
        <div className="modes">
          {(
            [
              ['system', 'Meeting audio'],
              ['both', 'Meeting + my mic'],
              ['mic', 'My mic only'],
            ] as [CaptureMode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={mode === value ? 'mode active' : 'mode'}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {state !== 'listening' && mode !== 'mic' && (
        <div className="notice">
          You will be asked to share a screen. Choose <b>Entire Screen</b> and tick
          <b> Also share system audio</b>. Your audio keeps playing normally.
        </div>
      )}

      <main className="feed">
        {suggestions.length === 0 ? (
          <p className="hint">
            {state === 'listening'
              ? 'Waiting for a customer question…'
              : 'Press Start listening when the conversation begins.'}
          </p>
        ) : (
          suggestions.map((suggestion) => (
            <SuggestionCard key={suggestion.id} suggestion={suggestion} />
          ))
        )}
      </main>

      <footer className="bottom">
        <button className="link" onClick={() => setShowTranscript((v) => !v)}>
          {showTranscript ? 'Hide transcript' : 'Show transcript'}
        </button>
        <button className="link" onClick={clear}>
          Clear
        </button>
      </footer>

      {import.meta.env.DEV && (
        <input
          className="dev-input"
          placeholder="Dev: type a customer question and press Enter"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const value = event.currentTarget.value.trim();
            if (!value) return;
            event.currentTarget.value = '';
            void handleLine({
              id: crypto.randomUUID(),
              speaker: 'customer',
              text: value,
              at: Date.now(),
            });
          }}
        />
      )}

      {showTranscript && <TranscriptFeed lines={lines} />}
    </div>
  );
}
