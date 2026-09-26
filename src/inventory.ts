import type { Item } from './items';

export const BAG_SIZE = 8;
export type EquipSlot = 'weapon' | 'charm1' | 'charm2';

export interface InventoryData {
  bag: (Item | null)[];
  equip: Record<EquipSlot, Item | null>;
}

export class Inventory {
  bag: (Item | null)[] = new Array(BAG_SIZE).fill(null);
  equip: Record<EquipSlot, Item | null> = { weapon: null, charm1: null, charm2: null };

  freeSlot(): number {
    return this.bag.findIndex((s) => s === null);
  }

  add(item: Item): boolean {
    const i = this.freeSlot();
    if (i < 0) return false;
    this.bag[i] = item;
    return true;
  }

  /** Rewards go straight into an empty matching equip slot, else the bag. */
  receive(item: Item): 'equipped' | 'bag' | 'full' {
    if (item.slot === 'weapon' && !this.equip.weapon) {
      this.equip.weapon = item;
      return 'equipped';
    }
    if (item.slot === 'charm') {
      if (!this.equip.charm1) {
        this.equip.charm1 = item;
        return 'equipped';
      }
      if (!this.equip.charm2) {
        this.equip.charm2 = item;
        return 'equipped';
      }
    }
    return this.add(item) ? 'bag' : 'full';
  }

  equipFromBag(i: number): boolean {
    const item = this.bag[i];
    if (!item || item.slot === 'consumable') return false;
    let slot: EquipSlot = 'weapon';
    if (item.slot === 'charm') slot = !this.equip.charm1 ? 'charm1' : !this.equip.charm2 ? 'charm2' : 'charm1';
    this.bag[i] = this.equip[slot];
    this.equip[slot] = item;
    return true;
  }

  unequip(slot: EquipSlot): boolean {
    const item = this.equip[slot];
    if (!item) return false;
    const i = this.freeSlot();
    if (i < 0) return false;
    this.bag[i] = item;
    this.equip[slot] = null;
    return true;
  }

  drop(i: number): Item | null {
    const it = this.bag[i];
    this.bag[i] = null;
    return it;
  }

  removeByName(name: string): Item | null {
    const n = name.trim().toLowerCase();
    const i = this.bag.findIndex((it) => it?.name.toLowerCase() === n);
    if (i >= 0) return this.drop(i);
    for (const slot of ['weapon', 'charm1', 'charm2'] as EquipSlot[]) {
      const it = this.equip[slot];
      if (it && it.name.toLowerCase() === n) {
        this.equip[slot] = null;
        return it;
      }
    }
    return null;
  }

  /** Up to three consumables, in bag order, bound to keys 1-3. */
  hotbar(): { item: Item; bagIndex: number }[] {
    const out: { item: Item; bagIndex: number }[] = [];
    this.bag.forEach((it, i) => {
      if (it && it.slot === 'consumable' && out.length < 3) out.push({ item: it, bagIndex: i });
    });
    return out;
  }

  takeHotbar(n: number): Item | null {
    const h = this.hotbar()[n];
    return h ? this.drop(h.bagIndex) : null;
  }

  /** Compact list for the world sheet. */
  names(): string[] {
    const out: string[] = [];
    const e = this.equip;
    if (e.weapon) out.push(`${e.weapon.name} (equipped weapon)`);
    if (e.charm1) out.push(`${e.charm1.name} (equipped charm)`);
    if (e.charm2) out.push(`${e.charm2.name} (equipped charm)`);
    for (const it of this.bag) if (it) out.push(it.name);
    return out;
  }

  toJSON(): InventoryData {
    return { bag: this.bag, equip: this.equip };
  }

  static fromJSON(d: InventoryData | undefined): Inventory {
    const inv = new Inventory();
    if (!d) return inv;
    for (let i = 0; i < BAG_SIZE; i++) inv.bag[i] = d.bag?.[i] ?? null;
    inv.equip = { weapon: d.equip?.weapon ?? null, charm1: d.equip?.charm1 ?? null, charm2: d.equip?.charm2 ?? null };
    return inv;
  }
}
