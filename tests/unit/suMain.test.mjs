// Il ridisegno del lavoro chiede a git, senza modello: le fusioni su main che citano un feedback (già risolto?),
// i file che un riallineamento ha riscritto (serve un giro nuovo?) e i rami in corso coi loro file (manutentore).
// Le regole sui file di servizio e sul motivo del correttore stanno in src/shared/verifierRound.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
require(resolve(ROOT, 'src', 'shared', 'verifierRound.js'));
const R = globalThis.SN_VERIFIER_ROUND;
const { numeroFeedback, regexCitazione, fusioniCheCitano, fileRiscritti, fileInConflitto, ramiInCorso, incroci, incrociFraRami, modifichePerFile } =
  await import('../../scripts/lib/su-main.mjs');

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const scrivi = (dir, file, testo) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), testo); };
const righe = (n, cambia = {}) => Array.from({ length: n }, (_, i) => cambia[i + 1] ?? `riga ${i + 1}`).join('\n') + '\n';

function repo() {
  const dir = cartellaTemporanea('su-main');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']); git(dir, ['config', 'commit.gpgsign', 'false']);
  scrivi(dir, 'a.js', righe(40));
  scrivi(dir, 'PATTERNS.md', '# indice\n- uno\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'inizio']);
  return dir;
}
const commit = (dir, msg, file = {}) => {
  for (const [f, t] of Object.entries(file)) scrivi(dir, f, t);
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', msg, '--allow-empty']);
  return git(dir, ['rev-parse', 'HEAD']);
};

test('un numero di feedback si riconosce citato da solo, non dentro un altro numero né nel figlio', () => {
  assert.equal(numeroFeedback('#1680'), '1680');
  assert.equal(numeroFeedback(' 1680.2 '), '1680.2');
  assert.equal(numeroFeedback('1680a'), '');
  // La forma del server (#2046.2): niente zeri davanti, niente figlio zero.
  for (const no of ['01680', '0', '#0', '1680.0', '1680.02']) assert.equal(numeroFeedback(no), '', no);
  const re = new RegExp(regexCitazione('1680'));
  for (const si of ['merge-gate: #1680 via server', 'chiude #1680.', '(#1680)', 'fine #1680']) assert.ok(re.test(si), si);
  for (const no of ['merge-gate: #16800 via server', 'figlio #1680.2', 'nessuno']) assert.ok(!re.test(no), no);
  assert.throws(() => regexCitazione('niente'), /non valido/);
});

test('le fusioni che citano il feedback: la sua, e quella di un altro lavoro che lo cita in un suo commit; i figli no', (t) => {
  const dir = repo();
  t.after(() => togliCartella(dir));
  git(dir, ['checkout', '-qb', 'lavoro']);
  commit(dir, 'verifica #12 giro 1', { 'a.js': righe(40, { 3: 'x' }) });
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['merge', '-q', '--no-ff', 'lavoro', '-m', 'merge-gate: #12 via server (unit verdi)']);
  commit(dir, 'merge-gate: #12.1 via server');
  commit(dir, 'merge-gate: #120 via server');
  git(dir, ['checkout', '-qb', 'altro']);
  commit(dir, 'il menu: chiude anche #12', { 'a.js': righe(40, { 3: 'x', 5: 'y' }) });
  commit(dir, 'auto: a.js');
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['merge', '-q', '--no-ff', 'altro', '-m', 'merge-gate: #77 via server']);
  const fusione77 = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const trovate = fusioniCheCitano(dir, '#12');
  assert.deepEqual(trovate.map((f) => [f.oggetto, f.citazione || '']), [
    ['merge-gate: #77 via server', 'il menu: chiude anche #12'],
    ['merge-gate: #12 via server (unit verdi)', ''],
  ]);
  assert.equal(trovate[0].sha, fusione77, 'la fusione della linea principale, non il commit del ramo');
  assert.deepEqual(fusioniCheCitano(dir, '12', { dopo: Date.now() + 60000 }), [], 'una fusione datata prima del rilievo non conta');
  assert.deepEqual(fusioniCheCitano(dir, '12.1').map((f) => f.oggetto), ['merge-gate: #12.1 via server']);
  assert.deepEqual(fusioniCheCitano(dir, '999'), []);
});

