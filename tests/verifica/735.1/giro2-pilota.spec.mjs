// Verifica #735.1 giro 2: Filo aperto dal pilota condiviso (cattura composita, spec della suite) deve avere
// il servizio delle schede chiuso come ogni altra prova.

import { test, expect } from '@playwright/test';
import { launchFilo, closeFilo } from '../../agent/driver.mjs';

const SCHEDE = 'https://firestore.googleapis.com/v1/projects/filo-prova/databases/(default)/documents:runQuery';

test('Filo aperto dal pilota non raggiunge le schede', async () => {
  const { app, shell } = await launchFilo();
  try {
    await shell.waitForFunction(() => document.readyState === 'complete');
    const esito = await app.evaluate(async ({ session }, url) => {
      try { const r = await session.defaultSession.fetch(url, { method: 'POST', body: '{}' }); return `raggiunto: ${r.status}`; } catch (e) { return String(e && e.message); }
    }, SCHEDE);
    expect(esito).toContain('ERR_BLOCKED_BY_CLIENT');
  } finally {
    await closeFilo(app);
  }
});
