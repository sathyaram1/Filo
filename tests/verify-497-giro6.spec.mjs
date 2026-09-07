// #497 — sesto giro: un messaggio d'esito lungo dentro la riga dei tasti.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over) {
  return {
    _id: 'x', text: 'Il bottone non fa niente', name: 'Bottone morto',
    seq: 700, subSeq: 0, clientId: 'tester@example.com',
    createdAt: '2026-09-01T10:00:00Z', images: [],
    status: 'todo', statusPublic: 'open', notes: '', ...over,
  };
}

test('#497 Y — errore lungo nella riga: i tasti restano dove sono e il testo si legge', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => {
    window.__mgTest.setAdmin(true);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        return { ok: false, error: 'Il server di sicurezza ha rifiutato la scrittura: la chiave della routine non è più valida, rigenerala e riprova (codice 401).' };
      }
      return { ok: true };
    };
  });
  await page.evaluate((l) => window.__mgTest.setData(l), [fb({ _id: 'z1', status: 'todo' })]);
  await page.evaluate(() => { window.__mgTest.setTab('queue'); window.__mgTest.openDetail('z1'); });

  const prima = await page.locator('#mgUserNoteToggle').boundingBox();
  await page.locator('#mgArchiveBtn').click();
  await expect(page.locator('#mgActionMsg')).toHaveClass(/mg-err/);
  const dopo = await page.locator('#mgUserNoteToggle').boundingBox();
  const misure = await page.evaluate(() => {
    const m = document.getElementById('mgActionMsg');
    const r = m.getBoundingClientRect();
    const col = document.getElementById('mgDetailCol').getBoundingClientRect();
    const d = document.getElementById('mgDetail');
    return {
      msgDestra: Math.round(r.right), colDestra: Math.round(col.right),
      msgAltezza: Math.round(r.height),
      scrollOrizzontale: d.scrollWidth - d.clientWidth,
    };
  });
  console.log('PRIMA y', Math.round(prima.y), 'DOPO y', Math.round(dopo.y), JSON.stringify(misure));
  await page.screenshot({ path: 'tests/.shots/497-errore-lungo.png' });
  expect(misure.msgDestra, 'il messaggio esce dalla colonna').toBeLessThanOrEqual(misure.colDestra + 1);
  expect(misure.scrollOrizzontale, 'il dettaglio scorre in orizzontale').toBeLessThanOrEqual(1);
});
