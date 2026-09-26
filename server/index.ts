import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_MAX_TOKENS,
  EFFORT,
  MAX_MAX_TOKENS,
  MAX_PROMPT_CHARS,
  MAX_SYSTEM_CHARS,
  MODEL,
  PORT,
} from './config';

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const client = apiKey ? new Anthropic({ apiKey }) : null;

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/status', (_req, res) => {
  res.json({ online: !!client, model: MODEL });
});

app.post('/api/ai', async (req, res) => {
  if (!client) {
    res.status(503).json({ error: 'offline' });
    return;
  }
  const { system, prompt, maxTokens, task } = req.body ?? {};
  if (typeof system !== 'string' || typeof prompt !== 'string') {
    res.status(400).json({ error: 'system and prompt must be strings' });
    return;
  }
  if (system.length > MAX_SYSTEM_CHARS || prompt.length > MAX_PROMPT_CHARS) {
    res.status(413).json({ error: 'request too large' });
    return;
  }
  const max_tokens = Math.min(
    MAX_MAX_TOKENS,
    Math.max(256, Number(maxTokens) || DEFAULT_MAX_TOKENS),
  );

  const started = Date.now();
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens,
      system,
      output_config: { effort: EFFORT },
      messages: [{ role: 'user', content: prompt }],
    });
    if (msg.stop_reason === 'refusal') {
      res.status(502).json({ error: 'refusal' });
      return;
    }
    const text = msg.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
    console.log(
      `[ai] ${String(task ?? '?')} ok in ${Date.now() - started}ms ` +
        `(in ${msg.usage.input_tokens} / out ${msg.usage.output_tokens}, stop=${msg.stop_reason})`,
    );
    res.json({ text, stopReason: msg.stop_reason });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[ai] authentication failed - check ANTHROPIC_API_KEY');
      res.status(401).json({ error: 'authentication failed' });
    } else if (err instanceof Anthropic.RateLimitError) {
      console.error('[ai] rate limited');
      res.status(429).json({ error: 'rate limited' });
    } else if (err instanceof Anthropic.APIError) {
      console.error(`[ai] API error ${err.status}: ${err.message}`);
      res.status(502).json({ error: `api error ${err.status ?? ''}`.trim() });
    } else {
      console.error('[ai] unexpected error', err);
      res.status(500).json({ error: 'server error' });
    }
  }
});

// Bind to localhost only: this proxy spends your API credits.
app.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[server] listening on http://127.0.0.1:${PORT} - ` +
      (client ? `AI online (model ${MODEL})` : 'no ANTHROPIC_API_KEY, game runs in OFFLINE mode'),
  );
});
