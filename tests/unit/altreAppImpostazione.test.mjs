// L'impostazione «Filo può usare le altre applicazioni» guida il componente (#779): spenta (com'è di serie) non scarica
// niente e la cartella dei dati non lo contiene; accesa lo installa e il ComputerDriver risponde; rispenta lo toglie.
// Il pacchetto è un driver finto servito in locale (FILO_ALTRE_APP_PACCHETTI vale solo nelle prove).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import * as zlib from 'node:zlib';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FINTO = join(ROOT, 'tests', 'fixtures', 'cua-driver-finto.mjs');
const SALTA = process.platform === 'win32' && 'il driver finto è uno script sh: su Windows lo copre computerDriver.test.mjs';

function tarDi(nome, contenuto) {
  const dati = Buffer.from(contenuto);
  const h = Buffer.alloc(512);
  h.write(nome, 0); h.write('0000755', 100); h.write('0000000', 108); h.write('0000000', 116);
  h.write(dati.length.toString(8).padStart(11, '0'), 124); h.write('00000000000', 136); h.write('0', 156);
  h.write('ustar\u0000', 257, 'latin1'); h.write('00', 263); h.fill(32, 148, 156);
  let s = 0; for (const b of h) s += b;
  h.write(`${s.toString(8).padStart(6, '0')}\u0000 `, 148, 'latin1');
  return zlib.gzipSync(Buffer.concat([h, dati, Buffer.alloc((512 - (dati.length % 512)) % 512), Buffer.alloc(1024)]));
}

let dir, srv, richieste = 0, A, elenco, file;
const base = () => join(dir, 'componenti');
const scriviElenco = (sha256) => writeFileSync(elenco, JSON.stringify({
  VERSIONE: '0.0.1-prova',
  BASE: `http://127.0.0.1:${srv.address().port}/`,
  PACCHETTI: { [`${process.platform}-${process.arch}`]: { file: 'finto.tar.gz', sha256, byte: file.length, formato: 'tar.gz', eseguibile: 'cua-driver' } },
}));

before(async () => {
  dir = cartellaTemporanea('filo-altreapp-imp-');
  file = tarDi('cua-driver', `#!/bin/sh\nexec "${process.execPath}" "${FINTO}" "$@"\n`);
  srv = createServer((req, res) => { richieste++; res.writeHead(200, { 'Content-Length': file.length }); res.end(file); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  elenco = join(dir, 'pacchetti.json');
  scriviElenco(createHash('sha256').update(file).digest('hex'));
  process.env.FILO_USER_DATA = dir;
  process.env.FILO_ALTRE_APP_PACCHETTI = elenco;
  A = require(join(ROOT, 'src/main/services/altreApp/index.js'));
});

after(async () => {
  try { A.allUscita(); } catch (_) {}
  await new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); });
  togliCartella(dir);
});

test('spenta, com\'è di serie: niente scaricato, niente sul disco, e il ComputerDriver dice perché', { skip: SALTA }, async () => {
  const C = require(join(ROOT, 'src/shared/constants.js'));
  const di = globalThis.SN_CONST.DEFAULT_SETTINGS;
  assert.ok(C || di);
  assert.equal(di.altreApp.enabled, false, 'di serie è spenta');
  await A.seguiImpostazioni(di);
  assert.equal(richieste, 0);
  assert.equal(existsSync(base()), false);
  const w = await A.computerDriver.windows();
  assert.deepEqual({ ok: w.ok, disponibile: w.disponibile, codice: w.codice }, { ok: false, disponibile: false, codice: 'spento' });
  assert.match(w.motivo, /spenta/);
  assert.equal((await A.statoPerPagina()).fase, 'assente');
});

test('accesa la installa e il driver risponde; rispenta lo toglie dal disco', { skip: SALTA }, async () => {
  await A.seguiImpostazioni({ altreApp: { enabled: true } });
  const s = await A.statoPerPagina({ verifica: true });
  assert.equal(s.fase, 'pronto', JSON.stringify(s.errore));
  assert.equal(s.attiva, true);
  assert.ok(s.byte > 0);
  assert.equal(richieste, 1);
  const w = await A.computerDriver.windows();
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(w.finestre[0].applicazione, 'Blocco note');
  const t = await A.computerDriver.tree(w.finestre[0].id);
  assert.equal(t.ok, true);
  assert.ok(!JSON.stringify(t).includes('segreto-123'));
  // La stessa impostazione arrivata di nuovo non riscarica.
  await A.seguiImpostazioni({ altreApp: { enabled: true } });
  assert.equal(richieste, 1);

  await A.seguiImpostazioni({ altreApp: { enabled: false } });
  assert.equal(existsSync(base()) && existsSync(join(base(), 'cua-driver')), false, 'il componente è tolto');
  const dopo = await A.computerDriver.windows();
  assert.equal(dopo.codice, 'spento');
});

test('un pacchetto con l\'impronta sbagliata non si installa e lo stato lo dice in chiaro', { skip: SALTA }, async () => {
  scriviElenco('0'.repeat(64));
  await A.seguiImpostazioni({ altreApp: { enabled: true } });
  const s = await A.statoPerPagina({ verifica: true });
  assert.equal(s.fase, 'errore');
  assert.equal(s.errore.codice, 'impronta');
  assert.match(s.errore.frase, /impronta non combacia, quindi non l'ho installato/);
  assert.equal(existsSync(join(base(), 'cua-driver', '0.0.1-prova')), false);
  const w = await A.computerDriver.windows();
  assert.equal(w.disponibile, false);
  assert.equal(w.codice, 'impronta');
  await A.seguiImpostazioni({ altreApp: { enabled: false } });
});
