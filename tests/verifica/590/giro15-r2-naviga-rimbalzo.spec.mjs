// Giro 15, rilievo 2 (#590): quando la lista ferma il rimbalzo di un'apertura chiesta dal modello, la chat lo dice.
import { test, expect, lista, schede, modelloFinto } from './helpers/rete15.mjs';

async function home(app) {
  for (let i = 0; i < 60; i++) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('home non trovata');
}

test('chat della home: NAVIGA verso un accorciatore che porta sul sito della lista non si conta come aperta', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const page = await home(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  const corto = rete.rimbalzo('accorcia.test', '/x', rete.pagina('blocked.test', '/', '<h1>SITO</h1>'));
  const chiamate = await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: corto, etichetta: 'pagina' }) }] },
    { text: 'RISPOSTA-FINTA' },
  ]);
  await page.locator('#input').fill('apri quel link');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-FINTA' })).toBeVisible({ timeout: 10_000 });
  await shell.waitForTimeout(1500);
  expect((await schede(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);

  const riga = page.locator('.dash-activity-row', { hasText: 'Link non aperto' });
  await page.locator('.dash-activity-head').click({ timeout: 3000 }).catch(() => {});
  await expect(riga).toContainText('blocked.test', { timeout: 3000 });
  const secondo = JSON.stringify((await chiamate())[1] || []);
  expect(secondo).toContain('lista dei siti bloccati');
  expect(secondo).not.toContain('Eseguita: Aprire');
});

test('assistente sulla pagina: NAVIGA verso un accorciatore che porta sul sito della lista dice che è bloccato', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const corto = rete.rimbalzo('accorcia.test', '/y', rete.pagina('blocked.test', '/', '<h1>SITO</h1>'));
  const page = await home(app);
  await page.waitForFunction(() => !!window.SN_SIDEBAR && !!window.__filoSidebarTest, null, { timeout: 8000 });
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const esito = await page.evaluate((u) => window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: u }), corto);
  await shell.waitForTimeout(1500);
  expect(esito).toBe(false);
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('blocked.test è fra i siti bloccati');
});
