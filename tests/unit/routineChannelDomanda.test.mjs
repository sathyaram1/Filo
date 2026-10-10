// `routine-channel.mjs deliver domanda --domanda <file.json>` (#1149): la domanda all'owner arriva al server
// come oggetto controllato con le regole condivise; un JSON storto o fuori tetto si ferma prima di chiamare.
// Server finto su HTTP locale (FILO_ROUTINE_API), CLI vera lanciata in un processo a parte.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANALE = join(__dirname, '..', '..', 'scripts', 'routine-channel.mjs');
const BIGLIETTO = 'b'.repeat(43);
const CARTELLA = mkdtempSync(join(tmpdir(), 'filo-domanda-canale-'));

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
      res.end(JSON.stringify({ ok: true, id: 'D-4', num: 'D-4', numero: 4 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

function lancia(args) {
  arrivate = [];
  return new Promise((resolve) => {
    execFile(process.execPath, [CANALE, ...args], { env: { ...process.env, FILO_ROUTINE_API: base, FILO_ROUTINE_TICKET: '' }, encoding: 'utf8', timeout: 60000 },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

function file(nome, contenuto) {
  const p = join(CARTELLA, nome);
  writeFileSync(p, contenuto, 'utf8');
  return p;
}

const DOMANDA = {
  titolo: 'Quale strada?', priorita: 'quando_puoi',
  opzioni: [{ testo: 'Riprendi', azione: { tipo: 'riprendi', feedbackId: 'abc' } }],
  consiglio: { opzione: 0, perche: 'la più corta' },
};

test('deliver domanda: al server va l’intento con la domanda controllata, a chi chiede il numero', async () => {
  const r = await lancia(['deliver', BIGLIETTO, 'domanda', '--domanda', file('ok.json', JSON.stringify(DOMANDA))]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /OK: D-4/);
  assert.equal(arrivate.length, 1);
  assert.equal(arrivate[0].path, '/routineDeliver');
  assert.equal(arrivate[0].body.intent, 'domanda');
  assert.equal(arrivate[0].body.ticket, BIGLIETTO);
  assert.equal(arrivate[0].body.data.domanda.titolo, 'Quale strada?');
  assert.deepEqual(Object.keys(arrivate[0].body.data), ['domanda']);
});

test('deliver domanda: JSON storto, tipo non attivo o campi in più si fermano prima del server', async () => {
  const storto = await lancia(['deliver', BIGLIETTO, 'domanda', '--domanda', file('storto.json', '{"titolo":')]);
  assert.equal(storto.code, 1);
  assert.match(storto.stderr, /JSON malformato/);
  const ambito = { ...DOMANDA, opzioni: [{ testo: 'x', azione: { tipo: 'ambito' } }] };
  const nonAttivo = await lancia(['deliver', BIGLIETTO, 'domanda', '--domanda', file('ambito.json', JSON.stringify(ambito))]);
  assert.equal(nonAttivo.code, 1);
  assert.match(nonAttivo.stderr, /tipo_non_attivo/);
  const conNote = await lancia(['deliver', BIGLIETTO, 'domanda', '--domanda', file('ok2.json', JSON.stringify(DOMANDA)), '--notes', 'altro']);
  assert.equal(conNote.code, 1);
  assert.match(conNote.stderr, /vuole solo --domanda/);
  assert.equal(arrivate.length, 0, 'il server non è stato chiamato');
});
