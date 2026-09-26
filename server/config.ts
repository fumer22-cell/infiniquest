// The one place the model is configured. Override with CLAUDE_MODEL in .env if desired.
export const MODEL = process.env.CLAUDE_MODEL?.trim() || 'claude-sonnet-5';

export const PORT = Number(process.env.PORT) || 8787;

// Game-master replies are short JSON objects; keep latency low.
export const DEFAULT_MAX_TOKENS = 3000;
export const MAX_MAX_TOKENS = 6000;
export const EFFORT = 'low' as const;

// Guard rails for what the browser may send through the proxy.
export const MAX_SYSTEM_CHARS = 20_000;
export const MAX_PROMPT_CHARS = 40_000;
