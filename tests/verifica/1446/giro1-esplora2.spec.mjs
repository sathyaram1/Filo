// Verifica #1446 giro 1: esplorazione di Preferenze → Correttore e della chat.
import { test, expect } from '../../fixtures/electron.mjs';

test('preferenze correttore', async ({ app, openTab }) => {
  const p = await openTab('filo://preferences/preferences.html');
  await expect(p.locator('#sec-correttore')).toBeVisible({ timeout: 8000 });
  await p.locator('#sec-correttore').scrollIntoViewIfNeeded();
  await p.locator('#sec-correttore').screenshot({ path: 'tests/.shots/v1446-pref.png' });
  await p.locator('#correttoreModello').click();
  await p.locator('#correttorePausaRapido').fill('900');
  await p.locator('#correttorePausaRapido').blur();
  await p.waitForTimeout(1000);
  const s = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).correttore);
  console.log('dopo', JSON.stringify(s));
  await p.locator('#correttorePausaRapido').fill('50');
  await p.locator('#correttorePausaRapido').blur();
  await p.waitForTimeout(1000);
  console.log('dopo 50', JSON.stringify(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).correttore)), await p.locator('#correttorePausaRapido').inputValue());
  for (const [chiave, valore] of [['errori', 'off'], ['suggerimenti', 'off'], ['controllo rapido', 'off'], ['pausa errori', 'mezzo secondo'], ['pausa errori', '2 secondi']]) {
    const r = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'IMPOSTA_PREFERENZA', chiave, valore });
    console.log(chiave, valore, JSON.stringify(r).slice(0, 200));
  }
  console.log('fine', JSON.stringify(await app.evaluate(async () => { const s = await globalThis.SN_STORAGE.getSettings(); return { f: s.featureFlags, c: s.correttore }; })));
  const o = await openTab('filo://options/options.html');
  await o.waitForTimeout(1500);
  const testo = await o.locator('body').innerText();
  console.log('options correttore', testo.split('\n').filter((r) => /orrettore/.test(r)).join(' | '));
});
