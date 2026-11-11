import { mkdir, readFile, writeFile } from 'node:fs/promises';

const inputs = await Promise.all(['index.html', 'style.css', 'app.js', 'champions.json'].map(file => readFile('ui/' + file, 'utf8')));
const source = await readFile('worker.mjs', 'utf8');
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', source.replace('/* EMBED_ASSETS */', () =>
  'const assets = ' + JSON.stringify(inputs) + ';'
));

