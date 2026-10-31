// #1790 (#1781): un guasto dell'ambiente non è una domanda. Ogni ruolo che lavora lo dichiara nel rilascio col gruppo
// fisso e il messaggio esatto, e ferma solo quel lavoro (#1950); nessun modello di domanda di guasto resta nei testi, e
// il canale rifiuta la vecchia fermata `design` + `guasto` prima del server. Canale finto su HTTP locale.

import '../helpers/senzaSessione.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RUOLI = join(ROOT, 'routines', 'roles');
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');

const SEZIONE = "## Un guasto dell'ambiente si dichiara nel rilascio";
const BIGLIETTO = 'g'.repeat(43);
const CARTELLA = cartellaTemporanea('filo-guasto-rilascio-');
const piatto = (s) => s.replace(/\s+/g, ' ');

// I testi come li consegna dispatch: ruolo, pezzi condivisi e contratto dei worker.
const CHI_RISOLVE = [['new-work', {}], ['fixer', {}], ['fixer', { caso: 'ripresa' }], ['fixer', { caso: 'riallineamento' }]];
const GLI_ALTRI = [['verifier', { scope: 'pieno' }], ['verifier', { scope: 'chiusura' }], ['verifier', { scope: 'riallineamento' }],
  ['secaudit', {}], ['risposta', {}], ['smistamento', {}]];

