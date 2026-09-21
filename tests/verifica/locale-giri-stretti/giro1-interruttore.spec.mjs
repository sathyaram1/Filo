// Prove del giro 1 (verifica locale) sul lavoro «giri stretti»: l'interruttore
// «Giro stretto dopo una correzione» in Gestione → Automazioni, usato come lo
// userebbe l'owner. La config del server è finta (stub del messaggio al main).

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function apri(openTab, iniziale) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.evaluate((init) => {
    window.__cfg = { ...init };
    window.__sets = [];
    window.__ritardi = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_caps_get') {
        if (window.__getFail) return { ok: false, error: 'rete giù' };
        return { ok: true, ...window.__cfg };
      }
      if (msg && msg.type === 'automation_caps_set') {
        const { type, ...campi } = msg;
        window.__sets.push(campi);
        const attesa = window.__ritardi.shift() || 0;
        if (attesa) await new Promise((r) => setTimeout(r, attesa));
        if (window.__setFail) return { ok: false, error: 'finto guasto' };
        for (const [k, v] of Object.entries(campi)) if (v !== undefined) window.__cfg[k] = v;
        return { ok: true, ...window.__cfg };
      }
      return orig(msg);
    };
  }, iniziale);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  return page;
}

const daOwner = async (page) => {
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadCaps());
};

test('spento di serie, in sola lettura per chi non è owner, e l’owner lo accende e lo spegne', async ({ openTab }) => {
  const page = await apri(openTab, { cap2: 5, cap1: 1, cap0: 0, fixInstructions: '' }); // config senza il campo
  const giro = page.locator('#mgGiroStretto');
  const etichetta = page.locator('#mgGiroStrettoSwitch');
  await expect(etichetta).toBeVisible();
  await expect(etichetta).toContainText('Giro stretto dopo una correzione');
  await expect(giro).not.toBeChecked();
  await expect(giro).toBeDisabled();

  await daOwner(page);
  await expect(giro).toBeEnabled();
  await expect(giro).not.toBeChecked(); // campo assente sul server = spento

  await etichetta.click();
  await expect(page.locator('#mgGiroStrettoMsg')).toHaveText('Salvato.');
  await expect(giro).toBeChecked();
  // Scrive SOLO il suo campo: accenderlo non riscrive i bilanci.
  const sets = await page.evaluate(() => window.__sets);
  expect(sets).toHaveLength(1);
  expect(Object.entries(sets[0]).filter(([, v]) => v !== undefined)).toEqual([['giroStretto', true]]);

  // Riletto dal server resta acceso (la pagina riaperta lo mostra com'è).
  await page.evaluate(() => window.__mgTest.loadCaps());
  await expect(giro).toBeChecked();

  // Salvare un bilancio non lo tocca.
  await page.locator('#mgCap2').fill('4');
  await page.locator('#mgCap2Save').click();
  await expect(page.locator('#mgCap2Msg')).toHaveText('Salvato.');
  expect(await page.evaluate(() => window.__cfg.giroStretto)).toBe(true);
  await expect(giro).toBeChecked();

  // Ciò che si accende si spegne, anche da tastiera.
  await giro.focus();
  await page.keyboard.press('Space');
  await expect(giro).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__cfg.giroStretto)).toBe(false);
});

test('un salvataggio fallito rimette l’interruttore dov’era e lo dice', async ({ openTab }) => {
  const page = await apri(openTab, { cap2: 5, cap1: 1, cap0: 0, fixInstructions: '', giroStretto: false });
  await daOwner(page);
  const giro = page.locator('#mgGiroStretto');
  await page.evaluate(() => { window.__setFail = true; });
  await page.locator('#mgGiroStrettoSwitch').click();
  await expect(page.locator('#mgGiroStrettoMsg')).toContainText('NON è cambiata');
  await expect(giro).not.toBeChecked();
  // Riprovando a guasto passato funziona, e il messaggio d'errore sparisce.
  await page.evaluate(() => { window.__setFail = false; });
  await page.locator('#mgGiroStrettoSwitch').click();
  await expect(page.locator('#mgGiroStrettoMsg')).toHaveText('Salvato.');
  await expect(giro).toBeChecked();
});

test('clic in fretta: quello che si vede alla fine è quello che sta sul server', async ({ openTab }) => {
  const page = await apri(openTab, { cap2: 5, cap1: 1, cap0: 0, fixInstructions: '', giroStretto: false });
  await daOwner(page);
  const giro = page.locator('#mgGiroStretto');
  // Il primo salvataggio è lento, il secondo veloce: le risposte tornano in ordine inverso.
  await page.evaluate(() => { window.__ritardi = [400, 0]; });
  await page.locator('#mgGiroStrettoSwitch').click(); // acceso (lento)
  await page.locator('#mgGiroStrettoSwitch').click(); // spento (veloce)
  await page.waitForTimeout(900);
  const sulServer = await page.evaluate(() => window.__cfg.giroStretto);
  expect(await giro.isChecked()).toBe(sulServer);
});

test('config non letta: l’interruttore non si mostra spento come se lo dicesse il server', async ({ openTab }) => {
  const page = await apri(openTab, { cap2: 5, cap1: 1, cap0: 0, fixInstructions: '', giroStretto: true });
  await daOwner(page);
  const giro = page.locator('#mgGiroStretto');
  await expect(giro).toBeChecked();
  // La rilettura fallisce: resta com'era, non torna «spento».
  await page.evaluate(() => { window.__getFail = true; });
  await page.evaluate(() => window.__mgTest.loadCaps());
  await expect(giro).toBeChecked();
});

test('nei due temi si legge e si vede: schermate in tests/.shots', async ({ openTab }) => {
  const page = await apri(openTab, { cap2: 5, cap1: 1, cap0: 0, fixInstructions: '', giroStretto: true });
  await daOwner(page);
  for (const tema of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } });
    }, tema);
    await page.waitForTimeout(400);
    await page.locator('#mgGiroStrettoBlock').scrollIntoViewIfNeeded();
    const c = await page.locator('#mgGiroStrettoSwitch .mg-switch-text').evaluate((el) => ({
      testo: getComputedStyle(el).color, sfondo: getComputedStyle(document.body).backgroundColor,
    }));
    expect(c.testo, `tema ${tema}`).not.toBe(c.sfondo);
    await page.screenshot({ path: `tests/.shots/verifica-giri-stretti-${tema}.png` });
  }
  // Il passaggio del mouse spiega cosa fa (pagina visitata di rado: un hover ci sta).
  await expect(page.locator('#mgGiroStrettoSwitch')).toHaveAttribute('title', /dopo una correzione/);
});
