// #837 giro 1, rilievo 1 — la velocità delle animazioni e l'intensità delle ombre si scrivono come le scrive un
// italiano («1,5», «0,1») e arrivano anche come numero dalla chat: in ogni caso il valore si applica.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const fattore = (page) => page.evaluate(() => window.SN_THEME_TOKENS.motionFactor(document));
const ombra = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sn-shadow-opacity').trim());

test('r1 Preferenze: «1,5» nella velocità delle animazioni e «0,1» nelle ombre si applicano', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  const riga = (n) => page.locator(`.sn-token-row[data-token="${n}"]`);
  const motion = riga('motion').locator('input').first();
  await motion.fill('1,5');
  await motion.blur();
  await expect(riga('motion').locator('.sn-token-error')).toBeHidden();
  await expect.poll(() => fattore(page)).toBe(1.5);
  const sh = riga('shadow').locator('input').first();
  await sh.fill('0,1');
  await sh.blur();
  await expect(riga('shadow').locator('.sn-token-error')).toBeHidden();
  await expect.poll(() => ombra(page).then(Number)).toBe(0.1);
});

test('r1 chat: «togli le animazioni» con il valore passato come numero dal modello le toglie', async ({ app }) => {
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"motion","valore":0}' }] },
    { text: 'Fatto, animazioni tolte.' },
  ]);
  await chiedi(page, 'togli le animazioni');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'animazioni tolte' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => fattore(page)).toBe(0);
  await ripristina(app);
});
