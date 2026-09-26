// Item effect library. The AI composes items from these effects; code clamps everything.
import { clamp, clipText } from './rng';
import { isHexColor } from './sprites';

export const EFFECT_KEYS = [
  'damage',
  'fireRate',
  'shotSpeed',
  'shotCount',
  'spread',
  'piercing',
  'homing',
  'bulletSize',
  'moveSpeed',
  'maxHp',
  'heal',
  'shield',
  'slowEnemyBullets',
] as const;
export type EffectKey = (typeof EFFECT_KEYS)[number];
export type ItemEffects = Partial<Record<EffectKey, number>>;

export type ItemSlot = 'weapon' | 'charm' | 'consumable';
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#b8b8c0',
  uncommon: '#5fd068',
  rare: '#4a9cf0',
  epic: '#b060f0',
  legendary: '#f0a030',
};

export interface Item {
  id: string;
  name: string;
  description: string;
  slot: ItemSlot;
  rarity: Rarity;
  effects: ItemEffects;
  color: string;
}

/** Per-item clamps. */
export const EFFECT_RANGES: Record<EffectKey, [number, number]> = {
  damage: [-5, 15],
  fireRate: [-1, 3],
  shotSpeed: [-40, 100],
  shotCount: [0, 4],
  spread: [0, 45],
  piercing: [0, 3],
  homing: [0, 1],
  bulletSize: [0, 2.5],
  moveSpeed: [-10, 20],
  maxHp: [-1, 3],
  heal: [0, 6],
  shield: [0, 3],
  slowEnemyBullets: [0, 0.35],
};

const INTEGER_EFFECTS = new Set<EffectKey>(['shotCount', 'piercing', 'maxHp', 'heal', 'shield']);
const CONSUMABLE_EFFECTS = new Set<EffectKey>(['heal', 'shield']);

