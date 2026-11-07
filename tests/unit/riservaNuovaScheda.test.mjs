// #1128 — la home pronta per la scheda nuova si tiene allineata come le schede aperte: chi annuncia alle schede passa
// da `vistePerAnnunci`, che la comprende, e non da un giro su `tabs` scritto a mano. #1129 — la voce del menu
// Impostazioni da preparare è la più scelta. Il resto: riserva-nuova-scheda.spec, riserva-menu-impostazioni.spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RiservaNuovaScheda, vistePerAnnunci, riserveDi } = require('../../src/main/tabs/riservaNuovaScheda.js');
const { scegli, crea } = require('../../src/main/services/vociMenuUsate.js');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const wc = (id) => ({ id, isDestroyed: () => false });
const tm = (riserva) => ({ activeId: 'a', tabs: [{ id: 'a', view: { webContents: wc(1) } }, { id: 'b', view: { webContents: wc(2) } }], riserva });

test('gli annunci arrivano alle schede e alla riserva, che non è mai davanti', () => {
  const r = new RiservaNuovaScheda(tm(null));
  r.vista = { webContents: wc(3) };
  const viste = vistePerAnnunci(tm(r));
  assert.deepEqual(viste.map((v) => [v.wc.id, v.inVista]), [[1, true], [2, false], [3, false]]);
});

test('senza riserva (spenta, o fra una consegna e la prossima) restano le schede', () => {
  assert.deepEqual(vistePerAnnunci(tm(null)).map((v) => v.wc.id), [1, 2]);
  const vuota = new RiservaNuovaScheda(tm(null));
  assert.deepEqual(vistePerAnnunci(tm(vuota)).map((v) => v.wc.id), [1, 2]);
  assert.deepEqual(vistePerAnnunci(null), []);
});

test('quello che la pagina dice di sé vale per la scheda che diventerà, e per nessun\'altra', () => {
  const r = new RiservaNuovaScheda(tm(null));
  r.vista = { webContents: wc(3) };
  r.id = 'futura';
  assert.equal(r.campiPer('futura'), r.campi);
  assert.equal(r.campiPer('a'), null);
  assert.equal(r.campiPer(null), null);
});

test('nelle prove la riserva parte spenta e si riaccende a richiesta', () => {
  const prima = process.env.FILO_RISERVA_NUOVA_SCHEDA;
  try {
    process.env.FILO_RISERVA_NUOVA_SCHEDA = '0';
    assert.equal(new RiservaNuovaScheda(tm(null)).spenta, true);
    process.env.FILO_RISERVA_NUOVA_SCHEDA = '1';
    assert.equal(new RiservaNuovaScheda(tm(null)).spenta, false);
    delete process.env.FILO_RISERVA_NUOVA_SCHEDA;
    assert.equal(new RiservaNuovaScheda(tm(null)).spenta, false, 'fuori dalle prove è sempre accesa');
  } finally {
    if (prima === undefined) delete process.env.FILO_RISERVA_NUOVA_SCHEDA;
    else process.env.FILO_RISERVA_NUOVA_SCHEDA = prima;
  }
  const config = readFileSync(join(ROOT, 'playwright.config.js'), 'utf8');
  assert.match(config, /FILO_RISERVA_NUOVA_SCHEDA = '0'/);
});

// Un giro su `.tabs` che spinge messaggi alle pagine lascerebbe la riserva indietro: alla consegna mostrerebbe carte,
// tema o impostazioni di prima. Le eccezioni dicono cosa mandano e perché alla riserva non serve.
const ECCEZIONI = new Map([
  // Lo stato della singola scheda (la riserva lo riceve alla consegna); i campi da ricontrollare per la pulizia, che la riserva non tocca.
  ['src/main/tabs.js', /tab_in_vista|FORM_RECHECK/],
  ['src/main/services/riquadriRotti.js', /RIQUADRO_COOKIE_AGGIORNA/], // solo ai riquadri dei siti
]);

function fileJs(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...fileJs(p));
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}

test('nessun giro sulle schede manda annunci alle pagine senza passare da vistePerAnnunci', () => {
  const violazioni = [];
  for (const file of fileJs(join(ROOT, 'src', 'main'))) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const righe = readFileSync(file, 'utf8').split('\n');
    righe.forEach((riga, i) => {
      const giro = /for \(const \w+ of [\w.?]*\.tabs\b/.exec(riga);
      if (!giro) return;
      const rientro = riga.match(/^\s*/)[0].length;
      const corpo = [riga];
      for (let j = i + 1; j < righe.length && j < i + 40; j++) {
        const r = righe[j];
        if (r.trim() && r.match(/^\s*/)[0].length <= rientro) { if (/^\s*}/.test(r)) corpo.push(r); break; }
        corpo.push(r);
      }
      const testo = corpo.join('\n');
      if (!/spingiAllaScheda\(|aFilo\(|\.send\(/.test(testo)) return;
      const eccezione = ECCEZIONI.get(rel);
      if (eccezione && eccezione.test(testo)) return;
      violazioni.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(violazioni, [], 'questi giri mandano annunci alle schede senza la riserva: usa vistePerAnnunci');
});

// ── #1129: la voce preparata del menu Impostazioni ──

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

test('un disco illeggibile o rovinato non ferma niente, e un conto non si scrive sopra quello non letto', async () => {
  let rotto = true;
  const scritti = [];
  const v = crea({ leggi: async () => { if (rotto) throw new Error('no'); return { impostazioni: { [M]: 7 } }; }, scrivi: async (x) => { scritti.push(x); } });
  await v.carica();
  await v.conta('impostazioni', P);
  assert.equal(v.piuUsata('impostazioni', [M, P], P), P);
  assert.equal(scritti.length, 0, 'sul disco non letto non si scrive');
  rotto = false;
  await v.conta('impostazioni', P);
  assert.deepEqual(scritti, [{ impostazioni: { [M]: 7, [P]: 1 } }], 'letto alla volta dopo, il conto si somma a quello del disco');
  assert.equal(v.piuUsata('impostazioni', [M, P], P), M);
  const r = crea({ leggi: async () => ({}), scrivi: async () => { throw new Error('disco pieno'); } });
  await r.conta('impostazioni', M);
  assert.equal(r.piuUsata('impostazioni', [M, P], P), M, 'una scrittura fallita non toglie la scelta di adesso');
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