test('un riallineamento pulito non riscrive niente, anche se main ha cambiato le righe accanto', (t) => {
  const dir = repo();
  t.after(() => togliCartella(dir));
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-qb', 'ramo']);
  const prima = commit(dir, 'lavoro', { 'a.js': righe(40, { 10: 'del ramo' }), 'PATTERNS.md': '# indice\n- uno\n- del ramo\n' });
  git(dir, ['checkout', '-q', 'main']);
  commit(dir, 'altro lavoro', { 'a.js': righe(40, { 11: 'di main' }), 'PATTERNS.md': '# indice\n- uno\n- di main\n' });
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  // Il riallineamento: la stessa modifica sopra il main nuovo, col conflitto di PATTERNS.md risolto tenendo le due righe.
  git(dir, ['checkout', '-qb', 'ramo-nuovo']);
  commit(dir, 'lavoro riallineato', { 'a.js': righe(40, { 10: 'del ramo', 11: 'di main' }), 'PATTERNS.md': '# indice\n- uno\n- di main\n- del ramo\n' });
  const r = fileRiscritti(dir, { prima, dopo: 'HEAD' });
  assert.equal(r.ok, true, r.errore);
  assert.equal(r.basi.prima, base);
  assert.deepEqual(r.file, [], 'tenere le due righe lascia al ramo la stessa modifica');
  assert.deepEqual(R.giroDopoRiallineamento(r.file), { giro: 'nessuno', codice: [] });
  // Un conflitto risolto riscrivendo la riga del ramo, ma in un file di servizio: niente giro nuovo lo stesso.
  commit(dir, 'riga riscritta', { 'PATTERNS.md': '# indice\n- uno\n- di main\n- del ramo, dopo main\n' });
  const s = fileRiscritti(dir, { prima });
  assert.deepEqual(s.file, ['PATTERNS.md']);
  assert.deepEqual(R.giroDopoRiallineamento(s.file), { giro: 'nessuno', codice: [] });
});

test('un conflitto risolto in un file di codice chiede la verifica intera', (t) => {
  const dir = repo();
  t.after(() => togliCartella(dir));
  git(dir, ['checkout', '-qb', 'ramo']);
  const prima = commit(dir, 'lavoro', { 'a.js': righe(40, { 10: 'del ramo' }) });
  git(dir, ['checkout', '-q', 'main']);
  commit(dir, 'altro lavoro', { 'a.js': righe(40, { 10: 'di main' }) });
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(dir, ['checkout', '-qb', 'ramo-nuovo']);
  commit(dir, 'conflitto risolto', { 'a.js': righe(40, { 10: 'del ramo e di main' }) });
  const r = fileRiscritti(dir, { prima });
  assert.deepEqual(r.file, ['a.js']);
  assert.deepEqual(R.giroDopoRiallineamento(r.file), { giro: 'pieno', codice: ['a.js'] });
  assert.deepEqual(R.giroDopoRiallineamento(undefined), { giro: 'pieno', codice: null }, 'senza elenco si verifica');
  assert.equal(fileRiscritti(dir, { prima: 'non-esiste' }).ok, false);
});

test('un conflitto in un file di codice risolto tenendo le due parti chiede la verifica, anche se la modifica è uguale', (t) => {
  const dir = repo();
  t.after(() => togliCartella(dir));
  git(dir, ['checkout', '-qb', 'ramo']);
  const prima = commit(dir, 'lavoro', { 'a.js': righe(40, { 10: 'mine();' }) });
  git(dir, ['checkout', '-q', 'main']);
  commit(dir, 'altro lavoro', { 'a.js': righe(40, { 10: 'return 1;' }) });
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(dir, ['checkout', '-qb', 'ramo-nuovo']);
  commit(dir, 'tenute le due parti', { 'a.js': righe(40, { 10: 'return 1;\nmine();' }) });
  const r = fileRiscritti(dir, { prima });
  assert.deepEqual(r.conflitti, ['a.js'], 'git dice dove il ramo andava in conflitto con main');
  assert.deepEqual(R.giroDopoRiallineamento(r.file, { conflitti: r.conflitti }), { giro: 'pieno', codice: ['a.js'] });
  assert.deepEqual(fileInConflitto(dir, { prima: 'HEAD' }), [], 'la punta nuova sopra main non ha più conflitti');
  assert.deepEqual(R.giroDopoRiallineamento([], { conflitti: ['PATTERNS.md'] }).giro, 'nessuno', 'un conflitto in un file di servizio no');
  assert.deepEqual(R.giroDopoRiallineamento([], { conflitti: null }).giro, 'pieno', 'senza sapere dei conflitti si verifica');
});

test('una riga tolta che comincia con due trattini resta una modifica, non un\'intestazione', () => {
  const diff = [
    'diff --git a/x.sql b/x.sql', 'index 111..222 100644', '--- a/x.sql', '+++ b/x.sql',
    '@@ -3 +3 @@', '--- commento', '+++ commento nuovo',
  ].join('\n');
  assert.equal(modifichePerFile(diff).get('x.sql'), '--- commento\n+++ commento nuovo');
});

