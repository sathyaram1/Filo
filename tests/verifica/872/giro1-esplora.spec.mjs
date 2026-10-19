// Verifica #872 giro 1: esplorazione del quaderno delle memorie (aspetto, gare col compattatore, righe uguali).

import { test, expect } from '../../fixtures/electron.mjs';

const QUADERNO = 'filo://quaderno/quaderno.html';

async function configura(app, uscita = 'PREFERENZE:\nÈ vegetariano (fonti: L1)') {
  await app.evaluate(async (_e, u) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash', [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__q_prompt = [];
    globalThis.__q_compattatore = u;
    globalThis.__q_attesa = null;
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      if (joined.includes('analizzare l\'ultima interazione')) {
        return { ...base, text: /UTENTE: [^\n]*vegetarian/i.test(joined) ? 'LEZIONE: L’utente è vegetariano.' : 'NULLA DA IMPARARE' };
      }
      if (joined.includes('integrare le nuove lezioni')) {
        if (globalThis.__q_attesa) await globalThis.__q_attesa;
        return { ...base, text: globalThis.__q_compattatore };
      }
      if (joined.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Cibo' }) };
      globalThis.__q_prompt.push(joined);
      return { ...base, text: 'Ne terrò conto.' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, uscita);
}

const turno = (app, chatId, userMessage) => app.evaluate(
  (_e, a) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: a.userMessage, threadHistory: [], chatId: a.chatId }),
  { chatId, userMessage },
);
const memoria = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
const lezioni = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer());
const esatto = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const riga = (page, testo) => page.locator('.qd-riga').filter({ has: page.locator('.qd-testo', { hasText: esatto(testo) }) });

test('aspetto chiaro e scuro', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'Ti dico una cosa: sono vegetariano');
  await expect.poll(async () => (await lezioni(app)).length, { timeout: 10_000 }).toBe(1);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Si chiama Marta\nVive a Lisbona e lavora come architetta in uno studio piccolo che si occupa soprattutto di ristrutturazioni di case vecchie del centro storico, con una passione per le piastrelle',
      PREFERENZE: 'Preferisce risposte brevi',
      CUCINA: 'Cucina spesso il curry',
    });
  });
  const page = await openTab(QUADERNO);
  await expect(page.locator('.qd-riga').first()).toBeVisible({ timeout: 8_000 });
  await riga(page, 'Preferisce risposte brevi').hover();
  await riga(page, 'Preferisce risposte brevi').locator('.qd-tasto[title="Togli dalla memoria"]').click();
  await expect(page.locator('.qd-gruppo[data-gruppo="nascoste"]')).toHaveCount(1, { timeout: 5_000 });
  await page.locator('.qd-nascoste').evaluate((d) => { d.open = true; });
  await riga(page, 'Si chiama Marta').hover();
  await page.screenshot({ path: 'tests/.shots/v872-chiaro.png' });
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await page.waitForTimeout(800);
  await riga(page, 'Si chiama Marta').hover();
  await page.screenshot({ path: 'tests/.shots/v872-scuro.png' });
  await page.setViewportSize?.({ width: 420, height: 800 }).catch?.(() => {});
});

test('correzione durante il compattatore', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'sono vegetariano');
  await expect.poll(async () => (await lezioni(app)).length, { timeout: 10_000 }).toBe(1);
  const page = await openTab(QUADERNO);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_compact_memory' }));
  await expect(riga(page, 'È vegetariano')).toHaveCount(1, { timeout: 8_000 });
  // Una nuova lezione e un compattatore lento, che riscrive la memoria com'era quando ha cominciato.
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.appendLesson('Ama le spezie', { fonti: ['altro'] });
    globalThis.__q_compattatore = 'PREFERENZE:\nÈ vegetariano (fonti: R1)\nAma le spezie (fonti: L1)';
    globalThis.__q_attesa = new Promise((r) => { globalThis.__q_via = r; });
    globalThis.__q_fatto = globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_COMPACT_MEMORY }, { url: 'filo://quaderno/quaderno.html' });
  });
  await page.waitForTimeout(500);
  const nota = riga(page, 'È vegetariano');
  await nota.locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('È vegano');
  await page.locator('.qd-campo').press('Enter');
  await expect(riga(page, 'È vegano')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator('#esito')).toContainText('Corretta');
  await app.evaluate(async () => { globalThis.__q_via(); await globalThis.__q_fatto; });
  const pref = (await memoria(app)).PREFERENZE;
  console.log('PREFERENZE dopo:', JSON.stringify(pref));
  await page.waitForTimeout(800);
  console.log('righe nel quaderno:', await page.locator('.qd-testo').allTextContents());
  expect(pref).toContain('È vegano');
});

test('correggo una riga nel testo di un\'altra', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: '', PREFERENZE: 'Ama il tè\nAma il caffè' });
  });
  const page = await openTab(QUADERNO);
  await expect(page.locator('.qd-riga')).toHaveCount(2, { timeout: 8_000 });
  await riga(page, 'Ama il caffè').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('Ama il tè');
  await page.locator('.qd-campo').press('Enter');
  await page.waitForTimeout(1000);
  console.log('memoria:', JSON.stringify((await memoria(app)).PREFERENZE));
  console.log('righe:', await page.locator('.qd-testo').allTextContents(), 'conto:', await page.locator('.qd-conto').allTextContents());
  await expect(page.locator('.qd-riga')).toHaveCount(2);
});
