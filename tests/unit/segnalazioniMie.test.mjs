// La copia locale delle segnalazioni mandate (#986): nasce all'invio, passa a «inviata» e a «risolta», regge un
// riavvio, una voce tolta sparisce dal disco e non torna, e l'incognito non scrive e non legge.
// Electron è finto (come in archivedTabsStore.test.mjs), il disco è vero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const userData = cartellaTemporanea('filo-segnalazioni-');
process.env.FILO_USER_DATA = userData;
const electronFinto = {
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
};
const caricaOriginale = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronFinto;
  return caricaOriginale.call(this, request, parent, isMain);
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULO = join(ROOT, 'src', 'main', 'services', 'segnalazioniMie.js');
const Disco = require(join(ROOT, 'src', 'main', 'shim', 'storage.js'));

// Un riavvio: il modulo rinasce e rilegge la cartella da capo.
function avvia() {
  delete require.cache[require.resolve(MODULO)];
  delete globalThis.SN_SEGNALAZIONI_MIE;
  return require(MODULO);
}
let M = avvia();

const annunci = [];
globalThis.SN_BROADCAST_FILO = (m) => annunci.push(m);

const cartella = () => join(userData, 'segnalazioni-mie');
const suDisco = (ago) => (existsSync(cartella()) ? readdirSync(cartella()) : [])
  .filter((f) => readFileSync(join(cartella(), f), 'utf8').includes(ago));

test('i nomi degli allegati: quelli veri, e per le immagini senza nome lo stesso nome dell\'avviso di invio', () => {
  assert.deepEqual(M.nomiAllegati({
    images: [{ dataUrl: 'data:x', name: 'gatto.png' }, { dataUrl: 'data:y' }, { name: 'senza-dati.png' }],
    files: [{ name: 'log.txt', dataUrl: 'data:z' }, {}],
  }), ['gatto.png', 'immagine 2', 'log.txt', 'allegato']);
  assert.deepEqual(M.nomiAllegati({}), []);
  assert.deepEqual(M.nomiAllegati(null), []);
});

test('le transizioni: una chiusura annunciata non torna indietro, «non partita» vale solo in partenza', () => {
  const v = M.voce({ id: 'a', testo: 'x' });
  assert.equal(v.stato, 'in_partenza');
  assert.deepEqual(M.applica(v, 'inviata', { feedbackId: 'fb', num: '12' }), { stato: 'inviata', feedbackId: 'fb', num: '12' });
  assert.equal(M.applica({ ...v, stato: 'inviata' }, 'non_partita'), null);
  assert.deepEqual(M.applica(v, 'non_partita'), { stato: 'non_partita' });
  assert.deepEqual(M.applica({ ...v, stato: 'inviata' }, 'risolta', { risposta: 'Fatto.' }), { stato: 'risolta', risposta: 'Fatto.' });
  assert.equal(M.applica({ ...v, stato: 'risolta' }, 'inviata'), null);
  assert.equal(M.applica(null, 'inviata'), null);
  assert.equal(M.applica(v, 'boh'), null);
});

test('mandata, inviata, risolta: la voce cambia stato e lo dice alle pagine aperte', async () => {
  annunci.length = 0;
  await M.registra({ id: 'sub-1', testo: 'Il tasto <b>Salva</b> non fa niente 🙃', allegati: ['schermata annotata'] });
  let [v] = await M.elenco();
  assert.equal(v.stato, 'in_partenza');
  assert.equal(v.testo, 'Il tasto <b>Salva</b> non fa niente 🙃');
  assert.deepEqual(v.allegati, ['schermata annotata']);
  assert.ok(!Number.isNaN(Date.parse(v.creataIl)));

  await M.inviata('sub-1', { feedbackId: 'fbDoc1', num: '986', titolo: 'Salva non salva' });
  [v] = await M.elenco();
  assert.equal(v.stato, 'inviata');
  assert.equal(v.num, '986');
  assert.equal(v.titolo, 'Salva non salva');

  await M.chiusa('fbDoc1', { stato: 'risolta', risposta: 'Adesso salva.' });
  [v] = await M.elenco();
  assert.equal(v.stato, 'risolta');
  assert.equal(v.risposta, 'Adesso salva.');
  assert.ok(annunci.length >= 3, 'ogni cambio avvisa le pagine aperte');
  // Il segnale non porta dati e salta le finestre incognito.
  const perNormale = typeof annunci[0] === 'function' ? annunci[0]('') : annunci[0];
  assert.deepEqual(Object.keys(perNormale), ['type']);
  assert.equal(annunci[0]('persist:incognito'), null);

  // Un'altra segnalazione chiusa senza modifiche.
  await M.registra({ id: 'sub-2', testo: 'doppione' });
  await M.inviata('sub-2', { feedbackId: 'fbDoc2' });
  await M.chiusa('fbDoc2', { stato: 'chiusa' });
  assert.equal((await M.elenco()).find((x) => x.id === 'sub-2').stato, 'chiusa');
});

