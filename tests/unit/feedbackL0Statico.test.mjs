// #1403.2 — il controllo senza modello della rilettura gira nel processo a parte: lì trova quello che trova nel processo
// principale, con le stesse regole caricate da sole. Il processo di Electron si fa qui con un processo di Node e la sua
// porta finta: stessi messaggi, stesso file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIGLIO = join(ROOT, 'src', 'main', 'services', 'feedbackL0StaticoFiglio.js');

const PORTA_FINTA = `
process.parentPort = {
  on: (_ev, fn) => process.on('message', (m) => fn({ data: m })),
  postMessage: (m) => process.send(m),
};
require(${JSON.stringify(FIGLIO)});
`;

function chiediAlFiglio(dati) {
  return new Promise((resolve, reject) => {
    const f = spawn(process.execPath, ['-e', PORTA_FINTA], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    f.on('message', (m) => { f.kill(); resolve(m); });
    f.on('error', reject);
    f.send({ id: 7, dati });
  });
}

const dataUrl = (testo) => `data:text/csv;base64,${Buffer.from(testo).toString('base64')}`;

test('il processo a parte, con le regole caricate da sé, trova quello che trova il processo principale', async () => {
  const dati = {
    testo: 'Il login fallisce: la mia password è Tr7#kq29Lm, e quella del portale M E L A ! V E R D E 7 7',
    allegati: [null, dataUrl('utente;password\nmario.rossi;hunter22\n'), dataUrl('niente di strano'),
      `data:text/plain;base64,${Buffer.from('avvio\r\npassword = Gatto!2024\r\n', 'utf16le').toString('base64')}`],
    custoditi: [{ valore: 'Mela!Verde77', password: true }],
  };
  const m = await chiediAlFiglio(dati);
  assert.equal(m.id, 7);
  const { leggiQui } = require(join(ROOT, 'src', 'main', 'services', 'feedbackL0Statico.js'));
  assert.deepEqual(m.r, leggiQui(dati));
  assert.ok(m.r.testo.valori.some((x) => x.valore === 'Tr7#kq29Lm'), 'la password del testo');
  assert.equal(m.r.allegati[0], null);
  assert.ok(m.r.allegati[1].valori.some((x) => x.valore === 'hunter22'), 'la colonna del CSV');
  assert.ok(!m.r.allegati[2].valori.length);
  assert.ok(m.r.allegati[3].valori.some((x) => x.valore === 'Gatto!2024'), 'il log in UTF-16');
});
