// Verifica #1921.1, giro 1: lo stesso caso con il primo giro FORZATO (risposta scritta insieme a lettura e spunta),
// così l'avviso «il testo è finito fra le note» arriva sempre; il giro dopo lo scrive GLM 5.3 Flash vero.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

test.use({
  accoglienzaFatta: false,
  envInPiu: { NODE_USE_ENV_PROXY: '1', NODE_EXTRA_CA_CERTS: '/root/.ccr/ca-bundle.crt' },
});

const CHIAVE = process.env.OPENROUTER_API_KEY || '';
const RACCONTO = /riscriv|note di lavoro|non ti è arrivat|non ti era arrivat|di nuovo la risposta|come risposta|riscritt|ripetendo|ripeto|prima non|ricapitol/i;
const PRIMA_RISPOSTA = 'Bella domanda. Quasi tutto resta sul tuo computer: chat, memorie e cronologia non hanno copie altrove. '
  + 'Escono solo i testi che servono al modello per risponderti, e passano da OpenRouter. Ti leggo il documento della privacy per essere preciso.';

async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('primo giro forzato fra le note: GLM riscrive senza dire perché', async ({ app, shell }, testInfo) => {
  test.skip(!CHIAVE, 'serve una chiave OpenRouter vera');
  test.setTimeout(240_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(async (_e, { chiave, primaRisposta }) => {
    const C = globalThis.SN_CONST;
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: chiave },
      models: { ...T.models, [C.ACTIONS.FILO_CHAT]: 'glm' },
      modelRegistry: T.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const orig = P.streamCompleteWithFallback;
    globalThis.__giri = [];
    globalThis.__inVolo = 0;
    globalThis.__forza = false;
    P.streamCompleteWithFallback = async (args) => {
      globalThis.__inVolo += 1;
      const voce = { modello: args.attempts && args.attempts[0] && args.attempts[0].model, testo: '', azioni: [] };
      try {
        const m = args.messages || [];
        voce.tutto = JSON.stringify(m).includes('fra le note di lavoro');
        voce.ultimo = JSON.stringify(m.slice(-3)).slice(-1500);
        if (globalThis.__forza && /glm/.test(String(voce.modello))) {
          globalThis.__forza = false;
          voce.forzato = true;
          voce.testo = primaRisposta;
          voce.azioni = ['LEGGI_TRASPARENZA', 'ONBOARDING'];
          try { args.onDelta && args.onDelta(primaRisposta); } catch (_) {}
          return {
            text: primaRisposta, model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {},
            toolCalls: [
              { id: 'call_f_0', type: 'function', function: { name: 'LEGGI_TRASPARENZA', arguments: '{"doc":"privacy"}' } },
              { id: 'call_f_1', type: 'function', function: { name: 'ONBOARDING', arguments: '{"spunta":["privacy"]}' } },
            ],
          };
        }
        const r = await orig(args);
        voce.testo = r && r.text;
        voce.azioni = ((r && r.toolCalls) || []).map((t) => (t.function && t.function.name) || t.name);
        return r;
      } catch (e) {
        voce.errore = String(e && e.message || e);
        throw e;
      } finally {
        globalThis.__giri.push(voce);
        globalThis.__inVolo -= 1;
      }
    };
  }, { chiave: CHIAVE, primaRisposta: PRIMA_RISPOSTA });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 60_000 });
  await expect(page.locator('#input')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => app.evaluate(() => globalThis.__inVolo), { timeout: 90_000 }).toBe(0);
  const bolleInizio = await page.locator('.dash-bubble-filo').count();

  await app.evaluate(() => { globalThis.__forza = true; });
  await page.locator('#input').fill('quali dati escono dal mio computer?');
  await page.locator('#sendBtn').click();
  await expect.poll(() => page.locator('.dash-bubble-filo').count(), { timeout: 120_000 }).toBeGreaterThan(bolleInizio);
  let prima = '';
  let stabile = 0;
  for (let i = 0; i < 90 && stabile < 4; i++) {
    await page.waitForTimeout(2_000);
    const ora = (await page.locator('.dash-bubble-filo').allInnerTexts()).slice(bolleInizio).join('\n---\n');
    const volo = await app.evaluate(() => globalThis.__inVolo);
    stabile = (ora === prima && volo === 0 && ora.trim()) ? stabile + 1 : 0;
    prima = ora;
  }
  const giri = await app.evaluate(() => globalThis.__giri);
  const chat = giri.filter((g) => /glm/.test(String(g.modello)));
  const avvisato = chat.some((g) => g.tutto);
  mkdirSync('tests/.shots/1921.1', { recursive: true });
  writeFileSync(`tests/.shots/1921.1/forzato-${testInfo.repeatEachIndex}.json`, JSON.stringify({ visibile: prima, avvisato, chat }, null, 2));
  console.log(`[1921.1 forzato #${testInfo.repeatEachIndex}] avvisato=${avvisato} giri=${chat.length} azioni=${chat.map((g) => g.azioni.join('+') || '-').join(' | ')}\n${prima.slice(0, 500)}`);
  expect(avvisato).toBe(true);
  expect(prima.trim()).not.toBe('');
  expect(prima).not.toMatch(RACCONTO);
});
