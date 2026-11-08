// #2294 — una pagina lasciata aperta faceva partire un download al secondo, e Filo per ognuno chiamava il modello della
// home. I download aprono un giro al più ogni N minuti, e quelli arrivati intanto si raccontano tutti nel giro dopo.
// Orologio finto, modulo vero di src/main/services/filoParla.js, filo in una cartella temporanea.

import { test, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import '../../src/shared/contenutoEsterno.js';
import '../../src/shared/chatArchive.js';
import '../../src/shared/filoEventi.js';
import '../../src/shared/filoApp.js';
import '../../src/shared/filoCoda.js';
import '../../src/shared/filoContesto.js';
import '../../src/shared/constants.js';
import '../../src/shared/preferences.js';
import '../../src/shared/cambi.js';

const require = createRequire(import.meta.url);
globalThis.SN_CONST = { ...(globalThis.SN_CONST || {}), STORAGE_KEYS: { ...((globalThis.SN_CONST || {}).STORAGE_KEYS || {}), FILO_CHATS: 'filo_chats' } };
globalThis.chrome = globalThis.chrome || { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../src/main/services/ilFilo.js');
require('../../src/main/services/filoChats.js');
const Parla = require('../../src/main/services/filoParla.js');
const C = globalThis.SN_CONST;

const cartelle = [];
after(() => { for (const c of cartelle) togliCartella(c); });

let giri = [];
beforeEach(() => {
  const cartella = cartellaTemporanea('filo-ritmo-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = creaFilo({ cartella });
  Parla._azzera();
  Parla.configura({});
  giri = [];
  // Il modello finto non scrive niente: conta solo quante volte e con quali eventi viene chiamato.
  Parla.collega({ puoParlare: async () => true, genera: async ({ eventi }) => { giri.push(eventi); return { message: '' }; }, annuncia: () => {} });
});

// Quanti download racconta un giro: un nome per evento, o il conto scritto nel riassunto.
const raccontati = (eventi) => eventi.filter((e) => e.tipo === 'download')
  .reduce((n, e) => n + (Number((/\((\d+) in tutto\)$/.exec(e.testo) || [])[1]) || 1), 0);

async function scorri(ms) {
  mock.timers.tick(ms);
  await Parla.giro();
}

test('un download al secondo per un\'ora: il modello della home parte al più sette volte, e ogni file viene raccontato', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-08T02:00:00Z') });
  t.after(() => mock.timers.reset());
  const N = 2880;
  for (let i = 0; i < N; i++) {
    Parla.segnala({ tipo: 'download', testo: `pezzo-${i}.txt` });
    await scorri(1300);
  }
  // In un'ora con giri ogni 10 minuti: il primo subito, poi uno ogni 10 minuti.
  assert.ok(giri.length >= 6 && giri.length <= 7, `giri: ${giri.length}`);
  await scorri(10 * 60_000);
  assert.equal(giri.reduce((n, e) => n + raccontati(e), 0), N, 'nessun download perso: quelli fermati arrivano nel giro dopo');
  const riassunto = giri[1].find((e) => e.tipo === 'download');
  assert.match(riassunto.testo, /^pezzo-1\.txt, pezzo-2\.txt, pezzo-3\.txt, pezzo-4\.txt e altri \d+ file \(\d+ in tutto\)$/);
  assert.ok(giri.every((e) => e.length <= 5), 'un giro non porta mai più di cinque eventi di download');
});

test('il primo download si racconta subito, quelli vicini aspettano il ritmo; un timer li porta con sé', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-08T02:00:00Z') });
  t.after(() => mock.timers.reset());
  Parla.segnala({ tipo: 'download', testo: 'fattura.pdf' });
  await scorri(1300);
  assert.deepEqual(giri, [[{ tipo: 'download', testo: 'fattura.pdf' }]]);
  Parla.segnala({ tipo: 'download', testo: 'foto.jpg' });
  await scorri(60_000);
  assert.equal(giri.length, 1, 'dentro il ritmo il secondo aspetta');
  Parla.segnala({ tipo: 'timer', testo: 'timer «pasta»' });
  await scorri(1300);
  assert.deepEqual(giri[1], [{ tipo: 'timer', testo: 'timer «pasta»' }, { tipo: 'download', testo: 'foto.jpg' }]);
  // Il timer non ha ritmo: un altro suona e parte subito, senza download da portare.
  Parla.segnala({ tipo: 'timer', testo: 'sveglia' });
  await scorri(1300);
  assert.deepEqual(giri[2], [{ tipo: 'timer', testo: 'sveglia' }]);
});

test('il ritmo è un\'impostazione: con 2 minuti il secondo download arriva dopo 2 minuti, non 10', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-08T02:00:00Z') });
  t.after(() => mock.timers.reset());
  Parla.configura({ filoParla: { downloadOgniMin: 2 } });
  Parla.segnala({ tipo: 'download', testo: 'a.txt' });
  await scorri(1300);
  Parla.segnala({ tipo: 'download', testo: 'b.txt' });
  await scorri(60_000);
  assert.equal(giri.length, 1);
  await scorri(61_000);
  assert.equal(giri.length, 2);
  assert.deepEqual(giri[1], [{ tipo: 'download', testo: 'b.txt' }]);
});

test('i minuti si leggono solo fra le scelte della pagina; la chat li cambia con la scelta più vicina', () => {
  assert.deepEqual(C.DEFAULT_SETTINGS.filoParla, { downloadOgniMin: 10 });
  assert.equal(C.minutiFraDownload(undefined), 10);
  assert.equal(C.minutiFraDownload({ downloadOgniMin: 'boh' }), 10);
  assert.equal(C.minutiFraDownload({ downloadOgniMin: 0 }), 10);
  assert.equal(C.minutiFraDownload({ downloadOgniMin: true }), 10);
  assert.equal(C.minutiFraDownload({ downloadOgniMin: 7 }), 5);
  assert.equal(C.minutiFraDownload({ downloadOgniMin: 1000 }), 60);
  for (const n of C.FILO_PARLA_DOWNLOAD_MIN) assert.equal(C.minutiFraDownload({ downloadOgniMin: String(n) }), n);
  const P = globalThis.SN_PREF;
  assert.deepEqual(P.buildPreferencePartial('messaggi sui download', '30').partial, { filoParla: { downloadOgniMin: 30 } });
  assert.deepEqual(P.buildPreferencePartial('messaggi_download', 'un\'ora').partial, { filoParla: { downloadOgniMin: 60 } });
  assert.equal(P.buildPreferencePartial('messaggi_download', 'boh'), null);
  assert.equal(globalThis.SN_CAMBI.fraseCambio({ chiave: 'filoParla.downloadOgniMin', prima: 10, dopo: 30 }).includes('al più ogni 30 minuti'), true);
});
