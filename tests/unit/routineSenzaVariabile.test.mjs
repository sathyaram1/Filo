// In cloud ogni chiamata della shell riparte senza `export FILO_ROUTINE=1` (#1966): la routine si riconosce dai segni
// che dispatch e preflight lasciano, e chi firma un commit o scarta una cartella lo chiede a isRoutineInstance.
// Il ritorno su main dell'orchestratore sta in lineaPrincipaleFraWorker.test.mjs.
import '../helpers/senzaSessione.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { ROOT, git, scene, togliScene, runHookRaw, stdinEdit } from '../helpers/scenaHook.mjs';

const { isRoutineInstance } = await import('../../scripts/lib/routine-role.mjs');
const { commitRestante, pushRamoCorrente } = await import('../../scripts/routine-channel.mjs');

const BIGLIETTO = 'b'.repeat(43);
const ROUTINE = 'claude-routine <claude@routine>';
const LOCALE = 'claude-local <claude@local>';
const autore = (work, ref = 'HEAD') => git(work, ['log', '-1', '--format=%an <%ae>', ref]);
// Come nei giri veri: il marcatore sta fuori dai commit.
function marcatore(dir, dati = { ticket: BIGLIETTO, since: new Date().toISOString() }) {
  mkdirSync(resolve(dir, '.claude'), { recursive: true });
  try { appendFileSync(resolve(dir, '.git', 'info', 'exclude'), '\n.claude/routine-ticket.json\n'); } catch (_) { /* non è un repo */ }
  writeFileSync(resolve(dir, '.claude', 'routine-ticket.json'), JSON.stringify(dati));
}
const cartelle = [];
after(() => { togliScene(); for (const d of cartelle.splice(0)) togliCartella(d); });

test('una routine senza la variabile si riconosce dal biglietto della cartella o dagli strumenti del giro', () => {
  const vuota = cartellaTemporanea('routine-senza-variabile-');
  cartelle.push(vuota);
  const senzaCopia = { env: {}, copiaDelGiro: () => false };
  assert.equal(isRoutineInstance(vuota, senzaCopia), false, 'una sessione qualunque');
  assert.equal(isRoutineInstance(vuota, { env: {} }), false, 'gli strumenti del repo non sono la copia del giro');
  assert.equal(isRoutineInstance(vuota, { env: {}, copiaDelGiro: () => true }), true, 'gli strumenti fissati dal preflight');
  marcatore(vuota, { since: new Date().toISOString() });
  assert.equal(isRoutineInstance(vuota, senzaCopia), false, 'un marcatore senza biglietto non conta');
  marcatore(vuota);
  assert.equal(isRoutineInstance(vuota, senzaCopia), true, 'il biglietto scritto da dispatch');
  marcatore(vuota, { ticket: BIGLIETTO, since: new Date().toISOString(), morto: { ora: new Date().toISOString(), perche: 'rilasciato' } });
  assert.equal(isRoutineInstance(vuota, senzaCopia), true, 'rilasciato, la cartella resta di una routine');
});

test('il salvataggio automatico firma da routine col solo biglietto nella cartella', () => {
  const conBiglietto = scene().work;
  git(conBiglietto, ['checkout', '-q', '-b', 'worker/1966']);
  marcatore(conBiglietto);
  writeFileSync(resolve(conBiglietto, 'a.js'), 'a\n', 'utf8');
  assert.equal(runHookRaw(conBiglietto, stdinEdit(resolve(conBiglietto, 'a.js'))).status, 0);
  assert.equal(git(conBiglietto, ['status', '--porcelain']), '');
  assert.equal(autore(conBiglietto), ROUTINE);
  assert.ok(!git(conBiglietto, ['show', '--name-only', '--format=', 'HEAD']).includes('routine-ticket'), 'il marcatore resta fuori');

  const senza = scene().work;
  git(senza, ['checkout', '-q', '-b', 'claude/locale']);
  writeFileSync(resolve(senza, 'a.js'), 'a\n', 'utf8');
  runHookRaw(senza, stdinEdit(resolve(senza, 'a.js')));
  assert.equal(autore(senza), LOCALE);
});

test('il commit del rilascio firma da routine col solo biglietto nella cartella', () => {
  const { work } = scene();
  git(work, ['checkout', '-q', '-b', 'worker/1966']);
  writeFileSync(resolve(work, 'nato-da-shell.txt'), 'x\n', 'utf8');
  assert.equal(commitRestante(work, { env: {} }).ok, true);
  assert.equal(autore(work), LOCALE, 'senza segni è una sessione locale');
  marcatore(work);
  writeFileSync(resolve(work, 'altro.txt'), 'y\n', 'utf8');
  const c = commitRestante(work, { env: {} });
  assert.deepEqual(c.committed, ['altro.txt']);
  assert.equal(autore(work), ROUTINE);
});

test('la spedizione che toglie una copia dei dati firma da routine col solo biglietto nella cartella', () => {
  const { work, origin } = scene();
  git(work, ['checkout', '-q', '-b', 'worker/1966']);
  mkdirSync(join(work, 'scripts', 'lib'), { recursive: true });
  for (const f of ['scripts/copie-in-scena.mjs', 'scripts/lib/copie-di-dati.mjs']) copyFileSync(join(ROOT, f), join(work, f));
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'strumenti']);
  git(work, ['push', '-q', 'origin', 'worker/1966']);
  marcatore(work);
  writeFileSync(join(work, 'dati.json'), JSON.stringify([{ id: 'abc123', text: 'il tasto non va', clientId: 'c-1', userAgent: 'Mozilla/5.0' }]));
  writeFileSync(join(work, 'nota.txt'), 'lavoro\n');
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'lavoro']);
  const p = pushRamoCorrente(work, { env: {} });
  assert.equal(p.ok, true, p.reason);
  assert.ok(!git(origin, ['ls-tree', '-r', '--name-only', 'worker/1966']).split('\n').includes('dati.json'), 'la copia non parte');
  assert.equal(autore(origin, 'worker/1966'), ROUTINE);
});
