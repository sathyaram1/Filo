// Le righe di novità che un ramo lungo ha sotto una versione uscita intanto tornano nel blocco della prossima versione
// da sole, al riallineamento (#2057): prima ogni uscita di main costava un giro di verifica e una correzione.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { aggiunteSottoUscite, registroDa, sottoUsciteSuMain, spostaInCima, FILE_NOVITA } from '../../scripts/lib/novita-in-cima.mjs';
import { riportaNelClone } from '../../scripts/routine-channel.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OGGI = '2026-11-04';

const scritta = (r) => (typeof r === 'string' ? `'${r}'` : `{ testo: '${r.testo}', segnalazione: ${r.segnalazione} }`);
/** Un registro scritto come quello vero: un blocco per oggetto, una proprietà e una riga per riga. */
function sorgente(blocchi) {
  const corpo = blocchi.map((b) => {
    let s = `    {\n      version: '${b.v}', date: '${b.d || '2026-11-01'}',\n`;
    for (const k of ['features', 'fixes']) if (b[k]) s += `      ${k}: [\n${b[k].map((r) => `        ${scritta(r)},\n`).join('')}      ],\n`;
    return `${s}    },\n`;
  }).join('');
  return `(function (global) {\n  'use strict';\n\n  const NOTES = [\n    // In cima il blocco della prossima versione.\n${corpo}  ];\n\n`
    + '  global.SN_PATCH_NOTES = { NOTES };\n})(typeof globalThis !== \'undefined\' ? globalThis : self);\n';
}
const R1 = { testo: 'Una novità del ramo', segnalazione: 1686 };
const R2 = 'Una correzione del ramo';

