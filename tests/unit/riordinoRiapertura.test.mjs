// #349 — il riordino alla riapertura: la barra si riordina anche senza archiviare, l'avviso c'è sempre e dice cosa è
// successo, un giudizio mancato lascia traccia, l'ultimo uso di ogni scheda sopravvive al riavvio.
// Electron è finto: qui conta cosa fa il gestore delle schede, non la finestra.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const finto = { get: (t, k) => (k in t ? t[k] : new Proxy(function () {}, finto)), apply: () => new Proxy(function () {}, finto), construct: () => new Proxy({}, finto) };
const electron = new Proxy({ app: { getPath: () => tmpdir(), on() {}, isPackaged: false, getVersion: () => '0.0.0' } }, finto);
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  return origLoad.call(this, request, parent, isMain);
};
const { TabManager } = require(join(ROOT, 'src', 'main', 'tabs.js'));
require(join(ROOT, 'src', 'shared', 'tabTriage.js'));
const T = globalThis.SN_TAB_TRIAGE;

const BLU = 'rgb(40, 80, 200)';
const VERDE = 'rgb(40, 200, 80)';
const ROSSO = 'rgb(200, 40, 40)';

// Aperte blu → verde → rosso: per tinta l'ordine giusto è rosso → verde → blu. L'attiva è la blu, mai candidata.
function gestore() {
  const tm = Object.create(TabManager.prototype);
  const scheda = (id, url, identityColor) => ({ id, url, title: id, identityColor, scrollPct: 0, formDirty: false, view: {} });
  tm.tabs = [scheda('blu', 'https://blu.example/', BLU), scheda('verde', 'https://verde.example/', VERDE), scheda('rosso', 'https://rosso.example/', ROSSO)];
  tm.activeId = 'blu';
  tm.incognito = false;
  tm._sempreAperte = [];
  tm.avvisi = [];
  tm.win = { webContents: { send: (canale, dati) => { if (canale === 'shell:toast') tm.avvisi.push(dati.text); } } };
  tm.broadcast = 0;
  tm._broadcast = function () { this.broadcast++; };
  tm._ricontrollaModuli = async () => {};
  tm._caricaSempreAperte = async () => {};
  tm._gatherTriageInput = async (cands) => cands.map((t) => ({ url: t.url, title: t.title }));
  return tm;
}
const ordine = (tm) => tm.tabs.map((t) => t.id);

async function conDecisione(decide, fn) {
  const prima = globalThis.SN_TAB_TRIAGE_DECIDE;
  globalThis.SN_TAB_TRIAGE_DECIDE = decide;
  try { return await fn(); } finally { globalThis.SN_TAB_TRIAGE_DECIDE = prima; }
}

test('alla riapertura, col modello che tiene tutto, la barra si riordina e l’avviso lo dice', async () => {
  const tm = gestore();
  const esito = await conDecisione(async ({ tabs }) => ({ decisions: tabs.map((_, i) => ({ i, action: 'keep' })) }),
    () => tm.runAutoTriage({ trigger: 'reopen' }));
  assert.deepEqual(ordine(tm), ['rosso', 'verde', 'blu']);
  assert.equal(esito.archived, 0);
  assert.equal(esito.reordered, true);
  assert.ok(tm.broadcast > 0, 'la barra non ha saputo del nuovo ordine');
  assert.deepEqual(tm.avvisi, ['Schede riordinate, nessuna da chiudere']);
});

test('alla riapertura le schede chiuse si contano nell’avviso', async () => {
  const tm = gestore();
  const esito = await conDecisione(async ({ tabs }) => ({ decisions: tabs.map((t, i) => ({ i, action: t.title === 'verde' ? 'archive' : 'keep' })) }),
    () => tm.runAutoTriage({ trigger: 'reopen' }));
  assert.equal(esito.archived, 1);
  assert.deepEqual(ordine(tm), ['rosso', 'blu']);
  assert.deepEqual(tm.avvisi, ['Schede riordinate: 1 chiusa, restano nel filo della home']);
});

test('alla riapertura, con la barra già in ordine, l’avviso dice che il giro c’è stato', async () => {
  const tm = gestore();
  tm.tabs.reverse();
  tm.activeId = 'rosso';
  await conDecisione(async ({ tabs }) => ({ decisions: tabs.map((_, i) => ({ i, action: 'keep' })) }),
    () => tm.runAutoTriage({ trigger: 'reopen' }));
  assert.deepEqual(ordine(tm), ['rosso', 'verde', 'blu']);
  assert.deepEqual(tm.avvisi, ['Schede già in ordine, nessuna da chiudere']);
});

