// Le operazioni del biglietto dalla riga di comando (#1153, SPEC-DOMANDE.md §5): `operazione`, `segnala` e `rapporto`
// portano al server la richiesta col biglietto del giro e riportano la risposta; un no esce 4 col motivo, dati storti
// o un testo mancante escono 1 senza chiamare il server. Le regole stanno sul server (filo-security operazioni.js).
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { datiOperazione } from '../../scripts/routine-channel.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIGLIETTO = 'bigliettodiprova0123';

function fintoServer(rispondi) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      const [status, risposta] = rispondi(req.url, j);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(risposta));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

function esegui(argv, env, stdin = '') {
  return new Promise((r) => {
    const figlio = execFile(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'), ...argv], { env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
    figlio.stdin.end(stdin);
  });
}

const ambiente = (port, casa) => ({ FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa, FILO_ROUTINE_TICKET: BIGLIETTO, FILO_NO_BEAT: '1' });

async function conServer(rispondi, corpo) {
  const s = await fintoServer(rispondi);
  const casa = cartellaTemporanea('filo-operazioni-');
  try { await corpo(s, casa); } finally { s.srv.close(); togliCartella(casa); }
}

test('operazione: dati dalla riga o da stdin, risposta del server stampata com’è', async () => {
  await conServer(() => [200, { ok: true, feedback: [{ id: 'f1', num: '#1' }] }], async ({ ricevuti, port }, casa) => {
    const r = await esegui(['operazione', 'coda.leggi', '{"id":"f1"}'], ambiente(port, casa));
    assert.equal(r.code, 0, r.se);
    assert.deepEqual(JSON.parse(r.so).feedback, [{ id: 'f1', num: '#1' }]);
    const s = await esegui(['operazione', 'coda.unione'], ambiente(port, casa), '{"ids":["f1","f2"]}\n');
    assert.equal(s.code, 0, s.se);
    assert.deepEqual(ricevuti.map((x) => [x.url, x.body]), [
      ['/routineOperazione', { ticket: BIGLIETTO, op: 'coda.leggi', dati: { id: 'f1' } }],
      ['/routineOperazione', { ticket: BIGLIETTO, op: 'coda.unione', dati: { ids: ['f1', 'f2'] } }],
    ]);
  });
});

test('un no del server esce 4 col motivo e il perché; dati storti escono 1 senza chiamarlo', async () => {
  await conServer(() => [403, { ok: false, reason: 'fuori_ambito', detail: '«feedback.leggi» non è nell’ambito del biglietto (coda)' }], async ({ ricevuti, port }, casa) => {
    const r = await esegui(['operazione', 'feedback.leggi', '{"id":"f3"}'], ambiente(port, casa));
    assert.equal(r.code, 4);
    assert.match(r.se, /RIFIUTATO dal server: fuori_ambito: «feedback\.leggi» non è nell’ambito del biglietto \(coda\)/);
    assert.equal(r.so, '');
    for (const storto of ['{id:f1}', '["f1"]', '3']) {
      const s = await esegui(['operazione', 'coda.leggi', storto], ambiente(port, casa));
      assert.equal(s.code, 1, storto);
      assert.match(s.se, /oggetto JSON/);
    }
    assert.equal(ricevuti.length, 1);
  });
});

test('segnala e rapporto: il testo da stdin, la conferma in una riga; senza testo non si chiama il server', async () => {
  await conServer((url, j) => [200, j.op === 'segnala' ? { ok: true, id: 'x', num: '#88', fiducia: 'non_fidato' } : { ok: true, compito: 'C-4', chiuso: true }], async ({ ricevuti, port }, casa) => {
    const s = await esegui(['segnala'], ambiente(port, casa), 'Mancava il permesso di leggere i rami\n');
    assert.equal(s.code, 0, s.se);
    assert.equal(s.so.trim(), 'OK: segnalazione #88 aperta (non fidata).');
    const r = await esegui(['rapporto'], ambiente(port, casa), 'Fatto tutto. Riparti da #2.\n');
    assert.equal(r.code, 0, r.se);
    assert.equal(r.so.trim(), 'OK: rapporto consegnato, C-4 chiuso.');
    const vuoto = await esegui(['segnala'], ambiente(port, casa), '   \n');
    assert.equal(vuoto.code, 1);
    assert.match(vuoto.se, /segnala vuole il testo, fra due righe FINE/);
    assert.deepEqual(ricevuti.map((x) => [x.body.op, x.body.dati]), [
      ['segnala', { testo: 'Mancava il permesso di leggere i rami' }],
      ['rapporto', { testo: 'Fatto tutto. Riparti da #2.' }],
    ]);
  });
});

test('il server che non ha ancora l’indirizzo è un guasto, non un rifiuto', async () => {
  await conServer(() => [404, {}], async ({ port }, casa) => {
    const r = await esegui(['segnala'], ambiente(port, casa), 'x\n');
    assert.equal(r.code, 3);
    assert.match(r.se, /routineOperazione non è ancora pubblicata/);
  });
});

test('il contratto comune di ogni worker insegna la segnalazione libera, con la ricetta che esegue', () => {
  // Il server la accetta da ogni biglietto: senza la ricetta nel contratto la usavano solo i compiti.
  const contratto = readFileSync(resolve(REPO, 'routines', 'roles', '_contratto-worker.md'), 'utf8');
  assert.match(contratto, /node scripts\/routine-channel\.mjs segnala <<'FINE'\n[^\n]+\n\s*FINE/);
  assert.match(contratto.replace(/\s+/g, ' '), /un permesso che mancava/);
});

test('datiOperazione: vuoto è un oggetto vuoto, il resto deve essere un oggetto JSON', () => {
  assert.deepEqual(datiOperazione(''), { dati: {} });
  assert.deepEqual(datiOperazione(' {"a":1} '), { dati: { a: 1 } });
  assert.ok(datiOperazione('null').errore);
  assert.ok(datiOperazione('[1]').errore);
});