test('i rami in corso dicono i loro file e i feedback citati, e si incrociano coi file di una scheda', (t) => {
  const dir = repo();
  t.after(() => togliCartella(dir));
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(dir, ['checkout', '-qb', 'claude/uno']);
  commit(dir, 'auto: a.js #44', { 'a.js': righe(40, { 1: 'x' }) });
  commit(dir, 'verifica #44 giro 1', { 'src/pagina/b.js': 'b\n' });
  git(dir, ['update-ref', 'refs/remotes/origin/claude/uno', 'HEAD']);
  git(dir, ['update-ref', 'refs/remotes/origin/discarded/vecchio', 'HEAD']);
  git(dir, ['update-ref', 'refs/remotes/origin/worker/AbC123-20261001T000000Z', 'HEAD']);
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['update-ref', 'refs/remotes/origin/claude/fuso', 'main']);
  git(dir, ['checkout', '-qb', 'secondo']);
  commit(dir, 'secondo tentativo', { 'b.js': 'b\n' });
  git(dir, ['update-ref', 'refs/remotes/origin/worker/AbC123-20261002T000000Z', 'HEAD']);
  git(dir, ['checkout', '-q', 'main']);
  const rami = ramiInCorso(dir);
  // Il nome di un ramo che non è un tentativo scritto dal server non si mostra (#2337): resta il commit.
  assert.deepEqual(rami.map((r) => r.ramo.replace(/@[0-9a-f]{7}$/, '@…')).sort(), ['claude/(nome non mostrato) @…', 'worker/AbC123-20261002T000000Z'],
    'fuori i rami già su main, quelli messi da parte e i tentativi vecchi dello stesso worker');
  rami.splice(rami.findIndex((r) => r.ramo.startsWith('worker/')), 1);
  const claude = rami[0].ramo;
  assert.deepEqual([rami[0].file, rami[0].fileNuovi], [['a.js'], ['src/pagina/b.js']], 'un file che su main non c\'è si tiene a parte');
  assert.deepEqual(rami[0].feedback, ['44']);
  assert.deepEqual(incroci(rami, ['a.js']), [{ ramo: claude, repo: 'app', feedback: ['44'], comuni: ['a.js'] }]);
  assert.deepEqual(incroci(rami, ['src/pagina/b.js']), [{ ramo: claude, repo: 'app', feedback: ['44'], comuni: ['src/pagina/b.js'] }], 'un file nuovo si incrocia per nome intero');
  assert.deepEqual(incroci(rami, ['src/pagina/']), [], 'non con una cartella: il nome lo porterebbe chi lavora');
  assert.deepEqual(incroci(rami, ['c.js']), []);
  // #2340: un ramo del server confronta le voci nude e quelle col prefisso; uno dell'app non prende quelle del server.
  const delServer = [{ ramo: 'claude/s', repo: 'server', file: ['functions/src/x.js', 'a.js'], feedback: [] }];
  assert.deepEqual(incroci(delServer, ['filo-security:functions/src/x.js']).map((r) => r.comuni), [['functions/src/x.js']]);
  assert.deepEqual(incroci(delServer, ['functions/src/']).map((r) => r.comuni), [['functions/src/x.js']]);
  assert.deepEqual(incroci(rami, ['filo-security:a.js']), [], 'un file del server non incrocia l\'app');
  assert.deepEqual(ramiInCorso(dir, { giorni: 1, adesso: Date.now() + 5 * 86400000 }), [], 'un ramo fermo da giorni non conta');
});

test('una correzione di main rifatta a mano nel ramo e poi fusa con main non è un file del ramo né un incrocio (#2340.3)', (t) => {
  const dir = repo();
  t.after(() => togliCartella(dir));
  const inizio = git(dir, ['rev-parse', 'HEAD']);
  const corretto = righe(40, { 7: 'corretto' });
  commit(dir, 'merge-gate: #10 correzione su main', { 'a.js': corretto });
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  for (const [nome, proprio] of [['uno', 'x.js'], ['due', 'y.js']]) {
    git(dir, ['checkout', '-qb', nome, inizio]);
    commit(dir, `auto: ${proprio} #2${nome.length}`, { [proprio]: `${nome}\n` });
    commit(dir, 'riallineamento a mano: la correzione di main', { 'a.js': corretto });
    git(dir, ['merge', '-q', '--no-edit', 'origin/main']);
    git(dir, ['update-ref', `refs/remotes/origin/claude/${nome}`, 'HEAD']);
  }
  git(dir, ['checkout', '-qb', 'tre', 'main']);
  commit(dir, 'auto: a.js #30', { 'a.js': righe(40, { 7: 'corretto', 20: 'davvero' }) });
  git(dir, ['update-ref', 'refs/remotes/origin/claude/tre', 'HEAD']);
  git(dir, ['checkout', '-q', 'main']);
  const rami = ramiInCorso(dir);
  assert.deepEqual(rami.map((r) => [...r.file, ...(r.fileNuovi || [])]).sort(), [['a.js'], ['x.js'], ['y.js']],
    'ognuno con i soli file che cambia rispetto a main: a.js resta solo a chi lo cambia davvero');
  assert.deepEqual(incrociFraRami(rami), [], 'due lavori su file diversi non si incrociano');
  assert.deepEqual(incroci(rami, ['a.js']).length, 1);
});

