// Game orchestration: scenes, interaction, AI calls at calm moments, save/load.
import { AIClient, type AIResponse, type AITask } from './ai';
import {
  burst,
  createBoss,
  createEnemy,
  moveBox,
  playerFire,
  updateBullets,
  updateEnemies,
  updateParticles,
  updatePickups,
  type Arena,
  type Bullet,
  type Enemy,
  type Particle,
  type Pickup,
  type Player,
} from './combat';
import { COMPRESS_COUNT, PLAYER_HALF, TILE } from './config';
import { FALLBACK_DESIGNS, OVERWORLD_ENEMIES, hostileNpcDef, sanitizeDesign, type DungeonDesign } from './enemies';
import type { Input } from './input';
import { Inventory } from './inventory';
import { computeStats, describeEffects, fallbackRewardItem, sanitizeItem, type Item, type PlayerStats } from './items';
import { mockCompress, mockDiscover, mockDungeon, mockNewGame, mockOutcome, mockTalk } from './mock';
import { compressPrompt, discoverPrompt, dungeonPrompt, newGamePrompt, outcomePrompt, talkPrompt } from './prompts';
import type { HudState, Renderer } from './render';
import { clipText, hashString, mulberry32, pick, randInt, type RNG } from './rng';
import { hasSave, readSave, writeSave } from './save';
import { getSprite, npcColors } from './sprites';
import type { UI } from './ui';
import {
  T,
  generateDungeon,
  generateOverworld,
  isSolid,
  randomFloorInRoom,
  type DungeonLayout,
  type Overworld,
  type Rect,
  type TileMap,
} from './worldgen';
import {
  addEvent,
  addNpcMemory,
  applyChanges,
  createSheet,
  needsCompression,
  slugify,
  toStanding,
  type Npc,
  type WorldSheet,
} from './worldsheet';

interface NpcActor {
  id: string;
  x: number;
  y: number;
}

