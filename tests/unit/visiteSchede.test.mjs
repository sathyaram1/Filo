// Sentinella delle pagine visitate (#866): una pagina che riscrive la propria voce di cronologia (history.replaceState:
// una mappa spostata, un filtro) resta UNA visita; una pagina nuova dentro la stessa (pushState) è una visita in più.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { scorri } from '../helpers/orologio.mjs';

const { VisiteSchede } = createRequire(import.meta.url)('../../src/main/tabs/visite.js');

function schedaFinta() {
  const voci = [];
  let attiva = -1;
  return {
    voci,
    isDestroyed: () => false,
    getTitle: () => 'Titolo',
    navigationHistory: {
      getActiveIndex: () => attiva,
      length: () => voci.length,
      getEntryAtIndex: (i) => ({ url: voci[i] }),
    },
    push(url) { voci.splice(attiva + 1); voci.push(url); if (voci.length > 50) voci.shift(); attiva = voci.length - 1; },
    replace(url) { voci[attiva] = url; },
    back() { attiva -= 1; },
  };
}

function prepara() {
  const scritte = [];
  const v = new VisiteSchede({ registra: (visita) => { scritte.push(visita); return Promise.resolve(); } });
  return { v, scritte, fermo: () => new Promise((r) => setTimeout(r, 0)) };
}

test('venti replaceState su una mappa sono una visita sola, con l’indirizzo più recente', async () => {
  const { v, scritte, fermo } = prepara();
  const wc = schedaFinta();
  wc.push('https://mappe.test/?@1');
  v.navigata(wc, 1, 'https://mappe.test/?@1');
  for (let i = 2; i <= 21; i++) { wc.replace(`https://mappe.test/?@${i}`); v.navigata(wc, 1, `https://mappe.test/?@${i}`, { inPagina: true }); }
  v.caricata(wc);
  await fermo();
  assert.equal(scritte.length, 1);
  assert.equal(scritte[0].url, 'https://mappe.test/?@21');
});

// Il gesto (un clic sulla scheda, la barra, indietro): senza, una pagina che cambia indirizzo da sola si frena (#1525).
const gesto = () => ({ gesto: Date.now() });

test('pushState è una pagina nuova, anche a cronologia piena; tornare indietro dentro la pagina pure', async () => {
  const { v, scritte, fermo } = prepara();
  const wc = schedaFinta();
  for (let i = 0; i < 55; i++) {
    wc.push(`https://video.test/watch?v=${i}`);
    v.navigata(wc, 1, `https://video.test/watch?v=${i}`, { inPagina: i > 0, ...gesto() });
    v.titolo(wc, `Video ${i}`);
    v.caricata(wc);
  }
  wc.back();
  v.navigata(wc, 1, 'https://video.test/watch?v=53', { inPagina: true, ...gesto() });
  v.titolo(wc, 'Video 53');
  await fermo();
  assert.equal(scritte.length, 56);
});

// Il titolo segue la pagina finché l'utente resta lì (verifica #866 giro 3): le app web lo scrivono dopo il caricamento.
function preparaTitoli(tempi = { assestamento: 30, finestra: 400 }) {
  const scritte = [];
  const aggiornate = [];
  let n = 0;
  const v = new VisiteSchede({
    tempi,
    registra: (visita) => { const ev = { ...visita, id: `v${++n}` }; scritte.push(ev); return Promise.resolve(ev); },
    aggiorna: (dato) => { aggiornate.push(dato); return Promise.resolve(); },
  });
  return { v, scritte, aggiornate };
}
// I tempi dei titoli contano in tick dell'orologio finto: su una macchina carica fra due titoli «a 5 ms» passerebbe
// l'assestamento intero (#1063).
async function conOrologioFinto(fn) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  try { await fn(); } finally { mock.timers.reset(); }
}
const attendi = (ms) => scorri(ms);

test('un titolo scritto dopo il caricamento diventa quello della visita, una volta sola quando si ferma', () => conOrologioFinto(async () => {
  const { v, scritte, aggiornate } = preparaTitoli();
  const wc = schedaFinta();
  wc.push('https://posta.test/');
  v.navigata(wc, 1, 'https://posta.test/');
  v.caricata(wc);
  for (const t of ['Posta', 'Posta in arrivo', 'Posta in arrivo (3)']) { v.titolo(wc, t); await attendi(5); }
  await attendi(80);
  assert.equal(scritte.length, 1);
  assert.deepEqual(aggiornate, [{ visita: 'v1', titolo: 'Posta in arrivo (3)' }]);
}));

