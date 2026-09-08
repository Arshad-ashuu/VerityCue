import type { Line } from '../useTranscription';

export function TranscriptFeed({ lines }: { lines: Line[] }) {
  if (lines.length === 0) {
    return <p className="hint">Nothing heard yet.</p>;
  }

  return (
    <div className="transcript">
      {lines.slice(-8).map((line) => (
        <div key={line.id} className={`line ${line.speaker === 'me' ? 'me' : ''}`}>
          <span className="speaker">{line.speaker === 'me' ? 'You' : 'Customer'}</span>
          <span>{line.text}</span>
        </div>
      ))}
    </div>
  );
}
