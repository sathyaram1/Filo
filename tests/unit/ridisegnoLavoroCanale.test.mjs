// Le porte degli strumenti per il ridisegno del lavoro (SPEC-RIDISEGNO-LAVORO.md): il biglietto di UN feedback, il
// piano che riceve chi riprende, la chiusura «già risolto su main» con la fusione che lo prova, e il motivo del
// correttore, senza il quale la correzione non parte. Server finto: si guarda cosa gli arriva, e cosa no.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Preflight e biglietto scrivono nelle impostazioni utente: mai in quelle vere.
process.env.CLAUDE_CONFIG_DIR = cartellaTemporanea('filo-claude-utente-');

/** Server finto; `ignoraFeedback`: un server vecchio, che alla richiesta per numero dà il primo della coda. */
function fintoServer({ ignoraFeedback = false } = {}) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      const biglietto = { ok: true, work: true, ticket: 'b'.repeat(43), role: 'new-work', ...(j.feedback && !ignoraFeedback ? { feedback: j.feedback } : {}) };
      res.end(JSON.stringify(req.url.includes('routineTicket') ? biglietto : { ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

const esegui = (script, argv, env, cwd) => new Promise((r) => {
  execFile(process.execPath, [resolve(REPO, 'scripts', script), ...argv], { env: { ...process.env, FILO_NO_BEAT: '1', ...env }, cwd },
    (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
});

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** main con una fusione che cita #77, origin/main su di lei, e la cartella sul ramo del lavoro. */
function deposito() {
  const casa = cartellaTemporanea('ridisegno-lavoro');
  git(casa, ['init', '-q', '-b', 'main']);
  git(casa, ['config', 'user.email', 't@t']); git(casa, ['config', 'user.name', 't']); git(casa, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(casa, '.gitignore'), 'stato/\n.claude/\n');
  writeFileSync(join(casa, 'a.js'), 'uno\n');
  git(casa, ['add', '-A']); git(casa, ['commit', '-qm', 'inizio']);
  git(casa, ['checkout', '-qb', 'altro']);
  writeFileSync(join(casa, 'a.js'), 'due\n');
  git(casa, ['commit', '-qam', 'dentro il ramo #77']);
  const dentro = git(casa, ['rev-parse', 'HEAD']);
  git(casa, ['checkout', '-q', 'main']);
  git(casa, ['merge', '-q', '--no-ff', 'altro', '-m', 'merge-gate: #75 via server (chiude anche #77)']);
  const fusione = git(casa, ['rev-parse', 'HEAD']);
  git(casa, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(casa, ['checkout', '-qb', 'worker/77']);
  return { casa, fusione, dentro };
}

test('ticket --feedback chiede il biglietto di quel feedback; un numero storto si ferma prima del server', async (t) => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = cartellaTemporanea('ticket-feedback');
  t.after(() => { srv.close(); togliCartella(casa); });
  const env = { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa };
  const r = await esegui('routine-channel.mjs', ['ticket', 'parola-segreta', '--feedback', '#1680', '--json'], env);
  assert.equal(r.code, 0, r.se);
  const chiesta = ricevuti.find((x) => x.url.includes('routineTicket'));
  assert.equal(chiesta.body.feedback, '1680');
  assert.equal(chiesta.body.passphrase, 'parola-segreta');
  const prima = ricevuti.length;
  const storto = await esegui('routine-channel.mjs', ['ticket', 'parola-segreta', '--feedback', 'tutti'], env);
  assert.equal(storto.code, 1);
  assert.match(storto.se, /--feedback vuole un numero di feedback/);
  const fuori = await esegui('routine-channel.mjs', ['deliver', 'b'.repeat(43), 'note', '--notes', 'x', '--feedback', '12'], env);
  assert.equal(fuori.code, 1);
  assert.match(fuori.se, /--feedback vale solo con ticket/);
  assert.equal(ricevuti.length, prima, 'nessuna delle due è arrivata al server');
});

test('un server che alla richiesta per numero dà un altro feedback: il biglietto si restituisce e non si lavora', async (t) => {
  const { srv, ricevuti, port } = await fintoServer({ ignoraFeedback: true });
  const casa = cartellaTemporanea('ticket-feedback-vecchio');
  t.after(() => { srv.close(); togliCartella(casa); });
  const r = await esegui('routine-channel.mjs', ['ticket', 'parola-segreta', '--feedback', '1680', '--json'], { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa });
  assert.equal(r.code, 3);
  assert.equal(r.so.trim(), '', 'nessun biglietto stampato da usare');
  assert.match(r.se, /chiesto il biglietto di #1680.*Biglietto restituito/);
  const reso = ricevuti.find((x) => x.url.includes('routineRelease'));
  assert.equal(reso && reso.body.ticket, 'b'.repeat(43));
});

test('deliver piano manda il piano intero da file; vuoto, troppo lungo o con altri campi non parte', async (t) => {
  const { srv, ricevuti, port } = await fintoServer();
  const { casa } = deposito();
  t.after(() => { srv.close(); togliCartella(casa); });
  const env = { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa };
  const piano = join(casa, 'stato', 'piano.md');
  mkdirSync(dirname(piano), { recursive: true });
  const testo = '# Piano\n1. #12: il menu (fatto)\n2. #13: la scorciatoia\n';
  writeFileSync(piano, testo);
  const r = await esegui('routine-channel.mjs', ['deliver', 'b'.repeat(43), 'piano', '--piano', piano], env);
  assert.equal(r.code, 0, r.se);
  const d = ricevuti.find((x) => x.url.includes('routineDeliver')).body;
  assert.equal(d.intent, 'piano');
  assert.equal(d.data.piano, testo);
  const prima = ricevuti.length;
  writeFileSync(piano, '  \n');
  assert.match((await esegui('routine-channel.mjs', ['deliver', 'b'.repeat(43), 'piano', '--piano', piano], env)).se, /è vuoto/);
  writeFileSync(piano, 'x'.repeat(64 * 1024 + 1));
  assert.match((await esegui('routine-channel.mjs', ['deliver', 'b'.repeat(43), 'piano', '--piano', piano], env)).se, /65537 byte, il massimo è 65536/);
  writeFileSync(piano, testo);
  assert.match((await esegui('routine-channel.mjs', ['deliver', 'b'.repeat(43), 'piano', '--piano', piano, '--notes', 'x'], env)).se, /vuole solo --piano/);
  assert.match((await esegui('routine-channel.mjs', ['deliver', 'b'.repeat(43), 'note', '--notes', 'x', '--piano', piano], env)).se, /--piano vale solo con deliver piano/);
  assert.equal(ricevuti.length, prima, 'nessun tentativo storto è arrivato al server');
});

test('già risolto su main: parte solo con una fusione della linea principale, il report e la frase', async (t) => {
  const { srv, ricevuti, port } = await fintoServer();
  const { casa, fusione, dentro } = deposito();
  t.after(() => { srv.close(); togliCartella(casa); });
  const env = { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa };
  const base = ['deliver', 'b'.repeat(43), 'status', '--status', 'done', '--reason', 'gia_risolto'];
  const testi = ['--notes', 'La fusione cambia il punto segnalato: il menu ora si apre.', '--frase', 'Il menu si apre di nuovo.'];
  const r = await esegui('routine-channel.mjs', [...base, '--fusione', fusione.slice(0, 10), ...testi], env);
  assert.equal(r.code, 0, r.se);
  const d = ricevuti.find((x) => x.url.includes('routineDeliver')).body.data;
  assert.equal(d.status, 'done');
  assert.equal(d.reason, 'gia_risolto');
  assert.equal(d.fusione, fusione, 'lo sha arriva intero');
  assert.equal(d.userNote, 'Il menu si apre di nuovo.');
  const prima = ricevuti.length;
  const casi = [
    [[...base, '--fusione', dentro, ...testi], /non è una fusione sulla linea principale/],
    [[...base, '--fusione', 'f'.repeat(40), ...testi], /qui non c'è/],
    [[...base, '--fusione', 'boh', ...testi], /vuole lo sha/],
    [[...base, ...testi], /vuole --fusione/],
    [[...base, '--fusione', fusione, '--notes', 'controllato'], /vuole --frase/],
    [['deliver', 'b'.repeat(43), 'status', '--status', 'design', '--reason', 'gia_risolto', '--fusione', fusione, ...testi], /va con --status done/],
    [['deliver', 'b'.repeat(43), 'note', '--notes', 'x', '--fusione', fusione], /--fusione vale solo con deliver status/],
  ];
  for (const [argv, atteso] of casi) {
    const no = await esegui('routine-channel.mjs', argv, env);
    assert.equal(no.code, 1, `${argv.join(' ')}: ${no.se}`);
    assert.match(no.se, atteso);
  }
  assert.equal(ricevuti.length, prima, 'nessuna chiusura storta è arrivata al server');
});

test('la correzione senza motivo non parte; col motivo e in un riallineamento porta motivo e confronto', async (t) => {
  const { srv, ricevuti, port } = await fintoServer();
  const { casa } = deposito();
  // Il riallineamento si consegna solo spedito su origin (#1964).
  const origin = cartellaTemporanea('ridisegno-lavoro-origin');
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(casa, ['remote', 'add', 'origin', origin]);
  git(casa, ['push', '-q', 'origin', 'main']);
  t.after(() => { srv.close(); togliCartella(casa); togliCartella(origin); });
  const stato = join(casa, 'stato');
  mkdirSync(stato, { recursive: true });
  writeFileSync(join(stato, 'fid-77.json'), JSON.stringify({ id: 'fid-77', branch: 'worker/77', loopCount: 1, verifierVerdict: 'pass' }));
  // Il marcatore che dispatch scrive dando il riallineamento: la punta ricevuta è quella di adesso.
  mkdirSync(join(casa, '.claude'), { recursive: true });
  writeFileSync(join(casa, '.claude', 'routine-role.json'), JSON.stringify({ role: 'fixer', since: new Date().toISOString(), dal: git(casa, ['rev-parse', 'HEAD']) }));
  const env = { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa, FILO_DISPATCH_STATE_DIR: stato, FILO_ROUTINES_ENABLED: '1', FILO_ROUTINE_TICKET: 'b'.repeat(43) };
  const REPORT = 'Riallineato sopra main: nessun conflitto, nessuna riga del ramo toccata in questo giro.';
  const senza = await esegui('dispatch.mjs', ['--record-fixed', 'fid-77', REPORT], env, casa);
  assert.equal(senza.code, 1);
  assert.match(senza.se, /Manca il motivo della correzione/);
  assert.equal(ricevuti.filter((x) => x.url.includes('routineDeliver')).length, 0, 'senza motivo il server non viene chiamato');
  const storto = await esegui('dispatch.mjs', ['--record-fixed', 'fid-77', REPORT, '--motivo', 'conflitto'], env, casa);
  assert.equal(storto.code, 1);
  assert.match(storto.se, /vuole l'elenco dopo i due punti/);
  const r = await esegui('dispatch.mjs', ['--record-fixed', 'fid-77', REPORT, '--motivo', 'conflitto: nessuno'], env, casa);
  assert.equal(r.code, 0, r.se);
  const d = ricevuti.find((x) => x.url.includes('routineDeliver')).body.data;
  assert.deepEqual(d.motivo, { tipo: 'conflitto', file: [] });
  assert.deepEqual(d.riallineamento, { fileRiscritti: [], fileInConflitto: [], giro: 'nessuno' });
  assert.match(r.se, /Riallineamento pulito/);
  assert.equal(git(origin, ['rev-parse', 'refs/heads/worker/77']), git(casa, ['rev-parse', 'HEAD']));
});

test('il preflight di una sessione accesa per un feedback consegna il ruolo della sessione, col numero, non l\'orchestratore', async (t) => {
  const srv = createServer((req, res) => {
    req.on('data', () => {}); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url.includes('config') ? { fields: { enabled: { booleanValue: true } } } : { ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dove = cartellaTemporanea('strumenti-sessione');
  t.after(() => { srv.close(); togliCartella(dove); });
  const env = {
    FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`,
    FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${srv.address().port}/config`,
    FILO_ROUTINES_ENABLED: '1', FILO_PREFLIGHT_ANY_BRANCH: '1', FILO_TOOLS_DIR: dove, CLAUDE_CODE_REMOTE: '',
  };
  const r = await esegui('dispatch.mjs', ['--preflight', '--feedback', '#1680'], env, REPO);
  assert.equal(r.code, 0, r.se.slice(-400));
  assert.match(r.so, /Sei stata accesa per il feedback \*\*#1680\*\*/);
  assert.match(r.so, /ticket "<parola-d-ordine>" --feedback 1680/);
  assert.doesNotMatch(r.so, /<numero-del-feedback>/, 'il segnaposto si riempie dappertutto');
  assert.doesNotMatch(r.so, /Sei l'orchestratore/);
  const storto = await esegui('dispatch.mjs', ['--preflight', '--feedback', 'tutti'], env, REPO);
  assert.equal(storto.code, 1);
  assert.match(storto.se, /--feedback vuole un numero di feedback/);
  const fuori = await esegui('dispatch.mjs', ['--record-fixed', 'id1', 'report', '--feedback', '12'], env, REPO);
  assert.equal(fuori.code, 1);
  assert.match(fuori.se, /--feedback non vale con --record-fixed/);
});

test('il primo lavoro riceve il piano di chi l\'ha preceduto e le fusioni su main che citano il feedback', async () => {
  const { buildPayload, segnaProprie } = await import('../../scripts/dispatch.mjs');
  const suMain = segnaProprie([{ sha: 'a'.repeat(40), oggetto: 'merge-gate: #77 via server' }, { sha: 'b'.repeat(40), oggetto: 'merge-gate: #75 via server (anche #77)' }], '77');
  assert.deepEqual(suMain.map((f) => !!f.propria), [true, false], 'la fusione del suo stesso lavoro vuol dire riaperto, non risolto');
  const p = buildPayload({ role: 'new-work', id: 'x', num: '#77' }, { feedback: { text: 't' }, piano: '1. il menu', suMain });
  assert.equal(p.piano, '1. il menu');
  assert.equal(p.suMain.length, 2);
  const vuoto = buildPayload({ role: 'new-work', id: 'x', num: '#77' }, { feedback: { text: 't' }, piano: '  ', suMain: [] });
  assert.equal('piano' in vuoto, false);
  assert.equal('suMain' in vuoto, false);
  const ripresa = buildPayload({ role: 'fixer', id: 'x', num: '#77' }, { ripresa: { domanda: 'd' }, piano: 'p' });
  assert.equal(ripresa.piano, 'p', 'anche chi riprende dopo una risposta riceve il piano');
});

test('il motivo è obbligatorio per il correttore e per nessun altro ruolo, come sul server', async () => {
  const { motivoDellaConsegna } = await import('../../scripts/dispatch.mjs');
  assert.deepEqual(motivoDellaConsegna(undefined, 'verifier'), { ok: true, motivo: null });
  assert.equal(motivoDellaConsegna(undefined, 'fixer').ok, false, 'il correttore senza motivo non consegna');
  assert.deepEqual(motivoDellaConsegna('ripresa', 'fixer'), { ok: true, motivo: { tipo: 'ripresa' } });
  assert.equal(motivoDellaConsegna('boh', 'verifier').ok, false, 'un motivo scritto vale nella sua forma anche per gli altri ruoli');
  assert.deepEqual(motivoDellaConsegna(undefined, 'fixer', { siFerma: true }), { ok: true, motivo: null },
    'la fermata del correttore vale da motivo, come sul server');
});

test('il canale capisce --motivo, e solo su deliver fixed', () => {
  let err = '';
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts', 'routine-channel.mjs'), 'deliver', 'status', '--status', 'design', '--motivo', 'ripresa', '--ticket', 'x'.repeat(43)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { err = String(e.stderr || ''); }
  assert.match(err, /--motivo vale solo con deliver fixed/);
});

test('il biglietto porta l\'id della sessione cloud: quella accesa per un feedback riceve il suo dal server', async () => {
  const { sessioneCloud } = await import('../../scripts/routine-channel.mjs');
  assert.equal(sessioneCloud({ CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01DDyykbMNiZwRJHNP6Y7SjW' }), 'cse_01DDyykbMNiZwRJHNP6Y7SjW');
  assert.equal(sessioneCloud({}), '', 'fuori dal cloud niente');
  assert.equal(sessioneCloud({ CLAUDE_CODE_REMOTE_SESSION_ID: 'a b' }), '');
});
