// Feedback #146.4 — "estetica via chat + GUI per richieste ambigue".
//
// Quando l'utente chiede a Filo (chat) una modifica estetica ("rendi i bottoni
// verdi"), Filo:
//   1. applica SUBITO un valore ragionevole al token giusto (azione
//      IMPOSTA_ESTETICA, livello 1, reversibile) — la modifica finisce davvero
//      nello storage e si propaga live a tutte le superfici;
//   2. nella bolla compare un bottone che apre un box (color picker / slider, a
//      seconda del tipo del token) per scegliere il valore esatto, con anteprima
//      live; il valore scelto persiste.
// Eccezione di sicurezza: se la modifica rende il testo ~uguale allo sfondo
// (illeggibilità estrema) l'azione diventa livello 2 → conferma PRIMA di
// applicare.
//
// Gli assert verificano il SUCCESSO (l'impostazione cambia davvero, il box
// compare, il picker scrive il nuovo valore), non l'assenza di un errore.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// La newtab di boot può distruggere il contesto della prima app.evaluate in
// volo: aspettiamo che sia comparsa e caricata (come in filo-chat-set-preference).
async function waitForBoot(app) {
  const deadline = Date.now() + 10_000;
  let tab = null;
  while (Date.now() < deadline) {
    tab = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; }
    });
    if (tab) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (tab) await tab.waitForLoadState('domcontentloaded').catch(() => {});
}

// ── livello main: l'azione applica DAVVERO il token (criterio "cambia davvero") ──

test('IMPOSTA_ESTETICA applica il token e lo scrive nello storage (livello 1)', async ({ app }) => {
  await waitForBoot(app);
  const res = await app.evaluate(async () =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_ESTETICA', token: 'button.bg', valore: '#3a7d44' }),
  );
  expect(res.executed).toBe(true);
  // kept:true → il client renderizza il bottone di raffinamento.
  expect(res.kept).toBe(true);

  const settings = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  expect(settings.themeTokens['button.bg']).toBe('#3a7d44');
});

test('un valore di token non valido non scrive nulla', async ({ app }) => {
  await waitForBoot(app);
  // "green" non è un esadecimale: la whitelist anti CSS-injection lo rifiuta.
  const res = await app.evaluate(async () =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_ESTETICA', token: 'accent', valore: 'green' }),
  );
  expect(res.executed).toBe(false);
  const settings = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  expect(settings.themeTokens && settings.themeTokens.accent).toBeUndefined();
});

test('testo ≈ sfondo → livello 2: conferma prima di applicare, poi applica', async ({ app }) => {
  await waitForBoot(app);
  // Sfondo personalizzato indipendente dal tema, così l'illeggibilità non
  // dipende dal tema risolto in headless.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ themeTokens: { background: '#222222' } });
  });

  // Rendere il testo uguale allo sfondo: NON si applica subito, torna
  // needsConfirm=2 con la spiegazione dell'illeggibilità.
  const susp = await app.evaluate(async () =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_ESTETICA', token: 'text', valore: '#222222' }),
  );
  expect(susp.executed).toBe(false);
  expect(susp.kept).toBe(true);
  expect(susp.needsConfirm).toBe(2);
  expect(susp.describe).toMatch(/illeggibile/i);

  // Non ancora scritto.
  const before = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  expect(before.themeTokens.text).toBeUndefined();
  // ...e lo sfondo preparato è ancora lì.
  expect(before.themeTokens.background).toBe('#222222');

  // Con conferma esplicita l'azione esegue e fonde (senza azzerare lo sfondo).
  const ok = await app.evaluate(async () =>
    globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_ESTETICA', token: 'text', valore: '#222222' }, { confirmed: true }),
  );
  expect(ok.executed).toBe(true);
  const after = await app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  expect(after.themeTokens.text).toBe('#222222');
  expect(after.themeTokens.background).toBe('#222222');
});

// ── livello UI: il bottone di raffinamento compare, il picker applica live e persiste ──

