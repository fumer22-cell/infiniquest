// Enemy, boss and dungeon definitions: pure data, validated from AI output.
import { makePattern, sanitizePattern, type PatternSpec } from './patterns';
import { clamp, clipText } from './rng';
import { DUNGEON_PALETTES, ENEMY_SPRITES, brighten, isHexColor } from './sprites';

export const MOVEMENTS = ['chase', 'orbit', 'stationary', 'wander'] as const;
export type Movement = (typeof MOVEMENTS)[number];

export interface EnemyDef {
  name: string;
  sprite: string;
  color: string;
  hp: number;
  speed: number;
  movement: Movement;
  patterns: PatternSpec[];
}

export interface BossPhase {
  movement: Movement;
  speed: number;
  patterns: PatternSpec[];
}

export interface BossDef {
  name: string;
  personality: string;
  taunt: string;
  phase2Line: string;
  defeatLine: string;
  sprite: string;
  color: string;
  hp: number;
  phases: [BossPhase, BossPhase];
}

export interface DungeonDesign {
  name: string;
  theme: string;
  description: string;
  palette: string;
  enemies: EnemyDef[];
  boss: BossDef;
}

const asMovement = (v: unknown, fb: Movement): Movement =>
  (MOVEMENTS as readonly string[]).includes(String(v)) ? (v as Movement) : fb;
const asSprite = (v: unknown, fb: string) => ((ENEMY_SPRITES as readonly string[]).includes(String(v)) ? String(v) : fb);
const asColor = (v: unknown, fb: string) => (isHexColor(v) ? v : fb);
const num = (v: unknown, fb: number, lo: number, hi: number) => {
  const n = Number(v);
  return clamp(Number.isFinite(n) ? n : fb, lo, hi);
};

