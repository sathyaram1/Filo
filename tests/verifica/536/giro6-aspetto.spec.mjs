// Verifica #536 — giro 6: sguardo al registro «Avvisi fermati» e alla colonna
// degli avvisi, nei due temi. Traccia visiva del giro.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('il registro e la colonna si leggono nei due temi', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.addGuardBlock({
      origine: 'una mail di Banca Esempio <avvisi@banca-esempio.it>',
      motivo: 'chiedeva di confermare le credenziali del conto entro 24 ore',
      regola: 'guardiano',
      testo: 'La tua banca chiede di confermare le credenziali entro 24 ore: '
        + '[banca-esempio.it](https://banca-esempio.it.attacco.ru/login)',
      fonte: 'controlla la posta',
    });
    await M.addGuardBlock({
      origine: 'una ricerca sul web',
      motivo: 'conteneva un codice che qualcuno chiedeva di comunicare',
      regola: 'codice-da-comunicare',
      testo: 'Il codice 483920 è nei dettagli della consegna.',
      fonte: 'qual è il codice della consegna?',
    });
    const TG = globalThis.SN_TEXT_GUARDIAN;
    await TG.proponiNotifica({
      testo: 'Il pacco arriva oggi: [traccia la consegna](https://corriere-esempio.it/track/9)',
      kind: 'info', fiducia: 'pulito', origine: 'una mail di Corriere <tracking@corriere-esempio.it>',
    });
  });

  for (const tema of ['dark', 'light']) {
    await app.evaluate(async (_e, t) => {
      await globalThis.SN_STORAGE.updateSettings({ theme: t });
    }, tema);
    await page.reload();
    const p = await newtabPage(app);
    await expect(p.locator('#input')).toBeVisible();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `tests/.shots/536-giro6-colonna-${tema}.png` });

    await shell.evaluate(() => window.filoShell.tabs.open('filo://preferences/preferences.html'));
    const deadline = Date.now() + 10_000;
    let pref = null;
    while (Date.now() < deadline) {
      pref = app.windows().find((w) => w.url().includes('preferences.html'));
      if (pref) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await pref.waitForLoadState('domcontentloaded');
    await pref.waitForTimeout(1500);
    await pref.evaluate(() => {
      const el = document.getElementById('guardBlocksList');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await pref.waitForTimeout(500);
    await pref.screenshot({ path: `tests/.shots/536-giro6-registro-${tema}.png` });
  }
});
