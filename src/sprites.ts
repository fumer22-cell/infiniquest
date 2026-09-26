import { hash2, mulberry32 } from './rng';
import { T } from './worldgen';

// ------------------------------------------------------------------ colors

export const OUTLINE = '#120b18';

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** amt < 0 darkens toward black, amt > 0 lightens toward white. */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (amt < 0) return rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}

/** Push a color toward high saturation/brightness so bullets pop on dark floors. */
export function brighten(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b, 1);
  const k = 235 / max;
  return rgbToHex(r * k, g * k, b * k);
}

// ----------------------------------------------------------- sprite art
// 8x8 art. '.' is transparent. Letters map to palette slots in getSprite().
// A 1px dark outline is added automatically, so each sprite renders at 10x10.

const ART: Record<string, string[]> = {
  hero: [
    '..hhhh..',
    '.hhhhhh.',
    '.hskssk.',
    '..ssss..',
    '.ccwwcc.',
    'scccccs.',
    '.cccccc.',
    '..l..l..',
  ],
  slime: [
    '........',
    '...aa...',
    '..aaaa..',
    '.aawaaa.',
    '.akaaka.',
    'aaaaaaaa',
    'abbbbbba',
    '.bbbbbb.',
  ],
  skull: [
    '..aaaa..',
    '.aaaaaa.',
    '.akkakk.',
    '.akkakk.',
    '.aaaaaa.',
    '..abba..',
    '..akka..',
    '..a..a..',
  ],
  bat: [
    '........',
    'a......a',
    'aa.aa.aa',
    'aaaaaaaa',
    '.aawwaa.',
    '..abba..',
    '...bb...',
    '........',
  ],
  eye: [
    '..aaaa..',
    '.awwwwa.',
    'awwkkwwa',
    'awwkkwwa',
    '.awwwwa.',
    '..aaaa..',
    '...b.b..',
    '..b...b.',
  ],
  knight: [
    '..aaaa..',
    '.aaaaaa.',
    '.akkkka.',
    '.aaaaaa.',
    'bbaaaabb',
    'b.aaaa.b',
    '..a..a..',
    '.bb..bb.',
  ],
  imp: [
    'a......a',
    '.a.aa.a.',
    '..aaaa..',
    '.awaawa.',
    '.aaaaaa.',
    '..abba..',
    '.a.aa.a.',
    '.a....a.',
  ],
  golem: [
    '.aaaaaa.',
    'aabaabaa',
    'aawaawaa',
    'aaaaaaaa',
    'baabbaab',
    'baaaaaab',
    '.aa..aa.',
    '.bb..bb.',
  ],
  wraith: [
    '..aaaa..',
    '.aaaaaa.',
    '.awaawa.',
    '.aaaaaa.',
    'aaaaaaaa',
    'abaaaaba',
    'a.b.ab.a',
    '....a...',
  ],
  heart: [
    '........',
    '.aa..aa.',
    'awaaaaaa',
    'aaaaaaaa',
    '.aaaaaa.',
    '..aaaa..',
    '...aa...',
    '........',
  ],
  shield: [
    '...aa...',
    '..aaaa..',
    '.awaaaa.',
    'awaaaaaa',
    'aaaaaaab',
    '.aaaaab.',
    '..aabb..',
    '...bb...',
  ],
  weapon: [
    '......aw',
    '.....aaa',
    '....nba.',
    '...nn...',
    '..nn....',
    '.nn.....',
    'nn......',
    'n.......',
  ],
  charm: [
    '.yy..yy.',
    'y......y',
    'y......y',
    '.y....y.',
    '..yaay..',
    '..awab..',
    '..abbb..',
    '...bb...',
  ],
  consumable: [
    '...nn...',
    '...gg...',
    '..g..g..',
    '.gaaaag.',
    'gawaaaag',
    'gaaaaabg',
    '.gabbbg.',
    '..gggg..',
  ],
};

export const ENEMY_SPRITES = ['slime', 'skull', 'bat', 'eye', 'knight', 'imp', 'golem', 'wraith'] as const;
export type EnemySpriteName = (typeof ENEMY_SPRITES)[number];

