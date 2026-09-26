// Verifica #536 giro 10 — due cose che si vedono solo guardando.
//
// 1. I controlli statici girano sul computer di chi usa Filo e decidono da
//    soli: qui si contano quanti avvisi ONESTI fermano. Le frasi sono posta di
//    tutti i giorni (casa in affitto, wifi, prenotazioni, articoli sulle
//    password).
// 2. Il collegamento dentro un avviso esiste per far leggere la destinazione
//    vera: sul tema scuro si guarda se si legge.

import { test, expect } from './../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Avvisi che Filo potrebbe scrivere dopo aver letto posta normale. Nessuno
// deve sparire.
const ONESTI = [
  'Il codice di accesso all\'appartamento è 4821, lo trovi nel messaggio di benvenuto.',
  'La cassetta delle chiavi si apre con il codice di accesso 3390.',
  'Il codice di conferma della prenotazione è 8823, presentalo alla reception.',
  'Il codice di sicurezza del cancello è 2210.',
  'Il codice di verifica della ricevuta è 4409, serve per il reso.',
  'Il codice di accesso al wifi è CASA2026.',
  'Per collegarti al wifi digita la password OSPITI24.',
  'Il pin del cancello è 7788.',
  'Articolo del 2023: come scegliere una password sicura.',
  'Nel 2024 sono trapelate milioni di password da un forum.',
  'Entro il 2026 dovrai cambiare la password del portale.',
  'Il codice di attivazione della SIM è 9931.',
];

test('i controlli statici non fermano la posta di tutti i giorni', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const fermati = await app.evaluate((_e, frasi) => {
    const G = globalThis.SN_GUARDIANO_STATICO;
    return frasi.filter((f) => G.controlla(f, {}).blocca);
  }, ONESTI);
  expect(fermati, 'avvisi onesti fermati dai controlli statici').toEqual([]);
});

test('sul tema scuro il collegamento di un avviso si legge', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      theme: 'dark',
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.NOTICE_GUARD]: 'claude, gemma-lite',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async ({ attempts }) => ({
      text: '{"passa":true,"motivo":null}',
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  });

  const dash = await openTab(NEWTAB);
  await dash.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await dash.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    await chrome.runtime.sendMessage({
      type: MSG.FILO_AVVISO_PROPOSTO,
      testo: 'Il corriere scrive che il pacco arriva domani. [Tracciamento](https://corriere-esempio.invalid/traccia/99)',
      fonte: 'spedizioni@corriere-esempio.invalid',
      classe: 'messaggio',
      richiesta: 'avvisami delle mail importanti',
      modelloProduttore: 'deepseek-flash',
    });
  });

  const link = dash.locator('.dash-live-link').first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  try { await dash.screenshot({ path: 'tests/.shots/verifica-536-giro10-tema-scuro.png' }); } catch (_) {}

  // Contrasto fra la scritta del collegamento e lo sfondo della scheda: sotto
  // 4.5 la cosa più importante della riga è la meno leggibile.
  const contrasto = await link.evaluate((el) => {
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const fg = getComputedStyle(el).color;
    let node = el;
    let bg = 'rgba(0, 0, 0, 0)';
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
      node = node.parentElement;
    }
    const a = lum(fg); const b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrasto, 'contrasto del collegamento sul tema scuro').toBeGreaterThan(4.5);
});