test('un giudizio che non arriva riordina lo stesso, lo dice all’utente e lascia una riga nel registro', async () => {
  const tm = gestore();
  const avvertito = mock.method(console, 'warn', () => {});
  try {
    const esito = await conDecisione(async () => { throw new Error('crediti finiti'); },
      () => tm.runAutoTriage({ trigger: 'reopen' }));
    assert.equal(esito.giudizioMancato, true);
    assert.deepEqual(ordine(tm), ['rosso', 'verde', 'blu']);
    assert.deepEqual(tm.avvisi, ['Schede riordinate, ma non sono riuscito a valutare quali chiudere']);
    assert.ok(avvertito.mock.calls.some((c) => c.arguments.join(' ').includes('crediti finiti')), 'nessuna traccia del giudizio mancato');
  } finally {
    avvertito.mock.restore();
  }
});

test('alla riapertura senza schede da giudicare la barra si riordina comunque', async () => {
  const tm = gestore();
  tm._intoccabileDalTriage = () => true;
  let chiesto = false;
  await conDecisione(async () => { chiesto = true; return { decisions: [] }; },
    () => tm.runAutoTriage({ trigger: 'reopen' }));
  assert.equal(chiesto, false, 'senza candidate il modello non va chiamato');
  assert.deepEqual(ordine(tm), ['rosso', 'verde', 'blu']);
  assert.deepEqual(tm.avvisi, ['Schede riordinate, nessuna da chiudere']);
});

test('fuori dalla riapertura un giro che non chiude niente non mostra avvisi, ma riordina', async () => {
  const tm = gestore();
  await conDecisione(async ({ tabs }) => ({ decisions: tabs.map((_, i) => ({ i, action: 'keep' })) }),
    () => tm.runAutoTriage({ trigger: 'idle' }));
  assert.deepEqual(ordine(tm), ['rosso', 'verde', 'blu']);
  assert.deepEqual(tm.avvisi, []);
});

test('testoEsito: un avviso per ogni esito, e niente quando non c’è niente da dire', () => {
  assert.equal(T.testoEsito({ trigger: 'reopen', valutate: 3, archiviate: 2, riordinate: true }), 'Schede riordinate: 2 chiuse, restano nel filo della home');
  assert.equal(T.testoEsito({ trigger: 'idle', valutate: 3, archiviate: 1 }), 'Schede riordinate: 1 chiusa, restano nel filo della home');
  assert.equal(T.testoEsito({ trigger: 'reopen', valutate: 3, archiviate: 2, giudizioMancato: true }),
    'Schede riordinate: 2 doppioni chiusi, restano nel filo della home. Le altre non sono riuscito a valutarle');
  assert.equal(T.testoEsito({ trigger: 'reopen', valutate: 3, giudizioMancato: true }), 'Non sono riuscito a valutare quali schede chiudere');
  assert.equal(T.testoEsito({ trigger: 'reopen', valutate: 0, riordinate: false }), '');
  assert.equal(T.testoEsito({ trigger: 'manual', valutate: 3, riordinate: true }), '');
  assert.equal(T.testoEsito({ trigger: 'idle', valutate: 3, giudizioMancato: true }), '');
});

test('l’ultimo uso di ogni scheda va nella sessione, al minuto', () => {
  const tm = gestore();
  const ora = Date.parse('2026-10-20T10:37:42.123Z');
  tm.tabs[0].lastInteractionAt = ora;
  const s = tm.sessionState();
  assert.equal(s.usate.length, s.tabs.length);
  assert.deepEqual(s.usate, ['2026-10-20T10:37:00.000Z', null, null]);
});

test('un’ora d’uso nel futuro mandata dalla pagina non resta sulla scheda', () => {
  const tm = gestore();
  tm._lastAppInteractionAt = 0;
  tm.setTabActivity('verde', { lastInteractionAt: Date.now() + 10 * 365 * 24 * 3600 * 1000 });
  assert.ok(tm.tabs[1].lastInteractionAt <= Date.now());
  tm.setTabActivity('verde', { lastInteractionAt: 'adesso' });
  assert.ok(Number.isFinite(tm.tabs[1].lastInteractionAt));
});

test('il riordino della riapertura aspetta il colore di ogni pagina, e non oltre il tetto', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const tm = gestore();
    tm._perScheda = (id) => tm.tabs.find((t) => t.id === id);
    tm._identityColorCache = new Map();
    tm.tabs[0]._identitaNota = true;
    tm.tabs.push({ id: 'casa', url: 'filo://newtab/', view: {} });
    let pronto = null;
    tm._coloriPronti(8000).then((v) => { pronto = v; });
    await Promise.resolve();
    assert.equal(pronto, null, 'è partito senza i colori di verde e rosso');
    tm.setTabIdentityColor('verde', VERDE);
    await Promise.resolve();
    assert.equal(pronto, null, 'è partito senza il colore di rosso');
    // «Nessun colore» è una risposta anche lei.
    tm.setTabIdentityColor('rosso', null);
    await Promise.resolve();
    assert.equal(pronto, true);

    const altro = gestore();
    let alTetto = null;
    altro._coloriPronti(8000).then((v) => { alTetto = v; });
    mock.timers.tick(7999);
    await Promise.resolve();
    assert.equal(alTetto, null);
    mock.timers.tick(1);
    await Promise.resolve();
    assert.equal(alTetto, false);
  } finally {
    mock.timers.reset();
  }
});
