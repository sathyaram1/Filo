// #1129 — la voce del menu Impostazioni da preparare: la più scelta da questo utente, all'inizio quella predefinita; la
// riserva del menu nasce sull'indirizzo chiesto e non rinasce da sola. Il resto: tests/riserva-menu-impostazioni.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { scegli, crea } = require('../../src/main/services/vociMenuUsate.js');
const { RiservaNuovaScheda, vistePerAnnunci, riserveDi } = require('../../src/main/tabs/riservaNuovaScheda.js');

const P = 'filo://preferences/preferences.html';
const M = 'filo://options/options.html';
const S = 'filo://security/security.html';

test('senza scelte vince la predefinita, poi la più scelta; a pari conto la predefinita', () => {
  assert.equal(scegli({}, [M, S, P], P), P);
  assert.equal(scegli(null, [M, S, P], P), P);
  assert.equal(scegli({ [M]: 2, [P]: 1 }, [M, S, P], P), M);
  assert.equal(scegli({ [M]: 2, [P]: 2 }, [M, S, P], P), P);
  assert.equal(scegli({ [M]: 2, [S]: 2 }, [M, S, P], P), M, 'fra due non predefinite vince l\'ordine del menu');
  assert.equal(scegli({ [M]: 3 }, [M, S, P], 'filo://altro/'), M, 'una predefinita fuori dal menu non conta');
  assert.equal(scegli({}, [M, S], ''), M);
  assert.equal(scegli({ [M]: 'tanti', [S]: -4 }, [M, S, P], P), P, 'conti rovinati valgono zero');
  assert.equal(scegli({ 'filo://fuori/': 99 }, [M, P], P), P, 'una pagina che il menu non ha più non si prepara');
  assert.equal(scegli({}, [], P), '');
});

test('le scelte si contano, si leggono subito dopo e arrivano al disco; l\'incognito non conta', async () => {
  let disco = { impostazioni: { [M]: 1 } };
  const scritti = [];
  const v = crea({ leggi: async () => disco, scrivi: async (x) => { scritti.push(x); disco = x; } });
  assert.equal(v.piuUsata('impostazioni', [M, P], P), P, 'prima di caricare: la predefinita, senza aspettare il disco');
  await v.carica();
  assert.equal(v.piuUsata('impostazioni', [M, P], P), M);
  await v.conta('impostazioni', P);
  await v.conta('impostazioni', P);
  assert.equal(v.piuUsata('impostazioni', [M, P], P), P);
  assert.deepEqual(disco, { impostazioni: { [M]: 1, [P]: 2 } });
  await v.conta('impostazioni', M, { incognito: true });
  assert.equal(scritti.length, 2, 'in incognito niente scrittura');
  assert.deepEqual(disco.impostazioni, { [M]: 1, [P]: 2 });
  // Un backup importato riscrive la chiave: la scelta segue il valore nuovo.
  v.allinea({ impostazioni: { [S]: 5 } });
  assert.equal(v.piuUsata('impostazioni', [M, S, P], P), S);
  v.allinea(undefined);
  assert.equal(v.piuUsata('impostazioni', [M, S, P], P), P);
});

test('un disco illeggibile o rovinato non ferma niente', async () => {
  const v = crea({ leggi: async () => { throw new Error('no'); }, scrivi: async () => { throw new Error('no'); } });
  await v.carica();
  await v.conta('impostazioni', M);
  assert.equal(v.piuUsata('impostazioni', [M, P], P), M);
  const w = crea({ leggi: async () => [1, 2], scrivi: async () => {} });
  await w.carica();
  assert.equal(w.piuUsata('impostazioni', [M, P], P), P);
});

// Un manager finto quanto basta a far nascere e buttare una vista.
function manager() {
  const nate = [];
  const m = {
    win: { isDestroyed: () => false, contentView: { addChildView() {}, removeChildView() {} } },
    _partitionFor: () => null,
    _areaPagina: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    _tastieraAllaSchedaAttiva() {},
    _makeView(url) {
      const wc = {
        url, chiusa: false, ses: 'predefinita', session: 'predefinita',
        isDestroyed() { return this.chiusa; }, isCrashed: () => false, close() { this.chiusa = true; },
        getURL() { return url; }, once() {}, on() {}, setWindowOpenHandler() {}, loadURL() {},
      };
      const vista = { webContents: wc, setVisible() {}, setBounds() {} };
      nate.push(vista);
      return vista;
    },
  };
  return { m, nate };
}

