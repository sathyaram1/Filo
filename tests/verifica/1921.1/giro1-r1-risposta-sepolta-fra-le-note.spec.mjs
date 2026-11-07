// Verifica #1921.1, giro 1, rilievo 1: nell'intervista, la risposta scritta insieme a lettura e spunta finisce fra le
// note; se il giro dopo il modello non la riscrive (GLM 5.3 Flash, circa una volta su cinque) l'utente non la vede.
// Qui il modello è finto e ripete quello che GLM ha fatto davvero: il secondo giro torna solo alla domanda dell'intervista.
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ accoglienzaFatta: false });

const RISPOSTA = 'Quasi tutto resta sul tuo computer: chat, memorie e cronologia non hanno copie altrove. '
  + 'Escono solo i testi che servono al modello per risponderti, e passano da OpenRouter.';
const SOLO_RITORNO = 'Torniamo a noi: chi sei, e a cosa ti serve di solito il computer?';

async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r1 quali dati escono: la risposta scritta insieme alla spunta arriva all’utente anche se il giro dopo non la riscrive', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(async (_e, { risposta, soloRitorno }) => {
    const C = globalThis.SN_CONST;
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...T.models, [C.ACTIONS.FILO_CHAT]: 'glm' },
      modelRegistry: T.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__coda = [];
    const altri = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('Sei il controllo rapido degli errori')) return '';
      if (all.includes('proponi SUGGERIMENTI')) return '[][][][nessuno]';
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\n\nPREFERENZE:\n';
      if (all.includes('analizzare l')) return 'NESSUNA';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Ciao.', suggestions: [] });
      return '';
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const prossima = tools && globalThis.__coda.shift();
      if (prossima === 'risposta') {
        try { onDelta && onDelta(risposta); } catch (_) {}
        return {
          ...base, text: risposta,
          toolCalls: [
            { id: 'call_r1_0', type: 'function', function: { name: 'LEGGI_TRASPARENZA', arguments: '{"doc":"privacy"}' } },
            { id: 'call_r1_1', type: 'function', function: { name: 'ONBOARDING', arguments: '{"spunta":["privacy"]}' } },
          ],
        };
      }
      if (prossima === 'ritorno') {
        try { onDelta && onDelta(soloRitorno); } catch (_) {}
        return { ...base, text: soloRitorno };
      }
      const t = tools ? 'Ciao, sono Filo. Chi sei, e a cosa ti serve di solito il computer?' : altri(messages);
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t };
    };
    P.completeWithFallback = async ({ attempts, messages }) => ({
      text: altri(messages), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  }, { risposta: RISPOSTA, soloRitorno: SOLO_RITORNO });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 30_000 });
  await expect(page.locator('#input')).toBeVisible({ timeout: 30_000 });

  await app.evaluate(() => { globalThis.__coda.push('risposta', 'ritorno'); });
  await page.locator('#input').fill('quali dati escono dal mio computer?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo:visible', { hasText: 'Torniamo a noi' })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => app.evaluate(() => globalThis.__coda.length), { timeout: 15_000 }).toBe(0);
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: 'tests/.shots/1921.1-r1-risposta-sepolta.png' }).catch(() => {});

  // Quello che l'utente legge senza aprire niente: la risposta alla sua domanda, non solo il ritorno all'intervista.
  await expect(page.locator('.dash-bubble-filo:visible', { hasText: 'Quasi tutto resta sul tuo computer' })).toBeVisible({ timeout: 5_000 });
});
