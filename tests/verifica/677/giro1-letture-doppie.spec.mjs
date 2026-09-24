// Verifica #677, giro 1 — la pagina dei feedback e le letture ripetute.
//
// Il lavoro rimanda il documento intero al momento in cui serve: la lista
// scarica una proiezione, la conversazione e gli allegati arrivano per la
// sezione che si sta guardando. Qui si prova che quella lettura sia UNA, anche
// quando l'owner tocca la pagina mentre sta arrivando: scrivere nella ricerca
// o cambiare sezione durante il caricamento non deve ricomprare la stessa
// sezione da capo.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';

function righe(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      _id: `fb${i}`,
      _proiezione: true,
      seq: 700 + i,
      subSeq: 0,
      name: `Segnalazione ${i}`,
      text: `Testo della segnalazione ${i}`,
      status: 'unlabeled',
      statusPublic: 'open',
      clientId: 'tester-1',
      createdAt: `2026-09-${String(10 + (i % 10)).padStart(2, '0')}T10:00:00.000Z`,
    });
  }
  return out;
}

async function preparaPagina(page, rows) {
  await page.evaluate((r) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.invalid' } };
      }
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    // Il registro delle letture del dettaglio: ogni id chiesto, ogni volta.
    window.__chiesti = [];
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(r));
    window.SN_FEEDBACK.getMany = async (ids) => {
      window.__chiesti.push(...ids);
      // Lenta apposta: è la finestra in cui l'owner tocca la pagina.
      await new Promise((res) => setTimeout(res, 1500));
      return ids.map((id) => {
        const base = r.find((x) => x._id === id);
        if (!base) return null;
        const pieno = JSON.parse(JSON.stringify(base));
        delete pieno._proiezione;
        pieno.notes = `Report della lavorazione di ${id}`;
        pieno.images = [];
        pieno.files = [];
        return pieno;
      }).filter(Boolean);
    };
  }, rows);
}

test('scrivere nella ricerca mentre la sezione arriva non la ricompra', async ({ openTab }) => {
  const rows = righe(6);
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await preparaPagina(page, rows);
  await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' }));

  // Il cammino vero: la lista proiettata entra, il completamento della sezione
  // parte da solo ed è ancora in volo.
  await page.evaluate(async () => {
    const lista = await window.SN_FEEDBACK.list({ pageSize: 500, fields: window.SN_FEEDBACK.CAMPI_LISTA });
    window.__fbTest.setData(lista);
  });
  await expect(page.locator('#list')).toContainText('Caricamento', { timeout: 5000 });

  // L'owner scrive nella casella di ricerca mentre aspetta.
  await page.locator('#search').type('segnalazione', { delay: 40 });

  // La sezione arriva.
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);

  const chiesti = await page.evaluate(() => window.__chiesti);
  const conteggi = {};
  for (const id of chiesti) conteggi[id] = (conteggi[id] || 0) + 1;
  const ripetuti = Object.entries(conteggi).filter(([, n]) => n > 1);
  expect(ripetuti, `documenti chiesti più di una volta: ${JSON.stringify(conteggi)}`).toEqual([]);
});

test('cambiare sezione mentre arriva non ricompra la sezione di prima', async ({ openTab }) => {
  const rows = righe(6);
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await preparaPagina(page, rows);
  await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' }));
  await page.evaluate(async () => {
    const lista = await window.SN_FEEDBACK.list({ pageSize: 500, fields: window.SN_FEEDBACK.CAMPI_LISTA });
    window.__fbTest.setData(lista);
  });
  await expect(page.locator('#list')).toContainText('Caricamento', { timeout: 5000 });

  // Va in «Risolti» (vuota) e torna subito indietro, mentre la prima sezione
  // sta ancora arrivando.
  await page.evaluate(() => window.__fbTest.setTab('resolved'));
  await page.evaluate(() => window.__fbTest.setTab('inbox'));

  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);

  const chiesti = await page.evaluate(() => window.__chiesti);
  const conteggi = {};
  for (const id of chiesti) conteggi[id] = (conteggi[id] || 0) + 1;
  const ripetuti = Object.entries(conteggi).filter(([, n]) => n > 1);
  expect(ripetuti, `documenti chiesti più di una volta: ${JSON.stringify(conteggi)}`).toEqual([]);
});
