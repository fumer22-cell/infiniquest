import { TILE } from './config';
import { mulberry32, randInt, valueNoise, type RNG } from './rng';

export const T = {
  VOID: 0,
  GRASS: 1,
  WATER: 2,
  TREE: 3,
  PATH: 4,
  BRIDGE: 5,
  TOWN: 6,
  HOUSE: 7,
  ROOF: 8,
  ENTRANCE: 9,
  FLOOR: 10,
  WALL: 11,
  DOOR: 12,
} as const;

const SOLID = new Set<number>([T.VOID, T.WATER, T.TREE, T.HOUSE, T.ROOF, T.WALL, T.DOOR]);
const BLOCKS_BULLETS = new Set<number>([T.VOID, T.TREE, T.HOUSE, T.ROOF, T.WALL, T.DOOR]);

export const isSolid = (t: number) => SOLID.has(t);
export const blocksBullet = (t: number) => BLOCKS_BULLETS.has(t);

export class TileMap {
  tiles: Uint8Array;
  variant: Uint8Array;
  constructor(public w: number, public h: number, fill: number = T.VOID) {
    this.tiles = new Uint8Array(w * h).fill(fill);
    this.variant = new Uint8Array(w * h);
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.VOID;
    return this.tiles[y * this.w + x];
  }
  set(x: number, y: number, t: number, v = 0) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.tiles[y * this.w + x] = t;
    this.variant[y * this.w + x] = v;
  }
  getVariant(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.variant[y * this.w + x];
  }
  atWorld(px: number, py: number): number {
    return this.get(Math.floor(px / TILE), Math.floor(py / TILE));
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Overworld {
  map: TileMap;
  spawn: { x: number; y: number }; // world px
  town: Rect; // tiles
  npcSpots: { x: number; y: number }[]; // world px
  entrances: { x: number; y: number }[]; // world px (tile centers)
  enemySpawns: { x: number; y: number }[]; // world px
}

const center = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

export function generateOverworld(seed: number): Overworld {
  const W = 96;
  const H = 96;
  const rng = mulberry32(seed);
  const map = new TileMap(W, H, T.GRASS);
  const water = valueNoise(seed ^ 0x5151);
  const trees = valueNoise(seed ^ 0xa3a3);
  const detail = valueNoise(seed ^ 0x7777);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = water(x / 11, y / 11) * 0.8 + detail(x / 4, y / 4) * 0.2;
      const t = trees(x / 6, y / 6) * 0.75 + detail(x / 2, y / 2) * 0.25;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) map.set(x, y, T.TREE);
      else if (n > 0.66) map.set(x, y, T.WATER);
      else if (t > 0.63) map.set(x, y, T.TREE);
      else map.set(x, y, T.GRASS, rng() < 0.05 ? 1 : 0);
    }
  }

  // Town: a cobbled square with four houses.
  const town: Rect = { x: 37, y: 40, w: 22, h: 16 };
  for (let y = town.y - 3; y < town.y + town.h + 3; y++)
    for (let x = town.x - 3; x < town.x + town.w + 3; x++) map.set(x, y, T.GRASS, 0);
  for (let y = town.y; y < town.y + town.h; y++)
    for (let x = town.x; x < town.x + town.w; x++) map.set(x, y, T.TOWN);
  const houses = [
    { x: town.x + 2, y: town.y + 1 },
    { x: town.x + 15, y: town.y + 1 },
    { x: town.x + 2, y: town.y + 10 },
    { x: town.x + 15, y: town.y + 10 },
  ];
  const npcSpots: { x: number; y: number }[] = [];
  for (const h of houses) {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 5; x++) {
        if (y < 2) map.set(h.x + x, h.y + y, T.ROOF);
        else map.set(h.x + x, h.y + y, T.HOUSE, x === 2 && y === 3 ? 1 : x !== 2 && y === 2 ? 2 : 0);
      }
    const spot = center(h.x + 2, h.y + 4);
    npcSpots.push({ x: spot.x, y: spot.y + 2 });
  }
  const tcx = town.x + Math.floor(town.w / 2);
  const tcy = town.y + Math.floor(town.h / 2);

  // Three dungeon entrances spread around the town.
  const entrances: { x: number; y: number }[] = [];
  const baseAngle = rng() * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const a = baseAngle + (i * Math.PI * 2) / 3 + (rng() - 0.5) * 0.6;
    const d = 26 + rng() * 10;
    const ex = Math.max(6, Math.min(W - 7, Math.round(tcx + Math.cos(a) * d)));
    const ey = Math.max(6, Math.min(H - 7, Math.round(tcy + Math.sin(a) * d)));
    for (let y = ey - 2; y <= ey + 2; y++) for (let x = ex - 2; x <= ex + 2; x++) map.set(x, y, T.GRASS, 0);
    map.set(ex, ey, T.ENTRANCE);
    entrances.push({ x: ex, y: ey });
    carvePath(map, rng, tcx, tcy, ex, ey + 1);
  }
  // Roads through town are cobble already; make the cross street visible.
  for (let x = town.x; x < town.x + town.w; x++) map.set(x, tcy, T.PATH);
  for (let y = town.y; y < town.y + town.h; y++) map.set(tcx, y, T.PATH);

  // Wandering monsters live away from town.
  const enemySpawns: { x: number; y: number }[] = [];
  let guard = 0;
  while (enemySpawns.length < 14 && guard++ < 5000) {
    const x = randInt(rng, 4, W - 5);
    const y = randInt(rng, 4, H - 5);
    if (map.get(x, y) !== T.GRASS) continue;
    if (Math.hypot(x - tcx, y - tcy) < 18) continue;
    if (entrances.some((e) => Math.hypot(e.x - x, e.y - y) < 5)) continue;
    enemySpawns.push(center(x, y));
  }

  return {
    map,
    spawn: center(tcx, tcy),
    town,
    npcSpots,
    entrances: entrances.map((e) => center(e.x, e.y)),
    enemySpawns,
  };
}