export interface Sprite {
  img: HTMLCanvasElement;
  flash: HTMLCanvasElement;
  size: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function buildSprite(rows: string[], pal: Record<string, string>): Sprite {
  const S = 10;
  const grid: (string | null)[] = new Array(S * S).fill(null);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const ch = rows[y]?.[x] ?? '.';
      if (ch !== '.' && pal[ch]) grid[(y + 1) * S + x + 1] = pal[ch];
    }
  const filled = grid.map((c) => c !== null);
  const img = makeCanvas(S, S);
  const flash = makeCanvas(S, S);
  const ic = img.getContext('2d')!;
  const fc = flash.getContext('2d')!;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (filled[i]) {
        ic.fillStyle = grid[i]!;
        ic.fillRect(x, y, 1, 1);
        fc.fillStyle = '#ffffff';
        fc.fillRect(x, y, 1, 1);
        continue;
      }
      const n =
        (x > 0 && filled[i - 1]) ||
        (x < S - 1 && filled[i + 1]) ||
        (y > 0 && filled[i - S]) ||
        (y < S - 1 && filled[i + S]);
      if (n) {
        ic.fillStyle = OUTLINE;
        ic.fillRect(x, y, 1, 1);
        fc.fillStyle = OUTLINE;
        fc.fillRect(x, y, 1, 1);
      }
    }
  return { img, flash, size: S };
}

const spriteCache = new Map<string, Sprite>();

export function getSprite(name: string, primary: string, secondary?: string): Sprite {
  const key = `${name}|${primary}|${secondary ?? ''}`;
  let s = spriteCache.get(key);
  if (!s) {
    const rows = ART[name] ?? ART.slime;
    s = buildSprite(rows, {
      a: primary,
      b: shade(primary, -0.4),
      h: primary,
      c: secondary ?? shade(primary, 0.3),
      s: '#f2c79a',
      k: '#1a1020',
      w: '#f4f0e8',
      l: '#2c2436',
      n: '#8a5a30',
      y: '#e8c850',
      g: '#c8dcec',
    });
    spriteCache.set(key, s);
  }
  return s;
}

/** Deterministic outfit colors for an NPC id. */
export function npcColors(id: string): [string, string] {
  const hats = ['#c0392b', '#8e44ad', '#2e86c1', '#d68910', '#1e8449', '#a04000', '#5d6d7e', '#cb4335'];
  const coats = ['#6c3483', '#1f618d', '#7d6608', '#196f3d', '#784212', '#922b21', '#34495e', '#5b2c6f'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return [hats[h % hats.length], coats[(h >> 3) % coats.length]];
}

// ------------------------------------------------------------------ items

const iconCache = new Map<string, string>();

/** An 8x8 icon (with outline) for an item, returned as a data URL for the DOM. */
export function itemIconURL(slot: string, color: string): string {
  const key = `${slot}|${color}`;
  let url = iconCache.get(key);
  if (!url) {
    const s = getSprite(ART[slot] ? slot : 'charm', color);
    url = s.img.toDataURL();
    iconCache.set(key, url);
  }
  return url;
}

// ------------------------------------------------------------------ tiles

export interface DungeonPalette {
  floor: string;
  floor2: string;
  wall: string;
  wallTop: string;
  door: string;
}

export const DUNGEON_PALETTES: Record<string, DungeonPalette> = {
  crypt: { floor: '#24212b', floor2: '#2c2835', wall: '#4d4558', wallTop: '#675d75', door: '#a07a30' },
  cavern: { floor: '#2a2119', floor2: '#33291f', wall: '#5a4630', wallTop: '#735a3e', door: '#9c6b2c' },
  ember: { floor: '#2a1616', floor2: '#341b1a', wall: '#5e2a22', wallTop: '#7c3a2c', door: '#c06020' },
  frost: { floor: '#18212e', floor2: '#1d2838', wall: '#3a5270', wallTop: '#577497', door: '#7ab0d0' },
  swamp: { floor: '#18241a', floor2: '#1e2c1f', wall: '#34503a', wallTop: '#4a6b4e', door: '#8a9a40' },
  void: { floor: '#16121f', floor2: '#1c1628', wall: '#3a2a55', wallTop: '#553f7a', door: '#b050d0' },
};

type Painter = (px: (x: number, y: number, c: string) => void, fill: (c: string) => void) => void;

function paint(fn: Painter): HTMLCanvasElement {
  const c = makeCanvas(8, 8);
  const g = c.getContext('2d')!;
  fn(
    (x, y, col) => {
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    },
    (col) => {
      g.fillStyle = col;
      g.fillRect(0, 0, 8, 8);
    },
  );
  return c;
}

function speckle(px: (x: number, y: number, c: string) => void, seed: number, n: number, colors: string[]) {
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) px(Math.floor(r() * 8), Math.floor(r() * 8), colors[i % colors.length]);
}