test('la riserva del menu nasce sull\'indirizzo chiesto, lo tiene per la stessa voce e si consegna solo per quello', () => {
  const { m, nate } = manager();
  const r = new RiservaNuovaScheda(m, { url: null, rinasce: false, variabile: 'FILO_PROVA_INESISTENTE' });
  assert.equal(r.preparaSubito(P), true);
  assert.equal(nate.length, 1);
  assert.equal(r.preparaSubito(P), true);
  assert.equal(nate.length, 1, 'la stessa voce non fa nascere una seconda vista');
  assert.equal(r.prendi(M, 'predefinita'), null);
  assert.equal(r.prendi(P, 'altra sessione'), null);
  r.preparaSubito(M);
  assert.equal(nate.length, 2);
  assert.equal(nate[0].webContents.chiusa, true, 'cambiata la voce, la pagina di prima si chiude');
  const presa = r.prendi(M, 'predefinita');
  assert.equal(presa.vista, nate[1]);
  assert.equal(r.vista, null);
  r.scarta(M);
  assert.equal(nate[1].webContents.chiusa, false, 'quella consegnata non si butta');
});

test('chiuso il menu la riserva si butta, e dopo un crollo non rinasce da sola', () => {
  const { m, nate } = manager();
  const r = new RiservaNuovaScheda(m, { url: null, rinasce: false, variabile: 'FILO_PROVA_INESISTENTE' });
  r.preparaSubito(P);
  r.scarta(M);
  assert.equal(nate[0].webContents.chiusa, false, 'si butta solo la voce preparata da quell\'apertura');
  r.scarta(P);
  assert.equal(nate[0].webContents.chiusa, true);
  assert.equal(r.webContents(), null);
  r.preparaSubito(P);
  r._butta({ poi: 10 });
  assert.equal(r._timer, null, 'nessuna rinascita programmata');
});

test('gli annunci arrivano anche alla pagina preparata, che non è mai davanti', () => {
  const wc = (id) => ({ id, isDestroyed: () => false });
  const preparata = new RiservaNuovaScheda({}, { url: null, rinasce: false, variabile: 'FILO_PROVA_INESISTENTE' });
  preparata.vista = { webContents: wc(9) };
  const tm = { activeId: 'a', tabs: [{ id: 'a', view: { webContents: wc(1) } }], riserva: null, preparata };
  assert.deepEqual(vistePerAnnunci(tm).map((v) => [v.wc.id, v.inVista]), [[1, true], [9, false]]);
  assert.deepEqual(riserveDi(tm), [preparata]);
  assert.deepEqual(riserveDi(null), []);
});

test('nelle prove la preparazione parte spenta; il menu Impostazioni la chiede, gli altri no', () => {
  const config = readFileSync(join(ROOT, 'playwright.config.js'), 'utf8');
  assert.match(config, /FILO_PREPARA_IMPOSTAZIONI = '0'/);
  const prima = process.env.FILO_PREPARA_IMPOSTAZIONI;
  try {
    process.env.FILO_PREPARA_IMPOSTAZIONI = '0';
    assert.equal(new RiservaNuovaScheda({}, { variabile: 'FILO_PREPARA_IMPOSTAZIONI' }).spenta, true);
    delete process.env.FILO_PREPARA_IMPOSTAZIONI;
    assert.equal(new RiservaNuovaScheda({}, { variabile: 'FILO_PREPARA_IMPOSTAZIONI' }).spenta, false);
  } finally {
    if (prima === undefined) delete process.env.FILO_PREPARA_IMPOSTAZIONI;
    else process.env.FILO_PREPARA_IMPOSTAZIONI = prima;
  }
  const shell = readFileSync(join(ROOT, 'src', 'renderer', 'shell.js'), 'utf8');
  assert.equal((shell.match(/prepara: 'impostazioni'/g) || []).length, 1, 'solo il menu Impostazioni chiede la preparazione');
});
