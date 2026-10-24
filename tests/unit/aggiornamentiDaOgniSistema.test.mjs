// Le prove dell'aggiornatore danno lo stesso esito qualunque sistema le esegua (#1146): qui si rifanno con Node che si
// crede su Windows e su Mac, così un caso che non si sceglie la piattaforma è rosso anche su Linux, dove girano routine e
// suite. Regola: patterns/un-test-chiede-al-sistema-non-presume-quello-su-cui-e-nato.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = dirname(fileURLToPath(import.meta.url));
const FINTO = join(QUI, '..', 'helpers', 'sistemaFinto.cjs');
const PROVE = readdirSync(QUI).filter((f) => /^(aggiornament|updater)\w*\.test\.mjs$/.test(f) && f !== 'aggiornamentiDaOgniSistema.test.mjs');
const NOMI = { linux: 'Linux', win32: 'Windows', darwin: 'Mac' };
const ATTESA_MS = 120_000;

function corri(args, sistema) {
  const t = tmpdir();
  return new Promise((ok) => {
    const p = spawn(process.execPath, ['--require', FINTO, ...args], {
      // Windows chiede la temporanea a TEMP, gli altri a TMPDIR: senza, la finzione la cerca in una cartella che non c'è.
      env: { ...process.env, FILO_SISTEMA_FINTO: sistema, TEMP: t, TMP: t, TMPDIR: t },
      timeout: ATTESA_MS,
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => ok({ codice: null, out: `${out}\n${e.message}` }));
    p.on('close', (codice, segnale) => ok({ codice, out: segnale ? `${out}\nfermato da ${segnale} dopo ${ATTESA_MS} ms` : out }));
  });
}

// Ogni caso rosso col suo blocco TAP (messaggio, atteso, ottenuto); un processo caduto prima dei casi, con la sua coda.
function perché(out) {
  const righe = out.split('\n');
  const rossi = [];
  let dentro = false;
  for (const r of righe) {
    if (/^\s*not ok\b/.test(r)) dentro = true;
    if (dentro) rossi.push(r);
    if (dentro && /^\s*\.\.\.$/.test(r)) dentro = false;
  }
  return rossi.length ? rossi.join('\n') : `(ultime 20 righe)\n${righe.slice(-20).join('\n')}`;
}

test('le prove dell\'aggiornatore si trovano: rinominate, la guardia non guarderebbe niente', () => {
  assert.ok(PROVE.includes('aggiornamentiAutomatici.test.mjs'), `trovate solo: ${PROVE.join(', ') || 'nessuna'}`);
});

// Da Windows non si finge: un Node di Windows che si crede Linux sceglie un'altra shell, e il rosso sarebbe della finzione.
// Un caso che dà per scontato Windows è già rosso su Linux da sé.
for (const sistema of Object.keys(NOMI).filter((s) => s !== process.platform)) {
  test(`le prove dell'aggiornatore passano anche eseguite da ${NOMI[sistema]}`, {
    skip: process.platform === 'win32' && 'qui girano già da Windows, e un Node di Windows non si finge un altro sistema',
  }, async () => {
    const io = await corri(['-p', 'process.platform'], sistema);
    assert.equal(io.out.trim(), sistema, `la finzione non ha preso: ${io.out}`);
    const esiti = await Promise.all(PROVE.map(async (f) => ({ f, ...(await corri(['--test-reporter=tap', join(QUI, f)], sistema)) })));
    const rossi = esiti.filter((e) => e.codice !== 0);
    assert.deepEqual(rossi.map((e) => e.f), [], rossi.map((e) => `── ${e.f} da ${NOMI[sistema]}:\n${perché(e.out)}`).join('\n\n'));
  });
}
