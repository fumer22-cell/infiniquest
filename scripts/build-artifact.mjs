// Builds the game into one self-contained HTML file (JS + CSS inlined) that can be
// published as a claude.ai artifact. Output: dist/infiniquest-artifact.html
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

execSync('npx vite build --base ./', { stdio: 'inherit' });

const assets = join('dist', 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8'));
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8'));

// The artifact host supplies <html>/<head>/<body>, so emit only page content.
const html = `<title>Infiniquest</title>
<style>
${css.join('\n')}
</style>
<div id="stage">
  <canvas id="game"></canvas>
  <div id="overlay"></div>
</div>
<script type="module">
${js.join('\n').replace(/<\/script/gi, '<\\/script')}
</script>
`;

const out = join('dist', 'infiniquest-artifact.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
