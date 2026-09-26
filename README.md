# Infiniquest

A playable prototype of a top-down bullet hell RPG where **Claude is the game master**. The AI runs the story, NPC dialogue, dungeon/enemy/boss design and item creation. Plain TypeScript runs everything else: movement, combat, collisions, bullet patterns and rules. The AI is never called during combat.

- Vite + TypeScript, HTML5 Canvas, no game engine
- A small Express server proxies Claude API calls so the API key never reaches the browser
- **Offline mode:** with no API key, a canned game master takes over, so the game is always playable

## Setup and run

Requires Node 20+.

```bash
npm install
cp .env.example .env      # optional: add ANTHROPIC_API_KEY=sk-ant-...
npm run dev               # starts the API proxy (port 8787) and the game (port 5173)
```

Open http://localhost:5173.

- With no `ANTHROPIC_API_KEY` in `.env`, the server logs `OFFLINE mode` and the title screen shows **AI offline**. Everything still works using canned responses.
- The model is set in one place, `server/config.ts` (`MODEL`, default `claude-sonnet-5`). You can also override it with `CLAUDE_MODEL` in `.env`.
- The proxy only listens on `127.0.0.1`.

Other scripts: `npm run typecheck`, `npm run build`.

### Play as a claude.ai artifact (no server, no API key)

```bash
npm run build:artifact    # writes dist/infiniquest-artifact.html (JS + CSS inlined)
```

Publish that file as a claude.ai artifact with the `sample` capability. Inside an artifact, the game calls Claude through the viewer's own claude.ai account (`claude.use("sample")`) instead of the local proxy. The first AI call asks the viewer for permission. If they decline, or Claude is unavailable, the game uses offline mode.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | move |
| Mouse | aim |
| Hold left click | shoot |
| E | talk to NPC / enter dungeon / use portal |
| I | inventory (click to equip, unequip or use; × drops an item) |
| 1-3 | use consumables (the first three in your bag) |
| Esc | pause (save, load, quit) / close dialogs |
| F1 | debug overlay: the live world sheet and the last raw AI response |

## How to play the prototype loop

1. **New Game:** the AI invents the main threat, 2 factions and 4 town NPCs, then narrates the opening.
2. **Talk** to townsfolk with E and type anything. Ask for work to get a quest.
3. **Explore:** the three dungeon entrances are linked to town by dirt roads. The AI names each one the first time you get close.
4. **Dungeons:** stand on an entrance and press E. The AI designs the theme, the regular enemies and the boss (name, personality, taunt, two phases), picking patterns from the library. The code builds 3-5 connected rooms. Doors lock until each room is cleared.
5. **Boss:** below 50% HP the boss switches to phase 2. When it dies, the AI narrates the outcome and gives you an item. A weapon changes your bullet color, count, spread, homing and so on right away.
6. **Return** through the portal. NPCs remember what you said and what happened. The quest giver notices when you've finished their task.
7. **Death** sends you back to town with the world sheet intact. Saves go to `localStorage`. The game autosaves at calm moments, and you can also save from the Esc menu.

## Architecture

```
server/
  config.ts      model name + limits (the one place to change the model)
  index.ts       Express proxy: /api/status, /api/ai -> Anthropic Messages API
src/
  main.ts        bootstrap + game loop
  game.ts        orchestration: scenes, interaction, AI calls at calm moments, save/load
  render.ts      canvas renderer (5x nearest-neighbor), camera, screen shake, HUD
  sprites.ts     8x8 pixel-array sprites with auto 1px outline, tiles, bullets, item icons
  input.ts       keyboard + mouse
  worldgen.ts    seeded overworld (grass, water, trees, paths, town, 3 entrances) + dungeon rooms
  patterns.ts    bullet pattern library + validation/clamping
  combat.ts      bullets, enemies, movement styles, collisions, particles
  enemies.ts     enemy/boss/dungeon data definitions, AI validation, offline fallbacks
  items.ts       effect library, item validation/clamping, stat stacking
  inventory.ts   8-slot bag + weapon/2 charm equip slots, consumable hotbar
  worldsheet.ts  the world sheet (AI memory), change validation/application
  prompts.ts     system prompt + per-task prompts
  ai.ts          AI client: proxy calls, code-fence stripping, JSON parsing, fallbacks
  mock.ts        offline game master (sheet-aware canned responses)
  ui.ts          DOM overlays: title, loading, narration, dialogue, inventory, pause, death, debug
  save.ts        localStorage save/load
```

### The world sheet

One JSON object (`src/worldsheet.ts`) is the AI's memory. It holds the player, world (seed, main threat, act, story so far), factions, NPCs (personality, secret, want, attitude, memory), quests, events, and discovered places. Each request sends the relevant slice. When `events` grows past 20 entries, the oldest 12 are sent to the AI and folded into `storySoFar`. Press F1 to watch it change live.

### AI calls (only at calm moments, with the game paused)

| Call | When | Extra fields returned |
| --- | --- | --- |
| `newGame` | New Game | `setup` (threat, town, factions, NPCs) |
| `talk` | each line of NPC dialogue (plus a greeting) | none |
| `discover` | first time near a dungeon entrance | `place` |
| `dungeon` | first entry to a dungeon | `dungeon` (theme, palette, enemies, boss) |
| `outcome` | after a boss dies | none (must include `addEvent` + `giveItem`) |
| `compress` | events > 20 | `storySoFar` |

Every response is JSON in the shape `{ narration, dialogue, changes: [...] }`. The client strips code fences, pulls out the JSON object and parses it. If parsing fails it falls back gracefully: a generic line for dialogue, or the canned version for content like dungeon designs. If the network or the API fails, the offline response is used. Unknown change types are ignored, and every change is validated before it's applied.

### Balance clamps

- **Items** are built from a fixed effect library (`damage, fireRate, shotSpeed, shotCount, spread, piercing, homing, bulletSize, moveSpeed, maxHp, heal, shield, slowEnemyBullets`). Each value is clamped per item, and the stacked totals are clamped again.
- **Patterns** have their parameters clamped. Each enemy has a bullets-per-second budget that scales with dungeon difficulty. If a pattern exceeds it, its fire rate is lowered.
- **Enemy/boss HP and speed** are clamped. Unknown sprites, movement styles or patterns fall back to known ones.
