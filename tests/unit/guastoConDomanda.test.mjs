// #1241: un guasto dell'ambiente si dice con una domanda all'owner, non col rimando in locale, e le istruzioni lo
// portano a ogni ruolo che lavora. La domanda del modello nel testo, chiesta col biglietto delle routine, arriva al
// canale col gruppo del guasto e il feedback legato. Canale finto su HTTP locale, CLI vera in un processo a parte.

import '../helpers/senzaSessione.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RUOLI = join(ROOT, 'routines', 'roles');
const CLI = join(ROOT, 'scripts', 'domanda.mjs');
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');
require(join(ROOT, 'src', 'shared', 'domande.js'));
const D = globalThis.SN_DOMANDE;

const SEZIONE = "## Un guasto dell'ambiente si dice con una domanda";
const ATTESA = '## Il feedback fermo per un guasto';
const BIGLIETTO = 'g'.repeat(43);
const FEEDBACK_ID = 'mzSM2TV5OAbnyfeasmih';
const CARTELLA = cartellaTemporanea('filo-guasto-domanda-');
const piatto = (s) => s.replace(/\s+/g, ' ');

// I testi come li consegna dispatch: ruolo, pezzi condivisi e contratto dei worker.
const CHI_RISOLVE = [['new-work', {}], ['fixer', {}], ['fixer', { caso: 'ripresa' }], ['fixer', { caso: 'riallineamento' }]];
const GLI_ALTRI = [['verifier', { scope: 'pieno' }], ['verifier', { scope: 'chiusura' }], ['verifier', { scope: 'riallineamento' }],
  ['secaudit', {}]];