test('il titolo di passaggio dopo un cambio d’indirizzo interno lascia il posto a quello vero', () => conOrologioFinto(async () => {
  const { v, scritte, aggiornate } = preparaTitoli();
  const wc = schedaFinta();
  wc.push('https://video.test/');
  v.navigata(wc, 1, 'https://video.test/');
  v.caricata(wc);
  let titoloPagina = 'Caricamento…';
  wc.getTitle = () => titoloPagina;
  wc.push('https://video.test/42');
  v.navigata(wc, 1, 'https://video.test/42', { inPagina: true, ...gesto() });
  v.titolo(wc, titoloPagina);
  await attendi(5);
  titoloPagina = 'Orche al tramonto';
  v.titolo(wc, titoloPagina);
  await attendi(80);
  assert.deepEqual(scritte.map((s) => s.titolo), ['Titolo', 'Caricamento…']);
  assert.deepEqual(aggiornate, [{ visita: 'v2', titolo: 'Orche al tramonto' }]);
}));

test('il titolo della pagina dopo, scritto un istante prima di cambiare indirizzo, non va alla pagina di prima', () => conOrologioFinto(async () => {
  const { v, aggiornate } = preparaTitoli();
  const wc = schedaFinta();
  wc.push('https://video.test/1');
  v.navigata(wc, 1, 'https://video.test/1');
  v.caricata(wc);
  v.titolo(wc, 'Video due');
  wc.push('https://video.test/2');
  v.navigata(wc, 1, 'https://video.test/2', { inPagina: true, ...gesto() });
  await attendi(80);
  assert.deepEqual(aggiornate, []);
}));

test('un titolo che cambia di continuo non riempie il filo: dopo la finestra vale quello fermo all’uscita', () => conOrologioFinto(async () => {
  const { v, aggiornate } = preparaTitoli({ assestamento: 30, finestra: 60 });
  const wc = schedaFinta();
  wc.push('https://borsa.test/');
  v.navigata(wc, 1, 'https://borsa.test/');
  v.caricata(wc);
  await attendi(80);
  for (let i = 0; i < 40; i++) { v.titolo(wc, `Indice ${i}`); await attendi(2); }
  await attendi(60);
  assert.deepEqual(aggiornate, []);
  v.chiusa(wc);
  assert.deepEqual(aggiornate.map((a) => a.titolo), []);
  await attendi(5);
  assert.deepEqual(aggiornate.map((a) => a.titolo), ['Indice 39']);
}));

// #1525 — una pagina lasciata aperta che cambia indirizzo da sola non fa crescere il filo senza fine.
test('500 cambi d’indirizzo senza gesto lasciano al più 30 visite; un tocco sulla scheda rimette il conto a zero', () => conOrologioFinto(async () => {
  const { v, scritte } = preparaTitoli();
  const wc = schedaFinta();
  wc.push('https://giostra.test/');
  v.navigata(wc, 1, 'https://giostra.test/');
  v.caricata(wc);
  for (let i = 1; i <= 500; i++) {
    await attendi(6_000);
    wc.push(`https://giostra.test/${i}`);
    v.navigata(wc, 1, `https://giostra.test/${i}`, { inPagina: true });
    v.titolo(wc, `Giro ${i}`);
  }
  await attendi(6_000);
  assert.equal(scritte.length, 30);
  // Un clic vero, poi un cambio: è una pagina che l'utente ha chiesto.
  wc.push('https://giostra.test/scelta');
  v.navigata(wc, 1, 'https://giostra.test/scelta', { inPagina: true, ...gesto() });
  v.titolo(wc, 'Scelta');
  await attendi(6_000);
  wc.push('https://giostra.test/dopo');
  v.navigata(wc, 1, 'https://giostra.test/dopo', { inPagina: true, gesto: Date.now() - 6_000 });
  v.titolo(wc, 'Dopo');
  await attendi(6_000);
  assert.deepEqual(scritte.slice(30).map((s) => s.url), ['https://giostra.test/scelta', 'https://giostra.test/dopo']);
}));

test('cambi a raffica senza gesto sono una visita sola, che segue l’indirizzo finché non è scritta', () => conOrologioFinto(async () => {
  const { v, scritte } = preparaTitoli();
  const wc = schedaFinta();
  wc.push('https://giostra.test/');
  v.navigata(wc, 1, 'https://giostra.test/', gesto());
  v.caricata(wc);
  await attendi(6_000);
  for (let i = 1; i <= 20; i++) {
    wc.push(`https://giostra.test/${i}`);
    v.navigata(wc, 1, `https://giostra.test/${i}`, { inPagina: true });
    await attendi(100);
  }
  // La visita in attesa si scrive a 4 s dal primo cambio, con l'indirizzo dell'ultimo.
  await attendi(2_500);
  assert.deepEqual(scritte.map((s) => s.url), ['https://giostra.test/', 'https://giostra.test/20']);
  // Già scritta, la visita assorbe i cambi a ridosso: nessuna riga nuova.
  for (let i = 21; i <= 300; i++) {
    wc.push(`https://giostra.test/${i}`);
    v.navigata(wc, 1, `https://giostra.test/${i}`, { inPagina: true });
    v.titolo(wc, `Giro ${i}`);
    await attendi(100);
  }
  await attendi(6_000);
  assert.equal(scritte.length, 2);
}));

