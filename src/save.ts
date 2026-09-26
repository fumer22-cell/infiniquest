import { SAVE_KEY } from './config';
import type { DungeonDesign } from './enemies';
import type { InventoryData } from './inventory';
import type { WorldSheet } from './worldsheet';

export interface SaveData {
  v: 1;
  savedAt: number;
  sheet: WorldSheet;
  inventory: InventoryData;
  designs: (DungeonDesign | null)[];
  cleared: boolean[];
  pos: { x: number; y: number };
  hp: number;
}

export function writeSave(data: SaveData): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('Save failed', err);
    return false;
  }
}

export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d?.v !== 1 || !d.sheet?.world) return null;
    return d;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  return readSave() !== null;
}
