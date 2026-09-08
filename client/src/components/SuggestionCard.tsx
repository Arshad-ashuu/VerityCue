import { useState } from 'react';
import type { Suggestion } from '../api';

export function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const [copied, setCopied] = useState(false);

  // The model sometimes returns the same word for topic and intent.
  const tags = [
    ...new Set([suggestion.topic, suggestion.intent, suggestion.domain].filter(Boolean)),
  ];

  const copy = async () => {
    const text = [suggestion.answer, ...suggestion.talkingPoints.map((p) => `• ${p}`)].join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className="card">
      <header className="card-head">
        <span className="question">{suggestion.question}</span>
        <button className="copy" onClick={copy} title="Copy answer">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </header>

      <div className="tags">
        {tags.map((tag, index) => (
          <span key={tag} className={index === 0 ? 'tag topic' : 'tag'}>
            {tag}
          </span>
        ))}
      </div>

      <p className="answer">
        {suggestion.answer}
        {suggestion.streaming && <span className="caret" />}
      </p>

      {suggestion.talkingPoints.length > 0 && (
        <ul className="points">
          {suggestion.talkingPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}

      <footer className="card-foot">
        {suggestion.grounding === 'notes' && (
          <span className="sources">Your notes · {suggestion.sources.join(' · ')}</span>
        )}

        {suggestion.grounding === 'official' && (
          <span className="sources">
            <span className="badge official">Microsoft Learn</span>
            {suggestion.sources.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="src-link">
                {prettyUrl(url)}
              </a>
            ))}
          </span>
        )}

        {suggestion.grounding === 'model' && (
          <span className="badge model">General knowledge — verify specifics</span>
        )}
      </footer>
    </article>
  );
}

/** Shows the doc slug rather than a long URL, which would wrap badly in the panel. */
function prettyUrl(url: string): string {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean);
    return path[path.length - 1] ?? url;
  } catch {
    return url;
  }
}
