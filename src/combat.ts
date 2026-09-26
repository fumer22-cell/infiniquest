// Combat simulation: bullets, enemies, collisions. Pure code, no AI calls.
import { INVULN_TIME, PLAYER_HITBOX, SHOT_LIFE, TILE } from './config';
import type { BossDef, EnemyDef, Movement } from './enemies';
import type { PlayerStats } from './items';
import { Emitter, type BulletSpawn } from './patterns';
import { blocksBullet, isSolid, type Rect, type TileMap } from './worldgen';

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  life: number;
  enemy: boolean;
  dmg: number;
  pierce: number;
  homing: number;
  hits?: Set<Enemy>;
  wave?: { ox: number; oy: number; dx: number; dy: number; speed: number; amp: number; freq: number; t: number };
  noWall: boolean;
  dead: boolean;
}

export interface Enemy {
  name: string;
  sprite: string;
  color: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  r: number;
  scale: number;
  speed: number;
  movement: Movement;
  emitters: Emitter[];
  flash: number;
  dead: boolean;
  roomId: number; // -1 on the overworld
  home: Rect | null; // tile rect enemies stay inside
  boss?: BossDef;
  phase: number;
  wanderT: number;
  tx: number;
  ty: number;
  orbitDir: number;
  npcId?: string;
  spawnFade: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface Pickup {
  x: number;
  y: number;
  kind: 'heart';
  t: number;
}

export interface Player {
  x: number;
  y: number;
  hp: number;
  invuln: number;
  shield: number;
  shieldTimer: number;
  fireCd: number;
  flash: number;
  dead: boolean;
  facing: number;
}

export interface Arena {
  map: TileMap;
  player: Player;
  enemies: Enemy[];
  bullets: Bullet[];
  particles: Particle[];
  pickups: Pickup[];
  stats: PlayerStats;
  aim: { x: number; y: number };
  firing: boolean;
  /** Player is in a safe zone (town): roaming monsters hold fire. */
  playerSafe: boolean;
  shake(amount: number): void;
  onEnemyKilled(e: Enemy): void;
  onPlayerHurt(): void;
  onBossPhase(e: Enemy): void;
  blockedForEnemy(e: Enemy, tx: number, ty: number): boolean;
}

const MAX_BULLETS = 1600;

// ---------------------------------------------------------------- movement

export function boxBlocked(map: TileMap, x: number, y: number, half: number, extra?: (tx: number, ty: number) => boolean) {
  const x0 = Math.floor((x - half) / TILE);
  const x1 = Math.floor((x + half - 0.001) / TILE);
  const y0 = Math.floor((y - half) / TILE);
  const y1 = Math.floor((y + half - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolid(map.get(tx, ty))) return true;
      if (extra && extra(tx, ty)) return true;
    }
  return false;
}

export function moveBox(
  map: TileMap,
  x: number,
  y: number,
  dx: number,
  dy: number,
  half: number,
  extra?: (tx: number, ty: number) => boolean,
) {
  // Sub-step so fast movers never tunnel through a tile.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 3));
  const sx = dx / steps;
  const sy = dy / steps;
  let hitX = false;
  let hitY = false;
  for (let i = 0; i < steps; i++) {
    if (!hitX) {
      if (!boxBlocked(map, x + sx, y, half, extra)) x += sx;
      else hitX = true;
    }
    if (!hitY) {
      if (!boxBlocked(map, x, y + sy, half, extra)) y += sy;
      else hitY = true;
    }
  }
  return { x, y, hitX, hitY };
}

// ----------------------------------------------------------------- spawning

export function createEnemy(def: EnemyDef, x: number, y: number, roomId: number, home: Rect | null): Enemy {
  return {
    name: def.name,
    sprite: def.sprite,
    color: def.color,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    r: 4,
    scale: 1,
    speed: def.speed,
    movement: def.movement,
    emitters: def.patterns.map((p) => new Emitter(p)),
    flash: 0,
    dead: false,
    roomId,
    home,
    phase: 0,
    wanderT: 0,
    tx: x,
    ty: y,
    orbitDir: Math.random() < 0.5 ? 1 : -1,
    spawnFade: 0.5,
  };
}

export function createBoss(def: BossDef, x: number, y: number, roomId: number, home: Rect): Enemy {
  const ph = def.phases[0];
  const e = createEnemy(
    { name: def.name, sprite: def.sprite, color: def.color, hp: def.hp, speed: ph.speed, movement: ph.movement, patterns: ph.patterns },
    x,
    y,
    roomId,
    home,
  );
  e.boss = def;
  e.r = 8;
  e.scale = 2;
  e.spawnFade = 1;
  e.emitters = ph.patterns.map((p, i) => new Emitter(p, 1.2 + i * 0.4));
  return e;
}

export function burst(arena: Arena, x: number, y: number, color: string, n: number, speed = 50, size = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    const life = 0.25 + Math.random() * 0.35;
    arena.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size });
  }
}

