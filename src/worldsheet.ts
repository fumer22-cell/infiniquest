// The world sheet: one JSON object that is the AI's memory of the game.
import { MAX_EVENTS, MAX_NPC_MEMORY } from './config';
import { clamp, clipText } from './rng';

export type FactionStanding = 'friendly' | 'neutral' | 'hostile';

export interface Npc {
  name: string;
  role: string;
  personality: string;
  secret: string;
  want: string;
  attitude: string; // friendly | neutral | wary | hostile | slain
  memory: string[];
}

export interface Quest {
  id: string;
  title: string;
  giver: string;
  goal: string;
  status: 'active' | 'completed' | 'failed';
}

export interface Place {
  name: string;
  description: string;
}

export interface WorldSheet {
  player: { name: string; hp: number; maxHp: number; inventory: string[]; reputation: number };
  world: { seed: number; mainThreat: string; act: number; storySoFar: string };
  factions: Record<string, FactionStanding>;
  npcs: Record<string, Npc>;
  quests: Quest[];
  events: string[];
  places: Record<string, Place>; // "town", "dungeon0".."dungeon2" once discovered
}

export interface Change {
  type: string;
  [k: string]: unknown;
}

export function createSheet(name: string, seed: number): WorldSheet {
  return {
    player: { name, hp: 6, maxHp: 6, inventory: [], reputation: 0 },
    world: { seed, mainThreat: '', act: 1, storySoFar: '' },
    factions: {},
    npcs: {},
    quests: [],
    events: [],
    places: {},
  };
}

const STANDINGS: FactionStanding[] = ['friendly', 'neutral', 'hostile'];
const ATTITUDES = ['friendly', 'neutral', 'wary', 'hostile'];

export function toStanding(v: unknown): FactionStanding {
  const s = String(v ?? '').toLowerCase();
  return (STANDINGS as string[]).includes(s) ? (s as FactionStanding) : 'neutral';
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'npc'
  );
}

/** Accept an npc id, or failing that a (case-insensitive) name or first name. */
export function resolveNpcId(sheet: WorldSheet, ref: unknown): string | null {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const r = ref.trim();
  if (sheet.npcs[r]) return r;
  const low = r.toLowerCase();
  for (const [id, n] of Object.entries(sheet.npcs)) {
    if (id.toLowerCase() === low || n.name.toLowerCase() === low) return id;
  }
  for (const [id, n] of Object.entries(sheet.npcs)) {
    if (n.name.toLowerCase().split(' ')[0] === low.split(' ')[0]) return id;
  }
  return null;
}

export function addEvent(sheet: WorldSheet, text: string) {
  const t = clipText(text, 160);
  if (t && sheet.events[sheet.events.length - 1] !== t) sheet.events.push(t);
}

export function addNpcMemory(sheet: WorldSheet, id: string, text: string) {
  const npc = sheet.npcs[id];
  const t = clipText(text, 160);
  if (!npc || !t) return;
  npc.memory.push(t);
  if (npc.memory.length > MAX_NPC_MEMORY) npc.memory.splice(0, npc.memory.length - MAX_NPC_MEMORY);
}

export const needsCompression = (s: WorldSheet) => s.events.length > MAX_EVENTS;

export interface ChangeHooks {
  /** Validate + add an AI item. Returns a toast message, or null if rejected. */
  giveItem(raw: unknown): string | null;
  takeItem(name: string): boolean;
  npcHostile(id: string): void;
}

/**
 * Validate and apply AI changes. Unknown change types and malformed entries are ignored.
 * Returns short messages for the UI.
 */