test('ogni ruolo che lavora riceve la domanda di guasto; chi risolve o corregge anche l’attesa col motivo guasto', () => {
  for (const [ruolo, opts] of [...CHI_RISOLVE, ...GLI_ALTRI]) {
    const t = readRoleInstructions(ruolo, opts);
    const chi = `${ruolo} ${JSON.stringify(opts)}`;
    assert.ok(t.includes(SEZIONE), `${chi}: manca la sezione del guasto`);
    assert.match(piatto(t), /node scripts\/domanda\.mjs chiedi <file\.json>/, `${chi}: la domanda passa da domanda.mjs`);
    assert.match(piatto(t), /release <biglietto> --role <il tuo ruolo> --guasto "<gruppo>, D-<n>/, `${chi}: il rilascio porta --guasto`);
  }
  for (const [ruolo, opts] of CHI_RISOLVE) {
    const t = readRoleInstructions(ruolo, opts);
    assert.ok(t.includes(ATTESA), `${ruolo} ${opts.caso || ''}: manca la ricetta dell'attesa`);
    // #1577: la domanda viaggia con la fermata, nella stessa scrittura: il feedback non va nei Ricevuti.
    assert.match(piatto(t), /deliver status --status design --reason guasto \\ --notes "Guasto, non per regola: <gruppo>\. \[cosa resta sul ramo\]" --domanda <file\.json>/,
      `${ruolo} ${opts.caso || ''}: la fermata del guasto porta la sua domanda`);
    const attesa = piatto(t.slice(t.indexOf(ATTESA)));
    assert.match(attesa, /non con `domanda\.mjs chiedi`/, `${ruolo}: chi risolve non apre la domanda a parte`);
    assert.doesNotMatch(attesa, /Domanda D-<n>\. \[cosa resta/, `${ruolo}: il numero non si scrive più a mano nella nota`);
  }
  // Agli altri ruoli il server non prende uno stato: la ricetta non si indica.
  for (const [ruolo, opts] of GLI_ALTRI) {
    assert.doesNotMatch(readRoleInstructions(ruolo, opts), /--reason guasto/, `${ruolo} ${JSON.stringify(opts)}`);
  }
});

// Due worker sullo stesso guasto devono scrivere lo stesso gruppo: un nome fisso per i noti, causa da una lista chiusa per gli altri.
test('il gruppo di un guasto non dipende dalle parole di chi cade', () => {
  const pezzo = piatto(readFileSync(join(RUOLI, '_guasto-con-domanda.md'), 'utf8'));
  for (const nome of ['filo-security', 'github', 'npm', 'electron']) assert.ok(pezzo.includes(`\`guasto: ${nome}\``), nome);
  assert.match(pezzo, /`guasto: <causa> <nome>`, la causa fra `credenziali` `clone` `rete` `servizio` `strumento` `permessi`/);
  assert.doesNotMatch(pezzo, /come la nomina il messaggio/);
  const server = piatto(readFileSync(join(RUOLI, '_lavoro-server.md'), 'utf8'));
  assert.ok(server.includes('`guasto: filo-security`'), 'il lavoro server usa lo stesso nome della lista');
});

test('le istruzioni separano «è rotto» (guasto) da «per regola» (un passo dell’owner o il lavoro server), e niente torna al PC', () => {
  const pezzo = readFileSync(join(RUOLI, '_guasto-con-domanda.md'), 'utf8');
  assert.match(piatto(pezzo), /«Non posso perché è rotto» è un guasto/);
  assert.match(piatto(pezzo), /«dalla cloud non si fa, per regola» \([^)]*segreti[^)]*automazioni GitHub del server[^)]*macchina dell'owner\) non lo è: è un passo dell'owner, che si chiede con una domanda/);
  for (const [ruolo, opts] of CHI_RISOLVE) {
    const t = piatto(readRoleInstructions(ruolo, opts));
    const locale = t.slice(t.indexOf('## Se il lavoro si fa solo in locale'), t.indexOf(ATTESA));
    assert.ok(locale.length > 200, `${ruolo}: sezione del lavoro locale`);
    assert.doesNotMatch(locale, /non puoi[^.]*codice del server/i, `${ruolo}: il codice del server si tocca nei lavori server`);
    assert.match(locale, /per regola/);
    assert.ok(locale.includes('«Un guasto dell\'ambiente si dice con una domanda»'), `${ruolo}: un guasto rimanda alla sua sezione`);
    assert.match(locale, /--reason locale \\ --notes "Per regola:/, `${ruolo}: la nota dice che è per regola, non un guasto`);
    // #1226.1: dal 14/10 sul PC dell'owner non lavora nessuno, e nessun ruolo glielo rimanda.
    assert.doesNotMatch(locale, /approva come lavoro locale|riparte da lì|sessione sulla sua macchina|nei Ricevuti/, `${ruolo}: niente lavoro rimandato al PC`);
    assert.match(locale, /--domanda <file\.json>/, `${ruolo}: il passo dell'owner si chiede con una domanda`);
  }
});

/** La domanda del modello nel testo di chi risolve, coi segnaposti dell'identificativo riempiti. */
function domandaDelModello() {
  const pezzo = readFileSync(join(RUOLI, '_guasto-in-attesa.md'), 'utf8');
  const m = /```json\n([\s\S]*?)\n\s*```/.exec(pezzo);
  assert.ok(m, 'il pezzo ha il modello JSON della domanda');
  const d = JSON.parse(m[1].split('<payload.id>').join(FEEDBACK_ID));
  d.gruppo = 'guasto: filo-security';
  d.contesto = 'Clonavo il server per il lavoro: GitHub ha risposto che a questa sessione manca il permesso di leggerlo.';
  d.notePerAgenti = 'git-server clone: «fatal: unable to access: 403». Respinto da GitHub, non dal proxy.';
  return d;
}

test('il modello della domanda passa i controlli del server: ogni strada sblocca il lavoro fermo, col feedback legato', () => {
  const v = D.validaDomanda(domandaDelModello(), { conOrigine: false });
  assert.ok(v.ok, `${v.errore}: ${v.dettaglio}`);
  // In una fermata il server prende solo riprendi e archivia su quel lavoro (#1358): un compito che nessuno lavora
  // lascerebbe il feedback fermo per sempre (#1577).
  assert.deepEqual(v.domanda.opzioni.map((o) => o.azione), [
    { tipo: 'riprendi', feedbackId: FEEDBACK_ID },
    { tipo: 'archivia', feedbackId: FEEDBACK_ID },
  ]);
  assert.equal(v.domanda.blocca, undefined, 'la fermata blocca da sé: «blocca» false lì è rifiutato');
  assert.deepEqual(v.domanda.collegamenti, [{ tipo: 'feedback', id: FEEDBACK_ID }]);
  assert.equal(v.domanda.consiglio.opzione, 0);
  // Senza opzioni (chi verifica, l'esplorazione) la domanda vale lo stesso.
  const { opzioni: _o, consiglio: _c, ...senza } = domandaDelModello();
  assert.ok(D.validaDomanda(senza, { conOrigine: false }).ok);
});

let server;
let base = '';
let arrivate = [];
let risposta = { status: 200, body: { ok: true, id: 'D-9', num: 'D-9', numero: 9 } };

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      arrivate.push({ path: req.url, body: JSON.parse(raw || '{}') });
      res.writeHead(risposta.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(risposta.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

function chiedi(file) {
  return new Promise((resolve) => {
    const env = { ...process.env, FILO_ROUTINE_API: base, FILO_ROUTINE_TICKET: BIGLIETTO, FILO_ADMIN_REFRESH_TOKEN: '' };
    execFile(process.execPath, [CLI, 'chiedi', file], { env, encoding: 'utf8', timeout: TETTO_ATTESA_MS },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

// Chi verifica la apre a parte, e il lavoro torna in coda da sé: «blocca» false, come dicono le istruzioni.
test('col biglietto della routine la domanda arriva al canale col gruppo del guasto e il feedback legato', async () => {
  arrivate = [];
  risposta = { status: 200, body: { ok: true, id: 'D-9', num: 'D-9', numero: 9 } };
  const file = join(CARTELLA, 'guasto-ok.json');
  writeFileSync(file, JSON.stringify({ ...domandaDelModello(), blocca: false }), 'utf8');
  assert.match(piatto(readFileSync(join(RUOLI, '_guasto-con-domanda.md'), 'utf8')), /domanda\.mjs chiedi <file\.json>`, con `"blocca": false`/);
  const r = await chiedi(file);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /OK: domanda D-9 aperta\./);
  assert.equal(arrivate.length, 1, 'una chiamata sola, al canale delle routine');
  const [a] = arrivate;
  assert.equal(a.path, '/routineDeliver');
  assert.equal(a.body.intent, 'domanda');
  assert.equal(a.body.ticket, BIGLIETTO);
  assert.equal(a.body.data.domanda.gruppo, 'guasto: filo-security');
  assert.deepEqual(a.body.data.domanda.collegamenti, [{ tipo: 'feedback', id: FEEDBACK_ID }]);
  assert.ok(a.body.data.domanda.opzioni.every((o) => o.azione.tipo === 'compito' || o.azione.feedbackId === FEEDBACK_ID));
  assert.ok(!('origine' in a.body.data.domanda), 'l’origine la mette il server dal biglietto');
  assert.equal(a.body.data.domanda.blocca, false);
});

function canale(args) {
  return new Promise((resolve) => {
    const env = { ...process.env, FILO_ROUTINE_API: base, FILO_ROUTINE_TICKET: '', FILO_ADMIN_REFRESH_TOKEN: '' };
    execFile(process.execPath, [join(ROOT, 'scripts', 'routine-channel.mjs'), ...args], { env, encoding: 'utf8', timeout: TETTO_ATTESA_MS },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

test('chi risolve consegna il guasto con la sua domanda: un passo solo, e la risposta dà il numero (#1577)', async () => {
  arrivate = [];
  risposta = { status: 200, body: { ok: true, num: '#1577', reply: { outcome: 'stop', status: 'design', domanda: 'D-12' } } };
  const file = join(CARTELLA, 'guasto-fermata.json');
  writeFileSync(file, JSON.stringify(domandaDelModello()), 'utf8');
  const r = await canale(['deliver', BIGLIETTO, 'status', '--status', 'design', '--reason', 'guasto',
    '--notes', 'Guasto, non per regola: guasto: filo-security. Resta il ramo.', '--domanda', file]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /il lavoro è FERMO e aspetta l'owner \(la domanda è consegnata, domanda D-12\)/);
  assert.equal(arrivate.length, 1, 'niente domanda a parte prima della fermata');
  const [a] = arrivate;
  assert.equal(a.body.intent, 'status');
  assert.deepEqual([a.body.data.status, a.body.data.reason], ['design', 'guasto']);
  assert.equal(a.body.data.domanda.gruppo, 'guasto: filo-security');
  assert.ok(a.body.data.domanda.opzioni.every((o) => ['riprendi', 'archivia'].includes(o.azione.tipo) && o.azione.feedbackId === FEEDBACK_ID));
});

// #1455: com'era D-89, col nome di file e la lineetta nel contesto. Si ferma prima del canale, e chi chiede sa dove.
test('un nome di file o una lineetta nel testo per l’owner: rifiutata prima del canale, col campo; la pulita parte', async () => {
  for (const [contesto, segno] of [
    ['Il clone fallisce in scripts/routine-channel.mjs.', /«contesto» nomina routine-channel\.mjs/],
    ['Il clone fallisce — GitHub risponde di no.', /«contesto» ha una lineetta/],
  ]) {
    arrivate = [];
    const file = join(CARTELLA, 'guasto-sporca.json');
    writeFileSync(file, JSON.stringify({ ...domandaDelModello(), contesto }), 'utf8');
    const r = await chiedi(file);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stderr, /RIFIUTATO: testo_non_per_owner: /);
    assert.match(r.stderr, segno);
    assert.match(r.stderr, /Non ho mandato niente/);
    assert.equal(arrivate.length, 0, 'il canale non è stato chiamato');
  }
  arrivate = [];
  risposta = { status: 200, body: { ok: true, id: 'D-10', num: 'D-10', numero: 10 } };
  const file = join(CARTELLA, 'guasto-pulita.json');
  writeFileSync(file, JSON.stringify(domandaDelModello()), 'utf8');
  const r = await chiedi(file);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /OK: domanda D-10 aperta\./);
  assert.match(arrivate[0].body.data.domanda.notePerAgenti, /fatal: unable to access: 403/, 'il messaggio esatto arriva nelle note');
});

test('se il server rifiuta la domanda, chi chiede legge il motivo esatto: è quello che le istruzioni fanno ricopiare', async () => {
  arrivate = [];
  risposta = { status: 403, body: { ok: false, reason: 'ruolo_non_ammesso', detail: 'questo biglietto non apre domande' } };
  const file = join(CARTELLA, 'guasto-no.json');
  writeFileSync(file, JSON.stringify(domandaDelModello()), 'utf8');
  const r = await chiedi(file);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /RIFIUTATO dal server: ruolo_non_ammesso: questo biglietto non apre domande/);
  assert.equal(arrivate.length, 1);
  const pezzo = piatto(readFileSync(join(RUOLI, '_guasto-con-domanda.md'), 'utf8'));
  assert.match(pezzo, /con `RIFIUTATO dal server: …`, al posto del numero va quel messaggio esatto/);
});

// #1241.1: il server prende domande solo da chi risolve, corregge o verifica; il controllo di sicurezza riceverebbe
// un no certo, e il guasto lo dice nel solo rilascio.
test('il controllo di sicurezza salta la domanda di guasto e rilascia col guasto; chi la può aprire non la salta', () => {
  const sec = piatto(readRoleInstructions('secaudit', {}));
  const sezione = sec.slice(sec.indexOf(SEZIONE));
  assert.match(sezione, /Il controllo di sicurezza salta il passo 1\*\*: il server prende domande solo da chi risolve, corregge o verifica/);
  assert.match(sezione, /basta il rilascio del passo 3, con `--guasto "<gruppo>: <messaggio>"`/);
  const ruolo = piatto(readFileSync(join(RUOLI, 'secaudit.md'), 'utf8'));
  assert.doesNotMatch(ruolo, /guasto, con la sua domanda/, 'il testo del ruolo non lo manda alla domanda');
  assert.match(ruolo, /tu la domanda non la apri/);
  assert.match(piatto(readFileSync(join(RUOLI, '_contratto-worker.md'), 'utf8')), /il controllo di sicurezza: il solo rilascio/);
  for (const [ruolo2, opts] of [...CHI_RISOLVE, ['verifier', { scope: 'pieno' }]]) {
    const t = piatto(readRoleInstructions(ruolo2, opts));
    assert.match(t, /1\. La domanda, coi campi di SPEC-DOMANDE/, `${ruolo2}: la domanda resta il primo passo`);
  }
});
