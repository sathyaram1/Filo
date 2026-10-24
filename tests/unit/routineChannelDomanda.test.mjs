// `routine-channel.mjs deliver domanda --domanda <file.json>` (#1149): la domanda all'owner arriva al server
// come oggetto controllato con le regole condivise; un JSON storto o fuori tetto si ferma prima di chiamare.
// Server finto su HTTP locale (FILO_ROUTINE_API), CLI vera lanciata in un processo a parte.

import '../helpers/senzaSessione.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANALE = join(__dirname, '..', '..', 'scripts', 'routine-channel.mjs');
const BIGLIETTO = 'b'.repeat(43);
const CARTELLA = cartellaTemporanea('filo-domanda-canale-');

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
  return new Promise((resolve) => {
    execFile(process.execPath, [CANALE, ...args], { env: { ...process.env, FILO_ROUTINE_API: base, FILO_ROUTINE_TICKET: '' }, encoding: 'utf8', timeout: TETTO_ATTESA_MS },
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
  arrivate = [];
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
  arrivate = [];
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

test('deliver status --domanda (#1358): la domanda viaggia controllata accanto alla fermata; su note no', async () => {
  arrivate = [];
  const p = file('ferma.json', JSON.stringify(DOMANDA));
  const r = await lancia(['deliver', BIGLIETTO, 'status', '--status', 'design', '--reason', 'clarify', '--notes', 'Quale?', '--domanda', p]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(arrivate.length, 1);
  assert.equal(arrivate[0].body.intent, 'status');
  assert.equal(arrivate[0].body.data.domanda.titolo, 'Quale strada?', 'un oggetto, non il percorso');
  assert.equal(arrivate[0].body.data.reason, 'clarify');
  const storta = await lancia(['deliver', BIGLIETTO, 'status', '--status', 'design', '--reason', 'clarify', '--domanda', file('storta.json', '{"titolo":')]);
  assert.equal(storta.code, 1);
  assert.match(storta.stderr, /JSON malformato/);
  const suNota = await lancia(['deliver', BIGLIETTO, 'note', '--notes', 'x', '--domanda', p]);
  assert.equal(suNota.code, 1);
  assert.match(suNota.stderr, /--domanda vale solo su deliver domanda, status, fixed e verdict/);
  assert.equal(arrivate.length, 1, 'gli errori non chiamano il server');
});

// #1577: con «blocca» false il server non ferma, e chi consegna lo legge: non un «server vecchio?».
test('una consegna con una domanda che non ferma lo dice; una che ferma resta FERMA', async () => {
  const { testoConsegnaRiuscita } = await import('../../scripts/routine-channel.mjs');
  const data = { domanda: { ...DOMANDA, blocca: false } };
  const avanti = testoConsegnaRiuscita({ num: '#1577', reply: { outcome: 'provvisoria', status: 'revision_capability', domanda: 'D-7' } }, data, 'status');
  assert.equal(avanti, "OK: #1577. La domanda D-7 non ferma il lavoro: vale la consigliata finché l'owner non risponde.");
  const critica = testoConsegnaRiuscita({ reply: { outcome: 'fix', domandaProvvisoria: 'D-8' } }, data, 'verdict');
  assert.match(critica, /La domanda D-8 non ferma il lavoro/);
  assert.doesNotMatch(critica, /server vecchio/);
  const ferma = testoConsegnaRiuscita({ num: '#1577', reply: { outcome: 'stop', domanda: 'D-9' } }, { domanda: DOMANDA }, 'status');
  assert.match(ferma, /il lavoro è FERMO e aspetta l'owner \(la domanda è consegnata, domanda D-9\)/);
  assert.match(testoConsegnaRiuscita({ reply: {} }, { domanda: DOMANDA }, 'status'), /server vecchio/);
});

test('le consegne di chi corregge e di chi verifica dicono anche loro che la domanda non ferma', async () => {
  const { fixedReplyText, verifierReplyText } = await import('../../scripts/dispatch.mjs');
  assert.match(fixedReplyText('f1', { outcome: 'provvisoria', domanda: 'D-7' }, true), /torna in coda per la verifica\. La domanda D-7 non ferma il lavoro/);
  assert.doesNotMatch(fixedReplyText('f1', { outcome: 'provvisoria', domanda: 'D-7' }, true), /ATTENZIONE/);
  for (const reply of [{ outcome: 'pass', domandaProvvisoria: 'D-8' }, { outcome: 'fix', phase2: { findings: [], derived: [] }, domandaProvvisoria: 'D-8' }]) {
    assert.match(verifierReplyText(reply), /La domanda D-8 non ferma il lavoro/, reply.outcome);
  }
  assert.doesNotMatch(verifierReplyText({ outcome: 'pass' }), /non ferma il lavoro/);
});
