// Verifica #496 — giro 11. Due frasi che promettono più (o meno) di quello che
// il disegno accanto fa davvero.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const ORA_MS = 3600 * 1000;
const iso = (h) => new Date(ora - h * ORA_MS).toISOString();
const AG = (g) => `--- Aggiornamento dell'agente del 0${g}/09/2026, 10:00 ---`;

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

test('l’orologio avanti di poche ore: la riga sotto il grafico dice il vero', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  // Tre segnalazioni, una col computer di chi segnala avanti di qualche ora ma
  // non abbastanza da scavalcare la mezzanotte: cade ancora dentro la colonna
  // di oggi, che il grafico disegna. L'istante si sceglie sull'orologio della
  // macchina, o alle 22 il "fra tre ore" finirebbe domani e la prova
  // racconterebbe un altro caso.
  const fineOggi = new Date();
  fineOggi.setHours(23, 59, 0, 0);
  const futuroOggi = new Date(Math.max(ora + 60 * 1000, fineOggi.getTime())).toISOString();
  await page.evaluate((d) => {
    window.__mgTest.setData([
      { _id: 'f1', seq: 701, clientId: 'tester@example.com', text: 'ieri', status: 'todo', createdAt: d[0] },
      { _id: 'f2', seq: 702, clientId: 'tester@example.com', text: 'poco fa', status: 'todo', createdAt: d[1] },
      { _id: 'f3', seq: 703, clientId: 'tester@example.com', text: 'orologio avanti', status: 'todo', createdAt: d[2] },
    ]);
  }, [iso(30), iso(2), futuroOggi]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);

  const stato = await page.evaluate(() => ({
    tessera: document.querySelector('[data-card-toggle="ricevuti"] .mg-st-card-value').textContent.trim(),
    somma: Array.from(document.querySelectorAll('#mgStBars [data-bucket] title'))
      .reduce((a, t) => a + (Number((t.textContent.split(':')[1] || '').trim()) || 0), 0),
    nota: document.getElementById('mgStBarsNote').textContent.replace(/\s+/g, ' ').trim(),
  }));
  console.log('ORE AVANTI:', JSON.stringify(stato, null, 1));

  // O la segnalazione è fuori dal grafico, e allora la frase è vera; o è
  // dentro, e allora la frase non deve dire il contrario.
  const dentro = stato.somma === Number(stato.tessera);
  if (dentro) {
    expect(stato.nota, stato.nota).not.toContain('nel futuro');
  } else {
    expect(stato.nota, stato.nota).toContain('nel futuro');
  }
});

test('«Giri di verifica registrati» apre quello che ha contato', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  // Due lavorazioni: una costata due giri, una costata un giro. In tutto tre
  // giri con rilievi, più i due «Verifica superata.»: il numero della riga.
  const verbale = (n) => [
    `Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`,
    'Provato: tutto quanto.',
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    ...Array.from({ length: n }, (_, i) => `- [1] rilievo ${i + 1}`),
  ].join('\n');
  const due = [verbale(2), `${AG(2)}\nCorretto.`, `${AG(3)}\n${verbale(1)}`,
    `${AG(4)}\nCorretto.`, `${AG(5)}\nVerifica superata.`].join('\n\n');
  const uno = [verbale(1), `${AG(2)}\nCorretto.`, `${AG(3)}\nVerifica superata.`].join('\n\n');

  await page.evaluate((d) => {
    window.__mgTest.setData([
      { _id: 'a', seq: 801, clientId: 'tester@example.com', name: 'due giri', text: 'due giri', status: 'done', createdAt: d.vecchio, _updateTime: d.ieri, notes: d.due },
      { _id: 'b', seq: 802, clientId: 'tester@example.com', name: 'un giro', text: 'un giro', status: 'done', createdAt: d.vecchio, _updateTime: d.ieri, notes: d.uno },
    ]);
  }, { vecchio: iso(200), ieri: iso(24), due, uno });
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);

  const riga = page.locator('#mgStMore [data-drill="misura:congiri"]');
  await expect(riga).toHaveCount(1);
  const numero = (await riga.locator('.mg-st-more-value').textContent()).trim();
  await riga.click();
  await page.waitForTimeout(150);
  const voci = await page.locator('#mgStMore .mg-st-drill .mg-st-drill-item').count();
  console.log('CONGIRI:', JSON.stringify({ numero, voci }));

  // Il tasto destro su questa riga promette «le segnalazioni contate»: allora
  // l'elenco che si apre deve avere tante voci quanto dice il numero, come su
  // ogni altra riga della scheda.
  expect(voci, `numero ${numero}, elenco ${voci}`).toBe(Number(numero));
});
