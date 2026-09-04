// VERIFICA INDIPENDENTE (2° giro) — da cancellare a fine verifica.
import { test, expect } from './fixtures/electron.mjs';

test('Preferenze: ordine della sezione lettura ad alta voce', async ({ openTab }) => {
  test.setTimeout(180000);
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForLoadState('load');
  await pref.waitForTimeout(3000);

  const ordine = await pref.evaluate(() => {
    const ids = ['ttsModelVoice', 'ttsModelPreview', 'ttsRate', 'ttsPitch', 'ttsPreview', 'ttsVoice'];
    const pos = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      pos[id] = el ? el.getBoundingClientRect().top + window.scrollY : null;
    }
    return pos;
  });
  console.log('POSIZIONI:', JSON.stringify(ordine));
  expect(ordine.ttsRate, 'velocità sotto la voce naturale').toBeGreaterThan(ordine.ttsModelVoice);
  expect(ordine.ttsPitch, 'tono sotto la velocità').toBeGreaterThan(ordine.ttsRate);
  expect(ordine.ttsVoice, 'la voce di riserva viene dopo i cursori').toBeGreaterThan(ordine.ttsPitch);

  await pref.locator('#ttsModelVoice').scrollIntoViewIfNeeded();
  await pref.waitForTimeout(500);
  await pref.screenshot({ path: 'tests/.zz2/preferenze-voce.png' });
});
