import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';

const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

test('debug tavily', async ({ openTab }) => {
  const opzioni = await openTab('filo://options/options.html');
  await opzioni.waitForSelector('#apiKey', { state: 'attached', timeout: 25_000 });
  if (await opzioni.isChecked('#useDefaultModels')) {
    await opzioni.uncheck('#useDefaultModels');
    await opzioni.waitForTimeout(800);
  }
  await opzioni.waitForSelector('#apiKey', { timeout: 25_000 });
  await opzioni.click('#apiKey');
  await opzioni.type('#apiKey', 'sk-or-v1-VECCHIA-0001');
  await opzioni.locator('#apiKey').blur();
  await opzioni.waitForTimeout(1500);
  console.log('A openrouter =', (await impostazioni(opzioni)).apiKeys?.openrouter);

  await opzioni.click('#apiKeyTavily');
  await opzioni.type('#apiKeyTavily', 'tvly-NUOVA-0002');
  console.log('fuoco =', await opzioni.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
  console.log('B openrouter =', (await impostazioni(opzioni)).apiKeys?.openrouter);

  const res = await opzioni.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'chiave_openrouter', valore: 'sk-or-v1-NUOVA-0002' },
  }));
  console.log('esito conferma =', JSON.stringify(res));
  console.log('C openrouter =', (await impostazioni(opzioni)).apiKeys?.openrouter);
  await opzioni.waitForTimeout(1500);
  console.log('D openrouter =', (await impostazioni(opzioni)).apiKeys?.openrouter);
  await opzioni.locator('#apiKeyTavily').blur();
  await opzioni.waitForTimeout(2000);
  const k = (await impostazioni(opzioni)).apiKeys;
  console.log('E =', JSON.stringify(k));
});
