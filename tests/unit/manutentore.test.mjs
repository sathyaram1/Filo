// Il contesto del manutentore (SPEC-RIDISEGNO-LAVORO.md § 2): il ruolo, tutte le schede in una riga ciascuna, i rami in
// corso coi loro file da git, e gli incroci fra i file di una scheda e quelli dei rami. Niente modello, niente rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const M = await import('../../scripts/manutentore.mjs');
const scheda = (num, extra = {}) => ({
  numero: String(num), titolo_breve: 'Menu immagini', riassunto: 'Il menu\nnon si apre.', tipo: 'bug', area: 'browser-schede',
  file_probabili: ['src/content/menu.js'], urgente: false, valido: 'si', risolto_su_main: null, doppione_di: [], ...extra,
});

test('una scheda in una riga: area, stato, priorità, i segni che contano, il riassunto e i file', () => {
  assert.equal(M.rigaScheda(scheda(12), { stato: 'todo', priorita: 2 }),
    '#12 · [browser-schede/bug] · todo · p2 · valido si — Menu immagini: Il menu non si apre. | file: src/content/menu.js');
  const segni = M.rigaScheda(scheda(13, { urgente: true, valido: 'no', risolto_su_main: 'abc123 merge-gate: #13', doppione_di: ['#7'] }), {});
  assert.match(segni, /URGENTE · valido no · risolto\? abc123 merge-gate: #13 · doppione di #7/);
  assert.match(segni, / · p\? · /, 'senza indice la priorità non si inventa');
});

test('il contesto porta il ruolo, le schede in ordine, chi non ha scheda, i rami e la spesa da chiedere', () => {
  const t = M.testoContesto({
    ruolo: '# Ruolo: manutentore',
    schede: [scheda(20), scheda(3)],
    indice: [{ num: '3', stato: 'todo', priorita: 1 }, { num: '20', stato: 'design', priorita: null }, { num: '44', stato: 'todo' }],
    rami: [{ ramo: 'claude/x', feedback: ['3'], avanti: 2, data: '2026-10-28T10:00:00Z', file: ['a.js'] }],
  });
  assert.ok(t.startsWith('# Ruolo: manutentore'));
  assert.ok(t.indexOf('#3 ·') < t.indexOf('#20 ·'), 'in ordine di numero');
  assert.match(t, /## Schede \(2\)/);
  assert.match(t, /Senza scheda \(1\): #44/);
  assert.match(t, /## Rami in corso \(1\)\n\nclaude\/x \(#3\), 2 commit, 2026-10-28: a\.js/);
  assert.match(t, /consumo della settimana dell'account/);
});

test('il ramo di un worker prende il numero del suo feedback dall\'indice', () => {
  const rami = M.conNumeri([
    { ramo: 'worker/HNgzAr4lreN25OPInPXq-20261029T021625Z', feedback: ['12', '1680'] },
    { ramo: 'claude/altro', feedback: ['5'] },
  ], [{ id: 'HNgzAr4lreN25OPInPXq', num: '1680' }]);
  assert.deepEqual(rami.map((r) => r.feedback), [['1680', '12'], ['5']]);
});

test('incroci: la riga dice quale ramo tocca i file probabili della scheda, o che nessuno li tocca', async (t) => {
  const dir = cartellaTemporanea('manutentore');
  const out = []; const err = [];
  const [l, e] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => err.push(a.join(' '));
  t.after(() => { console.log = l; console.error = e; togliCartella(dir); });
  // Un repo con main e un ramo vivo che tocca src/a.js, al posto di quello vero.
  const repo = cartellaTemporanea('manutentore-repo');
  t.after(() => togliCartella(repo));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(repo, 'x.txt'), 'x'); g('add', '-A'); g('commit', '-qm', 'inizio');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  g('checkout', '-qb', 'lavoro'); mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'), 'a'); g('add', '-A'); g('commit', '-qm', 'auto: #44');
  g('update-ref', 'refs/remotes/origin/claude/lavoro', 'HEAD');
  writeFileSync(join(dir, '12.json'), JSON.stringify(scheda(12, { file_probabili: ['src/a.js'] })));
  writeFileSync(join(dir, '13.json'), JSON.stringify(scheda(13, { file_probabili: ['non/esiste.js'] })));
  assert.equal(await M.main(['incroci', '12', '--cartella', dir, '--senza-fetch'], { root: repo }), 0);
  assert.match(out.join('\n'), /^claude\/lavoro \(#44\): src\/a\.js$/m);
  assert.equal(await M.main(['incroci', '#13', '--cartella', dir, '--senza-fetch'], { root: repo }), 0);
  assert.match(out.join('\n'), /Nessun ramo in corso tocca i file probabili di #13 \(non\/esiste\.js\)/);
  assert.equal(await M.main(['incroci', '99', '--cartella', dir, '--senza-fetch'], { root: repo }), 1);
  assert.match(err.join('\n'), /Nessuna scheda per #99/);
  assert.equal(await M.main(['boh']), 1);
});