test('ogni ruolo che lavora dichiara il guasto nel rilascio, col gruppo e il messaggio esatto; nessuno apre una domanda di guasto', () => {
  for (const [ruolo, opts] of [...CHI_RISOLVE, ...GLI_ALTRI]) {
    const t = readRoleInstructions(ruolo, opts);
    const chi = `${ruolo} ${JSON.stringify(opts)}`;
    assert.equal(t.split(SEZIONE).length - 1, 1, `${chi}: la sezione del guasto, una volta sola`);
    const p = piatto(t);
    assert.match(p, /release <biglietto> --role <il tuo ruolo> --guasto "<gruppo>: <il messaggio esatto>"/, `${chi}: il rilascio porta --guasto`);
    assert.match(p, /Un guasto non è una domanda/, chi);
    assert.doesNotMatch(p, /--reason guasto/, `${chi}: la fermata del guasto non c'è più`);
    assert.doesNotMatch(p, /## Il feedback fermo per un guasto/, chi);
    assert.doesNotMatch(p, /Riprendere quando/, `${chi}: nessun modello di domanda di guasto`);
    assert.doesNotMatch(p, /domanda di guasto/i, chi);
  }
});

// D-250: la pausa di un'ora per tutti dopo un guasto è tolta. Un testo che la promette ancora fa aspettare chi non c'entra.
test('un guasto ferma il lavoro che l’ha dichiarato, non gli altri: nessun testo promette più la pausa per tutti', () => {
  const FERMO = /fermo finché una nota del manutentore o la correzione della causa non lo sblocca/;
  for (const f of readdirSync(RUOLI).filter((x) => x.endsWith('.md'))) {
    assert.doesNotMatch(piatto(readFileSync(join(RUOLI, f), 'utf8')), /periodo di rispetto|smette di dare lavoro/i, f);
  }
  assert.doesNotMatch(piatto(readFileSync(join(ROOT, 'ROUTINE-AUTH-SPEC.md'), 'utf8')), /periodo di rispetto/i, 'la spec del canale');
  assert.match(piatto(readFileSync(join(RUOLI, '_dopo-un-guasto.md'), 'utf8')), /gli altri lavori vanno avanti/);
  for (const [ruolo, opts] of [...CHI_RISOLVE, ...GLI_ALTRI, ['halt', {}]]) {
    assert.match(piatto(readRoleInstructions(ruolo, opts)), FERMO, `${ruolo} ${JSON.stringify(opts)}`);
  }
});

// La sentinella della spec: i modelli di guasto non hanno più «Riprendere quando…» come unica opzione, da nessuna parte.
test('nessun pezzo di ruolo porta il modello di una domanda di guasto', () => {
  const file = readdirSync(RUOLI).filter((f) => f.endsWith('.md'));
  assert.ok(!file.includes('_guasto-in-attesa.md') && !file.includes('_guasto-con-domanda.md'));
  for (const f of file) {
    const testo = readFileSync(join(RUOLI, f), 'utf8');
    assert.doesNotMatch(testo, /Riprendere quando il guasto/, f);
    for (const blocco of testo.match(/```json\n[\s\S]*?\n\s*```/g) || []) assert.doesNotMatch(blocco, /"gruppo": "guasto/, `${f}: un modello di domanda di guasto`);
  }
});

// Due worker sullo stesso guasto devono scrivere lo stesso gruppo: è così che il server conta il terzo guasto uguale.
test('il gruppo di un guasto non dipende dalle parole di chi cade', () => {
  const pezzo = piatto(readFileSync(join(RUOLI, '_guasto-nel-rilascio.md'), 'utf8'));
  for (const nome of ['filo-security', 'github', 'npm', 'electron']) assert.ok(pezzo.includes(`\`guasto: ${nome}\``), nome);
  assert.match(pezzo, /`guasto: <causa> <nome>`, la causa fra `credenziali` `clone` `rete` `servizio` `strumento` `permessi`/);
  assert.match(pezzo, /il server conta i guasti uguali/);
  assert.match(pezzo, /Al terzo guasto uguale di seguito sullo stesso feedback il server apre una domanda col conteggio, e la smista un agente/);
  assert.match(pezzo, /non è una domanda nemmeno lei: il server la porta nei Ricevuti/);
  const server = piatto(readFileSync(join(RUOLI, '_lavoro-server.md'), 'utf8'));
  assert.ok(server.includes('`guasto: filo-security`'), 'il lavoro server usa lo stesso nome della lista');
  assert.match(server, /«Un guasto dell'ambiente si dichiara nel rilascio»/);
});

test('le istruzioni separano «è rotto» (guasto) da «per regola» (un passo dell’owner o il lavoro server), e niente torna al PC', () => {
  const pezzo = readFileSync(join(RUOLI, '_guasto-nel-rilascio.md'), 'utf8');
  assert.match(piatto(pezzo), /«Non posso perché è rotto» è un guasto/);
  assert.match(piatto(pezzo), /«dalla cloud non si fa, per regola» \([^)]*segreti[^)]*automazioni GitHub del server[^)]*macchina dell'owner\) non lo è: è un passo dell'owner, che si chiede con una domanda/);
  for (const [ruolo, opts] of CHI_RISOLVE) {
    const t = piatto(readRoleInstructions(ruolo, opts));
    const locale = t.slice(t.indexOf('## Se il lavoro si fa solo in locale'), t.indexOf('## ', t.indexOf('## Se il lavoro si fa solo in locale') + 5));
    assert.ok(locale.length > 200, `${ruolo}: sezione del lavoro locale`);
    assert.doesNotMatch(locale, /non puoi[^.]*codice del server/i, `${ruolo}: il codice del server si tocca nei lavori server`);
    assert.match(locale, /per regola/);
    assert.ok(locale.includes('«Un guasto dell\'ambiente si dichiara nel rilascio»'), `${ruolo}: un guasto rimanda alla sua sezione`);
    assert.match(locale, /--reason locale \\ --notes "Per regola:/, `${ruolo}: la nota dice che è per regola, non un guasto`);
    // #1226.1: dal 14/10 sul PC dell'owner non lavora nessuno, e nessun ruolo glielo rimanda.
    assert.doesNotMatch(locale, /approva come lavoro locale|riparte da lì|sessione sulla sua macchina|nei Ricevuti/, `${ruolo}: niente lavoro rimandato al PC`);
    assert.match(locale, /--domanda <file\.json>/, `${ruolo}: il passo dell'owner si chiede con una domanda`);
  }
  const sec = piatto(readFileSync(join(RUOLI, 'secaudit.md'), 'utf8'));
  assert.match(sec, /un guasto, da dichiarare nel rilascio con `--guasto` \(sezione «Un guasto dell'ambiente si dichiara nel rilascio»\)/);
  assert.match(piatto(readFileSync(join(RUOLI, '_contratto-worker.md'), 'utf8')), /un guasto che ti impedisce di lavorare → il rilascio con `--guasto`/);
});

let server;
let base = '';
let arrivate = [];

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      arrivate.push({ path: req.url, body: JSON.parse(raw || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, num: '#1790', reply: { outcome: 'stop', status: 'design', domanda: 'D-12' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

function canale(args) {
  return new Promise((resolve) => {
    const env = { ...process.env, FILO_ROUTINE_API: base, FILO_ROUTINE_TICKET: '', FILO_ADMIN_REFRESH_TOKEN: '' };
    execFile(process.execPath, [join(ROOT, 'scripts', 'routine-channel.mjs'), ...args], { env, encoding: 'utf8', timeout: TETTO_ATTESA_MS },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

test('la vecchia fermata del guasto si ferma prima del server, con o senza domanda, e dice di dichiararlo nel rilascio', async () => {
  const file = join(CARTELLA, 'guasto.json');
  writeFileSync(file, JSON.stringify({
    titolo: 'Il clone del server viene respinto', priorita: 'bloccante', gruppo: 'guasto: filo-security',
    opzioni: [
      { testo: 'Riprendere dopo', pro: 'Niente perso.', contro: 'Aspetta.', azione: { tipo: 'riprendi', feedbackId: 'f1' } },
      { testo: 'Archiviare', pro: 'Coda libera.', contro: 'Si perde.', azione: { tipo: 'archivia', feedbackId: 'f1' } },
    ],
    consiglio: { opzione: 0, perche: 'Il guasto passa.' },
  }), 'utf8');
  for (const coda of [[], ['--domanda', file]]) {
    arrivate = [];
    const r = await canale(['deliver', BIGLIETTO, 'status', '--status', 'design', '--reason', 'guasto', '--notes', 'Guasto: guasto: filo-security.', ...coda]);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stderr, /Un guasto non è una fermata e non è una domanda/);
    assert.match(r.stderr, /release <biglietto> --role <il tuo ruolo> --guasto "<gruppo>: <il messaggio esatto>"/);
    assert.equal(arrivate.length, 0, 'il canale non è stato chiamato');
  }
});