function spawnEnemyBullet(arena: Arena, b: BulletSpawn) {
  if (arena.bullets.length > MAX_BULLETS) return;
  const speed = b.speed * (1 - arena.stats.slowEnemyBullets);
  const dx = Math.cos(b.angle);
  const dy = Math.sin(b.angle);
  arena.bullets.push({
    x: b.x,
    y: b.y,
    vx: dx * speed,
    vy: dy * speed,
    r: b.size,
    color: b.color,
    life: b.noWall ? 4 : 7,
    enemy: true,
    dmg: 1,
    pierce: 0,
    homing: 0,
    noWall: !!b.noWall,
    dead: false,
    wave: b.wave ? { ox: b.x, oy: b.y, dx, dy, speed, amp: b.wave.amp, freq: b.wave.freq, t: 0 } : undefined,
  });
}

// ------------------------------------------------------------------ player

export function playerFire(arena: Arena, dt: number) {
  const p = arena.player;
  const s = arena.stats;
  p.fireCd -= dt;
  if (p.dead || !arena.firing || p.fireCd > 0) return;
  p.fireCd = 1 / s.fireRate;
  const base = Math.atan2(arena.aim.y - p.y, arena.aim.x - p.x);
  const n = s.shotCount;
  const total = ((n > 1 ? s.spread + 8 * (n - 1) : 0) * Math.PI) / 180;
  const jitter = n === 1 ? ((Math.random() - 0.5) * s.spread * Math.PI) / 180 : 0;
  for (let i = 0; i < n; i++) {
    const a = base + (n > 1 ? (i / (n - 1) - 0.5) * total : jitter);
    arena.bullets.push({
      x: p.x + Math.cos(a) * 4,
      y: p.y + Math.sin(a) * 4,
      vx: Math.cos(a) * s.shotSpeed,
      vy: Math.sin(a) * s.shotSpeed,
      r: s.bulletSize,
      color: s.color,
      life: SHOT_LIFE,
      enemy: false,
      dmg: s.damage,
      pierce: s.piercing,
      homing: s.homing,
      hits: s.piercing > 0 ? new Set() : undefined,
      noWall: false,
      dead: false,
    });
  }
}

export function hurtPlayer(arena: Arena) {
  const p = arena.player;
  if (p.invuln > 0 || p.dead) return;
  if (p.shield > 0) {
    p.shield--;
    p.invuln = 0.6;
    burst(arena, p.x, p.y, '#60c0ff', 10, 50);
    arena.shake(2);
    return;
  }
  p.hp -= 1;
  p.invuln = INVULN_TIME;
  p.flash = 0.12;
  arena.shake(5);
  burst(arena, p.x, p.y, '#ff4060', 12, 60);
  arena.onPlayerHurt();
}

// ----------------------------------------------------------------- enemies

