import './style.css';
import { AIClient } from './ai';
import { Game } from './game';
import { Input } from './input';
import { Renderer } from './render';
import { UI } from './ui';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const root = document.getElementById('overlay') as HTMLElement;
  const renderer = new Renderer(canvas);
  const input = new Input(canvas);
  const ui = new UI(root);
  const ai = new AIClient();
  await ai.checkStatus();

  const game = new Game(renderer, input, ui, ai);
  game.showTitle();

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    game.update(dt);
    game.render();
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Expose for debugging in the browser console.
  (window as unknown as { game: Game }).game = game;
}

void boot();