let idCounter = 0;
export const newItemId = () => `it_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export function sanitizeItem(raw: unknown): Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = clipText(r.name, 40);
  if (!name) return null;
  const rawEffects = (r.effects && typeof r.effects === 'object' ? r.effects : {}) as Record<string, unknown>;
  const effects: ItemEffects = {};
  for (const k of EFFECT_KEYS) {
    const v = Number(rawEffects[k]);
    if (!Number.isFinite(v) || v === 0) continue;
    let c = clamp(v, EFFECT_RANGES[k][0], EFFECT_RANGES[k][1]);
    c = INTEGER_EFFECTS.has(k) ? Math.round(c) : Math.round(c * 100) / 100;
    if (c !== 0) effects[k] = c;
  }
  let slot: ItemSlot = r.slot === 'weapon' || r.slot === 'charm' || r.slot === 'consumable' ? r.slot : 'charm';
  const keys = Object.keys(effects) as EffectKey[];
  if (r.slot === undefined && keys.length > 0 && keys.every((k) => CONSUMABLE_EFFECTS.has(k))) slot = 'consumable';
  if (slot === 'consumable') {
    for (const k of keys) if (!CONSUMABLE_EFFECTS.has(k)) delete effects[k];
    if (!effects.heal && !effects.shield) effects.heal = 2;
  } else {
    delete effects.heal;
    if (Object.keys(effects).length === 0) effects.damage = 2;
  }
  const rarity: Rarity = (RARITIES as readonly string[]).includes(r.rarity as string) ? (r.rarity as Rarity) : 'common';
  return {
    id: newItemId(),
    name,
    description: clipText(r.description, 140) || 'A curious object.',
    slot,
    rarity,
    effects,
    color: isHexColor(r.color) ? r.color : RARITY_COLORS[rarity],
  };
}

export interface PlayerStats {
  damage: number;
  fireRate: number;
  shotSpeed: number;
  shotCount: number;
  spread: number;
  piercing: number;
  homing: number;
  bulletSize: number;
  moveSpeed: number;
  maxHp: number;
  shieldMax: number;
  slowEnemyBullets: number;
  color: string;
}

export const BASE_STATS: PlayerStats = {
  damage: 10,
  fireRate: 4,
  shotSpeed: 140,
  shotCount: 1,
  spread: 0,
  piercing: 0,
  homing: 0,
  bulletSize: 1.5,
  moveSpeed: 48,
  maxHp: 6,
  shieldMax: 0,
  slowEnemyBullets: 0,
  color: '#80e8ff',
};

/** Stack equipped item effects onto the base stats, then clamp the totals. */
export function computeStats(weapon: Item | null, charms: (Item | null)[]): PlayerStats {
  const s: PlayerStats = { ...BASE_STATS };
  for (const it of [weapon, ...charms]) {
    if (!it) continue;
    const e = it.effects;
    s.damage += e.damage ?? 0;
    s.fireRate += e.fireRate ?? 0;
    s.shotSpeed += e.shotSpeed ?? 0;
    s.shotCount += e.shotCount ?? 0;
    s.spread += e.spread ?? 0;
    s.piercing += e.piercing ?? 0;
    s.homing += e.homing ?? 0;
    s.bulletSize += e.bulletSize ?? 0;
    s.moveSpeed += e.moveSpeed ?? 0;
    s.maxHp += e.maxHp ?? 0;
    s.shieldMax += e.shield ?? 0;
    s.slowEnemyBullets += e.slowEnemyBullets ?? 0;
  }
  s.damage = clamp(s.damage, 3, 60);
  s.fireRate = clamp(s.fireRate, 1, 12);
  s.shotSpeed = clamp(s.shotSpeed, 60, 300);
  s.shotCount = clamp(Math.round(s.shotCount), 1, 7);
  s.spread = clamp(s.spread, 0, 90);
  s.piercing = clamp(Math.round(s.piercing), 0, 4);
  s.homing = clamp(s.homing, 0, 1);
  s.bulletSize = clamp(s.bulletSize, 1, 5);
  s.moveSpeed = clamp(s.moveSpeed, 30, 80);
  s.maxHp = clamp(Math.round(s.maxHp), 3, 12);
  s.shieldMax = clamp(Math.round(s.shieldMax), 0, 4);
  s.slowEnemyBullets = clamp(s.slowEnemyBullets, 0, 0.5);
  if (weapon) s.color = weapon.color;
  return s;
}

const EFFECT_LABELS: Record<EffectKey, (v: number) => string> = {
  damage: (v) => `${sign(v)} damage`,
  fireRate: (v) => `${sign(v)} shots/sec`,
  shotSpeed: (v) => `${sign(v)} shot speed`,
  shotCount: (v) => `${sign(v)} projectiles`,
  spread: (v) => `${sign(v)}° spread`,
  piercing: (v) => `pierces ${v} ${v === 1 ? 'enemy' : 'enemies'}`,
  homing: (v) => `homing ${Math.round(v * 100)}%`,
  bulletSize: (v) => `${sign(v)} bullet size`,
  moveSpeed: (v) => `${sign(v)} move speed`,
  maxHp: (v) => `${sign(v)} max hearts`,
  heal: (v) => `heals ${v} ${v === 1 ? 'heart' : 'hearts'}`,
  shield: (v) => `${v} shield ${v === 1 ? 'charge' : 'charges'}`,
  slowEnemyBullets: (v) => `enemy bullets -${Math.round(v * 100)}% speed`,
};

function sign(v: number) {
  return v > 0 ? `+${v}` : `${v}`;
}

export function describeEffects(effects: ItemEffects): string[] {
  return (Object.keys(effects) as EffectKey[]).map((k) => EFFECT_LABELS[k](effects[k]!));
}

/** Used when the AI forgets to reward the player after a boss. */
export function fallbackRewardItem(index: number): Item {
  const pool = [
    {
      name: 'Tri-Ember Wand',
      description: 'Spits three coals where there used to be one.',
      slot: 'weapon',
      rarity: 'rare',
      effects: { shotCount: 2, spread: 18, damage: 2 },
      color: '#ff8a30',
    },
    {
      name: "Seeker's Thorn",
      description: 'Its needles hunt what they are pointed near.',
      slot: 'weapon',
      rarity: 'epic',
      effects: { homing: 0.8, piercing: 1, fireRate: 1 },
      color: '#70ff90',
    },
    {
      name: 'Stormcaller Staff',
      description: 'A fan of crackling bolts.',
      slot: 'weapon',
      rarity: 'legendary',
      effects: { shotCount: 4, spread: 40, bulletSize: 1, damage: 4 },
      color: '#b080ff',
    },
  ];
  return sanitizeItem(pool[index % pool.length])!;
}
