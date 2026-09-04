// VERIFICA INDIPENDENTE (2° giro) — da cancellare a fine verifica.
// Il limite mensile di spesa deve fermare voce e indicizzazione come la dettatura.
import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';

const KEY = (readFileSync('C:/Users/agenti AI/Desktop/Filo/agent-bench/.env', 'utf8')
  .match(/OPENROUTER_KEY=(\S+)/) || [])[1];

test('oltre il limite: voce, dettatura e indicizzazione si fermano tutte', async ({ openTab, testServer, shell }) => {
  test.setTimeout(400000);

  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(2500);
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(500);
  await opt.locator('#apiKey').fill(KEY);
  await opt.locator('#apiKey').blur();
  await opt.waitForTimeout(2500);

  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForTimeout(2000);

  // Controllo positivo: sotto il limite la voce esce.
  const prima = await pref.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: 'tts_synth', text: 'Prova della spesa.', lang: 'it', voice: 'if_sara' });
    return { ok: r && r.ok, error: r && r.error };
  });
  console.log('VOCE SOTTO IL LIMITE:', JSON.stringify(prima).slice(0, 200));
  expect(prima.ok).toBe(true);

  // Accumulo spesa con una richiesta di testo (il costo si registra subito).
  const page = await testServer.openReady(openTab,
    '<html lang="it"><body style="padding:40px"><p id="t">La fotosintesi clorofilliana trasforma la luce del sole in zuccheri.</p></body></html>');
  await page.locator('#t').click({ clickCount: 3 });
  await page.waitForTimeout(600);
  await page.locator('#t').click({ button: 'right' });
  await page.waitForTimeout(1200);
  const spiega = page.locator('text=Spiegazione').first();
  if (await spiega.count()) { await spiega.click(); await page.waitForTimeout(15000); }

  await opt.reload();
  await opt.waitForTimeout(3000);
  const speso = (await opt.locator('#spentBox').textContent() || '').trim();
  console.log('SPESO QUESTO MESE:', JSON.stringify(speso));

  // Limite minuscolo → oltre il limite.
  await opt.locator('#monthlyLimit').fill('0.000001');
  await opt.locator('#monthlyLimit').dispatchEvent('change');
  await opt.locator('#monthlyLimit').blur();
  await opt.waitForTimeout(3000);
  await opt.reload();
  await opt.waitForTimeout(2500);
  console.log('LIMITE SALVATO:', await opt.locator('#monthlyLimit').inputValue());

  const dopoVoce = await pref.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: 'tts_synth', text: 'Testo mai letto prima, oltre il limite.', lang: 'it', voice: 'if_sara' });
    return { ok: r && r.ok, error: r && r.error, code: r && r.errorCode };
  });
  console.log('VOCE OLTRE IL LIMITE:', JSON.stringify(dopoVoce).slice(0, 300));

  const dopoDettatura = await pref.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: 'ai_request', action: 'transcribe_audio',
      payload: { audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=', format: 'wav', lang: 'it' },
    }));
  console.log('DETTATURA OLTRE IL LIMITE:', JSON.stringify(dopoDettatura).slice(0, 300));

  const arc = await openTab('filo://archive/archive.html');
  await arc.waitForTimeout(2000);
  await arc.locator('#search').fill('qualcosa di nuovo');
  await arc.locator('#search').press('Enter');
  await arc.waitForTimeout(8000);
  const nota = (await arc.locator('#searchNote').textContent() || '').trim();
  console.log('ARCHIVIO OLTRE IL LIMITE:', JSON.stringify(nota));

  expect(dopoVoce.ok, 'la voce si ferma oltre il limite').toBe(false);
  expect(String(dopoVoce.error || '').toLowerCase()).toMatch(/limite|spesa/);
  expect(JSON.stringify(dopoDettatura).toLowerCase(), 'la dettatura si ferma').toMatch(/limite|spesa/);
  expect(nota.toLowerCase(), "l'indicizzazione non gira").toContain('non disponibile');
});
