// La dashboard di gestione mostra TUTTI i feedback, non i 500 più recenti: il
// #597, più vecchio della finestra, deve stare fra i Ricevuti.
// Regola: patterns/una-pagina-dei-piu-recenti-non-e-tutto.md.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// 600 feedback: i 500 più recenti e, oltre la finestra, i più vecchi fra cui il #597.
function collezione() {
  const righe = [];
  for (let i = 0; i < 600; i++) {
    const seq = 1000 - i;
    righe.push({
      _id: `fb${seq}`, seq, subSeq: 0, name: `Feedback ${seq}`, text: `Feedback ${seq}`,
      clientId: 'tester@example.com', status: i % 2 ? 'done' : 'todo',
      createdAt: new Date(Date.UTC(2026, 9, 1) - i * 3600 * 1000).toISOString(),
      _updateTime: 't1',
    });
  }
  const vecchio = righe[599];
  Object.assign(vecchio, { _id: 'fb597', seq: 597, name: 'Segnalazione vecchia rimasta nei ricevuti', status: 'unlabeled' });
  // Il main pagina col nome del documento: l'ordine d'arrivo non è per data.
  return righe.reverse();
}

test('la dashboard legge tutti i feedback: il #597 oltre i 500 più recenti sta nei Ricevuti', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));

  await page.evaluate((righe) => {
    window.__richieste = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      if (msg && msg.type === 'feedback_fetch') {
        window.__richieste.push(msg.op);
        const copia = JSON.parse(JSON.stringify(righe));
        if (msg.op === 'listAll') return { ok: true, rows: copia, complete: true };
        // La finestra dei più recenti, come la dà Firestore: senza il #597.
        const recenti = copia.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
        return { ok: true, rows: recenti };
      }
      return orig(msg);
    };
  }, collezione());

  await page.evaluate(() => window.__mgTest.ricarica());
  await page.evaluate(() => window.__mgTest.setTab('inbox'));

  const riga = page.locator('.mg-item[data-id="fb597"]');
  await expect(riga).toBeVisible();
  await expect(riga).toContainText('#597');
  // Il conto è un totale: nessun "+" che dica «forse ce ne sono altri».
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti (1)');
  expect(await page.evaluate(() => window.__richieste)).toContain('listAll');
});

test('se la lettura completa si ferma al freno, i numeri tornano minimi e lo dicono', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));

  await page.evaluate((righe) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      if (msg && msg.type === 'feedback_fetch' && msg.op === 'listAll') {
        return { ok: true, rows: JSON.parse(JSON.stringify(righe)), complete: false };
      }
      return orig(msg);
    };
  }, collezione());
  await page.evaluate(() => window.__mgTest.ricarica());
  await page.evaluate(() => window.__mgTest.setTab('inbox'));

  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti (1+)');
  const hint = await page.evaluate(() => window.SN_FEEDBACK.COUNT_INCOMPLETE_HINT);
  await expect(page.locator('#mgListHead')).toHaveAttribute('title', hint);
});
