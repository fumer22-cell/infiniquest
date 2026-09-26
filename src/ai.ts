// AI client: talks to the local proxy, parses JSON defensively, and falls back to mocks.
import { SYSTEM_PROMPT } from './prompts';
import { clipText } from './rng';

export type AITask = 'newGame' | 'talk' | 'discover' | 'dungeon' | 'outcome' | 'compress';

export interface AIResponse {
  narration: string;
  dialogue: string;
  changes: unknown[];
  /** The whole parsed object, for task-specific extra fields (setup, dungeon, place...). */
  data: Record<string, unknown>;
  source: 'ai' | 'mock' | 'fallback';
}

const GENERIC_LINES = [
  'The words seem to slip away on the wind. Perhaps try again.',
  'Hm? Forgive me, my mind wandered. What was that?',
  'A strange silence hangs in the air for a moment.',
];

/** Strip code fences / stray prose and parse the first JSON object. */
export function parseAIText(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

function normalize(obj: Record<string, unknown>, source: AIResponse['source']): AIResponse {
  return {
    narration: clipText(obj.narration, 900),
    dialogue: clipText(obj.dialogue, 900),
    changes: Array.isArray(obj.changes) ? obj.changes : [],
    data: obj,
    source,
  };
}

/** The artifact runtime's `sample` function (claude.ai artifacts: Claude on the viewer's account). */
type SampleFn = (input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>;
type ClaudeRuntime = { use(name: string): Promise<unknown> };

// Errors after which the artifact can no longer ask Claude in this view.
const SAMPLE_FATAL = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'session_expired']);

export class AIClient {
  online = false;
  private sample: SampleFn | null = null;
  model = '';
  lastRaw = '';
  lastTask = '';

  async checkStatus(): Promise<boolean> {
    // Running as a claude.ai artifact: use the viewer's own Claude, no server needed.
    const rt = (window as unknown as { claude?: ClaudeRuntime }).claude;
    if (rt?.use) {
      try {
        const s = (await rt.use('sample')) as SampleFn | null;
        if (s) {
          this.sample = s;
          this.online = true;
          this.model = 'Claude (your account)';
          return true;
        }
      } catch {
        // fall through to the local proxy check
      }
    }
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch('/api/status', { signal: ctl.signal });
      clearTimeout(t);
      const j = await res.json();
      this.online = !!j.online;
      this.model = String(j.model ?? '');
    } catch {
      this.online = false;
    }
    return this.online;
  }

  get label(): string {
    return this.online ? `AI: ${this.model}` : 'AI: offline mode';
  }

  /**
   * Run one game-master request. Offline or on network/API failure the mock answers,
   * so the game is always playable. On unparseable output we fall back gracefully.
   */
  async call(task: AITask, prompt: string, mock: () => Record<string, unknown>, maxTokens = 3000): Promise<AIResponse> {
    this.lastTask = task;
    if (!this.online) {
      await new Promise((r) => setTimeout(r, 350)); // let the loading indicator register
      const m = mock();
      this.lastRaw = '(offline mock)\n' + JSON.stringify(m, null, 2);
      return normalize(m, 'mock');
    }
    let text = '';
    if (this.sample) {
      try {
        const res = await this.sample(`${SYSTEM_PROMPT}\n\n${prompt}`, {
          cache: false,
          modelTier: task === 'talk' || task === 'discover' ? 'quick' : 'default',
        });
        text = String(res.text ?? '');
      } catch (err) {
        const code = String((err as { code?: string })?.code ?? 'upstream_error');
        if (SAMPLE_FATAL.has(code)) {
          this.sample = null;
          this.online = false;
        }
        console.warn(`[ai] ${task} failed (${code}), using offline response`);
        const m = mock();
        this.lastRaw = `(Claude unavailable: ${code}; used mock)\n` + JSON.stringify(m, null, 2);
        return normalize(m, 'mock');
      }
    } else {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 90_000);
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task, system: SYSTEM_PROMPT, prompt, maxTokens }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        text = String(j.text ?? '');
      } catch (err) {
        console.warn(`[ai] ${task} failed, using offline response`, err);
        const m = mock();
        this.lastRaw = `(request failed: ${String(err)}; used mock)\n` + JSON.stringify(m, null, 2);
        return normalize(m, 'mock');
      }
    }
    this.lastRaw = text;
    const parsed = parseAIText(text);
    if (parsed) return normalize(parsed, 'ai');

    console.warn(`[ai] ${task}: could not parse response`, text);
    if (task === 'talk') {
      return normalize({ dialogue: GENERIC_LINES[Math.floor(Math.random() * GENERIC_LINES.length)] }, 'fallback');
    }
    // Tasks that must produce content (setup, dungeon...) fall back to the canned version.
    return normalize(mock(), 'fallback');
  }
}