test('un tentativo vecchio di un feedback il cui ultimo tentativo è su main non è in corso; chi resta fuori si conta', (t) => {
  const dir = repo();
  t.after(() => togliCartella(dir));
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(dir, ['checkout', '-qb', 'morto']);
  commit(dir, '#812 primo tentativo', { 'a.js': 'morto\n' });
  git(dir, ['update-ref', 'refs/remotes/origin/worker/AbC123-20261020T100000Z', 'HEAD']);
  git(dir, ['update-ref', 'refs/remotes/origin/prova/esperimento', 'HEAD']);
  git(dir, ['checkout', '-q', 'main']);
  // Il cancello fonde con un commit di fusione: un tentativo con la punta sulla linea principale non ha mai scritto.
  git(dir, ['checkout', '-qb', 'buono']);
  commit(dir, '#812 secondo tentativo', { 'b.js': 'buono\n' });
  git(dir, ['update-ref', 'refs/remotes/origin/worker/AbC123-20261022T100000Z', 'HEAD']);
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['merge', '-q', '--no-ff', '-m', 'merge-gate: #812', 'buono']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const fuori = {};
  assert.deepEqual(ramiInCorso(dir, { fuori }), [], 'il tentativo del 20 è morto: quello del 22 è già su main');
  assert.deepEqual(fuori.altri.map((r) => r.replace(/@[0-9a-f]{7}$/, '@…')), ['altro/(nome non mostrato) @…'], 'un ramo che non è di lavoro resta fuori, ma si conta');
  git(dir, ['checkout', '-qb', 'vivo']);
  commit(dir, '#900', { 'c.js': 'c\n' });
  git(dir, ['update-ref', 'refs/remotes/origin/claude/vivo', 'HEAD']);
  ramiInCorso(dir, { fuori, giorni: 1, adesso: Date.now() + 5 * 86400000 });
  assert.equal(fuori.vecchi, 1, 'il ramo fermo da giorni resta fuori, contato');
});

