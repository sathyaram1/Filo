// Verifica avversariale #518 — l'host che mescolava le risposte fra richieste
// diverse deve smettere di servire le richieste di Filo, e l'owner deve poter
// applicare l'esclusione anche dove la lista condivisa sostituisce quella del
// codice.
//
// Nessuna rete: la pagina admin viene stubbata come nello spec dell'editor.

import { test, expect } from './fixtures/electron.mjs';

const ADMIN_URL = 'filo://admin-defaults/admin-defaults.html';

async function openStubbedEditor(openTab, overrides = {}) {
  const page = await openTab(ADMIN_URL);
  await page.addInitScript((over) => {
    const fakeConfig = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: { esistente: { provider: 'openrouter', model: 'vendor/gia-salvato', reasoning: 'medium' } },
      models: {},
      excludedProviders: null,
      ...over,
    };
    if (fakeConfig.excludedProviders == null) {
      Object.defineProperty(fakeConfig, 'excludedProviders', {
        get: () => (window.SN_CONST && window.SN_CONST.DEFAULT_EXCLUDED_PROVIDERS) || [],
      });
    }
    window.__sent = [];
    window.__xss = 0;
    const stub = async (msg) => {
      window.__sent.push(JSON.parse(JSON.stringify(msg)));
      switch (msg.type) {
        case 'defaults_get':
          return { ok: true, config: fakeConfig };
        case 'default_models_list':
          return { ok: true, provider: msg.provider, items: [] };
        case 'defaults_update':
          return {
            ok: true,
            config: {
              apiKeysPresent: fakeConfig.apiKeysPresent,
              safeBrowsingKeyPresent: fakeConfig.safeBrowsingKeyPresent,
              modelRegistry: (msg.config && msg.config.modelRegistry) || fakeConfig.modelRegistry,
              models: (msg.config && msg.config.models) || fakeConfig.models,
              // Come il main: la lista tornata è quella EFFETTIVA dopo la
              // scrittura, array vuoto compreso (svuotarla è un valore).
              excludedProviders: (msg.config && Array.isArray(msg.config.excludedProviders))
                ? msg.config.excludedProviders
                : fakeConfig.excludedProviders,
            },
          };
        default:
          return { ok: true };
      }
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  }, overrides);
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  return page;
}

const names = (page) => page.$$eval('.sn-excluded-name', (els) => els.map((e) => e.value));
const lastUpdate = (page) => page.evaluate(
  () => window.__sent.filter((m) => m.type === 'defaults_update').slice(-1)[0] || null,
);

// ── 1. La lamentela: l'host che mescolava le risposte non deve più servire ────

test('#518 la politica di build esclude l\'host che mescolava le risposte, su TUTTO ciò che instrada', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);

  const out = await page.evaluate(() => {
    const C = window.SN_CONST;
    const base = C.DEFAULT_EXCLUDED_PROVIDERS;
    // Come lo vede il main: lista effettiva → forme da mandare a OpenRouter.
    const eff = C.effectiveExcludedProviders(base, false);
    const ignore = C.providerIgnoreList(eff);
    return {
      ignore,
      // Nomi con cui l'host può presentarsi nella risposta.
      served: ['Novita', 'novita', 'Novita AI', 'novita.ai', 'NOVITA'].map(
        (s) => [s, C.isProviderExcluded(s, eff)],
      ),
      // Un host omonimo ma DIVERSO non deve cadere nell'esclusione.
      falsePositive: C.isProviderExcluded('Novitatech', eff),
      // L'interruttore "solo pesi aperti" non deve perdere l'esclusione.
      withOpenWeights: C.providerIgnoreList(C.effectiveExcludedProviders(base, true)),
    };
  });

  expect(out.ignore).toContain('Novita');
  for (const [name, excluded] of out.served) expect(excluded, name).toBe(true);
  expect(out.falsePositive).toBe(false);
  expect(out.withOpenWeights).toContain('Novita');
});

// ── 2. Il caso dell'owner: la lista condivisa vecchia non copre l'esclusione ──

test('#518 lista condivisa senza il nuovo escluso: la pagina lo nomina, lo rimette e lo salva', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google', 'OpenAI'] });

  const drift = page.locator('#excludedDrift');
  await expect(drift).toBeVisible();
  await expect(drift).toContainText('Novita');

  await page.click('#excludedDriftFix');
  await expect(drift).toBeHidden();

  const after = await names(page);
  expect(after).toContain('Novita');
  // Nessun duplicato: le voci già presenti non vengono ri-aggiunte.
  expect(after.filter((n) => n === 'Google').length).toBe(1);

  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toContainText('Salvato', { timeout: 8_000 });

  const upd = await lastUpdate(page);
  const buildList = await page.evaluate(() => window.SN_CONST.DEFAULT_EXCLUDED_PROVIDERS);
  for (const b of buildList) expect(upd.config.excludedProviders, b).toContain(b);
  expect(upd.config.excludedProviders).toContain('OpenAI');
});