export function damageEnemy(arena: Arena, e: Enemy, dmg: number) {
  if (e.dead) return;
  e.hp -= dmg;
  e.flash = 0.07;
  if (e.boss && e.phase === 0 && e.hp <= e.maxHp * 0.5) {
    const ph = e.boss.phases[1];
    e.phase = 1;
    e.movement = ph.movement;
    e.speed = ph.speed;
    e.emitters = ph.patterns.map((p, i) => new Emitter(p, 0.8 + i * 0.3));
    // A moment of mercy: clear the screen for the phase change.
    for (const b of arena.bullets) if (b.enemy) b.dead = true;
    arena.shake(8);
    burst(arena, e.x, e.y, e.color, 40, 90, 2);
    arena.onBossPhase(e);
  }
  if (e.hp <= 0) {
    e.dead = true;
    arena.shake(e.boss ? 10 : 2);
    burst(arena, e.x, e.y, e.color, e.boss ? 70 : 14, e.boss ? 110 : 60, e.boss ? 2 : 1);
    burst(arena, e.x, e.y, '#ffffff', e.boss ? 20 : 4, 40);
    if (e.boss) for (const b of arena.bullets) if (b.enemy) b.dead = true;
    arena.onEnemyKilled(e);
  }
}

export function updateEnemies(arena: Arena, dt: number) {
  const p = arena.player;
  for (const e of arena.enemies) {
    if (e.dead) continue;
    e.flash = Math.max(0, e.flash - dt);
    e.spawnFade = Math.max(0, e.spawnFade - dt);
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const active = !(arena.playerSafe && !e.npcId) && (e.roomId >= 0 || dist < 110);

    let mvx = 0;
    let mvy = 0;
    let move: Movement = active ? e.movement : 'wander';
    if (p.dead) move = 'wander';
    switch (move) {
      case 'chase':
        if (dist > e.r + 10) {
          mvx = dx / dist;
          mvy = dy / dist;
        }
        break;
      case 'orbit': {
        const R = e.boss ? 58 : 44;
        const ang = Math.atan2(e.y - p.y, e.x - p.x) + e.orbitDir * 0.5;
        const tx = p.x + Math.cos(ang) * R;
        const ty = p.y + Math.sin(ang) * R;
        const l = Math.hypot(tx - e.x, ty - e.y) || 1;
        mvx = (tx - e.x) / l;
        mvy = (ty - e.y) / l;
        break;
      }
      case 'wander': {
        e.wanderT -= dt;
        if (e.wanderT <= 0 || Math.hypot(e.tx - e.x, e.ty - e.y) < 3) {
          e.wanderT = 1.5 + Math.random() * 2;
          e.tx = e.x + (Math.random() - 0.5) * 70;
          e.ty = e.y + (Math.random() - 0.5) * 70;
          if (e.home) {
            e.tx = Math.max((e.home.x + 1.5) * TILE, Math.min((e.home.x + e.home.w - 1.5) * TILE, e.tx));
            e.ty = Math.max((e.home.y + 1.5) * TILE, Math.min((e.home.y + e.home.h - 1.5) * TILE, e.ty));
          }
        }
        const l = Math.hypot(e.tx - e.x, e.ty - e.y) || 1;
        mvx = ((e.tx - e.x) / l) * (active ? 0.8 : 0.4);
        mvy = ((e.ty - e.y) / l) * (active ? 0.8 : 0.4);
        break;
      }
      case 'stationary':
        break;
    }
    if (mvx || mvy) {
      const home = e.home;
      const extra = (tx: number, ty: number) =>
        arena.blockedForEnemy(e, tx, ty) ||
        (home !== null && (tx < home.x || ty < home.y || tx >= home.x + home.w || ty >= home.y + home.h));
      const res = moveBox(arena.map, e.x, e.y, mvx * e.speed * dt, mvy * e.speed * dt, e.r * 0.8, extra);
      if (res.hitX || res.hitY) {
        e.orbitDir *= -1;
        e.wanderT = 0;
      }
      e.x = res.x;
      e.y = res.y;
    }

    if (active && !p.dead && dist < 150 && e.spawnFade <= 0) {
      for (const em of e.emitters) em.update(dt, e.x, e.y, p.x, p.y, (b) => spawnEnemyBullet(arena, b));
    }
    if (!p.dead && dist < e.r + 3) hurtPlayer(arena);
  }
  // Remove the dead (callbacks already ran).
  let w = 0;
  for (const e of arena.enemies) if (!e.dead) arena.enemies[w++] = e;
  arena.enemies.length = w;
}

