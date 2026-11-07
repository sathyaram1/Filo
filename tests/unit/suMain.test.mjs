// Il ridisegno del lavoro chiede a git, senza modello: le fusioni su main che citano un feedback (già risolto?), i file
// che un riallineamento ha riscritto, anche solo spostando una riga (serve un giro nuovo?), e i rami in corso coi loro
// file (manutentore). Le regole sui file di servizio e sul motivo del correttore stanno in src/shared/verifierRound.js.

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
const { numeroFeedback, regexCitazione, fusioniCheCitano, fileRiscritti, fileInConflitto, ramiInCorso, incroci } =
  await import('../../scripts/lib/su-main.mjs');
const BI = await import('../../scripts/lib/branch-integrity.mjs');
const SM = await import('../../scripts/lib/su-main.mjs');
const DISPATCH = await import('../../scripts/dispatch.mjs');

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

test('l\'ultima fusione del lavoro stesso del feedback conta anche quella approvata dall\'owner dal suo ramo, con la regola della ricerca «già risolto»', (t) => {
  const { ultimaFusionePropria, segnaProprie } = SM;
  const dir = repo();
  t.after(() => togliCartella(dir));
  commit(dir, 'merge-gate: #12 via server');
  commit(dir, 'finish: worker/b493d90e-af97-4313-bec1-55961a7bb376-20261101T100000Z via server');
  const dellOwner = git(dir, ['show', '-s', '--format=%cI', 'HEAD']);
  commit(dir, 'finish: worker/altroID999-20261102T100000Z via server');
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  assert.equal(ultimaFusionePropria(dir, '13', { id: 'b493d90e-af97-4313-bec1-55961a7bb376' }), dellOwner,
    'solo la fusione approvata dall\'owner, col ramo nella forma lunga: è il suo tentativo arrivato');
  assert.notEqual(ultimaFusionePropria(dir, '12'), '', 'senza id resta la fusione del cancello');
  assert.equal(ultimaFusionePropria(dir, '14', { id: 'nessuno' }), '');
  assert.equal(DISPATCH.segnaProprie, segnaProprie, 'la sessione usa la stessa regola, non una copia');
});

