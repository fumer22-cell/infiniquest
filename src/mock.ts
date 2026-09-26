// Offline game master: canned but sheet-aware responses so the game always plays.
import { FALLBACK_DESIGNS } from './enemies';
import { mulberry32, pick, shuffle } from './rng';
import { activeQuests, type WorldSheet } from './worldsheet';

type Obj = Record<string, unknown>;

const THREATS = [
  'The Hollow Crown, a dead king who is slowly draining the color from the world.',
  'The Gloam Tide, a creeping dusk that turns sleepers into shadows.',
  'The Choir Beneath, a buried chorus whose song rots the minds of those who hear it.',
];
const TOWNS = ['Brindlewick', 'Lanternmoor', 'Saltcross', 'Hearthhollow'];
const FACTIONS: [string, string][] = [
  ['Lantern Wardens', 'Ashen Pact'],
  ['Brass Guild', 'Moonwell Circle'],
  ['Crownless Militia', 'Order of the Last Candle'],
];
const NPCS = [
  { id: 'elder_maren', name: 'Elder Maren', role: 'village elder', personality: 'weary, protective, dry humor', secret: 'she sealed the first dungeon herself decades ago', want: 'someone to finish what she started' },
  { id: 'tobin_forge', name: 'Tobin Forge', role: 'blacksmith', personality: 'loud, generous, terrible at secrets', secret: 'his forge runs on a stolen ember', want: 'rare ore from the deep places' },
  { id: 'sister_vey', name: 'Sister Vey', role: 'wandering priestess', personality: 'serene, cryptic, quietly afraid', secret: 'she hears the threat speaking in dreams', want: 'proof the dreams are lies' },
  { id: 'pip_quickcoin', name: 'Pip Quickcoin', role: 'merchant', personality: 'cheerful, greedy, oddly brave', secret: 'he sells relics looted from the dungeons', want: 'profit, and a hero to invest in' },
  { id: 'captain_hale', name: 'Captain Hale', role: 'militia captain', personality: 'stern, honest, stretched thin', secret: 'half her soldiers deserted last month', want: 'the roads made safe' },
  { id: 'old_wick', name: 'Old Wick', role: 'lamplighter', personality: 'rambling, sharp-eyed, nostalgic', secret: 'he was once an adventurer who fled', want: 'to be forgiven for running' },
];
const PLACE_NAMES = ['The Sunken Ossuary', 'The Ember Warrens', 'The Hollow Observatory'];
const PLACE_LINES = [
  'Stone steps slick with black water lead down into the smell of old bones.',
  'Heat breathes from the cracks like something enormous is sleeping below.',
  'A domed ruin where the stars seem to lean closer than they should.',
];

export function mockNewGame(playerName: string, seed: number): Obj {
  const r = mulberry32(seed);
  const threat = pick(r, THREATS);
  const town = pick(r, TOWNS);
  const [fa, fb] = pick(r, FACTIONS);
  const npcs = shuffle(r, NPCS.slice())
    .slice(0, 4)
    .map((n, i) => ({ ...n, attitude: i === 3 ? 'wary' : i === 0 ? 'friendly' : 'neutral' }));
  // Make sure someone reliably gives quests.
  if (!npcs.some((n) => n.id === 'elder_maren' || n.id === 'captain_hale')) npcs[0] = { ...NPCS[0], attitude: 'friendly' };
  return {
    narration: `The road ends at ${town}, ${playerName}, a huddle of lamplit roofs under a bruised sky. They say ${threat.charAt(0).toLowerCase() + threat.slice(1)} Three dark entrances have opened in the wilds beyond the walls, and the townsfolk watch you with desperate hope. (Offline mode: the game master is running on canned tales.)`,
    dialogue: '',
    changes: [{ type: 'addEvent', text: `${playerName} arrived in ${town}.` }],
    setup: {
      mainThreat: threat,
      townName: town,
      townDescription: 'A stubborn little town that keeps its lamps lit against the dark.',
      factions: { [fa]: 'friendly', [fb]: 'neutral' },
      npcs,
    },
  };
}

export function mockDiscover(index: number): Obj {
  return {
    narration: `You find a yawning entrance: ${PLACE_NAMES[index % 3]}.`,
    dialogue: '',
    changes: [],
    place: { name: PLACE_NAMES[index % 3], description: PLACE_LINES[index % 3] },
  };
}