export function applyChanges(sheet: WorldSheet, changes: unknown, hooks: ChangeHooks): string[] {
  const msgs: string[] = [];
  if (!Array.isArray(changes)) return msgs;
  for (const c of changes.slice(0, 14)) {
    if (!c || typeof c !== 'object') continue;
    const ch = c as Change;
    try {
      switch (ch.type) {
        case 'addEvent':
          addEvent(sheet, String(ch.text ?? ''));
          break;
        case 'setFaction': {
          const f = clipText(ch.faction, 40);
          if (!f) break;
          if (!sheet.factions[f] && Object.keys(sheet.factions).length >= 4) break;
          const v = toStanding(ch.value);
          if (sheet.factions[f] !== v) msgs.push(`${f} are now ${v}`);
          sheet.factions[f] = v;
          break;
        }
        case 'setNpcAttitude': {
          const id = resolveNpcId(sheet, ch.npc);
          const v = String(ch.value ?? '').toLowerCase();
          if (id && ATTITUDES.includes(v) && sheet.npcs[id].attitude !== 'slain') sheet.npcs[id].attitude = v;
          break;
        }
        case 'addNpcMemory': {
          const id = resolveNpcId(sheet, ch.npc);
          if (id) addNpcMemory(sheet, id, String(ch.text ?? ''));
          break;
        }
        case 'addQuest': {
          const q = (ch.quest ?? ch) as Record<string, unknown>;
          const title = clipText(q.title, 60);
          if (!title) break;
          let id = slugify(String(q.id ?? title));
          if (sheet.quests.some((x) => x.id === id && x.status === 'active')) break;
          while (sheet.quests.some((x) => x.id === id)) id += '_2';
          if (sheet.quests.filter((x) => x.status === 'active').length >= 6) break;
          sheet.quests.push({
            id,
            title,
            giver: resolveNpcId(sheet, q.giver) ?? clipText(q.giver, 40),
            goal: clipText(q.goal, 160),
            status: 'active',
          });
          msgs.push(`New quest: ${title}`);
          break;
        }
        case 'completeQuest': {
          const ref = String(ch.id ?? '');
          const q =
            sheet.quests.find((x) => x.id === ref && x.status === 'active') ??
            sheet.quests.find((x) => x.status === 'active' && (x.id === slugify(ref) || x.title.toLowerCase() === ref.toLowerCase()));
          if (q) {
            q.status = 'completed';
            msgs.push(`Quest complete: ${q.title}`);
          }
          break;
        }
        case 'giveItem': {
          const m = hooks.giveItem(ch.item);
          if (m) msgs.push(m);
          break;
        }
        case 'takeItem': {
          const name = clipText(ch.name, 40);
          if (name && hooks.takeItem(name)) msgs.push(`Gave away: ${name}`);
          break;
        }
        case 'npcHostile': {
          const id = resolveNpcId(sheet, ch.npc);
          if (id && sheet.npcs[id].attitude !== 'slain') {
            sheet.npcs[id].attitude = 'hostile';
            hooks.npcHostile(id);
          }
          break;
        }
        case 'adjustReputation': {
          const a = clamp(Number(ch.amount) || 0, -20, 20);
          sheet.player.reputation = clamp(Math.round(sheet.player.reputation + a), -100, 100);
          break;
        }
        default:
          // Unknown change types are ignored by design.
          break;
      }
    } catch (err) {
      console.warn('Ignoring bad change', ch, err);
    }
  }
  return msgs;
}

// ------------------------------------------------ slices sent to the AI

export function recentEvents(sheet: WorldSheet, n = 12): string[] {
  return sheet.events.slice(-n);
}

export function activeQuests(sheet: WorldSheet): Quest[] {
  return sheet.quests.filter((q) => q.status === 'active');
}

/** The general context every request gets. */
export function coreContext(sheet: WorldSheet) {
  return {
    player: sheet.player,
    world: sheet.world,
    factions: sheet.factions,
    places: sheet.places,
    quests: sheet.quests.slice(-8),
    recentEvents: recentEvents(sheet),
  };
}

export function talkContext(sheet: WorldSheet, npcId: string) {
  const others = Object.entries(sheet.npcs)
    .filter(([id]) => id !== npcId)
    .map(([id, n]) => ({ id, name: n.name, role: n.role, attitude: n.attitude }));
  return {
    ...coreContext(sheet),
    npc: { id: npcId, ...sheet.npcs[npcId] },
    otherNpcs: others,
  };
}
