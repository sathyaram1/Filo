// #1363: dopo il verdetto del verificatore un sotto-agente legge il diff con la richiesta davanti. La verifica piena
// (in cloud e in locale) lascia la richiesta, lo script stampa ruolo e fascicolo e lascia la ricevuta, e la critica
// senza ricevuta sul codice di adesso non si registra (le prove dei giri a parte).

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import {
  FILE_DIFF, FILE_DIFF_SERVER, letturaMancante, leggiRichiesta, leggiRicevuta, richiestaDalPayload, righeNumstat, scriviRichiesta, vociConPercorsoPrima,
} from '../../scripts/lib/lettura-diff.mjs';
import { cartellaConsegna } from '../../scripts/lib/consegna-file.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// I figli non ereditano radici di prova: gli strumenti sono quelli di questo repo.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['FILO_TOOLS_ROOT', 'FILO_REPO_ROOT', 'FILO_DISPATCH_STATE_DIR'].includes(k)));

test('dal payload del verificatore la richiesta prende il feedback e le scelte dell\'owner, non la serie delle critiche', () => {
  const r = richiestaDalPayload({
    branch: 'worker/x', id: 'f1', num: '#7', scope: 'pieno', history: [{ critique: '[2i] vecchio' }], historyDropped: 0,
    feedback: { name: 'titolo', text: '[nel file /t/01-feedback.text.txt, 3000 caratteri: …]' },
    decisioni: [{ domanda: 1 }], provvisorie: [{ domanda: 2 }], immagini: [{ id: 's1', file: '/t/immagine-s1.png' }],
    fileEsterni: { 'feedback.text': '/t/01-feedback.text.txt', 'history.0.critique': '/t/02-history.txt' },
  });
  assert.deepEqual(Object.keys(r).sort(), ['decisioni', 'feedback', 'fileEsterni', 'id', 'immagini', 'num', 'provvisorie']);
  assert.deepEqual(r.fileEsterni, { 'feedback.text': '/t/01-feedback.text.txt' });
  assert.deepEqual(richiestaDalPayload({ feedback: { text: 'x' } }), { feedback: { text: 'x' } });
});

test('le uscite di git con -z: spostamenti con i due percorsi, binari a zero righe', () => {
  assert.deepEqual(vociConPercorsoPrima('M\u0000a.js\u0000R087\u0000tests/x.spec.mjs\u0000tests/y.spec.mjs\u0000A\u0000b c.js\u0000'), [
    { stato: 'M', prima: 'a.js', percorso: 'a.js' },
    { stato: 'R', prima: 'tests/x.spec.mjs', percorso: 'tests/y.spec.mjs' },
    { stato: 'A', prima: 'b c.js', percorso: 'b c.js' },
  ]);
  assert.deepEqual(righeNumstat('3\t1\tsrc/a.js\u0000-\t-\timg.png\u00002\t0\t\u0000vecchio.js\u0000nuovo.js\u0000'), [
    { percorso: 'src/a.js', aggiunte: 3, tolte: 1 },
    { percorso: 'img.png', aggiunte: 0, tolte: 0 },
    { percorso: 'nuovo.js', aggiunte: 2, tolte: 0 },
  ]);
});

