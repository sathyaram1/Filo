// Nella dashboard di gestione (filo://manage), un allegato-file con un nome
// molto lungo SENZA spazi (centinaia di caratteri) deve andare a capo dentro la
// bolla, non sbordare oltre il bordo generando una barra di scorrimento
// orizzontale nel pannello della conversazione.
//
// Assert di SUCCESSO: il pannello del thread NON ha overflow orizzontale
// (scrollWidth <= clientWidth) anche con un nome-file abnorme. Senza il fix
// (overflow-wrap: anywhere sul link allegato) il nome sborda e scrollWidth >
// clientWidth → il test diventa rosso.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';

// Nome file lunghissimo senza spazi: il caso limite descritto nel feedback.
const LONG_NAME = 'x'.repeat(300) + '.pdf';

const FB_LONG_FILE = {
  _id: 'longname-fb-001',
  seq: 99,
  subSeq: 0,
  number: 99,
  text: 'Allegato con nome file abnorme.',
  name: 'Nome file lunghissimo',
  clientId: 'tester@example.com',
  createdAt: '2026-07-01T10:00:00Z',
  status: 'todo',
  images: [],
  files: [{ name: LONG_NAME, url: 'https://example.com/' + LONG_NAME, type: 'application/pdf' }],
};

test('un nome-file lunghissimo va a capo e non fa sbordare il pannello della conversazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.__mgTest);

  await page.evaluate((fb) => {
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, FB_LONG_FILE);

  await expect(page.locator('#mgDetail')).toBeVisible();

  // Il link allegato col nome lungo è presente.
  const fileLink = page.locator('.mg-bubble-file a').first();
  await expect(fileLink).toHaveCount(1);

  // Traccia visiva della run (gitignorata).
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/manage-attachment-longname-wrap.png' });

  // Il pannello della conversazione NON deve avere overflow orizzontale:
  // il nome lungo deve andare a capo dentro la bolla.
  const overflow = await page.evaluate(() => {
    const thread = document.getElementById('mgThread');
    return { scrollW: thread.scrollWidth, clientW: thread.clientWidth };
  });
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW);
});