interface DungeonRun {
  index: number;
  design: DungeonDesign;
  layout: DungeonLayout;
  roomState: ('idle' | 'active' | 'cleared')[];
  portal: { x: number; y: number } | null;
  boss: Enemy | null;
  rng: RNG;
  returnPos: { x: number; y: number };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Game implements Arena {
  // --- Arena (combat) state
  map: TileMap = generateOverworld(1).map;
  player: Player = { x: 0, y: 0, hp: 6, invuln: 0, shield: 0, shieldTimer: 0, fireCd: 0, flash: 0, dead: false, facing: 1 };
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  particles: Particle[] = [];
  pickups: Pickup[] = [];
  stats: PlayerStats = computeStats(null, []);
  aim = { x: 0, y: 0 };
  firing = false;
  playerSafe = false;

  // --- world state
  sheet: WorldSheet = createSheet('Wren', 1);
  inventory = new Inventory();
  designs: (DungeonDesign | null)[] = [null, null, null];
  cleared = [false, false, false];
  overworld!: Overworld;
  overworldEnemies: Enemy[] = [];
  npcs: NpcActor[] = [];
  dungeon: DungeonRun | null = null;

  // --- runtime
  running = false;
  busy = false;
  time = 0;
  private banner: { title: string; sub: string; t: number } | null = null;
  private discovering = false;
  private talkingTo: string | null = null;
  private convo: string[] = [];
  private talkMemoryStart = 0;
  private playerSpoke = '';
  private pendingHostile: string[] = [];
  private lastGiven: Item | null = null;
  private debugTimer = 0;
  private fxRng = mulberry32(Date.now() >>> 0);

  constructor(
    private r: Renderer,
    private input: Input,
    private ui: UI,
    private ai: AIClient,
  ) {}

  // ================================================================ arena hooks

  shake(a: number) {
    this.r.shake(a);
  }

  onPlayerHurt() {
    if (this.player.hp <= 0) this.onDeath();
  }

  onBossPhase(e: Enemy) {
    if (e.boss) this.showBanner(e.boss.name, `"${e.boss.phase2Line}"`, 2.5);
  }

  onEnemyKilled(e: Enemy) {
    if (e.boss) {
      void this.onBossDefeated(e);
      return;
    }
    if (e.npcId) {
      const npc = this.sheet.npcs[e.npcId];
      if (npc) {
        npc.attitude = 'slain';
        addEvent(this.sheet, `${this.sheet.player.name} slew ${npc.name} in the town square.`);
        this.sheet.player.reputation = Math.max(-100, this.sheet.player.reputation - 15);
        this.ui.toast(`${npc.name} has fallen.`, '#ff8080');
        this.save();
      }
      return;
    }
    if (this.fxRng() < 0.12) this.pickups.push({ x: e.x, y: e.y, kind: 'heart', t: 0 });
  }

  blockedForEnemy(e: Enemy, tx: number, ty: number): boolean {
    if (this.dungeon || e.npcId) return false;
    const t = this.overworld.town;
    return tx >= t.x - 2 && ty >= t.y - 2 && tx < t.x + t.w + 2 && ty < t.y + t.h + 2;
  }

  // ================================================================ lifecycle

  showTitle() {
    this.running = false;
    this.ui.closeDialogue();
    this.ui.closeInventory();
    this.ui.closePause();
    this.ui.showTitle(
      { hasSave: hasSave(), aiLabel: this.ai.online ? `AI game master online · ${this.ai.model}` : 'AI offline · canned game master', online: this.ai.online },
      (name, seed) => void this.newGame(name, seed),
      () => this.loadGame(),
    );
  }

  async newGame(name: string, seedText: string) {
    const seed = seedText
      ? /^\d+$/.test(seedText)
        ? Number(seedText) >>> 0
        : hashString(seedText)
      : (Math.random() * 2 ** 32) >>> 0;
    const playerName = clipText(name, 20) || 'Wren';
    this.ui.hideTitle();
    this.sheet = createSheet(playerName, seed);
    this.inventory = new Inventory();
    this.designs = [null, null, null];
    this.cleared = [false, false, false];
    this.dungeon = null;
    this.buildOverworld();
    this.player = { ...this.player, x: this.overworld.spawn.x, y: this.overworld.spawn.y + 16, dead: false, invuln: 0 };
    this.refreshStats();
    this.player.hp = this.stats.maxHp;
    this.running = true;

    const res = await this.runAI('newGame', newGamePrompt(playerName, seed), () => mockNewGame(playerName, seed), 'The Game Master is imagining a world...');
    this.applySetup(res.data.setup, playerName, seed);
    this.applyAI(res);
    this.placeNpcs();
    const town = this.sheet.places.town;
    await this.ui.narrate(res.narration || `${playerName} arrives in ${town.name}.`, town.name);
    this.ui.toast('Talk to the townsfolk with E. Ask for work!', '#c8e8ff');
    this.save();
  }

  private applySetup(raw: unknown, playerName: string, seed: number) {
    const fb = mockNewGame(playerName, seed).setup as Record<string, unknown>;
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const sheet = this.sheet;
    sheet.world.mainThreat = clipText(s.mainThreat, 200) || String(fb.mainThreat);
    sheet.places.town = {
      name: clipText(s.townName, 32) || String(fb.townName),
      description: clipText(s.townDescription, 140) || String(fb.townDescription),
    };
    const factions = s.factions && typeof s.factions === 'object' ? Object.entries(s.factions as object) : [];
    for (const [k, v] of (factions.length >= 2 ? factions : Object.entries(fb.factions as object)).slice(0, 2)) {
      sheet.factions[clipText(k, 40)] = toStanding(v);
    }
    const list = (Array.isArray(s.npcs) ? s.npcs : []).slice(0, 4) as Record<string, unknown>[];
    const fbList = fb.npcs as Record<string, unknown>[];
    while (list.length < 4) list.push(fbList[list.length]);
    for (const n of list) {
      const name = clipText(n?.name, 32);
      if (!name) continue;
      let id = slugify(String(n.id ?? name));
      while (sheet.npcs[id]) id += '_b';
      const att = String(n.attitude ?? 'neutral').toLowerCase();
      sheet.npcs[id] = {
        name,
        role: clipText(n.role, 40) || 'townsperson',
        personality: clipText(n.personality, 120),
        secret: clipText(n.secret, 160),
        want: clipText(n.want, 120),
        attitude: ['friendly', 'neutral', 'wary'].includes(att) ? att : 'neutral',
        memory: [],
      } satisfies Npc;
    }
  }

  // ================================================================ AI plumbing

  private async runAI(task: AITask, prompt: string, mock: () => Record<string, unknown>, text?: string): Promise<AIResponse> {
    this.busy = true;
    this.input.reset();
    this.ui.setLoading(true, text);
    try {
      this.syncSheet();
      return await this.ai.call(task, prompt, mock);
    } finally {
      this.ui.setLoading(false);
      this.busy = false;
    }
  }

  /** Apply validated changes; returns UI messages (also toasted). */
  private applyAI(res: AIResponse, toast = true): string[] {
    const msgs = applyChanges(this.sheet, res.changes, {
      giveItem: (raw) => {
        const item = sanitizeItem(raw);
        if (!item) return null;
        return this.giveItem(item);
      },
      takeItem: (name) => {
        const ok = !!this.inventory.removeByName(name);
        if (ok) this.refreshStats();
        return ok;
      },
      npcHostile: (id) => this.pendingHostile.push(id),
    });
    if (toast) for (const m of msgs) this.ui.toast(m, m.startsWith('New quest') ? '#c8e8ff' : '#f0e0a0');
    this.syncSheet();
    return msgs;
  }

  private giveItem(item: Item): string {
    this.lastGiven = item;
    const where = this.inventory.receive(item);
    this.refreshStats();
    const fx = describeEffects(item.effects).join(', ');
    if (where === 'full') return `Your bag is full: ${item.name} was left behind`;
    return `${where === 'equipped' ? 'Equipped' : 'Received'}: ${item.name} (${fx})`;
  }

  private async maybeCompress() {
    if (!needsCompression(this.sheet) || this.busy) return;
    const old = this.sheet.events.slice(0, COMPRESS_COUNT);
    const res = await this.runAI('compress', compressPrompt(this.sheet, old), () => mockCompress(this.sheet, old), 'The Game Master tidies the chronicle...');
    const story = clipText(res.data.storySoFar, 800) || clipText(mockCompress(this.sheet, old).storySoFar, 800);
    this.sheet.world.storySoFar = story;
    this.sheet.events.splice(0, old.length);
    this.save();
  }

  syncSheet() {
    const p = this.sheet.player;
    p.hp = Math.max(0, this.player.hp);
    p.maxHp = this.stats.maxHp;
    p.inventory = this.inventory.names();
  }

  refreshStats() {
    const e = this.inventory.equip;
    const before = this.stats.maxHp;
    this.stats = computeStats(e.weapon, [e.charm1, e.charm2]);
    if (this.stats.maxHp > before) this.player.hp += this.stats.maxHp - before;
    this.player.hp = Math.min(this.player.hp, this.stats.maxHp);
    this.player.shield = Math.min(Math.max(this.player.shield, 0), Math.max(this.stats.shieldMax, this.player.shield));
  }

  // ================================================================ world building

  private buildOverworld() {
    this.overworld = generateOverworld(this.sheet.world.seed);
    this.map = this.overworld.map;
    this.overworld.entrances.forEach((e, i) => {
      if (this.cleared[i]) this.map.set(Math.floor(e.x / TILE), Math.floor(e.y / TILE), T.ENTRANCE, 1);
    });
    const rng = mulberry32(this.sheet.world.seed ^ 0xbeef);
    this.overworldEnemies = this.overworld.enemySpawns.map((s) => createEnemy(pick(rng, OVERWORLD_ENEMIES), s.x, s.y, -1, null));
    this.enemies = this.overworldEnemies;
    this.bullets = [];
    this.pickups = [];
    this.particles = [];
  }

  private placeNpcs() {
    this.npcs = [];
    const ids = Object.keys(this.sheet.npcs).slice(0, 4);
    ids.forEach((id, i) => {
      const spot = this.overworld.npcSpots[i];
      const npc = this.sheet.npcs[id];
      if (!spot || npc.attitude === 'slain') return;
      if (npc.attitude === 'hostile') this.spawnHostileNpc(id, spot.x, spot.y);
      else this.npcs.push({ id, x: spot.x, y: spot.y });
    });
  }

  private spawnHostileNpc(id: string, x: number, y: number) {
    const npc = this.sheet.npcs[id];
    const e = createEnemy(hostileNpcDef(npc.name, npcColors(id)[1]), x, y, -1, this.townHome());
    e.npcId = id;
    this.overworldEnemies.push(e);
    if (!this.dungeon) this.enemies = this.overworldEnemies;
  }

  private townHome(): Rect {
    const t = this.overworld.town;
    return { x: t.x - 1, y: t.y - 1, w: t.w + 2, h: t.h + 2 };
  }

  // ================================================================ update

  update(dt: number) {
    this.time += dt;
    this.r.update(dt);
    const inp = this.input;

    if (inp.wasPressed('f1')) this.ui.toggleDebug();
    if (this.ui.debugOpen) {
      this.debugTimer -= dt;
      if (this.debugTimer <= 0) {
        this.debugTimer = 0.3;
        this.syncSheet();
        this.ui.setDebug(
          `WORLD SHEET  (F1 to close)\n${JSON.stringify(this.sheet, null, 2)}\n\n--- last AI response [${this.ai.lastTask || 'none'}] ---\n${this.ai.lastRaw || '(none yet)'}`,
        );
      }
    }
    if (!this.running) return;

    if (inp.wasPressed('escape')) this.handleEscape();
    if (inp.wasPressed('i') && !this.busy) {
      if (this.ui.inventoryOpen) this.closeInventory();
      else if (!this.ui.blocking) this.openInventory();
    }
    if (this.ui.blocking || this.busy) return;

    for (let k = 0; k < 3; k++) if (inp.wasPressed(String(k + 1))) this.useConsumable(k);
    if (inp.wasPressed('e')) this.interact();

    const p = this.player;
    if (!p.dead) {
      let mx = (inp.down('d') ? 1 : 0) - (inp.down('a') ? 1 : 0);
      let my = (inp.down('s') ? 1 : 0) - (inp.down('w') ? 1 : 0);
      if (mx && my) {
        mx *= Math.SQRT1_2;
        my *= Math.SQRT1_2;
      }
      const res = moveBox(this.map, p.x, p.y, mx * this.stats.moveSpeed * dt, my * this.stats.moveSpeed * dt, PLAYER_HALF, (tx, ty) =>
        this.npcs.some((n) => Math.floor(n.x / TILE) === tx && Math.floor(n.y / TILE) === ty),
      );
      p.x = res.x;
      p.y = res.y;
    }
    this.aim = this.r.toWorld(inp.mouse.x, inp.mouse.y);
    this.firing = inp.mouse.down;
    if (this.aim.x !== p.x) p.facing = this.aim.x < p.x ? -1 : 1;
    p.invuln = Math.max(0, p.invuln - dt);
    p.flash = Math.max(0, p.flash - dt);
    if (this.stats.shieldMax > 0 && p.shield < this.stats.shieldMax) {
      p.shieldTimer += dt;
      if (p.shieldTimer >= 8) {
        p.shieldTimer = 0;
        p.shield++;
      }
    }

    this.playerSafe = !this.dungeon && this.inTown();
    playerFire(this, dt);
    updateEnemies(this, dt);
    updateBullets(this, dt);
    updateParticles(this, dt);
    updatePickups(this, dt, this.stats.maxHp);

    if (this.dungeon) this.updateDungeon();
    else this.checkDiscovery();

    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }
  }

