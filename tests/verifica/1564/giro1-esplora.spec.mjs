// Verifica #1564 giro 1: i cammini della chat con gli strumenti generali, messi alla prova. Modello finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const tema = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => s.theme));

test('due strumenti diversi nello stesso giro: il timer parte e il tema cambia', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'light' }));
  await modelloFinto(app, [
    { text: 'Fatto.', toolCalls: [
      { id: 't1', name: 'promemoria', arguments: JSON.stringify({ azione: 'timer', secondi: 300, etichetta: 'pasta' }) },
      { id: 'p1', name: 'impostazioni', arguments: JSON.stringify({ azione: 'imposta', chiave: 'tema', valore: 'scuro' }) },
    ] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'timer di 5 minuti per la pasta e tema scuro');
  await expect.poll(() => tema(app), { timeout: 10_000 }).toBe('dark');
  await expect.poll(async () => (await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).length, { timeout: 10_000 }).toBe(1);
  await page.screenshot({ path: 'tests/.shots/verifica-1564-due-strumenti.png' });
  await ripristina(app);
});

test('nome dello strumento e azione con maiuscole e spazi arrivano lo stesso', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'light' }));
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'Impostazioni', arguments: JSON.stringify({ azione: ' Imposta ', chiave: 'tema', valore: 'scuro' }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'tema scuro');
  await expect.poll(() => tema(app), { timeout: 10_000 }).toBe('dark');
  await ripristina(app);
});

test('un\'azione di un altro strumento non parte e torna al modello con l\'elenco giusto', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'light' }));
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'scheda', arguments: JSON.stringify({ azione: 'imposta', chiave: 'tema', valore: 'scuro' }) }] },
    { text: 'Riprovo.' },
  ]);
  await chiedi(page, 'tema scuro');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(2);
  const c = await chiamateAlModello(app);
  expect(JSON.stringify(c[1])).toMatch(/l'azione «imposta» non c'è in scheda/);
  expect(await tema(app)).toBe('light');
  await ripristina(app);
});

test('la riga d\'attesa dice cosa sta facendo Filo mentre la segnalazione aspetta la conferma', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'filo_su_di_se', arguments: JSON.stringify({ azione: 'feedback', testo: 'Il timer non suona.', titolo: 'Timer muto' }) }] },
    { text: 'Ho preparato la segnalazione.' },
  ]);
  await chiedi(page, 'segnala che il timer non suona');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/verifica-1564-attesa-segnalazione.png' });
  const testo = await page.locator('body').innerText();
  expect(testo).not.toContain('Verifico cosa so fare');
  await clickConfirm(page, 'cancel');
  await ripristina(app);
});
