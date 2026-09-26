// DOM overlays: title, loading, narration, dialogue, inventory, pause, death, debug, toasts.
import type { EquipSlot, Inventory } from './inventory';
import { RARITY_COLORS, describeEffects, type Item } from './items';
import { itemIconURL } from './sprites';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export interface DialogueHandlers {
  onSend(text: string): void;
  onClose(): void;
}

export interface InventoryHandlers {
  onEquip(bagIndex: number): void;
  onUnequip(slot: EquipSlot): void;
  onUse(bagIndex: number): void;
  onDrop(bagIndex: number): void;
  onClose(): void;
}

export class UI {
  private title = el('div', 'screen title-screen hidden');
  private loading = el('div', 'loading hidden');
  private loadingText = el('div', 'loading-text');
  private narration = el('div', 'modal narration hidden');
  private narrationText = el('div', 'narration-text');
  private narrationTitle = el('div', 'narration-title');
  private narrationQueue: { title: string; text: string; resolve: () => void }[] = [];
  private dialogue = el('div', 'dialogue hidden');
  private dialogueLog = el('div', 'dialogue-log');
  private dialogueInput = el('input', 'dialogue-input');
  private dialogueHeader = el('div', 'dialogue-header');
  private dialogueHandlers: DialogueHandlers | null = null;
  private dialogueBusyFlag = false;
  private inventory = el('div', 'modal inventory hidden');
  private invHandlers: InventoryHandlers | null = null;
  private pause = el('div', 'modal pause hidden');
  private death = el('div', 'screen death hidden');
  private debug = el('pre', 'debug hidden');
  private toasts = el('div', 'toasts');

