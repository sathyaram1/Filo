// Verifica #724.1, giro 3 — la chat affida a Filo OGNI conto: quello che torna
// all'utente dev'essere un numero leggibile, mai un marker grezzo né dodici cifre.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Finto modello: a ogni domanda risponde con la frase data, a pezzi come in rete.
async function modelloFinto(app, risposte) {
  await app.evaluate(async (_e, risposte) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const full = risposte[Math.min(i++, risposte.length - 1)];
      const cut = Math.floor(full.length / 2);
      for (const c of [full.slice(0, cut), full.slice(cut)]) {
        try { onDelta && onDelta(c); } catch (_) {}
        await new Promise((r) => setTimeout(r, 150));
      }
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, risposte);
}

async function manda(page, testo) {
  const prima = await page.locator('.dash-bubble-filo').count();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo')).toHaveCount(prima + 1, { timeout: 15_000 });
  await expect(page.locator('.dash-bubble-streaming')).toHaveCount(0, { timeout: 15_000 });
  return (await page.locator('.dash-bubble-filo').last().textContent()) || '';
}

test('una conversione di unità scritta come chiede il prompt arriva come numero leggibile', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  // La formula è quella che le istruzioni della chat danno al modello per i Fahrenheit.
  await modelloFinto(app, ['70 °F sono [[calc: (70-32)*5/9]] °C.']);
  const t = await manda(page, 'quanti gradi sono 70 fahrenheit?');
  await page.screenshot({ path: 'tests/.shots/verifica-724.1-giro3-fahrenheit.png' });
  expect(t).toMatch(/21,1{1,2} ?°C/);
  expect(t, 'dieci decimali non sono una risposta').not.toMatch(/21,1{4,}/);
});

test('un conto che la calcolatrice non sa leggere non arriva mai come marker grezzo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await modelloFinto(app, [
    'Il 20% di 150 è [[calc: 150*20%]].',
    'Un milione di rupie sono circa [[calc: 1,000,000/92.3 | eur]] €.',
  ]);
  const t1 = await manda(page, 'quanto è il 20% di 150?');
  expect(t1).not.toContain('[[');
  expect(t1).toContain('30');
  const t2 = await manda(page, 'quanto fanno un milione di rupie in euro?');
  expect(t2).not.toContain('[[');
  expect(t2).toMatch(/10\.834,24 ?€/);
});
