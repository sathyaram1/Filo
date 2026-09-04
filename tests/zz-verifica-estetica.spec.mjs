// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
import { test } from './fixtures/electron.mjs';

test('scatti di Opzioni e Preferenze', async ({ openTab }) => {
  test.setTimeout(180000);
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(3000);
  await opt.screenshot({ path: 'tests/.zz/opzioni-default.png', fullPage: true });
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(1500);
  await opt.screenshot({ path: 'tests/.zz/opzioni-modelli.png', fullPage: true });

  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForLoadState('load');
  await pref.waitForTimeout(3000);
  const sec = pref.locator('#ttsModelVoice');
  if (await sec.count()) await sec.scrollIntoViewIfNeeded();
  await pref.waitForTimeout(500);
  await pref.screenshot({ path: 'tests/.zz/preferenze-voce.png' });
  await pref.screenshot({ path: 'tests/.zz/preferenze-intera.png', fullPage: true });
});
