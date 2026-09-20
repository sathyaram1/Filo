// #567.2 — con la modalità terminale spenta l'utente deve leggere PERCHÉ il
// comando non è partito, e trovare da lì l'interruttore. Chi non sa che quel
// interruttore esiste, con una riga «Azione non riuscita» non ha modo di capire.
//
// Le porte contate qui: comando di sola lettura (parte subito), comando che
// chiederebbe conferma (non deve nemmeno aprire il popup), comando vuoto,
// comando lunghissimo, comando con caratteri speciali.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

test('il comando che non parte spiega che il terminale è spento e porta all\'interruttore', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls -la"}' }] },
    { text: 'Ecco.' },
  ], '__v567e');

  await chiedi(page, 'elenca i file');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco.' })).toBeVisible({ timeout: 10_000 });

  // Il riquadro si legge SENZA aprire il diario: il blocco nasce chiuso.
  const box = page.locator('.dash-cmd-blocked');
  await expect(box).toBeVisible();
  const spiegazione = await box.textContent();
  expect(spiegazione).toContain('modalità terminale');
  expect(spiegazione).toContain('ls -la');

  // E porta dov'è l'interruttore.
  const apri = box.locator('button', { hasText: 'Apri Preferenze' });
  await expect(apri).toBeVisible();
  await apri.click();
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const t = w && w._filoTabs;
      return (t ? t.tabs : []).map((x) => String(x.url || '')).join(' ');
    }),
    { timeout: 10_000 },
  ).toContain('filo://preferences/preferences.html');

  // E il diario lo racconta con la ragione, non con un generico «non riuscita».
  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'terminale è spenta' });
  await expect(riga).toHaveCount(1);

  await page.screenshot({ path: 'tests/.shots/567-terminale-spento.png' });
  await restore(app, '__v567e');
});

test('anche un comando che chiederebbe conferma dice perché non è partito, senza popup', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'c2', name: 'ESEGUI_COMANDO', arguments: '{"comando":"rm -rf /tmp/qualcosa"}' }] },
    { text: 'Fatto?' },
  ], '__v567f');

  await chiedi(page, 'cancella quella cartella');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto?' })).toBeVisible({ timeout: 10_000 });

  await expect(page.locator('.dash-cmd-blocked')).toBeVisible();
  expect(await page.locator('.dash-cmd-blocked').textContent()).toContain('modalità terminale');
  // Nessun popup di conferma per un comando che non può partire comunque.
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);

  await restore(app, '__v567f');
});

test('comando vuoto, lunghissimo o con caratteri speciali: si legge sempre una ragione', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  const lungo = 'echo '.concat('a'.repeat(10_000));
  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'c3', name: 'ESEGUI_COMANDO', arguments: '{"comando":"   "}' },
        { id: 'c4', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: lungo }) },
        { id: 'c5', name: 'ESEGUI_COMANDO', arguments: '{"comando":"echo <script>alert(1)</script> \\u0000 🙂"}' },
      ],
    },
    { text: 'Nulla da fare.' },
  ], '__v567g');

  await chiedi(page, 'prova tre comandi');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Nulla da fare.' })).toBeVisible({ timeout: 15_000 });

  // Tre esiti, tre spiegazioni: nessuno sparisce in silenzio.
  await expect(page.locator('.dash-cmd-blocked')).toHaveCount(3);
  // Niente HTML iniettato dal testo del modello.
  await expect(page.locator('.dash-cmd-blocked script')).toHaveCount(0);
  // Il comando lunghissimo non spinge la pagina di lato.
  const sborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(sborda).toBe(false);

  await restore(app, '__v567g');
});
