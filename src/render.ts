// Canvas rendering. World is drawn in source pixels under a 5x transform with no smoothing.
import { SCALE, TILE, VIEW_H, VIEW_W } from './config';
import type { Bullet, Enemy, Particle, Pickup } from './combat';
import type { Item } from './items';
import { clamp } from './rng';
import { OUTLINE, getBulletSprite, getSprite, getTile, posHash, type Sprite } from './sprites';
import type { TileMap } from './worldgen';

export interface HudState {
  hp: number;
  maxHp: number;
  shield: number;
  place: string;
  quests: string[];
  hotbar: Item[];
  weapon: Item | null;
  prompt: string;
  aiLabel: string;
  boss: { name: string; hp: number; max: number } | null;
  banner: { title: string; sub: string; t: number } | null;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0 };
  private shakeAmt = 0;
  private sx = 0;
  private sy = 0;

  constructor(public canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W * SCALE;
    canvas.height = VIEW_H * SCALE;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  follow(x: number, y: number, map: TileMap) {
    const mw = map.w * TILE;
    const mh = map.h * TILE;
    this.cam.x = mw <= VIEW_W ? (mw - VIEW_W) / 2 : clamp(x - VIEW_W / 2, 0, mw - VIEW_W);
    this.cam.y = mh <= VIEW_H ? (mh - VIEW_H) / 2 : clamp(y - VIEW_H / 2, 0, mh - VIEW_H);
  }

  shake(a: number) {
    this.shakeAmt = Math.min(7, Math.max(this.shakeAmt, a));
  }

  update(dt: number) {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 22);
    this.sx = (Math.random() - 0.5) * this.shakeAmt;
    this.sy = (Math.random() - 0.5) * this.shakeAmt;
  }

  /** Converts a canvas pixel position to world coordinates. */
  toWorld(px: number, py: number) {
    return { x: this.cam.x + px / SCALE, y: this.cam.y + py / SCALE };
  }

  beginWorld() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#07050a';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const ox = Math.round((this.cam.x + this.sx) * SCALE);
    const oy = Math.round((this.cam.y + this.sy) * SCALE);
    c.setTransform(SCALE, 0, 0, SCALE, -ox, -oy);
    c.imageSmoothingEnabled = false;
  }

  private snap(v: number) {
    return Math.round(v * SCALE) / SCALE;
  }

  tiles(map: TileMap, palette: string, time: number) {
    const x0 = Math.max(0, Math.floor(this.cam.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(this.cam.y / TILE) - 1);
    const x1 = Math.min(map.w - 1, Math.ceil((this.cam.x + VIEW_W) / TILE) + 1);
    const y1 = Math.min(map.h - 1, Math.ceil((this.cam.y + VIEW_H) / TILE) + 1);
    const frame = Math.floor(time * 2) % 8;
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const id = map.get(tx, ty);
        if (id === 0) continue;
        this.ctx.drawImage(getTile(id, map.getVariant(tx, ty), posHash(tx, ty), frame, palette), tx * TILE, ty * TILE);
      }
  }

  sprite(s: Sprite, x: number, y: number, opts: { flash?: boolean; scale?: number; alpha?: number; flip?: boolean } = {}) {
    const c = this.ctx;
    const sc = opts.scale ?? 1;
    const size = s.size * sc;
    const dx = this.snap(x - size / 2);
    const dy = this.snap(y - size / 2);
    if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(this.snap(x - size * 0.3), this.snap(y + size * 0.38), this.snap(size * 0.6), sc);
    const img = opts.flash ? s.flash : s.img;
    if (opts.flip) {
      c.save();
      c.translate(dx + size, dy);
      c.scale(-1, 1);
      c.drawImage(img, 0, 0, size, size);
      c.restore();
    } else {
      c.drawImage(img, dx, dy, size, size);
    }
    c.globalAlpha = 1;
  }

  enemy(e: Enemy, time: number) {
    const bob = e.movement === 'stationary' ? 0 : Math.round(Math.sin(time * 8 + e.x) * 0.6);
    const alpha = e.spawnFade > 0 ? 1 - e.spawnFade / (e.boss ? 1 : 0.5) : 1;
    this.sprite(getSprite(e.sprite, e.color), e.x, e.y + bob, { flash: e.flash > 0, scale: e.scale, alpha: Math.max(0.1, alpha) });
    if (!e.boss && e.hp < e.maxHp) {
      const w = 8;
      const x = this.snap(e.x - w / 2);
      const y = this.snap(e.y + 6);
      this.ctx.fillStyle = OUTLINE;
      this.ctx.fillRect(x - 0.2, y - 0.2, w + 0.4, 1.4);
      this.ctx.fillStyle = '#ff4050';
      this.ctx.fillRect(x, y, (w * Math.max(0, e.hp)) / e.maxHp, 1);
    }
  }

  bullets(list: Bullet[], enemy: boolean) {
    const c = this.ctx;
    for (const b of list) {
      if (b.enemy !== enemy) continue;
      const img = getBulletSprite(b.color, b.r);
      c.drawImage(img, this.snap(b.x - img.width / 2), this.snap(b.y - img.height / 2));
    }
  }

  particles(list: Particle[]) {
    const c = this.ctx;
    for (const p of list) {
      c.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      c.fillStyle = p.color;
      c.fillRect(this.snap(p.x), this.snap(p.y), p.size, p.size);
    }
    c.globalAlpha = 1;
  }

  pickups(list: Pickup[], time: number) {
    for (const k of list) {
      const blink = k.t > 15 && Math.floor(time * 8) % 2 === 0;
      if (!blink) this.sprite(getSprite('heart', '#ff4060'), k.x, k.y + Math.sin(time * 4) * 1, { scale: 0.8 });
    }
  }

  portal(x: number, y: number, time: number) {
    const c = this.ctx;
    for (let i = 3; i >= 0; i--) {
      const r = 3 + i * 2 + Math.sin(time * 5 + i) * 0.8;
      c.fillStyle = ['#ffffff', '#a0f0ff', '#40a0ff', '#3040a0'][i];
      c.globalAlpha = 0.9 - i * 0.15;
      c.beginPath();
      c.arc(this.snap(x), this.snap(y), r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  hitbox(x: number, y: number) {
    const c = this.ctx;
    c.fillStyle = OUTLINE;
    c.fillRect(this.snap(x) - 1, this.snap(y) - 1, 2, 2);
    c.fillStyle = '#ffffff';
    c.fillRect(this.snap(x) - 0.6, this.snap(y) - 0.6, 1.2, 1.2);
  }

  aimCursor(x: number, y: number) {
    const c = this.ctx;
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillRect(this.snap(x) - 2, this.snap(y), 1, 0.4);
    c.fillRect(this.snap(x) + 1, this.snap(y), 1, 0.4);
    c.fillRect(this.snap(x), this.snap(y) - 2, 0.4, 1);
    c.fillRect(this.snap(x), this.snap(y) + 1, 0.4, 1);
  }

  label(text: string, x: number, y: number, color = '#f4f0e8') {
    // World-anchored text drawn at screen resolution for readability.
    const c = this.ctx;
    const t = c.getTransform();
    c.setTransform(1, 0, 0, 1, 0, 0);
    const sx = x * SCALE + t.e;
    const sy = y * SCALE + t.f;
    c.font = 'bold 14px "Courier New", monospace';
    c.textAlign = 'center';
    c.lineWidth = 4;
    c.strokeStyle = OUTLINE;
    c.strokeText(text, sx, sy);
    c.fillStyle = color;
    c.fillText(text, sx, sy);
    c.setTransform(t);
  }

  // ------------------------------------------------------------------ HUD

  hud(h: HudState, time: number) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    const heart = getSprite('heart', '#ff3050');
    const empty = getSprite('heart', '#3b2f45');
    const lowBlink = h.hp <= 1 && Math.floor(time * 4) % 2 === 0;
    for (let i = 0; i < h.maxHp; i++) {
      const s = i < h.hp ? heart : empty;
      c.drawImage(lowBlink && i < h.hp ? s.flash : s.img, 10 + i * 34, 10, 30, 30);
    }
    const shield = getSprite('shield', '#50b0ff');
    for (let i = 0; i < h.shield; i++) c.drawImage(shield.img, 10 + (h.maxHp + i) * 34 + 6, 10, 30, 30);

    this.text(h.place, this.canvas.width / 2, 30, { align: 'center', size: 18, color: '#f0e0a0' });

    let qy = 22;
    for (const q of h.quests.slice(0, 3)) {
      const t = q.length > 30 ? q.slice(0, 29) + '…' : q;
      this.text('◆ ' + t, this.canvas.width - 12, qy, { align: 'right', size: 14, color: '#c8e8ff' });
      qy += 20;
    }

    // Consumable hotbar (keys 1-3).
    for (let i = 0; i < 3; i++) {
      const x = 12 + i * 58;
      const y = this.canvas.height - 62;
      c.fillStyle = 'rgba(10,6,16,0.75)';
      c.fillRect(x, y, 50, 50);
      c.strokeStyle = '#5a4a6a';
      c.lineWidth = 2;
      c.strokeRect(x + 1, y + 1, 48, 48);
      const it = h.hotbar[i];
      if (it) c.drawImage(getSprite('consumable', it.color).img, x + 5, y + 5, 40, 40);
      this.text(String(i + 1), x + 6, y + 16, { size: 13, color: '#e0d0f0' });
    }
    const w = h.weapon;
    this.text(w ? `Weapon: ${w.name}` : 'Weapon: Apprentice Bolt', 196, this.canvas.height - 30, {
      size: 14,
      color: w ? w.color : '#a0a0b0',
    });

    this.text(h.aiLabel, this.canvas.width - 10, this.canvas.height - 10, { align: 'right', size: 12, color: '#8a7a9a' });

    if (h.prompt) this.text(h.prompt, this.canvas.width / 2, this.canvas.height - 90, { align: 'center', size: 18, color: '#ffffff' });

    if (h.boss) {
      const bw = 480;
      const bx = (this.canvas.width - bw) / 2;
      const by = 52;
      c.fillStyle = OUTLINE;
      c.fillRect(bx - 3, by - 3, bw + 6, 18);
      c.fillStyle = '#3a1420';
      c.fillRect(bx, by, bw, 12);
      c.fillStyle = h.boss.hp <= h.boss.max / 2 ? '#ff3060' : '#e05070';
      c.fillRect(bx, by, (bw * Math.max(0, h.boss.hp)) / h.boss.max, 12);
      this.text(h.boss.name, this.canvas.width / 2, by + 34, { align: 'center', size: 16, color: '#ffd0d8' });
    }

    if (h.banner) {
      const a = Math.min(1, h.banner.t, 1);
      c.globalAlpha = Math.max(0, a);
      c.fillStyle = 'rgba(8,4,12,0.7)';
      c.fillRect(0, this.canvas.height / 2 - 70, this.canvas.width, 110);
      this.text(h.banner.title, this.canvas.width / 2, this.canvas.height / 2 - 28, { align: 'center', size: 30, color: '#ffe080' });
      this.wrapText(h.banner.sub, this.canvas.width / 2, this.canvas.height / 2 + 6, 820, 18, '#f4e8ff');
      c.globalAlpha = 1;
    }
  }

  text(s: string, x: number, y: number, o: { align?: CanvasTextAlign; size?: number; color?: string } = {}) {
    const c = this.ctx;
    c.font = `bold ${o.size ?? 14}px "Courier New", monospace`;
    c.textAlign = o.align ?? 'left';
    c.lineWidth = 4;
    c.strokeStyle = OUTLINE;
    c.strokeText(s, x, y);
    c.fillStyle = o.color ?? '#ffffff';
    c.fillText(s, x, y);
  }

  private wrapText(s: string, x: number, y: number, maxW: number, size: number, color: string) {
    const c = this.ctx;
    c.font = `bold ${size}px "Courier New", monospace`;
    const words = s.split(' ');
    let line = '';
    let yy = y;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > maxW && line) {
        this.text(line, x, yy, { align: 'center', size, color });
        line = w;
        yy += size + 4;
      } else line = test;
    }
    if (line) this.text(line, x, yy, { align: 'center', size, color });
  }
}
