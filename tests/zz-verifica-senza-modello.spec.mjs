// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
// Nessun modello impostato → ogni funzione si ferma e lo DICE.
import { test, expect } from './fixtures/electron.mjs';

async function svuotaModelli(openTab) {
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(2500);
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(800);
  // rimuove ogni riga del registro
  for (let i = 0; i < 40; i++) {
    const btn = opt.locator('#modelRegistryList .sn-model-row button', { hasText: 'Rimuovi' }).first();
    if (!(await btn.count())) break;
    await btn.click();
    await opt.waitForTimeout(200);
  }
  await opt.waitForTimeout(2500);
  const rimaste = await opt.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').count();
  console.log('RIGHE RIMASTE NEL REGISTRO:', rimaste);
  expect(rimaste).toBe(0);
  return opt;
}

test('senza modello impostato: la lettura ad alta voce lo dice', async ({ openTab }) => {
  test.setTimeout(180000);
  await svuotaModelli(openTab);
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForTimeout(2500);
  const res = await pref.evaluate(async () => chrome.runtime.sendMessage({
    type: 'tts_synth', text: 'prova', lang: 'it', voice: '',
  }));
  console.log('TTS SENZA MODELLO:', JSON.stringify(res));
  expect(res.ok).toBe(false);
  expect(String(res.error)).toMatch(/[Nn]essun modello/);

  await pref.locator('#ttsModelPreview').click();
  await pref.waitForTimeout(6000);
  const status = (await pref.locator('#ttsModelPreviewStatus').textContent() || '').trim();
  console.log('MESSAGGIO ALL UTENTE (Preferenze):', JSON.stringify(status));
  expect(status).toMatch(/[Nn]essun modello/);
});

test('senza modello impostato: la spiegazione lo dice', async ({ openTab, testServer }) => {
  test.setTimeout(180000);
  await svuotaModelli(openTab);
  const page = await testServer.openReady(openTab,
    '<html lang="it"><body><p id="t">La fotosintesi clorofilliana trasforma la luce in zuccheri.</p></body></html>');
  const res = await page.evaluate(async () => {
    const C = window.SN_CONST || {};
    try {
      return await chrome.runtime.sendMessage({
        type: 'ai_request', action: (C.ACTIONS && C.ACTIONS.EXPLAIN) || 'explain',
        payload: { text: 'fotosintesi' },
      });
    } catch (e) { return { thrown: String(e && e.message) }; }
  });
  console.log('EXPLAIN SENZA MODELLO:', JSON.stringify(res).slice(0, 600));
  expect(JSON.stringify(res)).toMatch(/[Nn]essun modello/);
});

test('senza modello impostato: la dettatura lo dice', async ({ openTab, testServer }) => {
  test.setTimeout(180000);
  await svuotaModelli(openTab);
  const page = await testServer.openReady(openTab,
    '<html lang="it"><body><textarea id="campo"></textarea></body></html>');
  const res = await page.evaluate(async () => {
    const C = window.SN_CONST || {};
    return await chrome.runtime.sendMessage({
      type: 'ai_request', action: (C.ACTIONS && C.ACTIONS.TRANSCRIBE_AUDIO) || 'transcribe_audio',
      payload: { audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=', format: 'wav', lang: 'it' },
    });
  });
  console.log('DETTATURA SENZA MODELLO:', JSON.stringify(res).slice(0, 600));
  expect(JSON.stringify(res)).toMatch(/[Nn]essun modello/);
});

test('senza modello impostato: la ricerca fra le schede archiviate lo dice', async ({ openTab }) => {
  test.setTimeout(180000);
  await svuotaModelli(openTab);
  const arc = await openTab('filo://archive/archive.html');
  await arc.waitForTimeout(2000);
  await arc.locator('#search').fill('qualcosa');
  await arc.locator('#search').press('Enter');
  await arc.waitForTimeout(6000);
  const nota = (await arc.locator('#searchNote').textContent() || '').trim();
  console.log('ARCHIVIO SENZA MODELLO:', JSON.stringify(nota));
});
