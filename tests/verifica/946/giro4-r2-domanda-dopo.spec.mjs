// #946 giro 4: nella chat della Home la domanda «è fatta con l'AI?» fatta al messaggio dopo
// quello con l'immagine deve trovare lo stesso esito del tasto destro.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'provenienza', 'c2pa-ufficiale-ai.jpg'));

test('immagine allegata al primo messaggio, domanda sull’origine al secondo', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__turni = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__turni.push(JSON.stringify(messages));
      return { text: JSON.stringify({ text: 'Un quadrato.', status: 'done' }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeVisible({ timeout: 10000 });
  await home.evaluate((dati) => {
    const bin = atob(dati);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([arr], 'generata.jpg', { type: 'image/jpeg' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, FILE.toString('base64'));
  await expect(home.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5000 });
  await home.locator('#input').fill('cosa c’è in questa immagine?');
  await home.locator('#sendBtn').click();
  const turno = (_e, d) => globalThis.__turni.find((t) => t.includes(d) && !t.includes('TESTO_IN_PAGINA')) || '';
  await expect.poll(() => app.evaluate(turno, 'cosa c’è in questa'), { timeout: 20000 }).not.toBe('');
  expect(await app.evaluate(turno, 'cosa c’è in questa')).toContain('Generata con l’AI');

  await expect(home.locator('#input')).toBeEditable({ timeout: 10000 });
  await home.locator('#input').fill('ed è fatta con l’AI?');
  await home.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(turno, 'ed è fatta con'), { timeout: 20000 }).not.toBe('');
  expect(await app.evaluate(turno, 'ed è fatta con')).toContain('Generata con l’AI');
});