function sanitizePatterns(raw: unknown, color: string, max: number, budget: number, fb: PatternSpec[]): PatternSpec[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PatternSpec[] = [];
  for (const p of list) {
    const s = sanitizePattern(p, color, budget);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out.length ? out : fb;
}

/** Difficulty 0..2 scales hp and bullet budgets. */
export function sanitizeEnemy(raw: unknown, fb: EnemyDef, difficulty: number): EnemyDef {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const color = asColor(r.color, fb.color);
  return {
    name: clipText(r.name, 32) || fb.name,
    sprite: asSprite(r.sprite, fb.sprite),
    color,
    hp: Math.round(num(r.hp, fb.hp, 25, 140) * (1 + difficulty * 0.25)),
    speed: num(r.speed, fb.speed, 0, 55),
    movement: asMovement(r.movement, fb.movement),
    patterns: sanitizePatterns(r.patterns, brighten(color), 2, 14 + difficulty * 5, fb.patterns),
  };
}

export function sanitizeBoss(raw: unknown, fb: BossDef, difficulty: number): BossDef {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const color = asColor(r.color, fb.color);
  const phasesRaw = Array.isArray(r.phases) ? r.phases : [];
  const budget = 34 + difficulty * 10;
  const phase = (i: 0 | 1): BossPhase => {
    const p = (phasesRaw[i] && typeof phasesRaw[i] === 'object' ? phasesRaw[i] : {}) as Record<string, unknown>;
    const f = fb.phases[i];
    return {
      movement: asMovement(p.movement, f.movement),
      speed: num(p.speed, f.speed, 0, 45),
      patterns: sanitizePatterns(p.patterns, brighten(color), 3, budget * (i === 1 ? 1.25 : 1), f.patterns),
    };
  };
  return {
    name: clipText(r.name, 40) || fb.name,
    personality: clipText(r.personality, 120) || fb.personality,
    taunt: clipText(r.taunt, 140) || fb.taunt,
    phase2Line: clipText(r.phase2Line, 120) || fb.phase2Line,
    defeatLine: clipText(r.defeatLine, 120) || fb.defeatLine,
    sprite: asSprite(r.sprite, fb.sprite),
    color,
    hp: Math.round(num(r.hp, fb.hp, 450, 1500) * (1 + difficulty * 0.3)),
    phases: [phase(0), phase(1)],
  };
}

export function sanitizeDesign(raw: unknown, fb: DungeonDesign, difficulty: number): DungeonDesign {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const enemiesRaw = Array.isArray(r.enemies) ? r.enemies.slice(0, 3) : [];
  const enemies = enemiesRaw.map((e, i) => sanitizeEnemy(e, fb.enemies[i % fb.enemies.length], difficulty));
  const palette = String(r.palette ?? '').toLowerCase();
  return {
    name: clipText(r.name, 40) || fb.name,
    theme: clipText(r.theme, 80) || fb.theme,
    description: clipText(r.description, 160) || fb.description,
    palette: DUNGEON_PALETTES[palette] ? palette : fb.palette,
    enemies: enemies.length ? enemies : fb.enemies.map((e) => sanitizeEnemy(e, e, difficulty)),
    boss: sanitizeBoss(r.boss, fb.boss, difficulty),
  };
}

// ----------------------------------------------------------- built-ins

/** Weak roaming monsters on the overworld. */
export const OVERWORLD_ENEMIES: EnemyDef[] = [
  {
    name: 'Moss Slime',
    sprite: 'slime',
    color: '#5cc85a',
    hp: 35,
    speed: 22,
    movement: 'chase',
    patterns: [makePattern('aimed', { speed: 70, rate: 0.8, color: '#a0ff60' })],
  },
  {
    name: 'Dusk Bat',
    sprite: 'bat',
    color: '#8a5ac8',
    hp: 25,
    speed: 38,
    movement: 'orbit',
    patterns: [makePattern('shotgun', { speed: 65, count: 3, spread: 40, rate: 0.5, color: '#e070ff' })],
  },
  {
    name: 'Bramble Imp',
    sprite: 'imp',
    color: '#c85a3a',
    hp: 45,
    speed: 26,
    movement: 'wander',
    patterns: [makePattern('radial', { speed: 45, count: 8, rate: 0.45, color: '#ff8040' })],
  },
];

export function hostileNpcDef(name: string, color: string): EnemyDef {
  return {
    name,
    sprite: 'knight',
    color,
    hp: 160,
    speed: 26,
    movement: 'orbit',
    patterns: [
      makePattern('aimed', { speed: 85, count: 3, spread: 24, rate: 1, color: '#ff5050' }),
      makePattern('radial', { speed: 45, count: 12, rate: 0.35, color: '#ffd040' }),
    ],
  };
}

/** Canned dungeons: used offline, and as per-field fallbacks when AI output is incomplete. */
export const FALLBACK_DESIGNS: DungeonDesign[] = [
  {
    name: 'The Sunken Ossuary',
    theme: 'drowned crypt of restless bones',
    description: 'Water drips through bones stacked like cordwood.',
    palette: 'crypt',
    enemies: [
      {
        name: 'Rattling Skull',
        sprite: 'skull',
        color: '#d8d0b8',
        hp: 50,
        speed: 20,
        movement: 'orbit',
        patterns: [makePattern('aimed', { speed: 80, count: 3, spread: 24, rate: 0.9, color: '#ff4060' })],
      },
      {
        name: 'Grave Slime',
        sprite: 'slime',
        color: '#7a9a8a',
        hp: 70,
        speed: 16,
        movement: 'chase',
        patterns: [makePattern('radial', { speed: 45, count: 10, rate: 0.5, color: '#60ffc0' })],
      },
    ],
    boss: {
      name: 'Marrowking Osric',
      personality: 'pompous, obsessed with his lost crown',
      taunt: 'Kneel, bag of meat! Your bones will fit my throne nicely.',
      phase2Line: 'My crown! You dare scratch my CROWN?!',
      defeatLine: 'The throne... is... empty...',
      sprite: 'skull',
      color: '#e8e0c0',
      hp: 750,
      phases: [
        {
          movement: 'orbit',
          speed: 18,
          patterns: [
            makePattern('spiral', { speed: 55, count: 3, spin: 90, rate: 4, color: '#ff4070' }),
            makePattern('aimed', { speed: 90, count: 3, spread: 20, rate: 0.8, color: '#ffd040' }),
          ],
        },
        {
          movement: 'chase',
          speed: 22,
          patterns: [
            makePattern('ringGap', { speed: 45, count: 28, gap: 55, rate: 0.5, color: '#40e0ff' }),
            makePattern('spiral', { speed: 60, count: 4, spin: -120, rate: 4, color: '#ff4070' }),
          ],
        },
      ],
    },
  },
  {
    name: 'The Ember Warrens',
    theme: 'tunnels of living flame and soot-imps',
    description: 'The walls glow like a forge that forgot to go out.',
    palette: 'ember',
    enemies: [
      {
        name: 'Cinder Imp',
        sprite: 'imp',
        color: '#e05030',
        hp: 55,
        speed: 30,
        movement: 'wander',
        patterns: [makePattern('shotgun', { speed: 80, count: 5, spread: 50, rate: 0.6, color: '#ffa020' })],
      },
      {
        name: 'Ash Bat',
        sprite: 'bat',
        color: '#6a5050',
        hp: 40,
        speed: 42,
        movement: 'orbit',
        patterns: [makePattern('wave', { speed: 60, count: 2, spread: 20, amp: 10, freq: 1.5, rate: 0.8, color: '#ff6040' })],
      },
    ],
    boss: {
      name: 'Madame Scorchwick',
      personality: 'theatrical candle-witch who treats battle as a performance',
      taunt: 'Ah, an audience! Do try to burn beautifully, darling.',
      phase2Line: 'Encore! ENCORE! Let the whole stage burn!',
      defeatLine: 'The curtain... falls...',
      sprite: 'wraith',
      color: '#f06030',
      hp: 900,
      phases: [
        {
          movement: 'wander',
          speed: 20,
          patterns: [
            makePattern('rain', { speed: 60, count: 7, spread: 140, rate: 0.7, color: '#ffb020' }),
            makePattern('shotgun', { speed: 85, count: 7, spread: 60, rate: 0.6, color: '#ff4020' }),
          ],
        },
        {
          movement: 'orbit',
          speed: 26,
          patterns: [
            makePattern('radial', { speed: 50, count: 24, rate: 0.7, color: '#ffe040' }),
            makePattern('wave', { speed: 60, count: 5, spread: 60, amp: 12, freq: 1.2, rate: 0.7, color: '#ff4020' }),
            makePattern('rain', { speed: 70, count: 6, spread: 160, rate: 0.6, color: '#ffb020' }),
          ],
        },
      ],
    },
  },
  {
    name: 'The Hollow Observatory',
    theme: 'a star-temple where eyes watch from the void',
    description: 'Star-charts drift in the air, redrawn by unseen hands.',
    palette: 'void',
    enemies: [
      {
        name: 'Watcher Eye',
        sprite: 'eye',
        color: '#b050e0',
        hp: 65,
        speed: 0,
        movement: 'stationary',
        patterns: [makePattern('spiral', { speed: 55, count: 2, spin: 140, rate: 3, color: '#e060ff' })],
      },
      {
        name: 'Void Knight',
        sprite: 'knight',
        color: '#5a4a8a',
        hp: 95,
        speed: 24,
        movement: 'chase',
        patterns: [makePattern('aimed', { speed: 100, count: 1, rate: 1.4, color: '#60c0ff' })],
      },
    ],
    boss: {
      name: 'The Astronomer',
      personality: 'serene, cruel, speaks in star-charts and certainties',
      taunt: 'I have already seen how you fall. Let us make it so.',
      phase2Line: 'The stars... rearrange? No. NO.',
      defeatLine: 'An unrecorded... outcome...',
      sprite: 'eye',
      color: '#8060ff',
      hp: 1100,
      phases: [
        {
          movement: 'stationary',
          speed: 0,
          patterns: [
            makePattern('spiral', { speed: 50, count: 5, spin: 70, rate: 3, color: '#a080ff' }),
            makePattern('ringGap', { speed: 40, count: 30, gap: 50, rate: 0.4, color: '#40ffe0' }),
          ],
        },
        {
          movement: 'orbit',
          speed: 20,
          patterns: [
            makePattern('spiral', { speed: 55, count: 4, spin: -150, rate: 4, color: '#ff60c0' }),
            makePattern('wave', { speed: 60, count: 3, spread: 40, amp: 14, freq: 1.6, rate: 0.9, color: '#40ffe0' }),
            makePattern('aimed', { speed: 110, count: 3, spread: 16, rate: 0.9, color: '#ffffff' }),
          ],
        },
      ],
    },
  },
];