const tileCache = new Map<string, HTMLCanvasElement>();

/**
 * Tile image for a tile id. `v` is the per-tile variant stored in the map, `pos` a
 * per-position hash so repeated tiles don't look stamped, `frame` animates water.
 */
export function getTile(id: number, v: number, pos: number, frame: number, pal: string): HTMLCanvasElement {
  const alt = pos % 4;
  const key = `${id}|${v}|${alt}|${id === T.WATER ? frame : 0}|${id >= T.FLOOR ? pal : ''}`;
  let c = tileCache.get(key);
  if (c) return c;
  const dp = DUNGEON_PALETTES[pal] ?? DUNGEON_PALETTES.crypt;
  switch (id) {
    case T.GRASS:
      c = paint((px, fill) => {
        fill('#2b5226');
        speckle(px, 11 + alt, 6, ['#346030', '#244620']);
        if (v === 1) {
          px(2, 2, '#e8d04a');
          px(5, 5, '#e87aa8');
          px(6, 2, '#f4f0e8');
        }
      });
      break;
    case T.WATER:
      c = paint((px, fill) => {
        fill('#18365f');
        const o = (frame + alt) % 8;
        for (let i = 0; i < 3; i++) {
          px((o + i) % 8, 2, '#2b5791');
          px((o + i + 4) % 8, 6, '#2b5791');
        }
        px((o + 1) % 8, 2, '#5d8cc8');
      });
      break;
    case T.TREE:
      c = paint((px, fill) => {
        fill('#2b5226');
        px(3, 7, '#4a3020');
        px(4, 7, '#4a3020');
        px(3, 6, '#5a3a22');
        px(4, 6, '#5a3a22');
        for (let y = 0; y < 7; y++)
          for (let x = 0; x < 8; x++) {
            const d = Math.hypot(x - 3.5, y - 3);
            if (d < 3.1) px(x, y, d < 1.6 && x < 4 && y < 3 ? '#3a7a34' : '#1e4a1e');
            else if (d < 3.9) px(x, y, '#0e2410');
          }
        if (alt === 1) px(5, 2, '#3a7a34');
      });
      break;
    case T.PATH:
      c = paint((px, fill) => {
        fill('#6e5a3c');
        speckle(px, 21 + alt, 7, ['#7d6947', '#5e4c32']);
      });
      break;
    case T.BRIDGE:
      c = paint((px, fill) => {
        fill('#6b4a2a');
        for (let x = 0; x < 8; x++) {
          px(x, 0, '#3e2a18');
          px(x, 3, '#4e361e');
          px(x, 7, '#3e2a18');
        }
        px(2 + alt, 5, '#7e5a34');
      });
      break;
    case T.TOWN:
      c = paint((px, fill) => {
        fill('#524e5a');
        for (let x = 0; x < 8; x++) {
          px(x, 0, '#403c48');
          px(x, 4, '#403c48');
        }
        for (let y = 0; y < 4; y++) {
          px(alt % 2 ? 2 : 5, y, '#403c48');
          px(alt % 2 ? 6 : 1, y + 4, '#403c48');
        }
        px(3, 2, '#5e5a66');
      });
      break;
    case T.HOUSE:
      c = paint((px, fill) => {
        fill('#8c6a48');
        for (let y = 0; y < 8; y++) px(0, y, '#5a4028');
        for (let x = 0; x < 8; x++) px(x, 7, '#5a4028');
        if (v === 1) {
          for (let y = 2; y < 8; y++) for (let x = 2; x < 6; x++) px(x, y, '#3a2416');
          px(4, 5, '#e8c850');
        } else if (v === 2) {
          for (let y = 2; y < 5; y++) for (let x = 2; x < 6; x++) px(x, y, '#f0d070');
          px(3, 2, '#5a4028');
          px(3, 3, '#5a4028');
          px(3, 4, '#5a4028');
        }
      });
      break;
    case T.ROOF:
      c = paint((px, fill) => {
        fill('#8e3030');
        for (let x = 0; x < 8; x++) {
          px(x, 1, '#6e2020');
          px(x, 5, '#6e2020');
          px(x, 3, '#a84040');
        }
        px((alt * 2) % 8, 3, '#6e2020');
      });
      break;
    case T.ENTRANCE:
      c = paint((px, fill) => {
        fill('#2a2430');
        for (let y = 0; y < 8; y++) {
          px(0, y, '#6a6078');
          px(7, y, '#6a6078');
        }
        for (let x = 0; x < 8; x++) px(x, 0, '#6a6078');
        for (let y = 1; y < 8; y++) for (let x = 1; x < 7; x++) px(x, y, y % 2 ? '#141018' : '#3a3048');
        if (v === 1) {
          px(3, 3, '#60e080');
          px(4, 5, '#60e080');
        }
      });
      break;
    case T.FLOOR:
      c = paint((px, fill) => {
        fill(dp.floor);
        speckle(px, 31 + alt, 4, [dp.floor2]);
        if (alt === 0) {
          for (let x = 0; x < 8; x++) px(x, 7, dp.floor2);
        }
        if (v === 1) {
          px(2, 3, shade(dp.floor, -0.4));
          px(3, 4, shade(dp.floor, -0.4));
          px(4, 4, shade(dp.floor, -0.4));
        }
      });
      break;
    case T.WALL:
      c = paint((px, fill) => {
        fill(dp.wall);
        for (let x = 0; x < 8; x++) {
          px(x, 0, dp.wallTop);
          px(x, 1, dp.wallTop);
          px(x, 4, shade(dp.wall, -0.3));
          px(x, 7, shade(dp.wall, -0.45));
        }
        px(alt % 2 ? 2 : 5, 2, shade(dp.wall, -0.3));
        px(alt % 2 ? 2 : 5, 3, shade(dp.wall, -0.3));
        px(alt % 2 ? 6 : 1, 5, shade(dp.wall, -0.3));
        px(alt % 2 ? 6 : 1, 6, shade(dp.wall, -0.3));
      });
      break;
    case T.DOOR:
      c = paint((px, fill) => {
        fill('#0c0810');
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x += 2) px(x + (y === 0 || y === 7 ? 1 : 0), y, dp.door);
        for (let x = 0; x < 8; x++) {
          px(x, 1, shade(dp.door, -0.3));
          px(x, 6, shade(dp.door, -0.3));
        }
      });
      break;
    default:
      c = paint((_px, fill) => fill('#07050a'));
  }
  tileCache.set(key, c);
  return c;
}

export function posHash(x: number, y: number): number {
  return Math.floor(hash2(1337, x, y) * 1024);
}

// ----------------------------------------------------------------- bullets

const bulletCache = new Map<string, HTMLCanvasElement>();

/** Round bullet: dark outline, saturated body, white-hot core. */
export function getBulletSprite(color: string, radius: number): HTMLCanvasElement {
  const r = Math.max(1, Math.round(radius * 2) / 2);
  const key = `${color}|${r}`;
  let c = bulletCache.get(key);
  if (c) return c;
  const S = Math.ceil(r) * 2 + 3;
  c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  const mid = (S - 1) / 2;
  const core = shade(color, 0.65);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - mid, y - mid);
      if (d <= r) {
        g.fillStyle = d <= Math.max(0.5, r - 1.2) ? core : color;
        g.fillRect(x, y, 1, 1);
      } else if (d <= r + 1) {
        g.fillStyle = OUTLINE;
        g.fillRect(x, y, 1, 1);
      }
    }
  bulletCache.set(key, c);
  return c;
}