/** Un ramo di lavoro con codice, una prova e una prova del giro, e lo stato locale della verifica. */
function ramoDiLavoro() {
  const casa = cartellaTemporanea('filo-lettura-diff-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: casa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(casa, f)), { recursive: true }); writeFileSync(resolve(casa, f), t, 'utf8'); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', 'stato/\n.claude/\n');
  scrivi('src/riquadro.js', 'const fondo = (h) => h - 8;\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'worker/1363');
  scrivi('src/riquadro.js', 'const fondo = (h) => Math.max(0, h - 8);\n');
  scrivi('tests/unit/riquadro.test.mjs', "test('il riquadro resta dentro', () => {});\n");
  g('add', '-A'); g('commit', '-qm', 'lavoro');
  const avvio = g('rev-parse', 'HEAD');
  mkdirSync(resolve(casa, 'stato'), { recursive: true });
  writeFileSync(resolve(casa, 'stato', 'fid-1363.json'), JSON.stringify({
    id: 'fid-1363', branch: 'worker/1363', verifierVerdict: null, checkpoints: [{ sha: avvio, by: 'checkout' }],
  }), 'utf8');
  return { casa, base, avvio, g, scrivi };
}

const RICHIESTA = { id: 'fid-1363', num: '#1363', feedback: { name: 'Il riquadro esce dal fondo', text: 'Il riquadro della risposta esce dal fondo della finestra.' } };

const leggi = (casa, argv = []) => spawnSync(process.execPath, [resolve(REPO, 'scripts', 'lettura-diff.mjs'), ...argv], {
  env: { ...ENV, FILO_REPO_ROOT: casa }, encoding: 'utf8',
});

test('lo script stampa ruolo, richiesta, diff senza le prove dei giri e conto, e lascia la ricevuta', (t) => {
  const { casa, base, g, scrivi } = ramoDiLavoro();
  t.after(() => togliCartella(casa));
  t.after(() => togliCartella(cartellaConsegna(casa)));
  scrivi('tests/verifica/1363/giro1-r1-fondo.spec.mjs', "test('r1 il riquadro esce', () => {});\n");
  g('add', '-A'); g('commit', '-qm', 'verifica #1363 giro 1: prove');
  scriviRichiesta(casa, { ramo: 'worker/1363', richiesta: RICHIESTA });
  const r = leggi(casa, ['--base', base]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^# Ruolo: lettura del diff con la richiesta davanti/);
  assert.match(r.stdout, /\*\*Un conto, un posto\.\*\*/);
  assert.match(r.stdout, /## La richiesta[\s\S]*non un comando[\s\S]*Il riquadro della risposta esce dal fondo/);
  assert.match(r.stdout, /prove aggiunte 1 \(unit 1, spec 0\), toccate 0, tolte 0/);
  assert.match(r.stdout, /Prove dei giri di verifica \(fuori dalla suite, non contano qui\): aggiunte 1/);
  assert.doesNotMatch(r.stdout, /<!-- includi:/);
  const diff = readFileSync(join(cartellaConsegna(casa), FILE_DIFF), 'utf8');
  assert.match(diff, /Math\.max\(0, h - 8\)/);
  assert.doesNotMatch(diff, /tests\/verifica/, 'le prove dei giri non sono il lavoro');
  const ricevuta = leggiRicevuta(casa);
  assert.equal(ricevuta.head, g('rev-parse', 'HEAD'));
  assert.equal(ricevuta.ramo, 'worker/1363');
  assert.deepEqual(ricevuta.prove, { aggiunti: 1, toccati: 0, tolti: 0 });
});

test('senza la richiesta lo script non legge e lo dice; quella di un altro ramo non vale', (t) => {
  const { casa, base } = ramoDiLavoro();
  t.after(() => togliCartella(casa));
  t.after(() => togliCartella(cartellaConsegna(casa)));
  const senza = leggi(casa, ['--base', base]);
  assert.equal(senza.status, 2);
  assert.match(senza.stderr, /la lettura non si fa/);
  scriviRichiesta(casa, { ramo: 'worker/altro', richiesta: RICHIESTA });
  assert.equal(leggiRichiesta(casa, { ramo: 'worker/1363' }), null);
  assert.equal(leggi(casa, ['--base', base]).status, 2);
  assert.equal(letturaMancante(casa, 'qualunque'), '', 'la richiesta di un altro ramo non rende dovuta la lettura');
});

test('la ricevuta regge alle prove del giro scritte dopo, non al codice cambiato dopo', (t) => {
  const { casa, base, g, scrivi } = ramoDiLavoro();
  t.after(() => togliCartella(casa));
  t.after(() => togliCartella(cartellaConsegna(casa)));
  const head = () => g('rev-parse', 'HEAD');
  assert.equal(letturaMancante(casa, head()), '', 'senza richiesta la lettura non è dovuta (chiusura, riallineamento)');
  scriviRichiesta(casa, { ramo: 'worker/1363', richiesta: RICHIESTA });
  assert.match(letturaMancante(casa, head()), /manca la lettura del diff/);
  assert.equal(leggi(casa, ['--base', base]).status, 0);
  assert.equal(letturaMancante(casa, head()), '');
  scrivi('tests/verifica/1363/giro1-r1-fondo.spec.mjs', "test('r1 rosso', () => {});\n");
  g('add', '-A'); g('commit', '-qm', 'verifica: prove');
  assert.equal(letturaMancante(casa, head()), '', 'le prove del giro non fanno decadere la lettura');
  scrivi('src/riquadro.js', 'const fondo = (h) => h;\n');
  g('add', '-A'); g('commit', '-qm', 'codice');
  const msg = letturaMancante(casa, head());
  assert.match(msg, /è cambiato il codice \(src\/riquadro\.js\)/);
  assert.equal(leggi(casa, ['--base', base]).status, 0);
  assert.equal(letturaMancante(casa, head()), '');
});

/** Il repo del server di un lavoro server: main, il ramo omonimo con la correzione e la sua prova, main andato avanti. */
function cloneDelServer(ramo) {
  const srv = cartellaTemporanea('filo-lettura-server-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: srv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(srv, f)), { recursive: true }); writeFileSync(resolve(srv, f), t, 'utf8'); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('functions/battito.js', 'const scrivi = (doc, misura) => doc.mergeFields(misura);\n');
  g('add', '-A'); g('commit', '-qm', 'base del server');
  g('checkout', '-q', '-b', ramo);
  scrivi('functions/battito.js', 'const scrivi = (doc, misura) => doc.sostituisciSulBiglietto(misura);\n');
  scrivi('functions/test/battito-misura.test.js', "test('la misura nuova sostituisce quella vecchia, intera', () => {});\n");
  g('add', '-A'); g('commit', '-qm', 'il battito sostituisce la misura');
  g('checkout', '-q', 'main');
  scrivi('functions/altro.js', 'const dopo = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'main del server va avanti');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { srv, g };
}

test('un lavoro server: la lettura legge anche il diff del server con le sue prove, o dice che quella parte non l\'ha letta (#2049)', (t) => {
  const { casa, base } = ramoDiLavoro();
  const { srv, g: gs } = cloneDelServer('worker/1363');
  t.after(() => togliCartella(casa));
  t.after(() => togliCartella(srv));
  t.after(() => togliCartella(cartellaConsegna(casa)));
  const fileServer = join(cartellaConsegna(casa), FILE_DIFF_SERVER);
  scriviRichiesta(casa, { ramo: 'worker/1363', richiesta: RICHIESTA, radiceServer: srv });
  const r = leggi(casa, ['--base', base]);
  assert.equal(r.status, 0, r.stderr);
  const server = r.stdout.slice(r.stdout.indexOf('## Il diff del server'));
  assert.match(server, /^## Il diff del server\n\nQuesto è un lavoro server\. Il ramo `worker\/1363` di filo-security/);
  assert.match(server, /## Le prove del server contate\n\nProve del lavoro, contate dallo script: prove aggiunte 1 \(unit 1, spec 0\)/);
  assert.match(server, /functions\/test\/battito-misura\.test\.js \(unit\): aggiunti 1: «la misura nuova sostituisce quella vecchia, intera»/);
  assert.match(server, /Codice cambiato fuori da functions\/test\/: 1 file, \+1 −1 righe\.\n- functions\/battito\.js/);
  const diffServer = readFileSync(fileServer, 'utf8');
  assert.match(diffServer, /sostituisciSulBiglietto/);
  assert.doesNotMatch(diffServer, /altro\.js/, 'il main del server andato avanti dopo il ramo non è il lavoro');
  assert.doesNotMatch(readFileSync(join(cartellaConsegna(casa), FILE_DIFF), 'utf8'), /sostituisciSulBiglietto/);
  assert.match(r.stdout, /Un lavoro server ha in fondo anche «Il diff del server»/, 'il ruolo dice come leggerlo');

  gs('update-ref', 'refs/remotes/origin/worker/1363', 'worker/1363');
  gs('branch', '-q', '-D', 'worker/1363');
  assert.match(leggi(casa, ['--base', base]).stdout, /Questo è un lavoro server\. Il ramo `worker\/1363` di filo-security/, 'il ramo solo scaricato da origin si legge lo stesso');
  assert.match(readFileSync(fileServer, 'utf8'), /sostituisciSulBiglietto/);

  gs('update-ref', 'refs/remotes/origin/worker/1363', 'main~1');
  assert.match(leggi(casa, ['--base', base]).stdout, /Questo è un lavoro server, ma il ramo worker\/1363 del server non ha commit fuori dal main del server: lì non c'è niente da leggere\./);

  gs('update-ref', '-d', 'refs/remotes/origin/worker/1363');
  const senzaRamo = leggi(casa, ['--base', base]);
  assert.equal(senzaRamo.status, 0, senzaRamo.stderr);
  assert.match(senzaRamo.stdout, /## Il diff del server\n\nQuesto è un lavoro server, ma la parte di filo-security non si è potuta leggere: in .* il ramo worker\/1363 non c'è, né locale né scaricato da origin\./);
  assert.ok(!existsSync(fileServer), 'il diff del server di una lettura passata non resta lì come se fosse questo');

  scriviRichiesta(casa, { ramo: 'worker/1363', richiesta: RICHIESTA, radiceServer: join(srv, 'non-clonato') });
  assert.match(leggi(casa, ['--base', base]).stdout, /la parte di filo-security non si è potuta leggere: il clone del server non c'è/);

  scriviRichiesta(casa, { ramo: 'worker/1363', richiesta: RICHIESTA });
  const app = leggi(casa, ['--base', base]);
  assert.equal(app.status, 0, app.stderr);
  assert.doesNotMatch(app.stdout, /## Il diff del server/, 'un lavoro solo dell\'app non ha la sezione del server');
  gs('update-ref', 'refs/remotes/origin/worker/1363', 'main~1');
  gs('branch', '-q', 'worker/1363', 'main~1');
  gs('checkout', '-q', 'worker/1363');
  writeFileSync(join(srv, 'functions', 'battito.js'), 'const scrivi = (doc, misura) => doc.set(misura);\n', 'utf8');
  gs('commit', '-qam', 'a mano');
  const aMano = leggi(casa, ['--base', base, '--server', srv]);
  assert.match(aMano.stdout, /Questo è un lavoro server\. Il ramo `worker\/1363`/, 'lanciata a mano col server, la lettura lo legge');
  assert.match(readFileSync(fileServer, 'utf8'), /doc\.set\(misura\)/, 'la punta locale vince su quella scaricata');
});

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      ricevuti.push({ url: req.url });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, ...(req.url.includes('routineDeliver') ? { reply: { outcome: 'pass' } } : {}) }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

const registra = (casa, port, critica) => new Promise((r) => {
  execFile(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--record-verifier', 'fid-1363', critica], {
    env: {
      ...ENV, FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa, FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
      FILO_ROUTINES_ENABLED: '1', FILO_ROUTINE_TICKET: 'biglietto-di-prova', FILO_ROUTINE_ROLE: 'verifier', FILO_NO_BEAT: '1',
    },
  }, (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, out: String(so || '') + String(se || '') }));
});

test('la verifica piena non registra la critica senza la lettura: fatta la lettura, passa', async (t) => {
  const { casa, base } = ramoDiLavoro();
  t.after(() => togliCartella(casa));
  t.after(() => togliCartella(cartellaConsegna(casa)));
  const { srv, ricevuti, port } = await fintoServer();
  t.after(() => srv.close());
  scriviRichiesta(casa, { ramo: 'worker/1363', richiesta: RICHIESTA });
  const critica = 'Provato il riquadro in fondo alla finestra, da tasto destro e scorciatoia: resta dentro.';
  const fermo = await registra(casa, port, critica);
  assert.equal(fermo.code, 1, fermo.out);
  assert.match(fermo.out, /manca la lettura del diff/);
  assert.ok(!ricevuti.some((x) => x.url.includes('routineDeliver')), 'il verdetto non parte senza la lettura');
  assert.equal(leggi(casa, ['--base', base]).status, 0);
  const ok = await registra(casa, port, `${critica}\nLettura del diff: prove aggiunte 1 (unit 1, spec 0), toccate 0, tolte 0. Il conto sta in un posto.`);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /verifica superata/);
  assert.ok(ricevuti.some((x) => x.url.includes('routineDeliver')));
});

test('la consegna di una verifica piena lascia la richiesta al lettore; la chiusura no', async (t) => {
  const radice = cartellaTemporanea('filo-lettura-emit-');
  t.after(() => togliCartella(radice));
  t.after(() => togliCartella(cartellaConsegna(radice)));
  Object.assign(process.env, { FILO_REPO_ROOT: radice, FILO_DISPATCH_STATE_DIR: join(radice, 'stato') });
  const { emit } = await import('../../scripts/dispatch.mjs');
  const zitto = (fn) => { const w = process.stdout.write; process.stdout.write = () => true; try { fn(); } finally { process.stdout.write = w; } };
  const ctx = { feedback: { name: 'Il riquadro esce', text: 'esce dal fondo' }, history: [{ critique: '[2i] vecchio' }], decisioni: [{ domanda: 4 }] };
  zitto(() => emit({ role: 'verifier', id: 'f9', num: '#9', branch: 'worker/9' }, ctx));
  const r = leggiRichiesta(radice);
  assert.ok(r, 'la richiesta c\'è');
  assert.equal(r.richiesta.feedback.text, 'esce dal fondo');
  assert.deepEqual(r.richiesta.decisioni, [{ domanda: 4 }]);
  assert.equal(r.richiesta.history, undefined, 'la serie delle critiche al lettore non serve');
  assert.equal(r.radiceServer, undefined, 'un lavoro solo dell\'app non manda il lettore nel server');
  const clonePrima = process.env.FILO_SERVER_CLONE;
  process.env.FILO_SERVER_CLONE = join(radice, '..', 'clone-del-server');
  try {
    zitto(() => emit({ role: 'verifier', id: 'f9', num: '#9', branch: 'worker/9' }, { ...ctx, lavoroServer: { repo: 'sathyaram1/filo-security' } }));
  } finally {
    if (clonePrima === undefined) delete process.env.FILO_SERVER_CLONE; else process.env.FILO_SERVER_CLONE = clonePrima;
  }
  assert.equal(leggiRichiesta(radice).radiceServer, resolve(radice, '..', 'clone-del-server'), 'un lavoro server dice al lettore dove sta il clone (#2049)');
  zitto(() => emit({ role: 'verifier', id: 'f9', num: '#9', branch: 'worker/9' }, { ...ctx, scope: 'chiusura', perimetro: { rilievi: [] } }));
  assert.equal(leggiRichiesta(radice), null, 'nella chiusura il diff lo legge chi verifica: la lettura non è dovuta');
  assert.ok(!existsSync(join(cartellaConsegna(radice), 'lettura-richiesta.json')));
});

test('i testi: la verifica piena lancia la lettura, chiusura e chi risolve si fanno le due domande, il lettore non scrive', async () => {
  const { espandiInclusioni } = await import('../../scripts/lib/role-text.mjs');
  const dir = join(REPO, 'routines', 'roles');
  const ruolo = (n) => espandiInclusioni(readFileSync(join(dir, n), 'utf8'), dir).replace(/\s+/g, ' ');
  const verifica = ruolo('verifier.md');
  assert.match(verifica, /## La lettura del diff, dopo il tuo verdetto/);
  assert.match(verifica, /`subagent_type: routine-lettura`/);
  assert.match(verifica, /> Lancia `node scripts\/lettura-diff\.mjs`/, 'il comando si riscrive verso gli strumenti fissati');
  assert.match(verifica, /Il diff tu continui a non vederlo/);
  for (const n of ['verifier-chiusura.md', 'resolver.md', 'resolver-ripresa.md', 'lettura-diff.md']) {
    assert.match(ruolo(n), /\*\*Un conto, un posto\.\*\*[\s\S]*\*\*Prove che bastano\.\*\*/, n);
  }
  for (const n of ['verifier-riallineamento.md', 'secaudit.md']) assert.doesNotMatch(ruolo(n), /Un conto, un posto/, n);
  const lettore = ruolo('lettura-diff.md');
  assert.match(lettore, /non modifichi file e non fai commit/);
  assert.match(lettore, /## Il livello dei tuoi rilievi[\s\S]*Il metro è la frequenza/);
  const agente = readFileSync(join(REPO, '.claude', 'agents', 'routine-lettura.md'), 'utf8');
  assert.match(agente, /^tools: Bash, Read, Grep, Glob$/m, 'il lettore non ha strumenti per scrivere');
});

test('in locale come in cloud: start lascia la richiesta, la critica aspetta la lettura', async (t) => {
  const { avviaConfigRoutinesFinto } = await import('../helpers/server-finto.mjs');
  const finto = await avviaConfigRoutinesFinto({ FINTO_CAPS: JSON.stringify({ cap3: 5, cap2: 5, cap1: 2, cap0: 0 }) });
  t.after(() => finto.kill());
  const { casa, g } = ramoDiLavoro();
  t.after(() => togliCartella(casa));
  t.after(() => togliCartella(cartellaConsegna(casa)));
  const env = { ...ENV, FILO_REPO_ROOT: casa, FILO_ROUTINE_CONFIG_URL: finto.url, FILO_ADMIN_ID_TOKEN: 'finto-id-token' };
  const vl = (...a) => spawnSync(process.execPath, [resolve(REPO, 'scripts', 'verify-local.mjs'), ...a], { cwd: casa, env, encoding: 'utf8' });
  const avvio = vl('start', 'Il riquadro della risposta esce dal fondo della finestra.');
  assert.equal(avvio.status, 0, avvio.stderr);
  assert.equal(leggiRichiesta(casa, { ramo: 'worker/1363' }).richiesta, 'Il riquadro della risposta esce dal fondo della finestra.');
  const critica = 'Provato il riquadro in fondo alla finestra, da tasto destro e scorciatoia, con risposte lunghe: resta dentro.';
  const fermo = vl('critica', critica);
  assert.equal(fermo.status, 1);
  assert.match(fermo.stderr, /manca la lettura del diff/);
  const lettura = spawnSync(process.execPath, [resolve(REPO, 'scripts', 'lettura-diff.mjs'), '--base', g('rev-parse', 'main')], { env, encoding: 'utf8' });
  assert.equal(lettura.status, 0, lettura.stderr);
  assert.match(lettura.stdout, /Il riquadro della risposta esce dal fondo della finestra\./);
  const ok = vl('critica', critica);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /verifica superata/);
});
