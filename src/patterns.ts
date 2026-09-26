// Bullet pattern library. Pure code: every pattern is a small function of tunable params.
import { clamp } from './rng';
import { brighten, isHexColor } from './sprites';

export const PATTERN_TYPES = ['spiral', 'radial', 'aimed', 'shotgun', 'wave', 'rain', 'ringGap'] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

export interface PatternParams {
  speed: number; // px/sec
  count: number; // bullets per volley (arms for spiral)
  spread: number; // degrees of fan (rain: width in px)
  rate: number; // volleys per second
  color: string;
  size: number; // bullet radius in px
  spin: number; // spiral: degrees per second
  amp: number; // wave: sideways amplitude px
  freq: number; // wave: oscillations per second
  gap: number; // ringGap: gap width in degrees
}

export interface PatternSpec {
  type: PatternType;
  params: PatternParams;
}

type NumKey = Exclude<keyof PatternParams, 'color'>;

const DEFAULTS: Record<PatternType, Omit<PatternParams, 'color'>> = {
  spiral: { speed: 60, count: 3, spread: 0, rate: 5, size: 2, spin: 110, amp: 0, freq: 1, gap: 0 },
  radial: { speed: 55, count: 16, spread: 360, rate: 0.6, size: 2, spin: 0, amp: 0, freq: 1, gap: 0 },
  aimed: { speed: 85, count: 1, spread: 0, rate: 1.2, size: 2, spin: 0, amp: 0, freq: 1, gap: 0 },
  shotgun: { speed: 75, count: 5, spread: 50, rate: 0.6, size: 2, spin: 0, amp: 0, freq: 1, gap: 0 },
  wave: { speed: 55, count: 3, spread: 30, rate: 0.8, size: 2, spin: 0, amp: 10, freq: 1.5, gap: 0 },
  rain: { speed: 60, count: 6, spread: 120, rate: 0.6, size: 2, spin: 0, amp: 0, freq: 1, gap: 0 },
  ringGap: { speed: 45, count: 24, spread: 360, rate: 0.35, size: 2, spin: 0, amp: 0, freq: 1, gap: 55 },
};

const RANGE: Record<NumKey, [number, number]> = {
  speed: [25, 150],
  count: [1, 40],
  spread: [0, 360],
  rate: [0.15, 8],
  size: [1.5, 4],
  spin: [-360, 360],
  amp: [0, 24],
  freq: [0.3, 4],
  gap: [25, 140],
};

const COUNT_RANGE: Record<PatternType, [number, number]> = {
  spiral: [1, 8],
  radial: [4, 36],
  aimed: [1, 7],
  shotgun: [3, 11],
  wave: [1, 7],
  rain: [2, 14],
  ringGap: [8, 40],
};

const ALIASES: Record<string, PatternType> = {
  spiral: 'spiral',
  radial: 'radial',
  radialburst: 'radial',
  burst: 'radial',
  aimed: 'aimed',
  aimedshot: 'aimed',
  shot: 'aimed',
  shotgun: 'shotgun',
  shotgunspread: 'shotgun',
  wave: 'wave',
  sine: 'wave',
  rain: 'rain',
  bulletrain: 'rain',
  ringgap: 'ringGap',
  ringwithgap: 'ringGap',
  ring: 'ringGap',
  gapring: 'ringGap',
};

/**
 * Validate an AI-authored pattern. Unknown types are rejected, every number is clamped,
 * and the volley rate is reduced so the pattern never exceeds `maxBulletsPerSec`.
 */
export function sanitizePattern(raw: unknown, fallbackColor: string, maxBulletsPerSec: number): PatternSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = String(r.type ?? r.pattern ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const type = ALIASES[key];
  if (!type) return null;
  const src: Record<string, unknown> = { ...r, ...(r.params && typeof r.params === 'object' ? (r.params as object) : {}) };
  const d = DEFAULTS[type];
  const num = (k: NumKey) => {
    const v = Number(src[k]);
    return Number.isFinite(v) ? clamp(v, RANGE[k][0], RANGE[k][1]) : d[k];
  };
  const p: PatternParams = {
    speed: num('speed'),
    count: Math.round(clamp(num('count'), COUNT_RANGE[type][0], COUNT_RANGE[type][1])),
    spread: num('spread'),
    rate: num('rate'),
    size: num('size'),
    spin: num('spin'),
    amp: num('amp'),
    freq: num('freq'),
    gap: num('gap'),
    color: brighten(isHexColor(src.color) ? src.color : fallbackColor),
  };
  if (type === 'rain') p.spread = clamp(p.spread < 40 ? d.spread : p.spread, 40, 200);
  if (type === 'spiral' && Math.abs(p.spin) < 20) p.spin = d.spin;
  const bps = p.count * p.rate;
  if (bps > maxBulletsPerSec) p.rate = Math.max(RANGE.rate[0], maxBulletsPerSec / p.count);
  return { type, params: p };
}

