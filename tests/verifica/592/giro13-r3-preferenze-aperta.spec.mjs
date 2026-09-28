// Verifica #592 giro 13, rilievo 3: con le Preferenze aperte in una scheda, lo
// stile confermato in chat non compare lì, e un ritocco qualunque lo disfa.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { newtabPage, configuraModello, modelloFinto, ripristina, stileSalvato, chiamata, scrivi } from './giro13-comune.mjs';

test('Preferenze aperte: lo stile confermato in chat si vede e resta dopo un ritocco', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await newtabPage(app);
  await configuraModello(app, ['FILO_CHAT']);
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#agentStyleText', { timeout: 8_000 });
  await expect(prefs.locator('#agentStyleText')).toHaveValue('');

  const stile = 'Rispondi breve e dammi del tu.';
  await modelloFinto(app, [chiamata('IMPOSTA_PREFERENZA', { chiave: 'stile_agente', valore: stile }), { text: 'Ti chiedo conferma.' }]);
  await chat.bringToFront();
  await scrivi(chat, 'scrivimi breve e dammi del tu');
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(() => stileSalvato(app), { timeout: 5_000 }).toBe(stile);
  await ripristina(app);

  await prefs.bringToFront();
  await expect(prefs.locator('#agentStyleText'), 'la pagina aperta mostra ancora lo stile di prima').toHaveValue(stile, { timeout: 3_000 });
});

test('Preferenze aperte: un ritocco del tema non disfa lo stile confermato in chat', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await newtabPage(app);
  await configuraModello(app, ['FILO_CHAT']);
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#agentStyleText', { timeout: 8_000 });

  const stile = 'Rispondi breve e dammi del tu.';
  await modelloFinto(app, [chiamata('IMPOSTA_PREFERENZA', { chiave: 'stile_agente', valore: stile }), { text: 'Ti chiedo conferma.' }]);
  await chat.bringToFront();
  await scrivi(chat, 'scrivimi breve e dammi del tu');
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(() => stileSalvato(app), { timeout: 5_000 }).toBe(stile);
  await ripristina(app);

  await prefs.bringToFront();
  await prefs.selectOption('#theme', 'dark');
  await prefs.waitForTimeout(1_500);
  expect(await stileSalvato(app), 'toccare il tema ha rimesso lo stile di prima, senza dirlo').toBe(stile);
});
