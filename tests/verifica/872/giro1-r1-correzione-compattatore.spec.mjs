// Verifica #872 giro 1, rilievo 1: una correzione fatta nel quaderno mentre il compattatore lavora non si perde.

import { test, expect } from '../../fixtures/electron.mjs';

const QUADERNO = 'filo://quaderno/quaderno.html';

async function configura(app) {
  await app.evaluate(async () => {
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
    globalThis.__q_compattatore = 'PREFERENZE:\nÈ vegetariano (fonti: L1)';
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
      return { ...base, text: 'Ne terrò conto.' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  });
}

const turno = (app, chatId, userMessage) => app.evaluate(
  (_e, a) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: a.userMessage, threadHistory: [], chatId: a.chatId }),
  { chatId, userMessage },
);
const memoria = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
const lezioni = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer());
const esatto = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const riga = (page, testo) => page.locator('.qd-riga').filter({ has: page.locator('.qd-testo', { hasText: esatto(testo) }) });

test('r1 una riga corretta nel quaderno mentre il compattatore scrive resta corretta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'sono vegetariano');
  await expect.poll(async () => (await lezioni(app)).length, { timeout: 10_000 }).toBe(1);
  const page = await openTab(QUADERNO);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_compact_memory' }));
  await expect(riga(page, 'È vegetariano')).toHaveCount(1, { timeout: 8_000 });

  // Arriva un'altra lezione e il compattatore parte (il modello ci mette qualche secondo).
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.appendLesson('Ama le spezie', { fonti: ['altro'] });
    globalThis.__q_compattatore = 'PREFERENZE:\nÈ vegetariano (fonti: R1)\nAma le spezie (fonti: L1)';
    globalThis.__q_attesa = new Promise((r) => { globalThis.__q_via = r; });
    globalThis.__q_fatto = globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_COMPACT_MEMORY }, { url: 'filo://quaderno/quaderno.html' });
  });
  await page.waitForTimeout(300);
  await riga(page, 'È vegetariano').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('È vegano');
  await page.locator('.qd-campo').press('Enter');
  await expect(page.locator('#esito')).toContainText('Corretta');
  await app.evaluate(async () => { globalThis.__q_via(); await globalThis.__q_fatto; });

  // Quello che Filo ha confermato all'utente resta: la correzione vale, la riga vecchia non torna.
  await expect.poll(async () => (await memoria(app)).PREFERENZE.split('\n'), { timeout: 5_000 }).toContain('È vegano');
  expect((await memoria(app)).PREFERENZE).not.toContain('vegetariano');
  await expect(riga(page, 'È vegano')).toHaveCount(1, { timeout: 5_000 });
  await expect(riga(page, 'È vegetariano')).toHaveCount(0);
});

test('r1 una lezione che sto correggendo non sparisce col compattatore che la riordina', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await turno(app, 'chat-cibo', 'sono vegetariano');
  await expect.poll(async () => (await lezioni(app)).length, { timeout: 10_000 }).toBe(1);
  const page = await openTab(QUADERNO);
  const lez = riga(page, 'L’utente è vegetariano.');
  await expect(lez).toHaveCount(1, { timeout: 8_000 });
  await lez.locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('L’utente è vegano.');
  // Il compattatore riordina mentre il campo è aperto; poi l'utente conferma.
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_COMPACT_MEMORY }, { url: 'filo://quaderno/quaderno.html' }));
  await page.waitForTimeout(800);
  if (await page.locator('.qd-campo').count()) await page.locator('.qd-campo').press('Enter');
  await page.waitForTimeout(800);
  const tutto = JSON.stringify({ m: await memoria(app), l: (await lezioni(app)).map((l) => l.text) });
  expect(tutto).toContain('vegano');
  expect(tutto).not.toContain('vegetariano');
});
