// #837 giro 1 — esplorazione: menu del tasto destro nei siti, chat «togli le animazioni» col riquadro, Preferenze.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
mkdirSync(SHOTS, { recursive: true });
const setTokens = (shell, tokens) =>
  shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: t } }), tokens);
const tokensSalvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).themeTokens || {});

const durate = (page, radice) => page.evaluate((sel) => {
  const ms = (s) => String(s || '').split(',').map((x) => { x = x.trim(); return x.endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000; });
  const out = [];
  const giro = (root) => {
    for (const el of root.querySelectorAll('*')) {
      for (const ps of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, ps);
        const t = Math.max(...ms(cs.transitionDuration));
        const a = cs.animationName !== 'none' ? Math.max(...ms(cs.animationDuration)) : 0;
        if (t > 0 || a > 0) out.push(`${el.tagName.toLowerCase()}.${String(el.className || '').replace(/\s+/g, '.')}${ps || ''} t=${cs.transitionDuration} a=${cs.animationName}:${cs.animationDuration}`);
      }
      if (el.shadowRoot) giro(el.shadowRoot);
    }
  };
  giro(document);
  return out;
}, radice);

const SITO = `<!doctype html><html><body style="padding:40px"><p id="frase">Una frase qualunque da cliccare col destro.</p></body></html>`;

test('menu del tasto destro in un sito: a 0 nessuna durata, a 2 il doppio di 1', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, SITO);
  const apri = async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    await page.locator('#frase').click({ button: 'right' });
    await expect(page.locator('.sn-menu').first()).toBeVisible();
    await page.waitForTimeout(100);
  };
  await apri();
  const a1 = await durate(page);
  await setTokens(shell, { motion: '2' });
  await page.waitForTimeout(500);
  await apri();
  const a2 = await durate(page);
  await setTokens(shell, { motion: '0' });
  await page.waitForTimeout(500);
  await apri();
  const a0 = await durate(page);
  await page.screenshot({ path: join(SHOTS, 'v837-menu-sito-0.png') });
  console.log(JSON.stringify({ a1, a2, a0 }, null, 1));
  expect(a0).toEqual([]);
  expect(a1.length).toBeGreaterThan(0);
});

test('chat: «togli le animazioni» applica 0, il riquadro ha il cursore; «rimettile» torna al predefinito', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"motion","valore":"0"}' }] },
    { text: 'Fatto, animazioni tolte.' },
    { toolCalls: [{ id: 't2', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"motion","valore":"predefinito"}' }] },
    { text: 'Rimesse.' },
  ]);
  await chiedi(page, 'togli le animazioni');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'animazioni tolte' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => tokensSalvati(app).then((t) => t.motion)).toBe('0');
  // La shell: le schede non hanno più durate.
  const shellDurate = await durate(shell);
  console.log('shell', JSON.stringify(shellDurate));
  const trig = page.locator('.sn-refine-trigger').last();
  await expect(trig).toBeVisible();
  await trig.click();
  await expect(page.locator('.sn-refine-panel')).toBeVisible();
  await expect(page.locator('.sn-refine-panel input[type=range]')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, 'v837-riquadro-motion.png') });
  await page.keyboard.press('Escape');
  await chiedi(page, 'rimetti le animazioni');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rimesse' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => tokensSalvati(app).then((t) => t.motion)).toBeUndefined();
  await ripristina(app);
  expect(shellDurate).toEqual([]);
});

for (const tema of ['light', 'dark']) {
  test(`Preferenze ${tema}: righe nuove, errore puntuale sul valore non valido`, async ({ app, openTab }) => {
    await app.evaluate(async (_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    const page = await openTab('filo://preferences/preferences.html');
    const riga = (n) => page.locator(`.sn-token-row[data-token="${n}"]`);
    await expect(riga('motion')).toHaveCount(1);
    await expect(riga('shadow')).toHaveCount(1);
    await expect(riga('link.font')).toHaveCount(1);
    const motion = riga('motion').locator('input, select, textarea').first();
    console.log('motion', await motion.inputValue(), 'shadow', await riga('shadow').locator('input').first().inputValue(),
      'link.font', await riga('link.font').locator('input, select').first().inputValue());
    await motion.fill('abc');
    await motion.blur();
    await expect(riga('motion').locator('.sn-token-error')).toBeVisible();
    console.log('errore', await riga('motion').locator('.sn-token-error').textContent());
    await riga('motion').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `v837-pref-${tema}.png`) });
    await motion.fill('1,5');
    await motion.blur();
    console.log('1,5 →', await riga('motion').locator('.sn-token-error').textContent().catch(() => ''), JSON.stringify(await tokensSalvati(app)));
  });
}