test('il motivo del correttore: quattro forme, e senza motivo un errore che dice come si scrive', () => {
  assert.deepEqual(R.leggiMotivoCorrettore('conflitto: src/a.js, tests/b.mjs').motivo, { tipo: 'conflitto', file: ['src/a.js', 'tests/b.mjs'] });
  assert.deepEqual(R.leggiMotivoCorrettore('Conflitto: nessuno').motivo, { tipo: 'conflitto', file: [] });
  assert.deepEqual(R.leggiMotivoCorrettore('prove rosse: tests/unit/x.test.mjs, apertura scheda').motivo,
    { tipo: 'prove-rosse', prove: ['tests/unit/x.test.mjs', 'apertura scheda'] });
  assert.deepEqual(R.leggiMotivoCorrettore('ripresa').motivo, { tipo: 'ripresa' });
  assert.deepEqual(R.leggiMotivoCorrettore('altro: il ramo era già su main').motivo, { tipo: 'altro', testo: 'il ramo era già su main' });
  for (const male of ['', '   ', 'boh: x', 'constructor', 'toString: x', 'conflitto', 'conflitto:  ', 'prove rosse:', 'altro', `altro: ${'x'.repeat(1001)}`]) {
    const r = R.leggiMotivoCorrettore(male);
    assert.equal(r.ok, false, male.slice(0, 20));
    assert.ok(r.errore.length > 10);
  }
  assert.match(R.leggiMotivoCorrettore('').errore, /--motivo "conflitto:/);
  for (const testo of ['conflitto: a.js, b.js', 'conflitto: nessuno', 'prove rosse: x', 'ripresa', 'altro: y']) {
    assert.equal(R.testoMotivo(R.leggiMotivoCorrettore(testo).motivo), testo, 'la riga si rilegge uguale');
  }
});

// #2498: «conflitto: a, b (ramo del server)» diventava cinque file, tre dei quali parole della nota.
test('nel motivo di un conflitto quello fra parentesi è una nota, non dei file, e resta nel motivo', async () => {
  const letto = (t) => R.leggiMotivoCorrettore(t).motivo;
  assert.deepEqual(letto('conflitto: src/shared/patchNotes.js, PATTERNS.md (ramo del server)'),
    { tipo: 'conflitto', file: ['src/shared/patchNotes.js', 'PATTERNS.md'], testo: 'ramo del server' });
  assert.deepEqual(letto('conflitto: a.js (solo righe di novità), b.js (import)'), { tipo: 'conflitto', file: ['a.js', 'b.js'], testo: 'solo righe di novità; import' });
  assert.deepEqual(letto('conflitto: nessuno (il ramo era già sopra main)'), { tipo: 'conflitto', file: [], testo: 'il ramo era già sopra main' });
  assert.deepEqual(letto('conflitto: a.js (nota senza chiusura'), { tipo: 'conflitto', file: ['a.js'], testo: 'nota senza chiusura' });
  assert.deepEqual(letto('conflitto: a.js ()'), { tipo: 'conflitto', file: ['a.js'] }, 'una parentesi vuota non lascia una nota vuota');
  assert.equal(R.leggiMotivoCorrettore('conflitto: (solo una nota)').ok, false, 'una nota senza file non è un elenco');
  assert.equal(R.leggiMotivoCorrettore(`conflitto: a.js (${'x'.repeat(1001)})`).ok, false, 'la nota ha il tetto del testo, col numero');
  assert.deepEqual(letto('prove rosse: apertura scheda (tasto destro)'), { tipo: 'prove-rosse', prove: ['apertura scheda (tasto destro)'] },
    'il titolo di una prova può avere parentesi sue');
  for (const testo of ['conflitto: a.js, b.js (ramo del server)', 'conflitto: nessuno (niente da fare)', 'conflitto: a.js (x; y)']) {
    const m = letto(testo);
    assert.equal(R.testoMotivo(m), testo, 'la riga si rilegge uguale');
    assert.deepEqual(letto(R.testoMotivo(m)), m, 'e l\'oggetto pure: il server lo rilegge così');
  }
  // Il conto che il correttore vede dopo la consegna: due file di servizio e una nota non chiedono un giro di verifica.
  const { esitoRiallineamento } = await import('../../scripts/dispatch.mjs');
  const esito = esitoRiallineamento({ ok: true, file: [], conflitti: [] }, letto('conflitto: src/shared/patchNotes.js, PATTERNS.md (ramo del server)'));
  assert.equal(esito.riallineamento.giro, 'nessuno', esito.riga);
  assert.doesNotMatch(esito.riga, /file di codice|ramo/);
});

test('i file di servizio sono quelli della regola 3 della spec', () => {
  assert.deepEqual(R.FILE_DI_SERVIZIO.slice().sort(),
    ['PATTERNS.md', 'src/shared/capabilities.js', 'src/shared/patchNotes.js', 'tests/rossi-noti.json']);
  assert.deepEqual(R.giroDopoRiallineamento(['src/shared/patchNotes.js', './tests/rossi-noti.json']).giro, 'nessuno');
  assert.deepEqual(R.giroDopoRiallineamento([]).giro, 'nessuno', 'un riallineamento pulito non chiede un giro');
});

test('#2590: un riallineamento per prove rosse chiede la verifica anche pulito, gli altri motivi no', () => {
  const rosse = R.leggiMotivoCorrettore('prove rosse: tests/unit/x.test.mjs').motivo;
  assert.deepEqual(R.giroDopoRiallineamento([], { conflitti: [], motivo: rosse }), { giro: 'pieno', codice: [], proveRosse: true });
  assert.deepEqual(R.giroDopoRiallineamento(['src/shared/patchNotes.js'], { motivo: rosse }).giro, 'pieno');
  assert.equal(R.giroDopoRiallineamento(undefined, { motivo: rosse }).proveRosse, true, 'anche senza elenco si dice il perché');
  assert.equal(R.riallineamentoPerProveRosse(rosse), true);
  for (const testo of ['conflitto: nessuno', 'ripresa', 'altro: main era già dentro']) {
    const m = R.leggiMotivoCorrettore(testo).motivo;
    assert.equal(R.riallineamentoPerProveRosse(m), false, testo);
    assert.deepEqual(R.giroDopoRiallineamento([], { motivo: m }), { giro: 'nessuno', codice: [] }, testo);
  }
  assert.equal(R.riallineamentoPerProveRosse(null), false);
});