// ----------------------------------------------------------------- bullets

export function updateBullets(arena: Arena, dt: number) {
  const p = arena.player;
  const map = arena.map;
  for (const b of arena.bullets) {
    if (b.dead) continue;
    b.life -= dt;
    if (b.life <= 0) {
      b.dead = true;
      continue;
    }
    if (b.wave) {
      const w = b.wave;
      w.t += dt;
      const along = w.speed * w.t;
      const off = Math.sin(w.t * w.freq * Math.PI * 2) * w.amp;
      b.x = w.ox + w.dx * along - w.dy * off;
      b.y = w.oy + w.dy * along + w.dx * off;
    } else {
      if (b.homing > 0 && !b.enemy) steer(arena, b, dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    if (!b.noWall && blocksBullet(map.atWorld(b.x, b.y))) {
      b.dead = true;
      if (!b.enemy) burst(arena, b.x, b.y, b.color, 2, 25);
      continue;
    }
    if (b.enemy) {
      if (p.dead) continue;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const rr = b.r + PLAYER_HITBOX;
      if (dx * dx + dy * dy < rr * rr) {
        b.dead = true;
        hurtPlayer(arena);
      }
    } else {
      for (const e of arena.enemies) {
        if (e.dead || e.spawnFade > 0.3 || b.hits?.has(e)) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const rr = b.r + e.r;
        if (dx * dx + dy * dy < rr * rr) {
          damageEnemy(arena, e, b.dmg);
          burst(arena, b.x, b.y, b.color, 3, 30);
          if (b.pierce > 0) {
            b.pierce--;
            b.hits?.add(e);
          } else {
            b.dead = true;
          }
          break;
        }
      }
    }
  }
  let w = 0;
  for (const b of arena.bullets) if (!b.dead) arena.bullets[w++] = b;
  arena.bullets.length = w;
}

function steer(arena: Arena, b: Bullet, dt: number) {
  let best: Enemy | null = null;
  let bd = 90 * 90;
  for (const e of arena.enemies) {
    if (e.dead) continue;
    const d = (e.x - b.x) ** 2 + (e.y - b.y) ** 2;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  if (!best) return;
  const speed = Math.hypot(b.vx, b.vy);
  const cur = Math.atan2(b.vy, b.vx);
  const want = Math.atan2(best.y - b.y, best.x - b.x);
  let diff = want - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = b.homing * 7 * dt;
  const a = cur + Math.max(-turn, Math.min(turn, diff));
  b.vx = Math.cos(a) * speed;
  b.vy = Math.sin(a) * speed;
}

// --------------------------------------------------------------- particles

export function updateParticles(arena: Arena, dt: number) {
  for (const q of arena.particles) {
    q.life -= dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vx *= 1 - 4 * dt;
    q.vy *= 1 - 4 * dt;
  }
  let w = 0;
  for (const q of arena.particles) if (q.life > 0) arena.particles[w++] = q;
  arena.particles.length = w;
  if (arena.particles.length > 900) arena.particles.splice(0, arena.particles.length - 900);
}

export function updatePickups(arena: Arena, dt: number, maxHp: number) {
  const p = arena.player;
  for (const k of arena.pickups) {
    k.t += dt;
    if (!p.dead && Math.hypot(k.x - p.x, k.y - p.y) < 7 && p.hp < maxHp) {
      p.hp = Math.min(maxHp, p.hp + 1);
      k.t = -999;
      burst(arena, k.x, k.y, '#ff6080', 10, 40);
    }
  }
  arena.pickups = arena.pickups.filter((k) => k.t >= 0 && k.t < 20);
}
