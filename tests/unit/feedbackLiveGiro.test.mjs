// Quando la Gestione rilegge, cosa segna come arrivato e dove tiene lo
// scorrimento: la parte pura di src/shared/feedbackLive.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackLive.js'));
const LIVE = globalThis.SN_FEEDBACK_LIVE;

const T0 = 1_000_000_000_000;
const base = { ora: T0, inVista: true, dataLoaded: true, ultimoGiro: T0 - LIVE.POLL_MS, giroDa: 0, motivo: 'battito' };

test('una pagina che nessuno guarda non legge niente, nemmeno dopo ore', () => {
  assert.equal(LIVE.decidiGiro({ ...base, inVista: false, ultimoGiro: T0 - 5 * 3600e3 }), 'fermo');
  assert.equal(LIVE.decidiGiro({ ...base, inVista: false, motivo: 'rientro' }), 'fermo');
});

test('in vista si gira una volta a ritmo, non prima', () => {
  assert.equal(LIVE.decidiGiro(base), 'giro');
  assert.equal(LIVE.decidiGiro({ ...base, ultimoGiro: T0 - LIVE.POLL_MS + 1 }), 'attendi');
});

test('tornando in vista ci si allinea subito, ma un salto fra due schede non paga un giro', () => {
  const via = T0 - LIVE.RIENTRO_MIN_MS;
  assert.equal(LIVE.decidiGiro({ ...base, motivo: 'rientro', ultimoGiro: via }), 'giro');
  assert.equal(LIVE.decidiGiro({ ...base, motivo: 'rientro', ultimoGiro: T0 - 2000 }), 'attendi');
  assert.ok(LIVE.RIENTRO_MIN_MS < LIVE.POLL_MS);
});

test('un giro appeso non ferma la pagina per sempre', () => {
  assert.equal(LIVE.decidiGiro({ ...base, giroDa: T0 - 5000 }), 'attendi');
  assert.equal(LIVE.decidiGiro({ ...base, giroDa: T0 - LIVE.GIRO_BLOCCATO_MS }), 'giro');
});

test('una prima lista mai arrivata si ritenta al ritmo del giro, non a ogni battito', () => {
  assert.equal(LIVE.decidiGiro({ ...base, dataLoaded: false }), 'carica');
  assert.equal(LIVE.decidiGiro({ ...base, dataLoaded: false, ultimoGiro: T0 - 1000 }), 'attendi');
});

test('le soglie si possono passare (gli spec le accorciano)', () => {
  assert.equal(LIVE.decidiGiro({ ...base, ultimoGiro: T0 - 2000, pollMs: 1500 }), 'giro');
  assert.equal(LIVE.decidiGiro({ ...base, motivo: 'rientro', ultimoGiro: T0 - 200, rientroMs: 100 }), 'giro');
});

test('la lista si dice ferma solo a chi guarda e solo dopo più giri mancati', () => {
  assert.equal(LIVE.listaFerma({ ora: T0, inVista: true, ultimoRiuscito: T0 - LIVE.FERMA_DOPO_MS }), true);
  assert.equal(LIVE.listaFerma({ ora: T0, inVista: true, ultimoRiuscito: T0 - LIVE.POLL_MS }), false);
  assert.equal(LIVE.listaFerma({ ora: T0, inVista: false, ultimoRiuscito: T0 - 10 * LIVE.FERMA_DOPO_MS }), false);
  assert.equal(LIVE.listaFerma({ ora: T0, inVista: true, ultimoRiuscito: 0 }), false);
});

test('arriva chi cambia sezione o è nuovo; chi resta dov\'era no', () => {
  const sezione = (fb) => ({ design: 'inbox', working: 'queue', unlabeled: 'inbox' }[fb.status] || null);
  const prima = new Map([['515', 'queue'], ['700', 'inbox'], ['701', 'queue']]);
  const dopo = [
    { _id: '515', status: 'design' },     // In coda → Ricevuti
    { _id: '700', status: 'design' },     // già nei Ricevuti: cambiato, non arrivato
    { _id: '701', status: 'working' },    // resta In coda
    { _id: '720', status: 'unlabeled' },  // nuovo
    { _id: '721', status: 'boh' },        // sezione ignota: non si afferma niente
  ];
  assert.deepEqual([...LIVE.arrivi(prima, dopo, sezione)].sort(), ['515', '720']);
});

test('le richieste di fusione si rileggono solo se un giro ha mosso uno stato', () => {
  const vecchi = [{ _id: 'a', status: 'working' }, { _id: 'b', status: 'design', statusReason: 'loop' }];
  assert.equal(LIVE.statoCambiato(vecchi, [{ _id: 'a', status: 'working', name: 'titolo nuovo' }]), false);
  assert.equal(LIVE.statoCambiato(vecchi, [{ _id: 'a', status: 'design', statusReason: 'l5' }]), true);
  assert.equal(LIVE.statoCambiato(vecchi, [{ _id: 'b', status: 'design', statusReason: 'l5' }]), true);
  assert.equal(LIVE.statoCambiato(vecchi, [{ _id: 'c', status: 'unlabeled' }]), true);
});

test('lo scorrimento resta sulla stessa scheda anche se ne esce una più su', () => {
  const righe = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `f${i}`, top: i * 40, height: 36 }));
  // Si guarda a metà della f3 (top 120): 10 px dentro.
  const ancora = LIVE.ancoraScorrimento(righe, 130);
  assert.deepEqual(ancora, { id: 'f3', delta: 10 });
  // La f1 è uscita dalla sezione: tutto sotto sale di 40 px.
  const dopo = righe.filter((r) => r.id !== 'f1').map((r, i) => ({ ...r, top: i * 40 }));
  assert.equal(LIVE.scrollDaAncora(ancora, dopo, 130), 90);
});

test('se la scheda d\'ancora non c\'è più, lo scorrimento resta quello di prima', () => {
  const ancora = { id: 'sparita', delta: 5 };
  assert.equal(LIVE.scrollDaAncora(ancora, [{ id: 'x', top: 0 }], 77), 77);
  assert.equal(LIVE.scrollDaAncora(null, [], 12), 12);
});

test('chi sta puntando la lista non se la vede rimescolare sotto il cursore', () => {
  assert.equal(LIVE.listaInUso({ ora: T0, ultimoMovimento: T0 - 200 }), true);
  assert.equal(LIVE.listaInUso({ ora: T0, ultimoMovimento: T0 - LIVE.LISTA_IN_USO_MS }), false);
  assert.equal(LIVE.listaInUso({ ora: T0, ultimoMovimento: 0, premuto: true }), true);
  assert.equal(LIVE.listaInUso({ ora: T0, ultimoMovimento: 0 }), false);
});
