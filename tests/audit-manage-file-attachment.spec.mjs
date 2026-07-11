// AUDIT (prober): nella dashboard di gestione (filo://manage), il dettaglio di
// un feedback mostra le IMMAGINI allegate alla segnalazione originale
// (fb.images) ma NON i FILE allegati (fb.files: pdf/txt/log caricati dal
// tester col box feedback). La vecchia dashboard (filo://feedback) li mostra
// (filesListHtml); la nuova bolla della segnalazione in manage.js (renderThread,
// bolla 1) mappa solo fb.images → l'allegato-file del tester è invisibile
// all'owner nella superficie unificata. Asimmetria tra cammini equivalenti.
//
// Assert di SUCCESSO: aprendo il dettaglio di un feedback con un file allegato,
// nel thread deve comparire un riferimento cliccabile al file (nome visibile),
// come già avviene per le immagini. Oggi fallisce: il nome del file non compare
// da nessuna parte nel dettaglio.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';

// Feedback finto di un tester con UN'immagine e UN file allegati alla
// segnalazione originale (campi piatti images/files, come li scrive submit()).
const FB_WITH_FILE = {
  _id: 'audit-fb-file-001',
  seq: 98,
  subSeq: 0,
  number: 98,
  text: 'La pagina va in crash: in allegato lo screenshot e il log del crash.',
  name: 'Audit: allegato file invisibile',
  clientId: 'tester@example.com',
  createdAt: '2026-07-01T10:00:00Z',
  status: 'todo',
  images: ['https://example.com/screenshot.png'],
  files: [{ name: 'crash-log.txt', url: 'https://example.com/crash-log.txt', type: 'text/plain' }],
};

// test.fixme: repro del bug (oggi ROSSO). Documenta il comportamento atteso
// senza rendere rossa la regressione completa. Il fixer che chiude il feedback
// toglie `.fixme` per farlo diventare un assert vivo (deve passare col fix).
test.fixme('il dettaglio di manage mostra anche i FILE allegati alla segnalazione, non solo le immagini', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.__mgTest);

  await page.evaluate((fb) => {
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, FB_WITH_FILE);

  // Il dettaglio è aperto e la bolla della segnalazione è renderizzata.
  await expect(page.locator('#mgDetail')).toBeVisible();
  const userBubble = page.locator('.mg-bubble--user').first();
  await expect(userBubble).toContainText('La pagina va in crash');

  // L'IMMAGINE allegata compare (questo già funziona).
  await expect(userBubble.locator('.mg-bubble-imgs img')).toHaveCount(1);

  // Traccia visiva della run (gitignorata).
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/audit-manage-file-attachment.png' });

  // Il FILE allegato deve comparire con un riferimento cliccabile (parità con
  // le immagini e con la vecchia dashboard filo://feedback). Oggi: 0 match.
  await expect(page.locator('#mgThread a', { hasText: 'crash-log.txt' })).toHaveCount(1);
});
