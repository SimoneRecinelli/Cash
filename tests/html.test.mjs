import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

test('nessun id duplicato nella pagina (con id doppi $("#x") legge sempre il primo campo)', () => {
  const ids = [...markup.matchAll(/\sid="([^"$]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual([...new Set(dup)], []);
});

test('ogni $("#id") usato nello script esiste nella pagina', () => {
  const ids = new Set([...markup.matchAll(/\sid="([^"$]+)"/g)].map((m) => m[1]));
  // gli id creati dallo script stesso (template) non sono nel markup: li ammetto se compaiono come id="..." nello script
  const made = new Set([...script.matchAll(/\sid="([^"$]+)"/g)].map((m) => m[1]));
  const missing = [...new Set([...script.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))].filter((x) => !ids.has(x) && !made.has(x));
  assert.deepEqual(missing, []);
});