export function mockDungeon(index: number, name: string): Obj {
  const d = FALLBACK_DESIGNS[index % FALLBACK_DESIGNS.length];
  return {
    narration: `You descend into ${name}. ${d.description}`,
    dialogue: '',
    changes: [],
    dungeon: { ...d, name },
  };
}

const REWARDS = [
  { name: 'Tri-Ember Wand', description: 'Spits three coals where there used to be one.', slot: 'weapon', rarity: 'rare', effects: { shotCount: 2, spread: 18, damage: 2 }, color: '#ff8a30' },
  { name: "Seeker's Thorn", description: 'Its needles hunt whatever they are pointed near.', slot: 'weapon', rarity: 'epic', effects: { homing: 0.8, piercing: 1, fireRate: 1 }, color: '#70ff90' },
  { name: 'Stormcaller Staff', description: 'A fan of fat crackling bolts.', slot: 'weapon', rarity: 'legendary', effects: { shotCount: 4, spread: 40, bulletSize: 1, damage: 4 }, color: '#b080ff' },
];
const CHARMS = [
  { name: 'Quickstep Anklet', description: 'Light as a rumor.', slot: 'charm', rarity: 'uncommon', effects: { moveSpeed: 10, fireRate: 1 }, color: '#60e0d0' },
  { name: 'Heartstone Locket', description: 'Warm, and beating faintly.', slot: 'charm', rarity: 'rare', effects: { maxHp: 2, bulletSize: 1 }, color: '#ff6080' },
];

export function mockOutcome(sheet: WorldSheet, bossName: string, dungeonName: string, index: number, hasWeapon: boolean): Obj {
  const changes: Obj[] = [
    { type: 'addEvent', text: `With ${bossName} fallen, ${dungeonName} went quiet and the town breathed easier.` },
    { type: 'giveItem', item: hasWeapon && index === 0 ? CHARMS[0] : REWARDS[index % REWARDS.length] },
    { type: 'adjustReputation', amount: 12 },
  ];
  const left = 2 - index;
  return {
    narration: `${bossName} crumbles, and a hush rolls through ${dungeonName}. Something in the air loosens, like a held breath let go. Among the ruin you find a reward still humming with power. ${
      left > 0 ? 'But the threat is not finished; other entrances still breathe darkness.' : 'For now, at least, the dark has lost its grip.'
    }`,
    dialogue: '',
    changes,
  };
}

// ------------------------------------------------------------------ talk

function lastPlayerEvent(sheet: WorldSheet): string | null {
  for (let i = sheet.events.length - 1; i >= 0; i--) {
    const e = sheet.events[i];
    if (/defeat|fallen|fell|slain|quiet/i.test(e)) return e;
  }
  return null;
}

function nextUnclearedDungeon(sheet: WorldSheet, cleared: boolean[]): { index: number; name: string } | null {
  for (let i = 0; i < 3; i++) {
    if (!cleared[i]) return { index: i, name: sheet.places[`dungeon${i}`]?.name ?? `the ${['first', 'second', 'third'][i]} dark entrance` };
  }
  return null;
}