test('#518 doppio clic su «Rimettili nella lista»: non duplica le voci', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google'] });
  const fix = page.locator('#excludedDriftFix');
  await fix.dblclick();
  const after = await names(page);
  const dupes = after.filter((n, i) => after.indexOf(n) !== i);
  expect(dupes).toEqual([]);
  expect(after).toContain('Novita');
});

// ── 3. Stress ────────────────────────────────────────────────────────────────

test('#518 riga vuota / soli spazi: non entra nella lista salvata e non finge una modifica', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);
  await page.click('#addExcludedRow');
  await page.locator('.sn-excluded-name').last().fill('     ');
  await page.click('#addExcludedRow');

  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toContainText('Salvato', { timeout: 8_000 });

  const upd = await lastUpdate(page);
  // Non toccata davvero → la lista NON viaggia (non congela quella del codice).
  expect('excludedProviders' in (upd.config || {})).toBe(false);
});

test('#518 duplicati con maiuscole diverse: una sola voce viaggia', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google'] });
  await page.click('#addExcludedRow');
  await page.locator('.sn-excluded-name').last().fill('  gOOgle  ');
  await page.click('#addExcludedRow');
  await page.locator('.sn-excluded-name').last().fill('Novita');

  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toContainText('Salvato', { timeout: 8_000 });
  const upd = await lastUpdate(page);
  const list = upd.config.excludedProviders;
  expect(list.filter((x) => x.toLowerCase() === 'google').length).toBe(1);
  expect(list).toContain('Novita');
});

test('#518 nome con HTML/script: resta testo, niente esecuzione né markup', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: [] });
  await page.click('#addExcludedRow');
  const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  await page.locator('.sn-excluded-name').last().fill(evil);
  // Il riquadro di deriva stampa i nomi mancanti: è lì che un nome ostile
  // finirebbe in una stringa di testo.
  await expect(page.locator('#excludedDrift')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
  expect(await page.evaluate(() => document.querySelectorAll('#excludedList img, #excludedDrift img').length)).toBe(0);
});

test('#518 lista svuotata a mano: l\'owner può azzerarla e il vuoto viaggia', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google', 'Novita'] });
  const removeAll = async () => {
    while ((await page.locator('.sn-excluded-row').count()) > 0) {
      await page.locator('.sn-excluded-row').first().getByRole('button', { name: 'Rimuovi' }).click();
    }
  };
  await removeAll();
  await expect(page.locator('#excludedDrift')).toBeVisible();

  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toContainText('Salvato', { timeout: 8_000 });
  const upd = await lastUpdate(page);
  expect(Array.isArray(upd.config.excludedProviders)).toBe(true);
  expect(upd.config.excludedProviders).toEqual([]);
});

test('#518 nome lunghissimo: la pagina non sfonda in larghezza', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google'] });
  await page.click('#addExcludedRow');
  await page.locator('.sn-excluded-name').last().fill('N'.repeat(10_000));
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  expect(overflow.doc).toBeLessThanOrEqual(overflow.win + 2);
});

test('#518 due salvataggi di fila: il secondo non rimanda la lista se non l\'hai ritoccata', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google'] });
  await page.click('#excludedDriftFix');
  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toContainText('Salvato', { timeout: 8_000 });
  const first = await lastUpdate(page);
  expect(first.config.excludedProviders).toContain('Novita');

  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toContainText('Salvato', { timeout: 8_000 });
  const second = await lastUpdate(page);
  expect('excludedProviders' in (second.config || {})).toBe(false);
});

test('#518 traccia visiva della sezione', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google', 'OpenAI'] });
  await page.locator('#sec-excluded').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/verify-518-esclusi.png', fullPage: true }).catch(() => {});
  await expect(page.locator('#sec-excluded')).toBeVisible();
});

// Il tema scuro è metà degli utenti: un avviso che lì diventa illeggibile è
// come non averlo scritto.
test('#518 tema scuro: la sezione e l\'avviso restano leggibili', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google', 'OpenAI'] });
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.locator('#sec-excluded').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/verify-518-esclusi-dark.png', fullPage: true }).catch(() => {});
  // Contrasto minimo: testo dell'avviso diverso dallo sfondo del riquadro.
  const c = await page.evaluate(() => {
    const box = document.getElementById('excludedDrift');
    const txt = document.getElementById('excludedDriftText');
    return {
      bg: getComputedStyle(box).backgroundColor,
      fg: getComputedStyle(txt).color,
      inputFg: getComputedStyle(document.querySelector('.sn-excluded-name')).color,
      inputBg: getComputedStyle(document.querySelector('.sn-excluded-name')).backgroundColor,
    };
  });
  expect(c.bg).not.toBe(c.fg);
  expect(c.inputBg).not.toBe(c.inputFg);
});
