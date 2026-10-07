// Quali chiavi di un allarme hanno già un feedback lo sa solo il server: l'allarme gli manda il titolo base e il nome
// di ogni guasto, così il feedback nuovo nomina i soli guasti suoi. `name` resta intero per i server che non li leggono.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const ricevuti = [];
const srv = createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    ricevuti.push(JSON.parse(b || '{}'));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, duplicate: false, num: '#1' }));
  });
});
let allarme;

before(async () => {
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  process.env.FILO_ROUTINE_API = `http://127.0.0.1:${srv.address().port}`;
  process.env.FILO_BUILD_PASSPHRASE = 'finta';
  allarme = await import('../../scripts/build-alarm.mjs');
});
after(() => srv.close());

test('con le chiavi partono il titolo base e il nome di ogni guasto che ne ha uno', async () => {
  ricevuti.length = 0;
  const base = 'Controlli automatici rossi: nessuna versione pubblicata';
  assert.equal(await allarme.spedisciAllarme(base, 'testo',
    ['unit:tests/unit/fineRigaLf.test.mjs', 'unit:tests/unit/walletCrediti.test.mjs', 'bake:tavily']), true);
  const [b] = ricevuti;
  assert.equal(b.titoloBase, base);
  assert.deepEqual(b.nomi, {
    'unit:tests/unit/fineRigaLf.test.mjs': 'fineRigaLf',
    'unit:tests/unit/walletCrediti.test.mjs': 'walletCrediti',
  });
  assert.equal(b.name, `${base} (fineRigaLf, walletCrediti)`);
});

test('senza chiavi la richiesta resta quella di prima', async () => {
  ricevuti.length = 0;
  assert.equal(await allarme.spedisciAllarme('Titolo', 'testo', []), true);
  assert.deepEqual(Object.keys(ricevuti[0]).sort(), ['name', 'passphrase', 'text']);
});
