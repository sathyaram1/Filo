// #787 giro 2, rilievo 3: chiedere in chat di svuotare la chat. Filo deve saperlo fare (o almeno sapere come si
// fa): qui si guarda che le istruzioni che accompagnano la domanda al modello parlino di svuotare la chat.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, newDeck, ask } from './aiuti.mjs';

test('«svuota la chat» scritto in chat: il modello sa che si può', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await ask(page, 'svuota la chat, ricominciamo da zero', 1);
  const calls = await app.evaluate(() => globalThis.__chatCalls);
  const system = String((calls[calls.length - 1] || [])[0]?.content || '');
  expect(system).toMatch(/svuot\w* (la )?chat|cancell\w* (la )?(chat|conversazione)/i);
});