  constructor(private root: HTMLElement) {
    for (const e of [this.toasts, this.dialogue, this.narration, this.inventory, this.pause, this.death, this.loading, this.title, this.debug])
      root.appendChild(e);

    this.loading.append(el('div', 'spinner'), this.loadingText);

    this.narration.append(this.narrationTitle, this.narrationText, el('div', 'hint', 'Click, Enter or Space to continue'));
    this.narration.addEventListener('click', () => this.advanceNarration());
    window.addEventListener('keydown', (e) => {
      if (this.narrationOpen && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.advanceNarration();
      }
    });

    this.dialogueInput.type = 'text';
    this.dialogueInput.maxLength = 240;
    this.dialogueInput.placeholder = 'Say something... (Enter to send, Esc to leave)';
    this.dialogueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendDialogue();
      }
    });
    const row = el('div', 'dialogue-row');
    row.append(
      this.dialogueInput,
      button('Say', () => this.sendDialogue()),
      button('Leave', () => this.dialogueHandlers?.onClose(), 'btn secondary'),
    );
    this.dialogue.append(this.dialogueHeader, this.dialogueLog, row);
  }

  // ------------------------------------------------------------ state

  get narrationOpen() {
    return !this.narration.classList.contains('hidden');
  }
  get dialogueOpen() {
    return !this.dialogue.classList.contains('hidden');
  }
  get inventoryOpen() {
    return !this.inventory.classList.contains('hidden');
  }
  get pauseOpen() {
    return !this.pause.classList.contains('hidden');
  }
  get loadingOpen() {
    return !this.loading.classList.contains('hidden');
  }
  get deathOpen() {
    return !this.death.classList.contains('hidden');
  }
  get titleOpen() {
    return !this.title.classList.contains('hidden');
  }

  /** True when the world simulation should be paused. */
  get blocking() {
    return this.narrationOpen || this.dialogueOpen || this.inventoryOpen || this.pauseOpen || this.loadingOpen || this.deathOpen || this.titleOpen;
  }

  // ------------------------------------------------------------ title

  showTitle(opts: { hasSave: boolean; aiLabel: string; online: boolean }, onNew: (name: string, seed: string) => void, onContinue: () => void) {
    this.title.replaceChildren();
    const box = el('div', 'title-box');
    box.append(el('h1', 'logo', 'INFINIQUEST'), el('div', 'subtitle', 'an AI game-mastered bullet hell RPG'));
    const name = el('input', 'field');
    name.placeholder = 'Your name';
    name.maxLength = 20;
    name.value = 'Wren';
    const seed = el('input', 'field');
    seed.placeholder = 'World seed (optional)';
    seed.maxLength = 24;
    const start = () => onNew(name.value.trim() || 'Wren', seed.value.trim());
    name.addEventListener('keydown', (e) => e.key === 'Enter' && start());
    seed.addEventListener('keydown', (e) => e.key === 'Enter' && start());
    const buttons = el('div', 'title-buttons');
    buttons.append(button('New Game', start));
    if (opts.hasSave) buttons.append(button('Continue', onContinue, 'btn secondary'));
    box.append(el('label', '', 'Name'), name, el('label', '', 'Seed'), seed, buttons);
    const status = el('div', `ai-status ${opts.online ? 'online' : 'offline'}`, opts.aiLabel);
    if (!opts.online) status.title = 'No API key on the server (or server not running): using canned offline responses.';
    const help = el('div', 'controls-help');
    help.innerHTML =
      '<b>WASD</b> move &nbsp; <b>Mouse</b> aim &nbsp; <b>Hold click</b> shoot<br><b>E</b> talk / enter &nbsp; <b>I</b> inventory &nbsp; <b>1-3</b> consumables &nbsp; <b>Esc</b> pause &nbsp; <b>F1</b> world sheet';
    box.append(status, help);
    this.title.append(box);
    this.title.classList.remove('hidden');
    setTimeout(() => name.focus(), 50);
  }

  hideTitle() {
    this.title.classList.add('hidden');
  }

  // ---------------------------------------------------------- loading

  setLoading(on: boolean, text = 'The Game Master is weaving fate...') {
    this.loadingText.textContent = text;
    this.loading.classList.toggle('hidden', !on);
  }

  // -------------------------------------------------------- narration

  narrate(text: string, title = ''): Promise<void> {
    if (!text) return Promise.resolve();
    return new Promise((resolve) => {
      this.narrationQueue.push({ title, text, resolve });
      if (!this.narrationOpen) this.showNextNarration();
    });
  }

  private showNextNarration() {
    const n = this.narrationQueue[0];
    if (!n) {
      this.narration.classList.add('hidden');
      return;
    }
    this.narrationTitle.textContent = n.title;
    this.narrationTitle.style.display = n.title ? '' : 'none';
    this.narrationText.textContent = n.text;
    this.narration.classList.remove('hidden');
  }

  private advanceNarration() {
    const n = this.narrationQueue.shift();
    n?.resolve();
    this.showNextNarration();
  }

  // --------------------------------------------------------- dialogue

  openDialogue(npc: { name: string; role: string; attitude: string; icon: string }, handlers: DialogueHandlers) {
    this.dialogueHandlers = handlers;
    this.dialogueHeader.replaceChildren();
    const img = el('img', 'portrait');
    img.src = npc.icon;
    const info = el('div', 'dialogue-info');
    info.append(el('div', 'npc-name', npc.name), el('div', 'npc-role', `${npc.role} · ${npc.attitude}`));
    this.dialogueHeader.append(img, info);
    this.dialogueLog.replaceChildren();
    this.dialogueInput.value = '';
    this.dialogue.classList.remove('hidden');
    this.setDialogueBusy(false);
  }

  setDialogueAttitude(role: string, attitude: string) {
    const r = this.dialogueHeader.querySelector('.npc-role');
    if (r) r.textContent = `${role} · ${attitude}`;
  }

  closeDialogue() {
    this.dialogue.classList.add('hidden');
    this.dialogueHandlers = null;
    this.dialogueInput.blur();
  }

  dialogueAdd(kind: 'npc' | 'player' | 'narration' | 'system', text: string, speaker = '') {
    if (!text) return;
    const line = el('div', `line ${kind}`);
    if (speaker) line.append(el('span', 'speaker', speaker + ': '));
    line.append(document.createTextNode(text));
    this.dialogueLog.append(line);
    this.dialogueLog.scrollTop = this.dialogueLog.scrollHeight;
  }

  setDialogueBusy(busy: boolean) {
    this.dialogueBusyFlag = busy;
    this.dialogueInput.disabled = busy;
    this.dialogue.classList.toggle('busy', busy);
    const existing = this.dialogueLog.querySelector('.typing');
    if (busy && !existing) {
      this.dialogueLog.append(el('div', 'line typing', '...'));
      this.dialogueLog.scrollTop = this.dialogueLog.scrollHeight;
    } else if (!busy) {
      existing?.remove();
      setTimeout(() => this.dialogueOpen && this.dialogueInput.focus(), 0);
    }
  }

  private sendDialogue() {
    if (this.dialogueBusyFlag) return;
    const t = this.dialogueInput.value.trim();
    if (!t) return;
    this.dialogueInput.value = '';
    this.dialogueHandlers?.onSend(t);
  }

  // -------------------------------------------------------- inventory

  openInventory(inv: Inventory, handlers: InventoryHandlers) {
    this.invHandlers = handlers;
    this.renderInventory(inv);
    this.inventory.classList.remove('hidden');
  }

  closeInventory() {
    this.inventory.classList.add('hidden');
    this.invHandlers = null;
  }

  renderInventory(inv: Inventory) {
    const h = this.invHandlers;
    if (!h) return;
    this.inventory.replaceChildren();
    const head = el('div', 'inv-head');
    head.append(el('h2', '', 'Inventory'), button('Close (I)', () => h.onClose(), 'btn secondary'));
    this.inventory.append(head);
    const detail = el('div', 'inv-detail', 'Hover an item to inspect it. Click to equip / use.');

    const slotBox = (item: Item | null, label: string, onClick: (() => void) | null, extra?: HTMLElement) => {
      const s = el('div', 'slot' + (item ? ' filled' : ''));
      s.append(el('div', 'slot-label', label));
      if (item) {
        const img = el('img', 'slot-icon');
        img.src = itemIconURL(item.slot, item.color);
        s.style.borderColor = RARITY_COLORS[item.rarity];
        s.append(img);
        s.addEventListener('mouseenter', () => this.describeItem(detail, item));
        if (onClick) s.addEventListener('click', onClick);
        if (extra) s.append(extra);
      }
      return s;
    };

    const equip = el('div', 'inv-equip');
    equip.append(
      slotBox(inv.equip.weapon, 'Weapon', () => h.onUnequip('weapon')),
      slotBox(inv.equip.charm1, 'Charm', () => h.onUnequip('charm1')),
      slotBox(inv.equip.charm2, 'Charm', () => h.onUnequip('charm2')),
    );
    const bag = el('div', 'inv-bag');
    inv.bag.forEach((it, i) => {
      const drop = button('×', () => h.onDrop(i), 'drop-btn');
      drop.title = 'Drop';
      bag.append(slotBox(it, `${i + 1}`, it ? () => (it.slot === 'consumable' ? h.onUse(i) : h.onEquip(i)) : null, drop));
    });
    this.inventory.append(el('div', 'inv-sub', 'Equipped (click to unequip)'), equip, el('div', 'inv-sub', 'Bag'), bag, detail);
  }

  private describeItem(target: HTMLElement, it: Item) {
    target.replaceChildren();
    const name = el('div', 'item-name', it.name);
    name.style.color = it.color;
    target.append(
      name,
      el('div', 'item-meta', `${it.rarity} ${it.slot}`),
      el('div', 'item-desc', it.description),
      el('div', 'item-effects', describeEffects(it.effects).join(' · ')),
    );
    (target.querySelector('.item-meta') as HTMLElement).style.color = RARITY_COLORS[it.rarity];
  }

  // ------------------------------------------------------------ pause

  openPause(h: { onResume(): void; onSave(): void; onLoad(): void; onQuit(): void }, canLoad: boolean) {
    this.pause.replaceChildren();
    this.pause.append(el('h2', '', 'Paused'));
    const col = el('div', 'menu-col');
    col.append(button('Resume', h.onResume), button('Save Game', h.onSave), button('Load Game', h.onLoad, canLoad ? 'btn' : 'btn disabled'), button('Quit to Title', h.onQuit, 'btn secondary'));
    this.pause.append(col, el('div', 'hint', 'F1 toggles the world sheet (debug)'));
    this.pause.classList.remove('hidden');
  }

  closePause() {
    this.pause.classList.add('hidden');
  }

  // ------------------------------------------------------------ death

  showDeath(text: string, onContinue: () => void) {
    this.death.replaceChildren();
    const box = el('div', 'death-box');
    box.append(el('h1', '', 'You have fallen'), el('p', '', text), button('Rise again in town', () => {
      this.death.classList.add('hidden');
      onContinue();
    }));
    this.death.append(box);
    this.death.classList.remove('hidden');
  }

  // ------------------------------------------------------------ debug

  toggleDebug(): boolean {
    this.debug.classList.toggle('hidden');
    return !this.debug.classList.contains('hidden');
  }

  get debugOpen() {
    return !this.debug.classList.contains('hidden');
  }

  setDebug(text: string) {
    if (this.debug.textContent !== text) this.debug.textContent = text;
  }

  // ----------------------------------------------------------- toasts

  toast(text: string, color = '#f4f0e8') {
    const t = el('div', 'toast', text);
    t.style.color = color;
    this.toasts.append(t);
    setTimeout(() => t.classList.add('fade'), 2600);
    setTimeout(() => t.remove(), 3200);
    while (this.toasts.children.length > 5) this.toasts.firstChild?.remove();
  }

  get rootEl() {
    return this.root;
  }
}
