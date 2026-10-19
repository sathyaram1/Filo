// Prova temporanea: cancellare le pagine di oggi dalla Sicurezza toglie anche le schede chiuse di oggi?

import { test, expect } from '../../fixtures/electron.mjs';

test('pagine di oggi cancellate: la scheda chiusa di oggi resta?', async ({ app, shell, testServer }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const url = testServer.html('<title>Orche</title><p>x</p>');
  const ts = new Date(Date.now() - 10 * 60e3).toISOString();
  await app.evaluate(async (_e, a) => {
    await globalThis.SN_ARCHIVED_TABS.importa([{ id: 'arch-x', url: a.url, title: 'Orche oggi', openedAt: a.ts, closedAt: a.ts, summary: 'orche', snippet: '' }]);
  }, { url, ts });
  await app.evaluate(() => globalThis.SN_SCHEDE_NEL_FILO());
  const prima = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length);
  const testo = await app.evaluate(() => globalThis.SN_I18N ? globalThis.SN_I18N.t('security_visite_confirm_text') : '');
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_PAGINE_CANCELLA, periodo: 'oggi' }, { url: 'filo://security/security.html' }));
  const dopo = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length);
  console.log('ESITO', JSON.stringify({ prima, dopo, r, testo }));
});
