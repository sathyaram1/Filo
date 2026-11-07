// Verifica #1921.1, giro 2: la risposta scritta insieme alla spunta torna nella bolla, ma il testo dell'ultimo giro le
// va dietro com'è. Il modello è finto e rifà due uscite vere di GLM 5.3 Flash (15 prove col modello vero: una volta ciascuna).
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ accoglienzaFatta: false });

const PROTEZIONI = 'E le protezioni di base sono già accese da così: cookie rifiutati, pubblicità bloccate, siti pericolosi bloccati. '
  + 'Se vuoi il dettaglio completo di cosa esce e verso chi, chiedimelo e te lo leggo per intero.';
const BATTUTA = 'Torniamo a noi: cosa ci fai col computer, di solito? Lavoro, studio, svago?';
const RISPOSTA_CHAT = 'Bella domanda, e ci sta che la faccia subito: le tue chat restano sul tuo computer, senza copia da nessun\'altra parte. '
  + 'Il server di Filo non le riceve.\n\nEscono solo i pezzi che servono a un modello per risponderti: le conversazioni degli ultimi '
  + 'giorni passano da OpenRouter e arrivano al modello che ti risponde. Fuori da quello: solo i feedback che decidi di mandare '
  + '(cifrati) e dei contatori fatti di soli numeri, che puoi spegnere.\n\n'
  + `${PROTEZIONI}\n\n${BATTUTA}`;
const CODA_RIPETUTA = `${PROTEZIONI}\n\n${BATTUTA}`;

const RISPOSTA_VENDETE = 'No, i dati non si vendono, e non se ne guadagna nemmeno un centesimo: niente servizi di analisi, niente pubblicità. '
  + 'Anzi, la pubblicità la blocco, non la uso. Le chat, i file e le memorie restano tutti qui; esce solo quello che serve a un modello '
  + 'per risponderti, i feedback che decidi tu di mandare e ogni ora dei contatori fatti solo di numeri.\n\n'
  + 'E intanto, se hai ancora due minuti, dimmi chi sei e a cosa ti serve il computer, così ti lascio già impostato bene.';
const NOTA_AL_SISTEMA = '[La risposta sopra resta quella: niente vendite di dati, e chi non vuole i contatori numerici li spegne. '
  + 'C\'è ancora il primo punto del nostro accordo, chi sei e a cosa ti serve il computer, sempre che tu abbia due minuti.]';

async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function preparaGiri(app, page, risposta, finale) {
  await app.evaluate(async (_e, { risposta, finale }) => {
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
            { id: 'call_g2_0', type: 'function', function: { name: 'LEGGI_TRASPARENZA', arguments: '{"doc":"privacy"}' } },
            { id: 'call_g2_1', type: 'function', function: { name: 'ONBOARDING', arguments: '{"spunta":["privacy"]}' } },
          ],
        };
      }
      if (prossima === 'finale') {
        try { onDelta && onDelta(finale); } catch (_) {}
        return { ...base, text: finale };
      }
      const t = tools ? 'Ciao, sono Filo. Chi sei, e a cosa ti serve di solito il computer?' : altri(messages);
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t };
    };
    P.completeWithFallback = async ({ attempts, messages }) => ({
      text: altri(messages), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  }, { risposta, finale });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 30_000 });
  await expect(page.locator('#input')).toBeVisible({ timeout: 30_000 });
}

async function chiedi(app, page, domanda) {
  await app.evaluate(() => { globalThis.__coda.push('risposta', 'finale'); });
  await page.locator('#input').fill(domanda);
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__coda.length), { timeout: 30_000 }).toBe(0);
  await expect(page.locator('.dash-bubble-filo:visible', { hasText: 'Il server di Filo non le riceve' }).or(
    page.locator('.dash-bubble-filo:visible', { hasText: 'non si vendono' }))).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
}

test('r1 chi legge le mie chat: l’ultimo giro riscrive solo la coda della risposta, e la bolla non la ripete due volte', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await preparaGiri(app, page, RISPOSTA_CHAT, CODA_RIPETUTA);
  await chiedi(app, page, 'chi legge le mie chat?');
  await page.screenshot({ path: 'tests/.shots/1921.1-g2-r1.png' }).catch(() => {});
  const testo = (await page.locator('.dash-bubble-filo:visible').allInnerTexts()).join('\n');
  expect(testo.split('cosa ci fai col computer, di solito').length - 1).toBe(1);
  expect(testo.split('protezioni di base sono già accese').length - 1).toBe(1);
});

test('r2 ma i miei dati li vendete: la nota fra quadre che GLM scrive al sistema non arriva all’utente', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await preparaGiri(app, page, RISPOSTA_VENDETE, NOTA_AL_SISTEMA);
  await chiedi(app, page, 'ma i miei dati li vendete?');
  await page.screenshot({ path: 'tests/.shots/1921.1-g2-r2.png' }).catch(() => {});
  await expect(page.locator('.dash-bubble-filo:visible', { hasText: 'non si vendono' })).toBeVisible();
  await expect(page.locator('.dash-bubble-filo:visible', { hasText: 'La risposta sopra resta quella' })).toHaveCount(0);
});