test('la chat mostra il bottone di raffinamento e il picker scrive il nuovo colore', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  // Intercettiamo l'azione: stubbiamo la risposta della chat (Filo ha "scelto"
  // un verde per i bottoni) e catturiamo le scritture delle impostazioni.
  await page.evaluate(() => {
    const { MSG } = window.SN_MSG;
    window.__filoCaptured = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === MSG.FILO_CHAT) {
        cb && cb({
          ok: true,
          text: 'Fatto, ho reso i bottoni verdi — usa il controllo qui sotto per la tonalità esatta.',
          actions: [{ type: 'IMPOSTA_ESTETICA', token: 'button.bg', valore: '#3a7d44' }],
        });
        return;
      }
      if (msg && msg.type === MSG.UPDATE_SETTINGS) {
        window.__filoCaptured.push(msg.settings);
        cb && cb({ ok: true });
        return;
      }
      return orig(msg, cb);
    };
  });

  // L'utente chiede la modifica estetica.
  await input.fill('rendi i bottoni verdi');
  await page.locator('#sendBtn').click();

  // 1) Compare il bottone di raffinamento (etichetta da color token).
  const trigger = page.locator('.sn-refine-trigger');
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await expect(trigger).toContainText(/colore/i);

  // 2) Click → il box in sovrimpressione col color picker.
  await trigger.click();
  const overlay = page.locator('.sn-refine-overlay');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  const colorInput = page.locator('.sn-refine-color');
  await expect(colorInput).toBeVisible();

  // 3) L'utente sceglie un colore esatto → anteprima live + persistenza.
  await page.evaluate(() => {
    const inp = document.querySelector('.sn-refine-color');
    inp.value = '#112233';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Anteprima live: lo <style> dei token override contiene il nuovo valore.
  await expect(async () => {
    const css = await page.evaluate(() => {
      const el = document.getElementById('sn-theme-tokens');
      return el ? el.textContent : '';
    });
    expect(css).toContain('#112233');
  }).toPass({ timeout: 4_000 });

  // Persistenza: è stata inviata una UPDATE_SETTINGS col token al nuovo valore.
  await expect(async () => {
    const saved = await page.evaluate(() => window.__filoCaptured || []);
    const last = saved[saved.length - 1];
    expect(last && last.themeTokens && last.themeTokens['button.bg']).toBe('#112233');
  }).toPass({ timeout: 4_000 });
});

// #164 — "rendi le scritte rosse" diceva "Fatto" ma sulla dashboard (dove vive
// la chat) non cambiava nulla: la newtab usa una palette propria (--dash-*)
// slegata dai token. Ora un override di 'text' aggiorna DAVVERO --dash-ink (e il
// colore effettivo del testo della dashboard), così la modifica si vede dove
// l'utente l'ha chiesta.
test("una modifica estetica si applica DAVVERO alla dashboard (--dash-* segue i token)", async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  const read = () => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      ink: cs.getPropertyValue('--dash-ink').trim(),
      paper: cs.getPropertyValue('--dash-paper').trim(),
    };
  });

  // Default: la palette "carta" della dashboard, NON il token (estetica intatta).
  const before = await read();
  expect(before.ink.toLowerCase()).not.toBe('#ff0000');

  // L'utente ha chiesto "rendi le scritte rosse": applichiamo l'override come fa
  // il live-apply (SN_PAGE_BOOTSTRAP.applyThemeTokens, lo stesso path della chat).
  await page.evaluate(() => {
    window.SN_PAGE_BOOTSTRAP.applyThemeTokens({ text: '#ff0000', background: '#001122' });
  });

  // Ora la dashboard riflette davvero la modifica: --dash-ink/-paper seguono i token.
  await expect(async () => {
    const after = await read();
    expect(after.ink.toLowerCase()).toBe('#ff0000');
    expect(after.paper.toLowerCase()).toBe('#001122');
  }).toPass({ timeout: 4_000 });

  // E il colore effettivo del testo di una bolla risolve al rosso (non solo la var).
  const bubbleRed = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--dash-ink)';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(bubbleRed.replace(/\s/g, '')).toBe('rgb(255,0,0)');
});
