// VERIFICA INDIPENDENTE (2° giro) — da cancellare a fine verifica.
import { test, expect } from './fixtures/electron.mjs';

test('Opzioni: un solo fornitore, nessuna chiave Google', async ({ openTab }) => {
  test.setTimeout(180000);
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(3000);
  const d = await opt.evaluate(() => ({
    keys: [...document.querySelectorAll('input[type=password]')].map((e) => e.id + '|' + e.placeholder),
    providers: [...new Set([...document.querySelectorAll('select.sn-model-provider')]
      .flatMap((s) => [...s.options].map((o) => o.value)))],
  }));
  console.log('CHIAVI:', JSON.stringify(d.keys), 'FORNITORI:', JSON.stringify(d.providers));
  expect(d.providers).toEqual(['openrouter']);
  expect(d.keys.join(' ').toLowerCase()).not.toMatch(/gemini|google|aiza/);
});

test('senza modello impostato: la lettura lo dice', async ({ openTab }) => {
  test.setTimeout(180000);
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(2500);
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(800);
  for (let i = 0; i < 40; i++) {
    const btn = opt.locator('#modelRegistryList .sn-model-row button', { hasText: 'Rimuovi' }).first();
    if (!(await btn.count())) break;
    await btn.click();
    await opt.waitForTimeout(200);
  }
  await opt.waitForTimeout(2500);
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForTimeout(2500);
  await pref.locator('#ttsModelPreview').click();
  await pref.waitForTimeout(8000);
  const status = (await pref.locator('#ttsModelPreviewStatus').textContent() || '').trim();
  console.log('MESSAGGIO:', JSON.stringify(status));
  expect(status.toLowerCase()).toContain('modell');
});