test('un invio che non parte resta scritto come «non partito», mai «in partenza» per sempre', async () => {
  await M.registra({ id: 'sub-3', testo: 'senza rete' });
  await M.nonPartita('sub-3');
  assert.equal((await M.elenco()).find((x) => x.id === 'sub-3').stato, 'non_partita');
  await M.togli('sub-3');
});

test('rimandata, una segnalazione «non partita» lascia il posto a quella partita: una riga sola', async () => {
  await M.registra({ id: 'sub-r1', testo: 'Il video si blocca' });
  await M.nonPartita('sub-r1');
  await M.registra({ id: 'sub-r2', testo: 'Altro testo' });
  await M.nonPartita('sub-r2');
  await M.registra({ id: 'sub-r3', testo: '  Il video si blocca \n' });
  const ids = (await M.elenco()).map((x) => x.id);
  assert.ok(ids.includes('sub-r3'));
  assert.ok(!ids.includes('sub-r1'), 'la copia non partita resta accanto a quella rimandata');
  assert.ok(ids.includes('sub-r2'), 'una non partita con un altro testo non va toccata');
  assert.deepEqual(M.rimandate([{ id: 'x', stato: 'inviata', testo: 'a' }, { id: 'y', stato: 'non_partita', testo: '' }], { id: 'z', testo: '' }), []);
  for (const id of ['sub-r2', 'sub-r3']) await M.togli(id);
});

test('dopo un riavvio l\'elenco c\'è ancora; una voce tolta sparisce dal disco e non torna', async () => {
  await M.registra({ id: 'da-togliere', testo: 'TESTO-DA-TOGLIERE-986' });
  assert.equal(suDisco('TESTO-DA-TOGLIERE-986').length, 1);
  M = avvia();
  let ids = (await M.elenco()).map((v) => v.id);
  assert.ok(ids.includes('sub-1') && ids.includes('da-togliere'));
  assert.equal((await M.elenco()).find((v) => v.id === 'sub-1').stato, 'risolta');

  await M.togli('da-togliere');
  assert.deepEqual(suDisco('TESTO-DA-TOGLIERE-986'), []);
  M = avvia();
  ids = (await M.elenco()).map((v) => v.id);
  assert.ok(!ids.includes('da-togliere'));
  // Un invio arrivato tardi per una voce tolta non la fa rinascere.
  await M.inviata('da-togliere', { feedbackId: 'tardi' });
  assert.ok(!(await M.elenco()).some((v) => v.id === 'da-togliere'));
});

test('dall\'incognito l\'elenco non si scrive e non si legge, ma l\'annuncio aggiorna lo stesso le voci di fuori', async () => {
  const r = await Disco.runIncognito(() => M.registra({ id: 'privata', testo: 'TESTO-INCOGNITO-986' }));
  assert.equal(r, null);
  assert.deepEqual(suDisco('TESTO-INCOGNITO-986'), []);
  assert.equal(await Disco.runIncognito(() => M.elenco()), null);
  await Disco.runIncognito(() => M.togli('sub-1'));
  assert.ok((await M.elenco()).some((v) => v.id === 'sub-1'), 'l\'incognito non toglie');

  await M.registra({ id: 'sub-4', testo: 'fuori' });
  await M.inviata('sub-4', { feedbackId: 'fbDoc4' });
  await Disco.runIncognito(() => M.chiusa('fbDoc4', { stato: 'risolta' }));
  assert.equal((await M.elenco()).find((v) => v.id === 'sub-4').stato, 'risolta');
});

