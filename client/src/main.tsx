import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { saveConfiguration } from './teams';
import './styles.css';

/** Shown once, when the app is added to a meeting. */
function ConfigPage() {
  useEffect(() => {
    void saveConfiguration();
  }, []);

  return (
    <div className="app config">
      <h1>VerityCue</h1>
      <p>
        VerityCue listens to the meeting, spots customer questions and suggests concise,
        grounded answers in your side panel. Only you can see them.
      </p>
      <p className="hint">Select Save to add it to this meeting.</p>
    </div>
  );
}

const isConfig = window.location.pathname.startsWith('/config');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isConfig ? <ConfigPage /> : <App />}</StrictMode>,
);
