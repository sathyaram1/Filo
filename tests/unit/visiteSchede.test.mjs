// Sentinella delle pagine visitate (#866): una pagina che riscrive la propria voce di cronologia (history.replaceState:
// una mappa spostata, un filtro) resta UNA visita; una pagina nuova dentro la stessa (pushState) è una visita in più.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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

test('pushState è una pagina nuova, anche a cronologia piena; tornare indietro dentro la pagina pure', async () => {
  const { v, scritte, fermo } = prepara();
  const wc = schedaFinta();
  for (let i = 0; i < 55; i++) {
    wc.push(`https://video.test/watch?v=${i}`);
    v.navigata(wc, 1, `https://video.test/watch?v=${i}`, { inPagina: i > 0 });
    v.titolo(wc, `Video ${i}`);
    v.caricata(wc);
  }
  wc.back();
  v.navigata(wc, 1, 'https://video.test/watch?v=53', { inPagina: true });
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
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

test('un titolo scritto dopo il caricamento diventa quello della visita, una volta sola quando si ferma', async () => {
  const { v, scritte, aggiornate } = preparaTitoli();
  const wc = schedaFinta();
  wc.push('https://posta.test/');
  v.navigata(wc, 1, 'https://posta.test/');
  v.caricata(wc);
  for (const t of ['Posta', 'Posta in arrivo', 'Posta in arrivo (3)']) { v.titolo(wc, t); await attendi(5); }
  await attendi(80);
  assert.equal(scritte.length, 1);
  assert.deepEqual(aggiornate, [{ visita: 'v1', titolo: 'Posta in arrivo (3)' }]);
});

test('il titolo di passaggio dopo un cambio d’indirizzo interno lascia il posto a quello vero', async () => {
  const { v, scritte, aggiornate } = preparaTitoli();
  const wc = schedaFinta();
  wc.push('https://video.test/');
  v.navigata(wc, 1, 'https://video.test/');
  v.caricata(wc);
  let titoloPagina = 'Caricamento…';
  wc.getTitle = () => titoloPagina;
  wc.push('https://video.test/42');
  v.navigata(wc, 1, 'https://video.test/42', { inPagina: true });
  v.titolo(wc, titoloPagina);
  await attendi(5);
  titoloPagina = 'Orche al tramonto';
  v.titolo(wc, titoloPagina);
  await attendi(80);
  assert.deepEqual(scritte.map((s) => s.titolo), ['Titolo', 'Caricamento…']);
  assert.deepEqual(aggiornate, [{ visita: 'v2', titolo: 'Orche al tramonto' }]);
});

test('il titolo della pagina dopo, scritto un istante prima di cambiare indirizzo, non va alla pagina di prima', async () => {
  const { v, aggiornate } = preparaTitoli();
  const wc = schedaFinta();
  wc.push('https://video.test/1');
  v.navigata(wc, 1, 'https://video.test/1');
  v.caricata(wc);
  v.titolo(wc, 'Video due');
  wc.push('https://video.test/2');
  v.navigata(wc, 1, 'https://video.test/2', { inPagina: true });
  await attendi(80);
  assert.deepEqual(aggiornate, []);
});

test('un titolo che cambia di continuo non riempie il filo: dopo la finestra vale quello fermo all’uscita', async () => {
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
});