export function makePattern(type: PatternType, params: Partial<PatternParams> & { color: string }): PatternSpec {
  return { type, params: { ...DEFAULTS[type], ...params } };
}

// ------------------------------------------------------------------ firing

export interface BulletSpawn {
  x: number;
  y: number;
  angle: number;
  speed: number;
  size: number;
  color: string;
  wave?: { amp: number; freq: number };
  noWall?: boolean;
}

const DEG = Math.PI / 180;

/** Runs one pattern for one enemy: owns the fire timer and rotation state. */
export class Emitter {
  private timer: number;
  private angle = Math.random() * Math.PI * 2;

  constructor(
    public spec: PatternSpec,
    initialDelay = Math.random() * 0.8,
  ) {
    this.timer = 0.4 + initialDelay;
  }

  update(dt: number, sx: number, sy: number, tx: number, ty: number, spawn: (b: BulletSpawn) => void) {
    const p = this.spec.params;
    if (this.spec.type === 'spiral') this.angle += p.spin * DEG * dt;
    this.timer -= dt;
    if (this.timer < -1) this.timer = 0;
    while (this.timer <= 0) {
      this.timer += 1 / p.rate;
      this.fire(sx, sy, tx, ty, spawn);
    }
  }

  private fire(sx: number, sy: number, tx: number, ty: number, spawn: (b: BulletSpawn) => void) {
    const p = this.spec.params;
    const aim = Math.atan2(ty - sy, tx - sx);
    const base = { x: sx, y: sy, speed: p.speed, size: p.size, color: p.color };
    const fan = (n: number, spreadDeg: number, jitter = 0, speedJitter = 0) => {
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) - 0.5 : 0;
        spawn({
          ...base,
          angle: aim + t * spreadDeg * DEG + (Math.random() - 0.5) * jitter * DEG,
          speed: p.speed * (1 + (Math.random() - 0.5) * speedJitter),
        });
      }
    };
    switch (this.spec.type) {
      case 'spiral':
        for (let i = 0; i < p.count; i++) spawn({ ...base, angle: this.angle + (i * Math.PI * 2) / p.count });
        break;
      case 'radial': {
        const off = Math.random() * Math.PI * 2;
        for (let i = 0; i < p.count; i++) spawn({ ...base, angle: off + (i * Math.PI * 2) / p.count });
        break;
      }
      case 'aimed':
        fan(p.count, p.count > 1 ? Math.max(p.spread, 8 * (p.count - 1)) : 0);
        break;
      case 'shotgun':
        fan(p.count, Math.max(20, Math.min(120, p.spread)), 6, 0.4);
        break;
      case 'wave':
        for (let i = 0; i < p.count; i++) {
          const t = p.count > 1 ? i / (p.count - 1) - 0.5 : 0;
          spawn({ ...base, angle: aim + t * p.spread * DEG, wave: { amp: p.amp, freq: p.freq } });
        }
        break;
      case 'rain':
        for (let i = 0; i < p.count; i++) {
          spawn({
            ...base,
            x: tx + (Math.random() - 0.5) * p.spread,
            y: ty - 90 - Math.random() * 30,
            angle: Math.PI / 2 + (Math.random() - 0.5) * 10 * DEG,
            noWall: true,
          });
        }
        break;
      case 'ringGap': {
        const gapAt = aim + (Math.random() - 0.5) * 80 * DEG;
        const half = (p.gap * DEG) / 2;
        for (let i = 0; i < p.count; i++) {
          const off = (i * Math.PI * 2) / p.count;
          const rel = off > Math.PI ? Math.PI * 2 - off : off;
          if (rel < half) continue;
          spawn({ ...base, angle: gapAt + off });
        }
        break;
      }
    }
  }
}