test('anche le pagine intere caricate senza gesto si fermano a 30 visite, e la pagina vuota in mezzo non riapre il conto', () => conOrologioFinto(async () => {
  const { v, scritte } = preparaTitoli();
  const wc = schedaFinta();
  for (let i = 0; i < 100; i++) {
    // Una pagina che si porta su about:blank e torna: la visita aperta non si chiude per questo.
    wc.push('about:blank');
    v.navigata(wc, 1, 'about:blank');
    await attendi(6_000);
    wc.push(`https://rimbalzo.test/${i}`);
    v.navigata(wc, 1, `https://rimbalzo.test/${i}`);
    v.caricata(wc);
    await attendi(6_000);
  }
  assert.ok(scritte.length <= 31, `${scritte.length} visite`);
  assert.ok(scritte.length >= 30, `${scritte.length} visite`);
}));

// #1525 giro 1 — in privacy ogni salto fra siti ricrea la vista della scheda: il conto è della scheda, non della vista.
test('una scheda che salta da sola fra siti, con una vista nuova a ogni salto, si ferma a 30 visite; un gesto riapre il conto', () => conOrologioFinto(async () => {
  const { v, scritte } = preparaTitoli();
  const scheda = { id: 1 };
  let wc = schedaFinta();
  wc.push('https://salto-a.test/0');
  v.navigata(wc, 1, 'https://salto-a.test/0', { ...gesto(), chiave: scheda });
  v.caricata(wc);
  for (let i = 1; i <= 100; i++) {
    await attendi(300);
    v.chiusa(wc);
    wc = schedaFinta();
    const url = `https://salto-${i % 2 ? 'b' : 'a'}.test/${i}`;
    wc.push(url);
    v.navigata(wc, 1, url, { chiave: scheda });
    v.caricata(wc);
  }
  await attendi(6_000);
  assert.equal(scritte.length, 31);
  v.chiusa(wc);
  wc = schedaFinta();
  wc.push('https://salto-a.test/scelta');
  v.navigata(wc, 1, 'https://salto-a.test/scelta', { ...gesto(), chiave: scheda });
  v.caricata(wc);
  await attendi(10);
  assert.equal(scritte.at(-1).url, 'https://salto-a.test/scelta');
}));

test('un gesto vale per la pagina che segue, non per i cambi che la pagina fa dopo da sola', () => conOrologioFinto(async () => {
  const { v, scritte } = preparaTitoli();
  const wc = schedaFinta();
  const clic = Date.now();
  await attendi(10);
  wc.push('https://giostra.test/scelta');
  v.navigata(wc, 1, 'https://giostra.test/scelta', { gesto: clic });
  v.caricata(wc);
  for (let i = 1; i <= 40; i++) {
    await attendi(50);
    wc.push(`https://giostra.test/${i}`);
    v.navigata(wc, 1, `https://giostra.test/${i}`, { inPagina: true, gesto: clic });
    v.titolo(wc, `Giro ${i}`);
  }
  await attendi(6_000);
  assert.deepEqual(scritte.map((s) => s.url), ['https://giostra.test/scelta']);
}));

test('un rinvio del sito dopo il caricamento resta una visita sua; quello prima del caricamento porta la visita dov’è arrivata', () => conOrologioFinto(async () => {
  const { v, scritte } = preparaTitoli();
  const wc = schedaFinta();
  await attendi(10);
  wc.push('https://traccia.test/l?u=arrivo');
  v.navigata(wc, 1, 'https://traccia.test/l?u=arrivo', { gesto: Date.now() - 5 });
  v.caricata(wc);
  await attendi(800);
  wc.push('https://arrivo.test/');
  v.navigata(wc, 1, 'https://arrivo.test/', { gesto: Date.now() - 805 });
  v.caricata(wc);
  await attendi(10_000);
  wc.push('https://accesso.test/entra');
  v.navigata(wc, 1, 'https://accesso.test/entra', gesto());
  await attendi(300);
  wc.push('https://app.test/casa');
  v.navigata(wc, 1, 'https://app.test/casa');
  v.caricata(wc);
  await attendi(100);
  assert.deepEqual(scritte.map((s) => s.url), ['https://traccia.test/l?u=arrivo', 'https://arrivo.test/', 'https://app.test/casa']);
}));
