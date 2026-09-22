// La scelta generale degli host è arrivata in pagina: qui si guarda che stia
// dove si capisce (dentro la sezione dei modelli, non incollata al pulsante
// sopra) e che si veda nei due temi. Le immagini finiscono in tests/.shots/.

import { test, expect } from '../../fixtures/electron.mjs';

const MODELLI_PREDEFINITI = 'filo://admin-defaults/admin-defaults.html';

async function apriConConfig(openTab, cfg) {
  const page = await openTab(MODELLI_PREDEFINITI);
  await page.addInitScript((config) => {
    window.chrome = window.chrome || {};
    const attacca = () => {
      if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
      window.chrome.runtime.sendMessage = async (msg) => {
        switch (msg.type) {
          case 'defaults_get': return { ok: true, config };
          case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
          case 'defaults_update': return { ok: true, config };
          default: return { ok: true };
        }
      };
    };
    attacca();
  }, cfg);
  await page.reload();
  await page.waitForSelector('#providerSort', { timeout: 15_000 });
  return page;
}

const CONFIG = {
  apiKeysPresent: { openrouter: true, tavily: false },
  safeBrowsingKeyPresent: false,
  modelRegistry: {
    veloce: { provider: 'openrouter', model: 'vendor/uno', sort: 'throughput' },
    pronto: { provider: 'openrouter', model: 'vendor/due', reasoning: 'high' },
  },
  models: {},
  excludedProviders: ['Google', 'OpenAI'],
  providerSort: 'latency',
};

test('la scelta generale si vede nei due temi e non sta incollata al pulsante sopra', async ({ app, openTab }) => {
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    const page = await apriConConfig(openTab, CONFIG);
    await page.waitForTimeout(300);

    const box = await page.evaluate(() => {
      const sel = document.getElementById('providerSort');
      const lab = document.getElementById('providerSortLabel');
      const riga = document.querySelector('#sec-model-registry .sn-row');
      const r = sel.getBoundingClientRect();
      const l = lab.getBoundingClientRect();
      const b = riga.getBoundingClientRect();
      return {
        etichetta: lab.textContent.trim(),
        voci: Array.from(sel.options).map((o) => o.value),
        larghezza: r.width,
        altezza: r.height,
        distanzaDalPulsante: Math.round(l.top - b.bottom),
        descrizione: (document.getElementById('providerSortDesc').textContent || '').trim(),
      };
    });

    await page.screenshot({ path: `tests/.shots/ordine-host-generale-${tema}.png`, fullPage: false });

    expect(box.etichetta, `${tema}: la scelta generale è senza scritta`).not.toBe('');
    expect(box.descrizione, `${tema}: la scelta generale è senza spiegazione`).not.toBe('');
    expect(box.voci, `${tema}: le voci della scelta generale`).toEqual(['auto', 'throughput', 'latency', 'price']);
    expect(box.altezza, `${tema}: la scelta generale non si vede`).toBeGreaterThan(10);
    expect(box.distanzaDalPulsante,
      `${tema}: la scritta della scelta generale tocca il pulsante sopra (${box.distanzaDalPulsante} px)`)
      .toBeGreaterThanOrEqual(8);
  }
});

test('con la finestra stretta la riga di un modello resta dentro lo schermo', async ({ app, openTab }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'light' }); });
  const page = await apriConConfig(openTab, CONFIG);
  await page.setViewportSize({ width: 720, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/ordine-host-stretta.png', fullPage: false });

  const fuori = await page.evaluate(() => {
    const riga = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    const larghezza = document.documentElement.clientWidth;
    const figli = Array.from(riga.children).map((c) => {
      const r = c.getBoundingClientRect();
      return { destra: Math.round(r.right), larghezza: Math.round(r.width) };
    });
    return { larghezza, oltre: figli.filter((f) => f.destra > larghezza + 1).length, stretti: figli.filter((f) => f.larghezza < 20).length };
  });
  expect(fuori.oltre, 'con la finestra stretta dei controlli della riga finiscono fuori dallo schermo').toBe(0);
  expect(fuori.stretti, 'con la finestra stretta dei controlli della riga si schiacciano a niente').toBe(0);
});
