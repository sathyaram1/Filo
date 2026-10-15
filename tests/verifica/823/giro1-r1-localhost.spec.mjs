// Verifica #823 giro 1, rilievo 1: «tienimi sempre aperta questa scheda» su un sito locale (localhost) non si salva,
// mentre la pulizia quella scheda la può archiviare.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const pagina = (titolo) => `<!doctype html><html><head><title>${titolo}</title></head><body><p>${titolo}</p></body></html>`;

test('r1 «tienimi sempre aperta questa scheda» davanti a una scheda su localhost salva la regola',async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const locale = testServer.html(pagina('Locale')).replace('127.0.0.1', 'localhost');
  await openTab(locale);
  await expect.poll(async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.url)))
    .some((u) => u.startsWith('http://localhost:'))).toBe(true);

  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'TIENI_APERTA', arguments: JSON.stringify({}) }] },
    { text: 'Fatto.' },
  ]);
  const chat = await home(app);
  await chiedi(chat, 'tienimi sempre aperta questa scheda');
  await expect(chat.locator('.dash-bubble-filo')).toContainText('Fatto.', { timeout: 15_000 });
  await ripristina(app);

  expect(Object.keys(await app.evaluate(() => globalThis.SN_FILO_MEMORY.listKeepOpen()))).toEqual(['localhost']);
});
