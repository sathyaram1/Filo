// Giro 3 di home-invito: chi scrive nella home prima dei crediti, da ogni strada, e il fornitore «gemini» in chat.
import { test, expect } from '../../fixtures/electron.mjs';
import { usaServerFinto, homePage, nuovaHome, prepara, onboardingFatto, riscattaDaCrediti, testoHome } from './_crediti-finti.mjs';

const stato = usaServerFinto(test);
const BENVENUTO = /Ciao, sono Filo/;
const INVITO = /codice d.invito/i;
const FILO = { tab: { id: 8, url: 'filo://newtab/' }, url: 'filo://newtab/' };

async function scrivi(home, testo) {
  await home.fill('#input', testo);
  await home.press('#input', 'Enter');
}

async function scriviSenzaCrediti(home) {
  await expect(home.locator('#homeMessage')).toContainText(INVITO, { timeout: 30_000 });
  await scrivi(home, 'ciao');
  await expect(home.locator('#bubbles')).toContainText(INVITO, { timeout: 20_000 });
  await expect(home.locator('#bubbles button', { hasText: 'Apri Crediti' })).toBeVisible();
}

const onboarding = (app) => app.evaluate(async () => globalThis.SN_FILO_MEMORY.getOnboarding());

test('nuovo: scrivo prima dei crediti, «Apri Crediti», riscatto, e nella home Filo si presenta', async ({ app, shell }) => {
  test.setTimeout(180_000);
  await prepara(app, stato.base);
  const home = await homePage(app);
  await scriviSenzaCrediti(home);
  await home.locator('#bubbles button', { hasText: 'Apri Crediti' }).click();
  let cr = null;
  await expect.poll(() => { cr = app.windows().find((w) => w.url().startsWith('filo://credits')); return Boolean(cr); }, { timeout: 20_000 }).toBe(true);
  await expect(cr.locator('#redeemForm')).toBeVisible({ timeout: 20_000 });
  await cr.fill('#inviteCode', 'ABCD-EFGH');
  await cr.click('#redeemBtn');
  await expect(cr.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20_000 });
  await shell.locator('.tab').first().click();
  await expect(home.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
  await expect(home.locator('#bubbles')).not.toContainText(INVITO);
  const onb = await onboarding(app);
  expect(onb.thread.map((m) => m.role)).toEqual(['filo']);

  // La conversazione prosegue da qui, e la risposta entra nell'intervista.
  await scrivi(home, 'mi chiamo Marco');
  await expect.poll(async () => (await onboarding(app)).thread.map((m) => m.text).join('|'), { timeout: 20_000 }).toContain('mi chiamo Marco');

  // Scheda nuova: la stessa intervista, senza il «ciao» di prima.
  const altra = await nuovaHome(app, shell);
  await expect(altra.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
  await expect(altra.locator('#bubbles')).not.toContainText(/\bciao\b(?!,)/);
});

test('nuovo: scrivo prima che arrivi l’invito del primo avvio, poi arriva, e Filo si presenta nella home', async ({ app }) => {
  test.setTimeout(180_000);
  stato.pendingCode = 'ABCD-EFGH';
  stato.trattieni = true;
  await prepara(app, stato.base);
  const home = await homePage(app);
  await expect.poll(() => stato.trattenute.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await scriviSenzaCrediti(home);
  await scrivi(home, 'ci sei?');
  await expect(home.locator('#bubbles .dash-bubble-user')).toHaveCount(2, { timeout: 20_000 });
  await home.waitForTimeout(1500);
  for (const r of stato.trattenute.splice(0)) r();
  await expect(home.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
  await expect(home.locator('#bubbles')).not.toContainText(INVITO);
  expect((await onboarding(app)).thread.map((m) => m.role)).toEqual(['filo']);
});

test('nuovo: due home aperte, una con la risposta sui crediti; dopo il riscatto l’intervista parte in tutte e due, una volta sola', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  await prepara(app, stato.base);
  const home = await homePage(app);
  await scriviSenzaCrediti(home);
  const seconda = await nuovaHome(app, shell);
  await expect(seconda.locator('#homeMessage')).toContainText(INVITO, { timeout: 30_000 });
  await riscattaDaCrediti(openTab);
  await expect(home.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
  await expect(seconda.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
  expect((await onboarding(app)).thread.length).toBe(1);
});

test('nuovo: scrivo prima dei crediti, poi metto la chiave nelle Impostazioni, e Filo si presenta nella home', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  await prepara(app, stato.base);
  const home = await homePage(app);
  await scriviSenzaCrediti(home);
  const opt = await openTab('filo://options/options.html');
  await expect(opt.locator('#useDefaultModels')).toBeChecked({ timeout: 20_000 });
  await opt.locator('#useDefaultModels').uncheck();
  await expect(opt.locator('#apiKey')).toBeVisible({ timeout: 20_000 });
  await opt.fill('#apiKey', 'sk-or-v1-mia');
  await opt.locator('#apiKey').blur();
  await shell.locator('.tab').first().click();
  await expect(home.locator('#bubbles')).toContainText(BENVENUTO, { timeout: 30_000 });
  await expect(home.locator('#bubbles')).not.toContainText(INVITO);
});

test('esplora: già accolto, scrivo prima dei crediti, riscatto: cosa resta nella home', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await prepara(app, stato.base);
  await onboardingFatto(app);
  const home = await homePage(app);
  await home.reload();
  await scriviSenzaCrediti(home);
  await riscattaDaCrediti(openTab);
  await home.waitForTimeout(6000);
  const stato2 = await home.evaluate(() => ({ state: document.body.dataset.state, bolle: document.getElementById('bubbles').innerText, msg: document.getElementById('homeMessage').innerText }));
  console.log('ESPLORA-GIA-ACCOLTO', JSON.stringify(stato2));
});

test('config remota su «gemini»: coi crediti la chat della home risponde col modello', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  stato.modelsDoc = {
    fields: {
      provider: { stringValue: 'gemini' },
      modelRegistry: { mapValue: { fields: { base: { mapValue: { fields: { provider: { stringValue: 'openrouter' }, model: { stringValue: 'test/base' } } } } } } },
      models: { mapValue: { fields: { filo_chat: { stringValue: 'base' }, filo_dashboard: { stringValue: 'base' }, filo_lesson: { stringValue: 'base' }, filo_compact: { stringValue: 'base' } } } },
    },
  };
  await prepara(app, stato.base);
  await app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    await req('./services/defaultsStore').refresh();
  });
  await onboardingFatto(app);
  const home = await homePage(app);
  await home.reload();
  await expect(home.locator('#homeMessage')).toContainText(INVITO, { timeout: 30_000 });
  await riscattaDaCrediti(openTab);
  await expect(home.locator('#homeMessage')).toContainText('HOME-DAL-MODELLO', { timeout: 30_000 });
  await scrivi(home, 'che tempo fa?');
  await expect(home.locator('#bubbles')).toContainText('Dimmi pure.', { timeout: 30_000 });
  await expect(home.locator('#bubbles')).not.toContainText(INVITO);
  const eff = await app.evaluate(async (_, s) => {
    const r = await globalThis.SN_HANDLE_MESSAGE({ type: 'filo_get_onboarding', peek: true }, s);
    return r.ready;
  }, FILO);
  expect(eff).toBe(true);
});
