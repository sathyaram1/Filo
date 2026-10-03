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
