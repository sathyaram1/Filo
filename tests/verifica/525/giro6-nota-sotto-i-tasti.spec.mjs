// #525 — giro 6. La riga di avviso in cima alla Cronologia (#searchNote) è il
// posto in cui questo lavoro spiega perché «Svuota archivio» non tocca le chat.
// È una frase scritta per essere letta: qui si misura se si legge davvero, o se
// la fila dei bottoni le sta sopra.

import { test, expect } from '../../fixtures/electron.mjs';

const ARCHIVE = 'filo://archive/archive.html';

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function stubProvider(app) {
  await app.evaluate(async () => {
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) {
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'La coscienza' }) };
      }
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  });
}

test('la spiegazione di «Svuota archivio» non finisce sotto i bottoni', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app);

  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({
    userMessage: 'Parliamo della coscienza', threadHistory: [], chatId: 'c-cosc',
  }));
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-cosc'));
  await expect.poll(
    async () => (await app.evaluate(() => globalThis.SN_FILO_CHATS.list())).filter((c) => c.kind).length,
    { timeout: 30_000 },
  ).toBe(1);

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });

  // Nessuna scheda chiusa e una chat in elenco: è il caso in cui il tasto
  // spiega, invece di restare muto.
  await page.locator('#clear').click();
  await expect(page.locator('#searchNote')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);

  const misura = await page.evaluate(() => {
    const nota = document.getElementById('searchNote');
    const n = nota.getBoundingClientRect();
    const sopra = [...document.querySelectorAll('.arc-toolbar button, button')]
      .map((b) => ({ testo: b.textContent.trim().slice(0, 24), r: b.getBoundingClientRect() }))
      .filter((b) => b.r.width && b.r.height)
      .filter((b) => b.r.bottom > n.top + 1 && b.r.top < n.bottom - 1
        && b.r.right > n.left + 1 && b.r.left < n.right - 1);
    // Chi sta davvero davanti al primo carattere della nota?
    const davanti = document.elementFromPoint(n.left + 6, n.top + n.height / 2);
    return {
      testo: nota.textContent.trim(),
      nota: { top: Math.round(n.top), bottom: Math.round(n.bottom) },
      coperta: sopra.map((b) => b.testo),
      davanti: davanti ? `${davanti.tagName}.${davanti.className}`.slice(0, 60) : '',
    };
  });
  console.log('LA NOTA IN CIMA:', JSON.stringify(misura, null, 1));

  await page.screenshot({ path: 'tests/.shots/525-giro6-nota-svuota.png', fullPage: true });

  expect(misura.coperta, `bottoni sopra la nota: ${misura.coperta.join(', ')}`).toEqual([]);
});