  private handleEscape() {
    if (this.ui.dialogueOpen) this.endTalk();
    else if (this.ui.inventoryOpen) this.closeInventory();
    else if (this.ui.pauseOpen) this.ui.closePause();
    else if (!this.ui.blocking && !this.busy) this.openPause();
  }

  private interact() {
    const p = this.player;
    if (p.dead) return;
    if (this.dungeon) {
      const portal = this.dungeon.portal;
      if (portal && Math.hypot(portal.x - p.x, portal.y - p.y) < 14) this.exitDungeon();
      return;
    }
    const npc = this.nearestNpc(16);
    if (npc) {
      void this.talkTo(npc.id);
      return;
    }
    const ei = this.nearestEntrance(14);
    if (ei >= 0) void this.enterDungeon(ei);
  }

  private nearestNpc(range: number): NpcActor | null {
    let best: NpcActor | null = null;
    let bd = range;
    for (const n of this.npcs) {
      const d = Math.hypot(n.x - this.player.x, n.y - this.player.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  private nearestEntrance(range: number): number {
    return this.overworld.entrances.findIndex((e) => Math.hypot(e.x - this.player.x, e.y - this.player.y) < range);
  }

  private useConsumable(k: number) {
    const item = this.inventory.takeHotbar(k);
    if (!item) return;
    const heal = item.effects.heal ?? 0;
    const shield = item.effects.shield ?? 0;
    this.player.hp = Math.min(this.stats.maxHp, this.player.hp + heal);
    this.player.shield = Math.min(6, this.player.shield + shield);
    burst(this, this.player.x, this.player.y, item.color, 16, 50);
    this.ui.toast(`Used ${item.name}`, item.color);
    this.syncSheet();
  }

  // ================================================================ discovery

  private checkDiscovery() {
    if (this.discovering || this.busy) return;
    const i = this.overworld.entrances.findIndex(
      (e, idx) => !this.sheet.places[`dungeon${idx}`] && Math.hypot(e.x - this.player.x, e.y - this.player.y) < 72,
    );
    if (i >= 0) void this.discover(i);
  }

  private async discover(i: number) {
    if (this.discovering) return;
    this.discovering = true;
    try {
      const res = await this.runAI('discover', discoverPrompt(this.sheet, i), () => mockDiscover(i), 'Something stirs in the distance...');
      const fb = mockDiscover(i).place as { name: string; description: string };
      const raw = (res.data.place ?? {}) as Record<string, unknown>;
      const place = { name: clipText(raw.name, 40) || fb.name, description: clipText(raw.description, 160) || fb.description };
      this.sheet.places[`dungeon${i}`] = place;
      addEvent(this.sheet, `${this.sheet.player.name} discovered ${place.name}.`);
      this.applyAI(res);
      await this.ui.narrate([res.narration, place.description].filter(Boolean).join('\n\n'), place.name);
      this.save();
      await this.maybeCompress();
    } finally {
      this.discovering = false;
    }
  }

  // ================================================================ dialogue

  private async talkTo(id: string) {
    const npc = this.sheet.npcs[id];
    if (!npc) return;
    this.talkingTo = id;
    this.convo = [];
    this.playerSpoke = '';
    this.talkMemoryStart = npc.memory.length;
    this.input.reset();
    const [hat, coat] = npcColors(id);
    this.ui.openDialogue(
      { name: npc.name, role: npc.role, attitude: npc.attitude, icon: getSprite('hero', hat, coat).img.toDataURL() },
      { onSend: (t) => void this.say(t), onClose: () => this.endTalk() },
    );
    await this.say('');
  }

  private async say(text: string) {
    const id = this.talkingTo;
    if (!id) return;
    const npc = this.sheet.npcs[id];
    const pname = this.sheet.player.name;
    if (text) {
      this.ui.dialogueAdd('player', text, pname);
      this.convo.push(`${pname}: ${text}`);
      if (!this.playerSpoke) this.playerSpoke = text;
    }
    this.ui.setDialogueBusy(true);
    this.syncSheet();
    const res = await this.ai.call('talk', talkPrompt(this.sheet, id, text, this.convo), () => mockTalk(this.sheet, id, text, this.cleared));
    const msgs = this.applyAI(res, false);
    if (this.talkingTo !== id) {
      msgs.forEach((m) => this.ui.toast(m));
      return;
    }
    this.ui.dialogueAdd('narration', res.narration);
    this.ui.dialogueAdd('npc', res.dialogue, npc.name);
    if (res.dialogue) this.convo.push(`${npc.name}: ${res.dialogue}`);
    for (const m of msgs) this.ui.dialogueAdd('system', m);
    this.ui.setDialogueAttitude(npc.role, npc.attitude);
    this.ui.setDialogueBusy(false);
    if (this.pendingHostile.includes(id)) {
      this.ui.setDialogueBusy(true);
      await wait(1400);
      this.endTalk();
    } else {
      this.save();
    }
  }

  private endTalk() {
    const id = this.talkingTo;
    this.ui.closeDialogue();
    this.talkingTo = null;
    this.input.reset();
    if (id && this.playerSpoke && this.sheet.npcs[id]?.memory.length === this.talkMemoryStart) {
      // Guarantee NPCs remember that you spoke, even if the AI recorded nothing.
      addNpcMemory(this.sheet, id, `${this.sheet.player.name} talked with me (act ${this.sheet.world.act}): "${this.playerSpoke.slice(0, 80)}"`);
    }
    for (const hid of this.pendingHostile.splice(0)) {
      const actor = this.npcs.find((n) => n.id === hid);
      if (!actor) continue;
      this.npcs = this.npcs.filter((n) => n.id !== hid);
      this.spawnHostileNpc(hid, actor.x, actor.y);
      addEvent(this.sheet, `${this.sheet.npcs[hid].name} turned on ${this.sheet.player.name}.`);
      this.ui.toast(`${this.sheet.npcs[hid].name} attacks!`, '#ff6060');
      this.shake(4);
    }
    this.save();
    void this.maybeCompress();
  }

  // ================================================================ dungeons

  private async enterDungeon(i: number) {
    if (this.cleared[i]) {
      this.ui.toast('This place lies silent now. Its master is gone.');
      return;
    }
    if (!this.sheet.places[`dungeon${i}`]) await this.discover(i);
    const name = this.sheet.places[`dungeon${i}`]?.name ?? 'The Depths';
    let design = this.designs[i];
    let narration = '';
    if (!design) {
      const res = await this.runAI('dungeon', dungeonPrompt(this.sheet, i, name), () => mockDungeon(i, name), 'The Game Master is designing the depths...');
      const place = this.sheet.places[`dungeon${i}`];
      design = sanitizeDesign(res.data.dungeon, { ...FALLBACK_DESIGNS[i % FALLBACK_DESIGNS.length], name, description: place?.description ?? '' }, i);
      design.name = name;
      this.designs[i] = design;
      this.applyAI(res);
      narration = res.narration;
    } else {
      narration = `You return to ${design.name}. ${design.description}`;
    }

    const entrance = this.overworld.entrances[i];
    const layout = generateDungeon(this.sheet.world.seed, i);
    this.dungeon = {
      index: i,
      design,
      layout,
      roomState: layout.rooms.map((r) => (r.isStart ? 'cleared' : 'idle')),
      portal: null,
      boss: null,
      rng: mulberry32((this.sheet.world.seed ^ (i * 7919) ^ Date.now()) >>> 0),
      returnPos: { x: entrance.x, y: entrance.y + TILE + 2 },
    };
    this.map = layout.map;
    this.enemies = [];
    this.bullets = [];
    this.pickups = [];
    this.player.x = layout.start.x;
    this.player.y = layout.start.y;
    addEvent(this.sheet, `${this.sheet.player.name} entered ${design.name}.`);
    await this.ui.narrate(narration || design.description, design.name);
    this.save();
  }

  private updateDungeon() {
    const run = this.dungeon!;
    const tx = Math.floor(this.player.x / TILE);
    const ty = Math.floor(this.player.y / TILE);
    run.layout.rooms.forEach((room, ri) => {
      const st = run.roomState[ri];
      if (st === 'idle' && tx >= room.x + 1 && ty >= room.y + 1 && tx < room.x + room.w - 1 && ty < room.y + room.h - 1) {
        this.activateRoom(ri);
      } else if (st === 'active' && !room.isBoss && !this.enemies.some((e) => e.roomId === ri)) {
        run.roomState[ri] = 'cleared';
        this.setDoors(ri, false);
        this.ui.toast('Room cleared', '#a0f0a0');
      }
    });
  }

  private setDoors(ri: number, closed: boolean) {
    const room = this.dungeon!.layout.rooms[ri];
    for (const d of room.doors) this.map.set(d.x, d.y, closed ? T.DOOR : T.FLOOR);
  }

  private activateRoom(ri: number) {
    const run = this.dungeon!;
    const room = run.layout.rooms[ri];
    run.roomState[ri] = 'active';
    this.setDoors(ri, true);
    this.shake(3);
    if (room.isBoss) {
      const b = run.design.boss;
      const x = (room.x + room.w / 2) * TILE;
      const y = (room.y + 4) * TILE;
      run.boss = createBoss(b, x, y, ri, room);
      this.enemies.push(run.boss);
      this.showBanner(b.name, `"${b.taunt}"`, 3.5);
      return;
    }
    const count = randInt(run.rng, 3, 4) + run.index + (ri > 1 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const def = pick(run.rng, run.design.enemies);
      const pos = randomFloorInRoom(this.map, room, run.rng, this.player, 44);
      this.enemies.push(createEnemy(def, pos.x, pos.y, ri, room));
    }
  }

  private async onBossDefeated(boss: Enemy) {
    const run = this.dungeon;
    if (!run || !boss.boss) return;
    const i = run.index;
    const bossRoom = run.layout.rooms.findIndex((r) => r.isBoss);
    run.roomState[bossRoom] = 'cleared';
    this.cleared[i] = true;
    const pname = this.sheet.player.name;
    addEvent(this.sheet, `${pname} defeated ${boss.boss.name}, master of ${run.design.name}.`);
    this.sheet.player.reputation = Math.min(100, this.sheet.player.reputation + 5);
    this.showBanner(`${boss.boss.name} is defeated`, `"${boss.boss.defeatLine}"`, 3);
    await wait(1800);
    if (this.dungeon !== run) return;

    this.lastGiven = null;
    const hadWeapon = !!this.inventory.equip.weapon;
    const res = await this.runAI('outcome', outcomePrompt(this.sheet, boss.boss.name, run.design.name, i), () =>
      mockOutcome(this.sheet, boss.boss!.name, run.design.name, i, hadWeapon),
    'The Game Master weighs your victory...');
    this.sheet.world.act = Math.min(4, this.sheet.world.act + 1);
    const msgs = this.applyAI(res, false);
    if (!this.lastGiven) msgs.push(this.giveItem(fallbackRewardItem(i)));
    await this.ui.narrate(res.narration || `${boss.boss.name} is no more.`, 'Victory');
    for (const m of msgs) this.ui.toast(m, '#f0e0a0');
    this.setDoors(bossRoom, false);
    const room = run.layout.rooms[bossRoom];
    run.portal = { x: (room.x + room.w / 2) * TILE, y: (room.y + room.h / 2) * TILE };
    this.ui.toast('A portal home shimmers open. Press E beside it.', '#a0e0ff');
    const e = this.overworld.entrances[i];
    this.overworld.map.set(Math.floor(e.x / TILE), Math.floor(e.y / TILE), T.ENTRANCE, 1);
    this.save();
    await this.maybeCompress();
  }

  private exitDungeon() {
    const run = this.dungeon;
    if (!run) return;
    this.dungeon = null;
    this.map = this.overworld.map;
    this.enemies = this.overworldEnemies;
    this.bullets = [];
    this.pickups = [];
    this.player.x = run.returnPos.x;
    this.player.y = run.returnPos.y;
    this.ui.toast(`You emerge from ${run.design.name}.`);
    this.save();
  }

  // ================================================================ death

  private onDeath() {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    p.hp = 0;
    this.shake(8);
    burst(this, p.x, p.y, '#ff4060', 40, 90, 2);
    const place = this.placeName();
    setTimeout(() => {
      this.ui.showDeath(`You fell in ${place}. Your story is not over - the world remembers everything.`, () => this.respawn(place));
    }, 1100);
  }

  private respawn(place: string) {
    const town = this.sheet.places.town?.name ?? 'town';
    addEvent(this.sheet, `${this.sheet.player.name} fell in ${place} and awoke, battered, in ${town}.`);
    this.dungeon = null;
    this.map = this.overworld.map;
    this.enemies = this.overworldEnemies;
    this.bullets = [];
    this.pickups = [];
    const p = this.player;
    p.x = this.overworld.spawn.x;
    p.y = this.overworld.spawn.y + 16;
    p.dead = false;
    p.hp = this.stats.maxHp;
    p.invuln = 2;
    p.shield = this.stats.shieldMax;
    this.input.reset();
    this.save();
    void this.maybeCompress();
  }

  // ================================================================ menus

  private openInventory() {
    this.input.reset();
    this.ui.openInventory(this.inventory, {
      onEquip: (i) => {
        this.inventory.equipFromBag(i);
        this.afterInventoryChange();
      },
      onUnequip: (slot) => {
        if (!this.inventory.unequip(slot)) this.ui.toast('No room in your bag.');
        this.afterInventoryChange();
      },
      onUse: (i) => {
        const it = this.inventory.bag[i];
        const idx = this.inventory.hotbar().findIndex((h) => h.bagIndex === i);
        if (it && idx >= 0) this.useConsumable(idx);
        this.afterInventoryChange();
      },
      onDrop: (i) => {
        const it = this.inventory.drop(i);
        if (it) this.ui.toast(`Dropped ${it.name}`);
        this.afterInventoryChange();
      },
      onClose: () => this.closeInventory(),
    });
  }

  private afterInventoryChange() {
    this.refreshStats();
    this.syncSheet();
    this.ui.renderInventory(this.inventory);
  }

  private closeInventory() {
    this.ui.closeInventory();
    this.input.reset();
  }

  private openPause() {
    this.input.reset();
    this.ui.openPause(
      {
        onResume: () => this.ui.closePause(),
        onSave: () => {
          this.save(false);
          this.ui.closePause();
        },
        onLoad: () => {
          this.ui.closePause();
          this.loadGame();
        },
        onQuit: () => {
          this.save();
          this.ui.closePause();
          this.showTitle();
        },
      },
      hasSave(),
    );
  }

  // ================================================================ save / load

  save(showToast = false) {
    if (!this.running) return;
    this.syncSheet();
    const pos = this.dungeon ? this.dungeon.returnPos : { x: this.player.x, y: this.player.y };
    const ok = writeSave({
      v: 1,
      savedAt: Date.now(),
      sheet: this.sheet,
      inventory: this.inventory.toJSON(),
      designs: this.designs,
      cleared: this.cleared,
      pos,
      hp: Math.max(1, this.player.hp),
    });
    if (showToast) this.ui.toast(ok ? 'Game saved.' : 'Save failed!', ok ? '#a0f0a0' : '#ff8080');
  }

  loadGame() {
    const d = readSave();
    if (!d) {
      this.ui.toast('No save found.');
      return;
    }
    this.ui.hideTitle();
    this.sheet = d.sheet;
    this.sheet.places ??= {};
    this.inventory = Inventory.fromJSON(d.inventory);
    this.designs = [0, 1, 2].map((i) => d.designs?.[i] ?? null);
    this.cleared = [0, 1, 2].map((i) => !!d.cleared?.[i]);
    this.dungeon = null;
    this.pendingHostile = [];
    this.buildOverworld();
    this.placeNpcs();
    this.refreshStats();
    const p = this.player;
    const tile = this.map.atWorld(d.pos?.x ?? -1, d.pos?.y ?? -1);
    const valid = d.pos && !isSolid(tile);
    p.x = valid ? d.pos.x : this.overworld.spawn.x;
    p.y = valid ? d.pos.y : this.overworld.spawn.y + 16;
    p.hp = Math.min(this.stats.maxHp, Math.max(1, d.hp || this.stats.maxHp));
    p.dead = false;
    p.invuln = 1;
    p.shield = this.stats.shieldMax;
    this.running = true;
    this.input.reset();
    this.ui.toast(`Welcome back, ${this.sheet.player.name}.`, '#f0e0a0');
  }

  // ================================================================ render

  private showBanner(title: string, sub: string, t: number) {
    this.banner = { title, sub, t };
  }

  private inTown(): boolean {
    const t = this.overworld.town;
    const tx = this.player.x / TILE;
    const ty = this.player.y / TILE;
    return tx >= t.x - 2 && ty >= t.y - 2 && tx < t.x + t.w + 2 && ty < t.y + t.h + 2;
  }

  private placeName(): string {
    if (this.dungeon) return this.dungeon.design.name;
    if (this.inTown()) return this.sheet.places.town?.name ?? 'Town';
    const i = this.overworld.entrances.findIndex((e) => Math.hypot(e.x - this.player.x, e.y - this.player.y) < 48);
    if (i >= 0 && this.sheet.places[`dungeon${i}`]) return this.sheet.places[`dungeon${i}`].name;
    return 'The Wilds';
  }

  private interactionPrompt(): string {
    const p = this.player;
    if (p.dead || this.ui.blocking || this.busy) return '';
    if (this.dungeon) {
      const portal = this.dungeon.portal;
      return portal && Math.hypot(portal.x - p.x, portal.y - p.y) < 14 ? '[E] Return to the surface' : '';
    }
    const npc = this.nearestNpc(16);
    if (npc) return `[E] Talk to ${this.sheet.npcs[npc.id].name}`;
    const i = this.nearestEntrance(14);
    if (i >= 0) {
      const name = this.sheet.places[`dungeon${i}`]?.name ?? 'the dark entrance';
      return this.cleared[i] ? `${name} (cleansed)` : `[E] Enter ${name}`;
    }
    return '';
  }

  render() {
    const r = this.r;
    if (!this.running) {
      r.beginWorld();
      return;
    }
    const p = this.player;
    r.follow(p.x, p.y, this.map);
    r.beginWorld();
    r.tiles(this.map, this.dungeon?.design.palette ?? 'crypt', this.time);
    r.pickups(this.pickups, this.time);
    if (this.dungeon?.portal) r.portal(this.dungeon.portal.x, this.dungeon.portal.y, this.time);

    if (!this.dungeon) {
      for (const n of this.npcs) {
        const [hat, coat] = npcColors(n.id);
        const bob = Math.round(Math.sin(this.time * 2 + n.x) * 0.5);
        r.sprite(getSprite('hero', hat, coat), n.x, n.y - 1 + bob, { flip: p.x < n.x });
      }
    }
    for (const e of this.enemies) r.enemy(e, this.time);

    if (!p.dead) {
      const blink = p.invuln > 0 && Math.floor(this.time * 16) % 2 === 0;
      if (!blink) r.sprite(getSprite('hero', '#3a7bd5', '#e0b040'), p.x, p.y - 1, { flash: p.flash > 0, flip: p.facing < 0 });
      if (p.shield > 0) r.label('◈'.repeat(Math.min(p.shield, 4)), p.x, p.y - 8, '#60c0ff');
    }
    r.bullets(this.bullets, false);
    r.bullets(this.bullets, true);
    r.particles(this.particles);

    const inCombat =
      this.bullets.some((b) => b.enemy) ||
      this.enemies.some((e) => e.roomId >= 0 || e.npcId || (!this.playerSafe && Math.hypot(e.x - p.x, e.y - p.y) < 110));
    if (inCombat && !p.dead) r.hitbox(p.x, p.y);

    // Labels: nearby NPC names and discovered entrances.
    if (!this.dungeon) {
      for (const n of this.npcs) {
        if (Math.hypot(n.x - p.x, n.y - p.y) < 40) r.label(this.sheet.npcs[n.id]?.name ?? '', n.x, n.y - 9);
      }
      this.overworld.entrances.forEach((e, i) => {
        const place = this.sheet.places[`dungeon${i}`];
        if (place && Math.hypot(e.x - p.x, e.y - p.y) < 90) r.label(place.name, e.x, e.y - 8, this.cleared[i] ? '#80f0a0' : '#ffc080');
      });
    }

    const boss = this.dungeon?.boss;
    const hud: HudState = {
      hp: Math.max(0, p.hp),
      maxHp: this.stats.maxHp,
      shield: p.shield,
      place: this.placeName(),
      quests: this.sheet.quests.filter((q) => q.status === 'active').map((q) => q.title),
      hotbar: this.inventory.hotbar().map((h) => h.item),
      weapon: this.inventory.equip.weapon,
      prompt: this.interactionPrompt(),
      aiLabel: this.ai.label,
      boss: boss && !boss.dead ? { name: boss.name, hp: boss.hp, max: boss.maxHp } : null,
      banner: this.banner,
    };
    r.hud(hud, this.time);
  }
}