test('il backup rimette le voci che mancano, senza doppioni, e svuota le toglie tutte', async () => {
  const prima = await M.elenco();
  await M.svuota();
  assert.deepEqual(await M.elenco(), []);
  assert.equal(await M.importa([...prima, ...prima, { id: '' }, null]), prima.length);
  assert.deepEqual((await M.elenco()).map((v) => v.id).sort(), prima.map((v) => v.id).sort());
  assert.equal((await M.elenco()).find((v) => v.id === 'sub-1').risposta, 'Adesso salva.');
});

test('l\'annuncio di una segnalazione più vecchia dell\'elenco la fa entrare; una più recente tolta dall\'utente non torna', async () => {
  await M.elenco();
  const nato = Date.parse(readFileSync(join(cartella(), 'nato-il.txt'), 'utf8').trim());
  assert.ok(Number.isFinite(nato));
  const prima = new Date(nato - 86_400_000).toISOString();
  const dopo = new Date(nato + 60_000).toISOString();

  await M.chiusa('fbVecchia', { stato: 'risolta', creataIl: prima, num: '640', titolo: 'Il download si fermava', risposta: 'Riprende da solo.' });
  const v = (await M.elenco()).find((x) => x.id === 'fbVecchia');
  assert.equal(v.stato, 'risolta');
  assert.equal(v.num, '640');
  assert.equal(v.titolo, 'Il download si fermava');
  assert.equal(v.risposta, 'Riprende da solo.');
  assert.equal(v.creataIl, prima);

  // Le schede più vecchie hanno la data vuota: sono di prima.
  await M.chiusa('fbSenzaData', { stato: 'chiusa', titolo: 'Senza data' });
  assert.equal((await M.elenco()).find((x) => x.id === 'fbSenzaData').stato, 'chiusa');

  // Mandata dopo la nascita dell'elenco e assente: non ci era entrata (incognito), non entra all'annuncio.
  await M.chiusa('fbDopo', { stato: 'risolta', creataIl: dopo, titolo: 'Dopo' });
  await Disco.runIncognito(() => M.chiusa('fbDaIncognito', { stato: 'risolta', creataIl: prima }));
  let ids = (await M.elenco()).map((x) => x.id);
  assert.ok(!ids.includes('fbDopo') && !ids.includes('fbDaIncognito'));

  // Tolta dall'utente, anche se di prima e senza data, non torna con un altro annuncio, nemmeno dopo un riavvio.
  await M.registra({ id: 'sub-tolta', testo: 'TESTO-TOLTA-986' });
  await M.inviata('sub-tolta', { feedbackId: 'fbTolta' });
  await M.togli('sub-tolta');
  await M.togli('fbSenzaData');
  M = avvia();
  await M.chiusa('fbTolta', { stato: 'risolta', creataIl: prima });
  await M.chiusa('fbSenzaData', { stato: 'chiusa' });
  ids = (await M.elenco()).map((x) => x.id);
  assert.ok(!ids.includes('sub-tolta') && !ids.includes('fbTolta') && !ids.includes('fbSenzaData'));
  assert.deepEqual(suDisco('TESTO-TOLTA-986'), [], 'di una voce tolta non resta il testo');

  // La data di nascita regge il riavvio: non si sposta in avanti a ogni avvio.
  M = avvia();
  await M.elenco();
  assert.equal(Date.parse(readFileSync(join(cartella(), 'nato-il.txt'), 'utf8').trim()), nato);
});

test('chi aveva già segnalato lo sa il registro dei numeri', async () => {
  globalThis.SN_FEEDBACK_MINE = { leggi: async () => ({ ids: [], ereditaFinoA: 0 }) };
  assert.equal(await M.haPrecedenti(), false);
  globalThis.SN_FEEDBACK_MINE = { leggi: async () => ({ ids: ['fbX'], ereditaFinoA: 0 }) };
  assert.equal(await M.haPrecedenti(), true);
  globalThis.SN_FEEDBACK_MINE = { leggi: async () => ({ ids: [], ereditaFinoA: Date.now() + 1000 }) };
  assert.equal(await M.haPrecedenti(), true);
  delete globalThis.SN_FEEDBACK_MINE;
  assert.equal(await M.haPrecedenti(), false);
});