test('le righe del ramo sotto una versione uscita passano nel blocco in cima, e quelle di main restano dove sono', () => {
  // Il caso della segnalazione: il ramo ha scritto nel blocco 0.2.257 quando era in cima; main è alla 0.2.258.
  const main = [
    { v: '0.2.259', features: ['Di main, in arrivo'] },
    { v: '0.2.257', features: ['Di main, uscita'], fixes: ['Correzione di main, uscita'] },
    { v: '0.2.256', features: ['Vecchia'] },
  ];
  const ramo = [main[0], { ...main[1], features: [...main[1].features, R1], fixes: [...main[1].fixes, R2] }, main[2]];
  const r = spostaInCima(sorgente(ramo), { prima: registroDa(sorgente(main)), manifesto: { version: '0.2.258' }, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.verso, '0.2.259');
  assert.deepEqual(r.spostate.map((s) => [s.version, s.chiave, s.riga]),
    [['0.2.257', 'features', R1.testo], ['0.2.257', 'fixes', R2]]);
  assert.equal(r.src, sorgente([{ v: '0.2.259', features: ['Di main, in arrivo', R1], fixes: [R2] }, main[1], main[2]]));
  assert.deepEqual(aggiunteSottoUscite(registroDa(sorgente(main)), registroDa(r.src), '0.2.258'), []);
});

test('il blocco aperto dal ramo con un numero poi uscito sparisce, e le sue righe aprono il blocco della prossima versione', () => {
  const main = [{ v: '0.2.256', features: ['Vecchia'] }];
  const ramo = [{ v: '0.2.257', features: [R1], fixes: [R2] }, ...main];
  const r = spostaInCima(sorgente(ramo), { prima: registroDa(sorgente(main)), manifesto: { version: '0.2.257' }, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.src, sorgente([{ v: '0.2.258', d: OGGI, features: [R1], fixes: [R2] }, ...main]));
  // Un salto di versione dichiarato nel manifesto vale anche qui.
  const salto = spostaInCima(sorgente(ramo), { prima: registroDa(sorgente(main)), manifesto: { version: '0.2.257', prossimaVersione: '0.3.0' }, oggi: OGGI });
  assert.equal(salto.src, sorgente([{ v: '0.3.0', d: OGGI, features: [R1], fixes: [R2] }, ...main]));
});

test('un elenco che si svuota resta vuoto, e un elenco in cima scritto in una riga si apre', () => {
  const main = [{ v: '0.2.259', features: ['In arrivo'] }, { v: '0.2.257', features: ['Uscita'] }];
  const ramo = sorgente([main[0], { v: '0.2.257', features: ['Uscita', 'Nuova'], fixes: [R2] }])
    .replace("features: [\n        'In arrivo',\n      ],", "features: ['In arrivo'],");
  const r = spostaInCima(ramo, { prima: registroDa(sorgente(main)), manifesto: { version: '0.2.258' }, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  const atteso = sorgente([{ v: '0.2.259', features: ['In arrivo', 'Nuova'], fixes: [R2] }, { v: '0.2.257', features: ['Uscita'], fixes: ['_'] }])
    .replace("fixes: [\n        '_',\n      ],", 'fixes: [],');
  assert.equal(r.src, atteso);
});

test('una riga scritta su più righe si sposta intera, e niente si sposta se il ramo non ha scritto sotto versioni uscite', () => {
  const main = [{ v: '0.2.259', features: ['In arrivo'] }, { v: '0.2.257', features: ['Uscita'] }];
  const lunga = "{\n          testo: 'Su due righe, con una virgola, e una \\'citazione\\'',\n          segnalazione: 12,\n        }";
  const ramo = sorgente(main).replace("        'Uscita',\n", `        'Uscita',\n        ${lunga},\n`);
  const r = spostaInCima(ramo, { prima: registroDa(sorgente(main)), manifesto: { version: '0.2.258' }, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  assert.ok(r.src.includes(`        'In arrivo',\n        ${lunga},\n      ],`), r.src);
  assert.deepEqual([...registroDa(r.src)[1].features], ['Uscita']);

  const nessuna = sorgente([{ v: '0.2.259', features: ['In arrivo', 'Del ramo, al posto giusto'] }, main[1]]);
  const n = spostaInCima(nessuna, { prima: registroDa(sorgente(main)), manifesto: { version: '0.2.258' }, oggi: OGGI });
  assert.deepEqual([n.ok, n.spostate.length, n.src === nessuna], [true, 0, true]);
});

test('quando il registro non torna lo dice e non scrive niente', () => {
  const main = [{ v: '0.2.257', features: ['Uscita'] }];
  const prima = registroDa(sorgente(main));
  const doppio = spostaInCima(sorgente([{ v: '0.2.257', features: [R2, 'Altra'] }, ...main]), { prima, manifesto: { version: '0.2.258' }, oggi: OGGI });
  assert.equal(doppio.ok, false);
  assert.match(doppio.motivo, /0\.2\.257 compare due volte/);
  const sbagliato = spostaInCima(sorgente([{ v: '0.2.261', features: ['In cima col numero sbagliato'] }, { v: '0.2.257', features: ['Uscita', R2] }]),
    { prima, manifesto: { version: '0.2.258' }, oggi: OGGI });
  assert.equal(sbagliato.ok, false);
  assert.match(sbagliato.motivo, /0\.2\.261.*0\.2\.259/);
});

test('un ramo che riscrive una riga già scritta e ne aggiunge una nello stesso blocco: niente spostamento, la versione uscita resta', () => {
  // Spostarle tutte e due toglieva dal registro la versione uscita e ripresentava come nuova la riga già letta.
  const prima = registroDa(sorgente([{ v: '0.2.257', features: ['La barra si apre'] }, { v: '0.2.256', fixes: ['Vecchia'] }]));
  const ramo = sorgente([{ v: '0.2.257', features: ['La barra si apre anche con Ctrl+B', R1] }, { v: '0.2.256', fixes: ['Vecchia'] }]);
  const r = spostaInCima(ramo, { prima, manifesto: { version: '0.2.257' }, oggi: OGGI });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /0\.2\.257.*riscritto.*0\.2\.258/);
  // Solo riscritta, senza aggiunte: resta lecito e non si sposta niente.
  const soloRiscritta = spostaInCima(sorgente([{ v: '0.2.257', features: ['La barra si apre anche con Ctrl+B'] }, { v: '0.2.256', fixes: ['Vecchia'] }]),
    { prima, manifesto: { version: '0.2.257' }, oggi: OGGI });
  assert.equal(soloRiscritta.ok, true, soloRiscritta.motivo);
  assert.deepEqual(soloRiscritta.spostate, []);
});

test('sul registro vero: una riga aggiunta sotto l\'ultima versione uscita finisce nel blocco della prossima', () => {
  const vero = readFileSync(join(REPO, FILE_NOVITA), 'utf8');
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const prima = registroDa(vero);
  const uscito = prima.find((n) => n.features && n.features.length && globalThis.SN_PATCH_NOTES.cmpVersion(n.version, pkg.version) <= 0);
  const i = vero.indexOf(`version: '${uscito.version}'`);
  const j = vero.indexOf('features: [\n', i) + 'features: [\n'.length;
  const conRiga = `${vero.slice(0, j)}        'Riga tardiva di prova',\n${vero.slice(j)}`;
  const r = spostaInCima(conRiga, { prima, manifesto: pkg, oggi: OGGI });
  assert.equal(r.ok, true, r.motivo);
  const dopo = registroDa(r.src);
  assert.ok(dopo[0].features.includes('Riga tardiva di prova'), `in cima c'è ${dopo[0].version}`);
  assert.deepEqual(aggiunteSottoUscite(prima, dopo, pkg.version), []);
  // Tutto il resto è com'era.
  const senza = JSON.parse(JSON.stringify(dopo));
  senza[0].features = senza[0].features.filter((t) => t !== 'Riga tardiva di prova');
  // Un blocco in cima con le sole correzioni riceve da spostaInCima un `features` nuovo: tolta la riga, l'elenco non c'era (#2168).
  const cimaPrima = prima.find((n) => n.version === senza[0].version);
  if (!senza[0].features.length && !(cimaPrima && cimaPrima.features)) delete senza[0].features;
  assert.deepEqual(senza.filter((n) => (n.features || []).length + (n.fixes || []).length), JSON.parse(JSON.stringify(prima)));
});

// ── Nel clone: lo strumento, e le due strade di consegna del riallineamento ──

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identita = (dir) => { git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']); git(dir, ['config', 'commit.gpgsign', 'false']); };
const scrivi = (dir, file, testo) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), testo); };
const committa = (dir, msg) => { git(dir, ['add', '-A']); git(dir, ['commit', '-qm', msg]); return git(dir, ['rev-parse', 'HEAD']); };
const fatte = [];
test.after(() => { for (const d of fatte) { try { togliCartella(d); } catch (_) {} } });

const VECCHIE = ['Prima', 'Seconda', 'Terza', 'Quarta', 'Quinta'];
/**
 * origin con main alla 0.2.256 e il ramo verificato, che scrive nel blocco 0.2.257 in cima; poi da un'altra cartella
 * esce la 0.2.257 e main apre il blocco 0.2.258. La cartella ha scaricato main e rifatto la base: niente conflitti.
 */
function scena({ rebase = true } = {}) {
  const base = cartellaTemporanea('novita-in-cima-');
  fatte.push(base);
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  const altro = join(base, 'altro');
  mkdirSync(origin); mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  identita(work);
  // Il default di Git for Windows, e la regola del repo vero che lo batte: senza, il rebase riscrive il registro a CRLF
  // e il confronto è rosso solo su Windows (#2135).
  git(work, ['config', 'core.autocrlf', 'true']);
  git(work, ['remote', 'add', 'origin', origin]);
  scrivi(work, '.gitattributes', '* text=auto eol=lf\n');
  scrivi(work, '.gitignore', 'stato/\n.claude/\n');
  scrivi(work, 'package.json', '{\n  "name": "filo",\n  "version": "0.2.256"\n}\n');
  scrivi(work, FILE_NOVITA, sorgente([{ v: '0.2.257', features: ['Di main, in arrivo'] }, { v: '0.2.256', features: VECCHIE }]));
  committa(work, 'inizio');
  git(work, ['push', '-q', 'origin', 'main']);
  git(work, ['remote', 'set-head', 'origin', 'main']);
  git(work, ['checkout', '-qb', 'worker/77']);
  scrivi(work, FILE_NOVITA, sorgente([{ v: '0.2.257', features: ['Di main, in arrivo', R1] }, { v: '0.2.256', features: VECCHIE }]));
  const verificato = committa(work, 'il lavoro di #77');
  git(work, ['push', '-q', 'origin', 'worker/77']);
  execFileSync('git', ['clone', '-q', origin, altro], { stdio: 'ignore' });
  identita(altro);
  scrivi(altro, 'package.json', '{\n  "name": "filo",\n  "version": "0.2.257"\n}\n');
  committa(altro, 'esce la 0.2.257');
  scrivi(altro, FILE_NOVITA, `${sorgente([{ v: '0.2.258', features: ['Di main, dopo'] }, { v: '0.2.257', features: ['Di main, in arrivo'] }, { v: '0.2.256', features: VECCHIE }])}`);
  committa(altro, 'apre il blocco 0.2.258');
  git(altro, ['push', '-q', 'origin', 'main']);
  git(work, ['fetch', '-q', 'origin', 'main']);
  if (rebase) git(work, ['rebase', '-q', 'origin/main']);
  return { origin, work, verificato };
}
const ATTESO = sorgente([{ v: '0.2.258', features: ['Di main, dopo', R1] }, { v: '0.2.257', features: ['Di main, in arrivo'] }, { v: '0.2.256', features: VECCHIE }]);

test('lo strumento dopo il rebase: sposta, committa solo il registro, e una seconda volta non trova niente', async () => {
  const s = scena();
  const prima = registroDa(git(s.work, ['show', `origin/main:${FILE_NOVITA}`]));
  assert.equal(aggiunteSottoUscite(prima, registroDa(readFileSync(join(s.work, FILE_NOVITA), 'utf8')), '0.2.257').length, 1,
    'la scena riproduce la segnalazione: dopo il rebase la riga del ramo è sotto la 0.2.257 uscita');
  const cli = execFileSync(process.execPath, [join(REPO, 'scripts', 'novita-in-cima.mjs'), '--commit'],
    { encoding: 'utf8', env: { ...process.env, FILO_REPO_ROOT: s.work, FILO_ROUTINE: '' } });
  assert.match(cli, /una riga del ramo era sotto versioni già uscite, ora sta nel blocco 0\.2\.258 \(commit [0-9a-f]{9}\)/);
  assert.equal(readFileSync(join(s.work, FILE_NOVITA), 'utf8'), ATTESO);
  assert.equal(git(s.work, ['status', '--porcelain']), '');
  assert.equal(git(s.work, ['show', '--name-only', '--format=', 'HEAD']), FILE_NOVITA);
  const ancora = await riportaNelClone(s.work, { commit: true, env: {} });
  assert.deepEqual([ancora.ok, ancora.spostate.length, ancora.commit], [true, 0, '']);
});

test('prima del rebase lo strumento riconosce la riga che finirà sotto la versione uscita su main, e non tocca il ramo (#2130)', async () => {
  const s = scena({ rebase: false });
  const sulRamo = readFileSync(join(s.work, FILE_NOVITA), 'utf8');
  const base = git(s.work, ['merge-base', 'HEAD', 'origin/main']);
  const prima = registroDa(git(s.work, ['show', `${base}:${FILE_NOVITA}`]));
  assert.deepEqual(aggiunteSottoUscite(prima, registroDa(sulRamo), '0.2.256'), [], 'sul ramo da solo la sentinella è verde');
  const cli = execFileSync(process.execPath, [join(REPO, 'scripts', 'novita-in-cima.mjs'), '--commit'],
    { encoding: 'utf8', env: { ...process.env, FILO_REPO_ROOT: s.work, FILO_ROUTINE: '' } });
  assert.match(cli, /una riga del ramo sta sotto la 0\.2\.257, uscita su main dopo la partenza del ramo\. Dopo il rebase su main le sposta questo strumento/);
  assert.match(cli, /in 0\.2\.257: Una novità del ramo/);
  assert.doesNotMatch(cli, /nessuna riga del ramo/);
  assert.equal(readFileSync(join(s.work, FILE_NOVITA), 'utf8'), sulRamo, 'il ramo com\'è resta com\'è');
  assert.equal(git(s.work, ['rev-parse', 'HEAD']), s.verificato);
  const r = await riportaNelClone(s.work, { commit: true, env: {} });
  assert.deepEqual([r.ok, r.spostate.length, r.uscitaSuMain, r.inAttesa], [true, 0, '0.2.257', [{ version: '0.2.257', riga: 'Una novità del ramo' }]]);
  // Il riallineamento: dopo il rebase la stessa riga si sposta, e l'avviso sparisce.
  git(s.work, ['rebase', '-q', 'origin/main']);
  const dopo = await riportaNelClone(s.work, { commit: true, env: {} });
  assert.deepEqual([dopo.ok, dopo.spostate.length, dopo.verso, dopo.inAttesa], [true, 1, '0.2.258', undefined]);
  assert.equal(readFileSync(join(s.work, FILE_NOVITA), 'utf8'), ATTESO);
});

test('senza --commit lo strumento dice cosa sposterebbe e non tocca il ramo, anche con una riga da spostare davvero', () => {
  // Chi verifica lo lancia così per riconoscere il caso: la correzione nel suo ramo finirebbe col commit della verifica.
  const s = scena();
  const sulRamo = readFileSync(join(s.work, FILE_NOVITA), 'utf8');
  const punta = git(s.work, ['rev-parse', 'HEAD']);
  const cli = execFileSync(process.execPath, [join(REPO, 'scripts', 'novita-in-cima.mjs')],
    { encoding: 'utf8', env: { ...process.env, FILO_REPO_ROOT: s.work, FILO_ROUTINE: '' } });
  assert.match(cli, /una riga del ramo sta sotto versioni già uscite alla partenza del ramo e va nel blocco 0\.2\.258\. Non ho toccato niente/);
  assert.match(cli, /in 0\.2\.257: Una novità del ramo/);
  assert.equal(readFileSync(join(s.work, FILE_NOVITA), 'utf8'), sulRamo);
  assert.equal(git(s.work, ['status', '--porcelain']), '');
  assert.equal(git(s.work, ['rev-parse', 'HEAD']), punta);
});

test('l\'avviso vale solo per una versione di main più alta di quella del ramo', () => {
  const prima = [{ version: '0.2.257', features: ['in arrivo'] }, { version: '0.2.256', features: ['uscita'] }];
  const dopo = [{ version: '0.2.257', features: ['in arrivo', 'del ramo'] }, { version: '0.2.256', features: ['uscita'] }];
  const ramo = { version: '0.2.256' };
  assert.deepEqual(sottoUsciteSuMain(prima, dopo, ramo, '0.2.257'), [{ version: '0.2.257', riga: 'del ramo' }]);
  assert.deepEqual(sottoUsciteSuMain(prima, dopo, ramo, '0.2.30'), [], 'confronto fra numeri: 0.2.30 viene prima di 0.2.256');
  for (const v of ['0.2.256', '0.2.255', '', 'v0.2.257', undefined]) assert.deepEqual(sottoUsciteSuMain(prima, dopo, ramo, v), [], String(v));
  assert.deepEqual(sottoUsciteSuMain(prima, dopo, {}, '0.2.257'), []);
  // Una riga scritta nel blocco ancora in arrivo anche su main non aspetta niente.
  assert.deepEqual(sottoUsciteSuMain(prima, dopo, ramo, '0.2.256'), []);
});

test('lo strumento non tocca niente a metà di un rebase né con il registro già modificato', async () => {
  const s = scena();
  scrivi(s.work, FILE_NOVITA, `${readFileSync(join(s.work, FILE_NOVITA), 'utf8')}// a mano\n`);
  const sporco = await riportaNelClone(s.work, { commit: true, env: {} });
  assert.equal(sporco.ok, false);
  assert.match(sporco.motivo, /modifiche fuori dai commit/);
  assert.ok(readFileSync(join(s.work, FILE_NOVITA), 'utf8').endsWith('// a mano\n'), 'il file non è stato riscritto');
  git(s.work, ['checkout', '-q', '--', FILE_NOVITA]);
  writeFileSync(join(git(s.work, ['rev-parse', '--absolute-git-dir']), 'MERGE_HEAD'), `${git(s.work, ['rev-parse', 'HEAD'])}\n`);
  const aMeta = await riportaNelClone(s.work, { commit: true, env: {} });
  assert.equal(aMeta.ok, false);
  assert.match(aMeta.motivo, /una fusione è a metà/);
});

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}
const esegui = (script, argv, env, cwd) => new Promise((r) => {
  execFile(process.execPath, [resolve(REPO, 'scripts', script), ...argv], { env: { ...process.env, FILO_NO_BEAT: '1', ...env }, cwd },
    (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
});

for (const [strada, argv] of [
  ['dispatch --record-fixed', (rep) => ['dispatch.mjs', ['--record-fixed', 'fid-77', rep, '--motivo', 'conflitto: nessuno']]],
  ['deliver fixed', (rep) => ['routine-channel.mjs', ['deliver', 'b'.repeat(43), 'fixed', '--notes', rep, '--motivo', 'conflitto: nessuno']]],
]) {
  test(`${strada}: il riallineamento spedisce il ramo con le righe già nel blocco della prossima versione`, async (t) => {
    const { srv, ricevuti, port } = await fintoServer();
    t.after(() => srv.close());
    const s = scena();
    const stato = join(s.work, 'stato');
    mkdirSync(stato, { recursive: true });
    writeFileSync(join(stato, 'fid-77.json'), JSON.stringify({ id: 'fid-77', branch: 'worker/77', loopCount: 1, verifierVerdict: 'pass' }));
    mkdirSync(join(s.work, '.claude'), { recursive: true });
    writeFileSync(join(s.work, '.claude', 'routine-role.json'), JSON.stringify({ role: 'fixer', since: new Date().toISOString(), dal: s.verificato }));
    const env = {
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: s.work, FILO_DISPATCH_STATE_DIR: stato,
      FILO_ROUTINES_ENABLED: '1', FILO_ROUTINE_TICKET: 'b'.repeat(43), FILO_ROUTINE: '',
    };
    const [script, args] = argv('Riallineato su main: nessun conflitto, nessuna riga del lavoro toccata in questo giro.');
    const r = await esegui(script, args, env, s.work);
    assert.equal(r.code, 0, r.se);
    assert.match(r.se, /Novità: una riga del ramo era sotto versioni già uscite, ora sta nel blocco 0\.2\.258/);
    const punta = git(s.work, ['rev-parse', 'HEAD']);
    assert.equal(git(s.origin, ['rev-parse', 'refs/heads/worker/77']), punta, 'su origin c\'è la punta con lo spostamento');
    assert.equal(git(s.origin, ['show', `${punta}:${FILE_NOVITA}`]), ATTESO.trimEnd());
    const consegne = ricevuti.filter((x) => x.url.includes('routineDeliver'));
    assert.equal(consegne.length, 1);
    assert.equal(consegne[0].body.data.sha, punta);
  });
}