export function mockTalk(sheet: WorldSheet, npcId: string, text: string, cleared: boolean[]): Obj {
  const npc = sheet.npcs[npcId];
  const player = sheet.player.name;
  const changes: Obj[] = [];
  const t = text.toLowerCase();
  const hadQuestFromMe = sheet.quests.find((q) => q.giver === npcId && q.status === 'active');
  const news = lastPlayerEvent(sheet);
  let dialogue = '';

  // Quest turn-in (also on greeting: they have heard the news).
  if (hadQuestFromMe) {
    const idx = Number(hadQuestFromMe.id.replace('clear_dungeon_', ''));
    if (Number.isFinite(idx) && cleared[idx]) {
      changes.push({ type: 'completeQuest', id: hadQuestFromMe.id });
      changes.push({ type: 'giveItem', item: { name: 'Hearthbrew Tonic', description: 'Tastes like home and courage.', slot: 'consumable', rarity: 'uncommon', effects: { heal: 3 }, color: '#ff7060' } });
      changes.push({ type: 'adjustReputation', amount: 10 });
      changes.push({ type: 'setNpcAttitude', npc: npcId, value: 'friendly' });
      changes.push({ type: 'addNpcMemory', npc: npcId, text: `${player} completed my task: ${hadQuestFromMe.title}.` });
      const how = news ? ` I heard it myself: ${news.charAt(0).toLowerCase() + news.slice(1)}` : '';
      return { narration: `${npc.name} grips your hand.`, dialogue: `${player}, you actually did it!${how} Take this, with my thanks.`, changes };
    }
  }

  if (!text) {
    if (npc.memory.length) {
      const mem = npc.memory[npc.memory.length - 1];
      dialogue = `${player}! You came back. I remember: ${mem.replace(/\.$/, '')}.`;
      if (news) dialogue += ` And the whole town is talking - ${news.charAt(0).toLowerCase() + news.slice(1)}`;
    } else {
      dialogue = `Well met, stranger. I'm ${npc.name}, the ${npc.role} here. `;
      dialogue += activeQuests(sheet).length === 0 ? 'If you are looking for work, just ask.' : `What I want? ${npc.want}.`;
    }
    return { narration: '', dialogue, changes };
  }

  if (/(kill|die|stupid|hate|shut up|idiot|attack)/.test(t)) {
    const angry = npc.attitude === 'wary' || npc.attitude === 'hostile';
    changes.push({ type: 'setNpcAttitude', npc: npcId, value: angry ? 'hostile' : 'wary' });
    changes.push({ type: 'adjustReputation', amount: -8 });
    changes.push({ type: 'addNpcMemory', npc: npcId, text: `${player} threatened me.` });
    if (angry) {
      changes.push({ type: 'npcHostile', npc: npcId });
      return { narration: `${npc.name}'s eyes go cold.`, dialogue: 'That is ENOUGH. Draw your weapon, then.', changes };
    }
    return { narration: `${npc.name} takes a step back.`, dialogue: 'Watch your tongue. I will not warn you twice.', changes };
  }

  const wantsWork = /(quest|help|work|job|task|do for you|need)/.test(t);
  const target = nextUnclearedDungeon(sheet, cleared);
  if (!hadQuestFromMe && target && (wantsWork || activeQuests(sheet).length === 0)) {
    const id = `clear_dungeon_${target.index}`;
    if (!sheet.quests.some((q) => q.id === id && q.status === 'active')) {
      changes.push({ type: 'addQuest', quest: { id, title: `Cleanse ${target.name}`, giver: npcId, goal: `Defeat the master of ${target.name}.`, status: 'active' } });
      changes.push({ type: 'addNpcMemory', npc: npcId, text: `I asked ${player} to clear ${target.name}.` });
      return { narration: '', dialogue: `Then listen. Something festers in ${target.name}. Put an end to whatever rules it, and I will make it worth your while.`, changes };
    }
  }

  if (/(threat|danger|evil|dark|crown|tide|choir)/.test(t)) {
    dialogue = `You want the truth? ${sheet.world.mainThreat} Every night it gets a little closer.`;
  } else if (/secret/.test(t)) {
    dialogue = `Secrets? Everyone here has one. Mine stays buried... for now.`;
    changes.push({ type: 'setNpcAttitude', npc: npcId, value: 'wary' });
  } else if (/(thank|friend|kind|hello|hi\b)/.test(t)) {
    dialogue = `Kind words are rare lately. ${news ? `Especially since ${news.charAt(0).toLowerCase() + news.slice(1)}` : 'Stay safe out there.'}`;
    changes.push({ type: 'adjustReputation', amount: 2 });
  } else {
    dialogue = `Hm. ${npc.want.charAt(0).toUpperCase() + npc.want.slice(1)} - that is what I think about, mostly. ${
      news ? `Though I did hear ${news.charAt(0).toLowerCase() + news.slice(1)}` : ''
    }`.trim();
  }
  changes.push({ type: 'addNpcMemory', npc: npcId, text: `${player} said: "${text.slice(0, 80)}"` });
  return { narration: '', dialogue, changes };
}

export function mockCompress(sheet: WorldSheet, events: string[]): Obj {
  const joined = [sheet.world.storySoFar, events.join(' ')].filter(Boolean).join(' ');
  return { narration: '', dialogue: '', changes: [], storySoFar: joined.length > 600 ? '…' + joined.slice(-599) : joined };
}