function carvePath(map: TileMap, rng: RNG, x0: number, y0: number, x1: number, y1: number) {
  let x = x0;
  let y = y0;
  const paint = (px: number, py: number) => {
    const t = map.get(px, py);
    if (t === T.TOWN || t === T.HOUSE || t === T.ROOF || t === T.ENTRANCE || t === T.PATH) return;
    if (px < 2 || py < 2 || px >= map.w - 2 || py >= map.h - 2) return;
    map.set(px, py, t === T.WATER || t === T.BRIDGE ? T.BRIDGE : T.PATH);
  };
  let guard = 0;
  while ((x !== x1 || y !== y1) && guard++ < 1000) {
    const dx = x1 - x;
    const dy = y1 - y;
    const horiz = Math.abs(dx) > 0 && (Math.abs(dy) === 0 || rng() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy)));
    if (horiz) x += Math.sign(dx);
    else y += Math.sign(dy);
    paint(x, y);
    paint(x + 1, y);
    paint(x, y + 1);
  }
}

// ---------------------------------------------------------------- dungeons

export interface DungeonRoom extends Rect {
  isBoss: boolean;
  isStart: boolean;
  doors: { x: number; y: number }[]; // tiles in the wall ring that corridors pass through
}

export interface DungeonLayout {
  map: TileMap;
  rooms: DungeonRoom[];
  start: { x: number; y: number }; // world px
}

export function generateDungeon(seed: number, index: number): DungeonLayout {
  const rng = mulberry32(seed ^ (0x9e3779b1 * (index + 1)));
  const roomCount = randInt(rng, 3, 5);
  const H = 44;
  const specs: Rect[] = [];
  let cx = 3;
  for (let i = 0; i < roomCount; i++) {
    const boss = i === roomCount - 1;
    const start = i === 0;
    const w = boss ? 21 : start ? 11 : randInt(rng, 14, 18);
    const h = boss ? 17 : start ? 9 : randInt(rng, 11, 14);
    const y = Math.max(2, Math.min(H - h - 2, Math.floor(H / 2 - h / 2) + randInt(rng, -6, 6)));
    specs.push({ x: cx, y, w, h });
    cx += w + randInt(rng, 5, 8);
  }
  const W = cx + 2;
  const map = new TileMap(W, H, T.VOID);
  const rooms: DungeonRoom[] = specs.map((r, i) => ({
    ...r,
    isBoss: i === specs.length - 1,
    isStart: i === 0,
    doors: [],
  }));

  for (const r of rooms)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) map.set(x, y, T.FLOOR, rng() < 0.08 ? 1 : 0);

  // L-shaped 3-wide corridors between consecutive rooms.
  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i];
    const b = rooms[i + 1];
    const ay = a.y + Math.floor(a.h / 2);
    const by = b.y + Math.floor(b.h / 2);
    const mx = a.x + a.w + Math.floor((b.x - (a.x + a.w)) / 2);
    const carve = (x: number, y: number) => {
      for (let d = -1; d <= 1; d++) {
        if (map.get(x, y + d) === T.VOID) map.set(x, y + d, T.FLOOR);
      }
    };
    const carveV = (x: number, y: number) => {
      for (let d = -1; d <= 1; d++) if (map.get(x + d, y) === T.VOID) map.set(x + d, y, T.FLOOR);
    };
    for (let x = a.x + a.w; x <= mx; x++) carve(x, ay);
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carveV(mx, y);
    for (let x = mx; x < b.x; x++) carve(x, by);
    for (let d = -1; d <= 1; d++) {
      a.doors.push({ x: a.x + a.w, y: ay + d });
      b.doors.push({ x: b.x - 1, y: by + d });
    }
  }

  // Walls around every floor tile.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (map.get(x, y) !== T.VOID) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++) if (map.get(x + dx, y + dy) === T.FLOOR) near = true;
      if (near) map.set(x, y, T.WALL);
    }

  // Pillars give cover in combat rooms.
  for (const r of rooms) {
    if (r.isStart || r.isBoss) continue;
    const opts = [
      [3, 3],
      [r.w - 4, 3],
      [3, r.h - 4],
      [r.w - 4, r.h - 4],
    ];
    for (const [px, py] of opts) if (rng() < 0.6) map.set(r.x + px, r.y + py, T.WALL);
  }
  const boss = rooms[rooms.length - 1];
  for (const [px, py] of [
    [4, 4],
    [boss.w - 5, 4],
    [4, boss.h - 5],
    [boss.w - 5, boss.h - 5],
  ])
    map.set(boss.x + px, boss.y + py, T.WALL);

  const s = rooms[0];
  return { map, rooms, start: center(s.x + 2, s.y + Math.floor(s.h / 2)) };
}

export function randomFloorInRoom(map: TileMap, room: Rect, rng: RNG, avoid: { x: number; y: number }, minDist: number) {
  for (let i = 0; i < 60; i++) {
    const tx = randInt(rng, room.x + 1, room.x + room.w - 2);
    const ty = randInt(rng, room.y + 1, room.y + room.h - 2);
    if (map.get(tx, ty) !== T.FLOOR) continue;
    const p = center(tx, ty);
    if (Math.hypot(p.x - avoid.x, p.y - avoid.y) < minDist) continue;
    return p;
  }
  return center(room.x + Math.floor(room.w / 2), room.y + 2);
}

