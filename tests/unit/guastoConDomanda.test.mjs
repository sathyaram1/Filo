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
    assert.match(t, /deliver status --status design --reason guasto/);
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

test('le istruzioni separano «è rotto» (domanda) da «per regola» (rimando in locale), e il rimando non vieta più il server', () => {
  const pezzo = readFileSync(join(RUOLI, '_guasto-con-domanda.md'), 'utf8');
  assert.match(piatto(pezzo), /«Non posso perché è rotto» è un guasto/);
  assert.match(piatto(pezzo), /«dalla cloud non si fa, per regola» \([^)]*segreti[^)]*automazioni GitHub del server[^)]*macchina dell'owner\) è il rimando in locale/);
  for (const [ruolo, opts] of CHI_RISOLVE) {
    const t = piatto(readRoleInstructions(ruolo, opts));
    const locale = t.slice(t.indexOf('## Se il lavoro si fa solo in locale'), t.indexOf(ATTESA));
    assert.ok(locale.length > 200, `${ruolo}: sezione del lavoro locale`);
    assert.doesNotMatch(locale, /non puoi[^.]*codice del server/i, `${ruolo}: il codice del server si tocca nei lavori server`);
    assert.match(locale, /per regola/);
    assert.ok(locale.includes('«Un guasto dell\'ambiente si dice con una domanda»'), `${ruolo}: un guasto rimanda alla sua sezione`);
    assert.match(locale, /--reason locale \\ --notes "Lavoro locale per regola:/, `${ruolo}: la nota dice che è lavoro locale davvero`);
  }
});

/** La domanda del modello nel testo di chi risolve, coi segnaposti dell'identificativo riempiti. */
function domandaDelModello() {
  const pezzo = readFileSync(join(RUOLI, '_guasto-in-attesa.md'), 'utf8');
  const m = /```json\n([\s\S]*?)\n\s*```/.exec(pezzo);
  assert.ok(m, 'il pezzo ha il modello JSON della domanda');
  const d = JSON.parse(m[1].split('<payload.id>').join(FEEDBACK_ID));
  d.gruppo = 'guasto: filo-security';
  d.contesto = 'Clonavo il server per il lavoro. Il messaggio: «fatal: unable to access: 403».';
  return d;
}

test('il modello della domanda passa i controlli del server, con le tre strade e il feedback legato', () => {
  const v = D.validaDomanda(domandaDelModello(), { conOrigine: false });
  assert.ok(v.ok, `${v.errore}: ${v.dettaglio}`);
  assert.deepEqual(v.domanda.opzioni.map((o) => o.azione), [
    { tipo: 'riprendi', feedbackId: FEEDBACK_ID },
    { tipo: 'approva_locale', feedbackId: FEEDBACK_ID },
    { tipo: 'archivia', feedbackId: FEEDBACK_ID },
  ]);
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

test('col biglietto della routine la domanda arriva al canale col gruppo del guasto e il feedback legato', async () => {
  arrivate = [];
  risposta = { status: 200, body: { ok: true, id: 'D-9', num: 'D-9', numero: 9 } };
  const file = join(CARTELLA, 'guasto-ok.json');
  writeFileSync(file, JSON.stringify(domandaDelModello()), 'utf8');
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
  assert.ok(a.body.data.domanda.opzioni.every((o) => o.azione.feedbackId === FEEDBACK_ID));
  assert.ok(!('origine' in a.body.data.domanda), 'l’origine la mette il server dal biglietto');
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