test('un numero di feedback si riconosce citato da solo, non dentro un altro numero né nel figlio', () => {
  assert.equal(numeroFeedback('#1680'), '1680');
  assert.equal(numeroFeedback(' 1680.2 '), '1680.2');
  assert.equal(numeroFeedback('1680a'), '');
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

test('un riallineamento pulito non riscrive niente, anche se main ha cambiato le righe vicine', (t) => {
  const dir = repo();
  t.after(() => togliCartella(dir));
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-qb', 'ramo']);
  const prima = commit(dir, 'lavoro', { 'a.js': righe(40, { 10: 'del ramo' }), 'PATTERNS.md': '# indice\n- uno\n- del ramo\n' });
  git(dir, ['checkout', '-q', 'main']);
  commit(dir, 'altro lavoro', { 'a.js': righe(40, { 12: 'di main' }), 'PATTERNS.md': '# indice\n- uno\n- di main\n' });
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  // Il riallineamento: la stessa modifica sopra il main nuovo, col conflitto di PATTERNS.md risolto tenendo le due righe.
  git(dir, ['checkout', '-qb', 'ramo-nuovo']);
  commit(dir, 'lavoro riallineato', { 'a.js': righe(40, { 10: 'del ramo', 12: 'di main' }), 'PATTERNS.md': '# indice\n- uno\n- di main\n- del ramo\n' });
  const r = fileRiscritti(dir, { prima, dopo: 'HEAD' });
  assert.equal(r.ok, true, r.errore);
  assert.equal(r.basi.prima, base);
  assert.deepEqual(r.file, ['PATTERNS.md'], 'a.js è quello che git rifà da sé; PATTERNS.md l\'ha risolto il correttore');
  assert.deepEqual(R.giroDopoRiallineamento(r.file, { conflitti: r.conflitti }), { giro: 'nessuno', codice: [] });
  // Un conflitto risolto riscrivendo la riga del ramo, ma in un file di servizio: niente giro nuovo lo stesso.
  commit(dir, 'riga riscritta', { 'PATTERNS.md': '# indice\n- uno\n- di main\n- del ramo, dopo main\n' });
  const s = fileRiscritti(dir, { prima });
  assert.deepEqual(s.file, ['PATTERNS.md']);
  assert.deepEqual(R.giroDopoRiallineamento(s.file), { giro: 'nessuno', codice: [] });
});

test('una riga spostata dal correttore nello stesso file, fuori da un conflitto, è un file riscritto', (t) => {
  const dir = repo();
  t.after(() => togliCartella(dir));
  git(dir, ['checkout', '-qb', 'ramo']);
  // Una riga aggiunta e nessuna tolta: il testo della modifica è lo stesso ovunque stia.
  const conControllo = (dopoLa) => righe(40, { [dopoLa]: `riga ${dopoLa}\ncontrolla();` });
  const prima = commit(dir, 'lavoro', { 'a.js': conControllo(5) });
  git(dir, ['checkout', '-q', 'main']);
  commit(dir, 'altro lavoro', { 'b.js': 'di main\n' });
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(dir, ['checkout', '-qb', 'ramo-nuovo']);
  commit(dir, 'riallineato, col controllo in un\'altra funzione', { 'a.js': conControllo(30), 'b.js': 'di main\n' });
  const r = fileRiscritti(dir, { prima });
  assert.equal(r.ok, true, r.errore);
  assert.deepEqual(r.conflitti, [], 'nessun conflitto con main');
  assert.deepEqual(r.file, ['a.js']);
  assert.deepEqual(R.giroDopoRiallineamento(r.file, { conflitti: r.conflitti }), { giro: 'pieno', codice: ['a.js'] });
  // Lo stesso riallineamento senza lo spostamento è pulito.
  commit(dir, 'rimesso a posto', { 'a.js': conControllo(5) });
  assert.deepEqual(fileRiscritti(dir, { prima }).file, []);
});

test('con gli unit rossi sul risultato della fusione la verifica è intera anche dopo un riallineamento pulito', () => {
  assert.deepEqual(R.giroDopoRiallineamento([], { conflitti: [], rossiAllaFusione: true }), { giro: 'pieno', codice: [], rossiAllaFusione: true });
  assert.deepEqual(R.giroDopoRiallineamento(['PATTERNS.md'], { rossiAllaFusione: true }).giro, 'pieno');
  assert.deepEqual(R.giroDopoRiallineamento([], { rossiAllaFusione: false }), { giro: 'nessuno', codice: [] });
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
  assert.deepEqual(rami.map((r) => r.ramo).sort(), ['claude/uno', 'worker/AbC123-20261002T000000Z'],
    'fuori i rami già su main, quelli messi da parte e i tentativi vecchi dello stesso worker');
  rami.splice(rami.findIndex((r) => r.ramo.startsWith('worker/')), 1);
  assert.deepEqual(rami[0].file.sort(), ['a.js', 'src/pagina/b.js']);
  assert.deepEqual(rami[0].feedback, ['44']);
  assert.deepEqual(incroci(rami, ['src/pagina/']), [{ ramo: 'claude/uno', feedback: ['44'], comuni: ['src/pagina/b.js'] }]);
  assert.deepEqual(incroci(rami, ['c.js']), []);
  assert.deepEqual(ramiInCorso(dir, { giorni: 1, adesso: Date.now() + 5 * 86400000 }), [], 'un ramo fermo da giorni non conta');
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
  assert.deepEqual(fuori.altri, ['prova/esperimento'], 'un ramo che non è di lavoro resta fuori, ma si dice');
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
  for (const testo of ['conflitto: a.js, b.js', 'conflitto: nessuno', 'prove rosse: x', 'ripresa', 'altro: y', 'conflitto: tests/con spazio.mjs, a.js']) {
    assert.equal(R.testoMotivo(R.leggiMotivoCorrettore(testo).motivo), testo, 'la riga si rilegge uguale');
  }
});

test('il motivo coi file separati da punto e virgola, o con un nome che ha lo spazio, dà i nomi giusti', () => {
  assert.deepEqual(R.leggiMotivoCorrettore('conflitto: src/shared/patchNotes.js; PATTERNS.md').motivo.file, ['src/shared/patchNotes.js', 'PATTERNS.md']);
  assert.deepEqual(R.leggiMotivoCorrettore('conflitto: src/a.js;src/b.js;').motivo.file, ['src/a.js', 'src/b.js']);
  assert.deepEqual(R.leggiMotivoCorrettore('conflitto: tests/agent/con spazio.mjs, src/a.js').motivo.file, ['tests/agent/con spazio.mjs', 'src/a.js']);
  assert.deepEqual(R.leggiMotivoCorrettore('conflitto: "tests/agent/con spazio.mjs"').motivo.file, ['tests/agent/con spazio.mjs']);
  const solo = { tipo: 'conflitto', file: ['build/Se Filo non si apre.txt'] };
  assert.deepEqual(R.leggiMotivoCorrettore(R.testoMotivo(solo)).motivo, solo, 'un nome solo con lo spazio si rilegge intero');
  assert.deepEqual(R.leggiMotivoCorrettore('conflitto: a.js b.js').motivo.file, ['a.js', 'b.js'], 'senza virgole separano gli spazi, come prima');
  assert.deepEqual(R.leggiMotivoCorrettore('prove rosse: tests/unit/x.test.mjs; apertura scheda').motivo.prove, ['tests/unit/x.test.mjs', 'apertura scheda']);
  // Un file di servizio scritto col punto e virgola resta di servizio: niente verifica intera per un nome sporco.
  const m = R.leggiMotivoCorrettore('conflitto: src/shared/patchNotes.js; tests/rossi-noti.json').motivo;
  assert.equal(R.giroDopoRiallineamento([], { conflitti: m.file }).giro, 'nessuno');
});

test('i file di servizio sono quelli della regola 3 della spec', () => {
  assert.deepEqual(R.FILE_DI_SERVIZIO.slice().sort(),
    ['PATTERNS.md', 'src/shared/capabilities.js', 'src/shared/patchNotes.js', 'tests/rossi-noti.json']);
  assert.deepEqual(R.giroDopoRiallineamento(['src/shared/patchNotes.js', './tests/rossi-noti.json']).giro, 'nessuno');
  assert.deepEqual(R.giroDopoRiallineamento([]).giro, 'nessuno', 'un riallineamento pulito non chiede un giro');
});

test('il motivo del correttore: «nessuno» con la punteggiatura, virgolette di ogni tipo e barre di Windows', () => {
  const file = (s) => R.leggiMotivoCorrettore(s).motivo.file;
  for (const s of ['conflitto: nessuno;', 'conflitto: "nessuno"', 'conflitto: nessuno.', 'conflitto: «nessuno»']) assert.deepEqual(file(s), [], s);
  for (const s of ["conflitto: 'src/shared/patchNotes.js'", 'conflitto: “src/shared/patchNotes.js”', 'conflitto: ‘src/shared/patchNotes.js’']) {
    assert.equal(R.giroDopoRiallineamento([], { conflitti: file(s) }).giro, 'nessuno', s);
  }
  assert.deepEqual(file('conflitto: "a, b.js", c.js'), ['a, b.js', 'c.js']);
  assert.deepEqual(file('conflitto: src\\shared\\patchNotes.js'), ['src/shared/patchNotes.js']);
  assert.deepEqual(R.leggiMotivoCorrettore('prove rosse: "apertura, scheda"; x').motivo.prove, ['apertura, scheda', 'x']);
  const conVirgola = { tipo: 'conflitto', file: ['a, b.js', 'c.js'] };
  assert.deepEqual(R.leggiMotivoCorrettore(R.testoMotivo(conVirgola)).motivo, conVirgola, 'un nome con la virgola si rilegge intero');
});

test('un ramo di lavoro con l\'id in forma uuid è un tentativo come gli altri: lo legge la regola dei rami dell\'app', async () => {
  const { newWorkBranch } = BI;
  const { leggiTentativo } = await import('../../scripts/lib/tentativi.mjs');
  const uu = 'b493d90e-af97-4313-bec1-55961a7bb376';
  const ramo = newWorkBranch(uu, Date.parse('2026-10-22T17:11:41Z'));
  assert.deepEqual(leggiTentativo(ramo), { id: uu, stampo: '20261022T171141Z' });
  assert.equal(leggiTentativo(`origin/${ramo}`).id, uu);
  assert.equal(leggiTentativo('worker/abc'), null);
  assert.equal('TENTATIVO_RAMO' in BI, false, 'la forma del nome di un tentativo non si riscrive accanto a chi dà il nome');
});
