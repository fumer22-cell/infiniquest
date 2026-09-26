const ALIASES: Record<string, string> = {
  arrowup: 'w',
  arrowleft: 'a',
  arrowdown: 's',
  arrowright: 'd',
};

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouse = { x: 0, y: 0, down: false }; // canvas pixel coords

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      const k = this.keyName(e);
      if (isTyping(e.target) && k !== 'escape' && k !== 'f1') return;
      if (k === 'f1' || k === ' ' || k === 'tab') e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(this.keyName(e)));
    window.addEventListener('blur', () => this.reset());
    canvas.addEventListener('mousemove', (e) => this.track(e));
    canvas.addEventListener('mousedown', (e) => {
      this.track(e);
      if (e.button === 0) this.mouse.down = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private keyName(e: KeyboardEvent): string {
    // Use physical keys for WASD so non-QWERTY layouts still work.
    if (e.code === 'KeyW') return 'w';
    if (e.code === 'KeyA') return 'a';
    if (e.code === 'KeyS') return 's';
    if (e.code === 'KeyD') return 'd';
    const k = e.key.toLowerCase();
    return ALIASES[k] ?? k;
  }

  private track(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) * this.canvas.width) / r.width;
    this.mouse.y = ((e.clientY - r.top) * this.canvas.height) / r.height;
  }

  down(k: string): boolean {
    return this.keys.has(k);
  }

  wasPressed(k: string): boolean {
    return this.pressed.has(k);
  }

  endFrame() {
    this.pressed.clear();
  }

  reset() {
    this.keys.clear();
    this.pressed.clear();
    this.mouse.down = false;
  }
}
