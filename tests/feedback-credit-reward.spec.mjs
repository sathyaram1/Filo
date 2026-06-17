// C3 — Ricompensa feedback: inviare un feedback accredita +5 crediti SUBITO e
// fa "volare" le monete verso l'angolo profilo (animazione).
//
// Asserisce IL SUCCESSO della feature: il saldo crediti aumenta di esattamente
// 5 dopo un invio riuscito, e il layer dell'animazione delle monete compare.
// Il submit verso Firestore è stubbato (niente rete): la ricompensa è una
// conseguenza dell'invio riuscito, non del round-trip di rete.
//
// Pre-condizione che renderebbe rosso il test senza il fix: prima di C3 l'invio
// non chiamava `credits_award_feedback`, quindi il saldo non cambiava e nessun
// layer `.sn-fb-credit-fly` veniva creato.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
  return win;
}

async function balance(page) {
  return page.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: 'get_credits' });
    return r?.credits?.balance ?? null;
  });
}

test('inviare un feedback accredita +5 crediti e mostra l\'animazione delle monete', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Saldo iniziale (il primo GET_CREDITS applica già l'eventuale refill lazy,
  // così il secondo confronto isola il solo effetto della ricompensa).
  const before = await balance(page);
  expect(typeof before, 'GET_CREDITS deve tornare un saldo numerico').toBe('number');

  // Stub: il submit NON tocca la rete (Firestore) — torna ok subito. In più un
  // osservatore registra la comparsa del layer dell'animazione. Tutto il resto
  // (get_credits, credits_award_feedback) passa al vero handler nel main.
  await page.evaluate(() => {
    window.__flySeen = false;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && node.classList && node.classList.contains('sn-fb-credit-fly')) {
            window.__flySeen = true;
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true });
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'submit_feedback') return Promise.resolve({ ok: true, id: 'test-fb' });
      return orig(msg, ...rest);
    };
  });

  // Apri il box, scrivi qualcosa, invia.
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill('Test ricompensa crediti');
  await page.locator('.sn-fb-send').click();

  // Invio riuscito → il box si chiude.
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 6_000 });

  // L'animazione "monete che volano" è comparsa (il layer dedicato è stato
  // aggiunto al DOM; si auto-rimuove dopo ~1s, ma l'osservatore l'ha vista).
  await expect
    .poll(() => page.evaluate(() => window.__flySeen), { timeout: 4_000 })
    .toBe(true);

  // Il saldo è aumentato di ESATTAMENTE 5.
  await expect
    .poll(() => balance(page), { timeout: 6_000 })
    .toBe(before + 5);
});
