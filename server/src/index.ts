import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { analyzeRouter } from './routes/analyze.js';
import { initKnowledgeBase } from './services/knowledgeBase.js';

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin/server-to-server requests arrive without an Origin header.
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed`));
    },
  }),
);
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', analyzeRouter);

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  // Warm the index so the first question of the meeting is not slow.
  void initKnowledgeBase();
});
