// #726 — primo giro di verifica. La lamentela: dopo un cambio d'aspetto la
// risposta metteva un bottone per impostazione cambiata, ma tutti col solo
// verbo («Scegli il colore esatto»), quindi indistinguibili. Qui si prova il
// SUCCESSO: ogni bottone dice QUALE impostazione regola, su strade che il
// lavoro non nominava (tipi misti, tema scuro, cambio che chiede conferma).

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Risposta finta del modello: una bolla con le azioni estetiche date.
async function rispostaCon(page, actions, testo = 'Fatto.') {
  await page.evaluate(({ actions: acts, testo: t }) => {
    const { MSG } = window.SN_MSG;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === MSG.FILO_CHAT) { cb && cb({ ok: true, text: t, actions: acts }); return; }
      if (msg && msg.type === MSG.UPDATE_SETTINGS) { cb && cb({ ok: true }); return; }
      return orig(msg, cb);
    };
  }, { actions, testo });
}

async function chiedi(page, frase) {
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(frase);
  await page.locator('#sendBtn').click();
}

// ── A. Tipi MISTI: colori, font, misura, opacità nella stessa risposta ──────
// Col solo verbo qui i bottoni sarebbero stati «Scegli il colore esatto» due
// volte più «Regola la dimensione»: due colori ancora indistinguibili.
test('A — tipi misti: ogni bottone porta il nome della sua impostazione e apre QUEL controllo', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await rispostaCon(page, [
    { type: 'IMPOSTA_ESTETICA', token: 'background', valore: '#efe6d2' },
    { type: 'IMPOSTA_ESTETICA', token: 'hover', valore: '#d9c9a4' },
    { type: 'IMPOSTA_ESTETICA', token: 'font', valore: 'Georgia, serif' },
    { type: 'IMPOSTA_ESTETICA', token: 'radius', valore: '2px' },
    { type: 'IMPOSTA_ESTETICA', token: 'selection.opacity', valore: '0.5' },
  ]);
  await chiedi(page, 'fammi Filo piu’ retro’');

  const triggers = page.locator('.sn-refine-trigger');
  await expect(triggers).toHaveCount(5, { timeout: 10_000 });
  const nomi = (await triggers.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  expect(new Set(nomi).size).toBe(5);
  for (const atteso of ['Colore di sfondo', 'Sfondo al passaggio del mouse', 'Font della UI', 'Raggio degli angoli', 'Opacità della selezione']) {
    expect(nomi.some((n) => n.includes(atteso))).toBe(true);
  }

  await page.screenshot({ path: 'tests/.shots/726-misti.png' });

  // Ogni bottone apre il box della SUA impostazione: il nome non basta se poi
  // il controllo che si apre e' di un'altra.
  for (const atteso of ['Font della UI', 'Raggio degli angoli', 'Opacità della selezione', 'Sfondo al passaggio del mouse']) {
    await triggers.filter({ hasText: atteso }).first().click();
    await expect(page.locator('.sn-refine-title')).toHaveText(`Regola: ${atteso}`, { timeout: 8_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-refine-overlay')).toHaveCount(0, { timeout: 8_000 });
  }
});

// ── B. Tema scuro: i nomi si leggono e i campioni si vedono ────────────────
test('B — tema scuro: i cinque nomi si leggono e ogni campione porta il suo colore', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } });
  });
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 8_000 });

  await rispostaCon(page, [
    { type: 'IMPOSTA_ESTETICA', token: 'background', valore: '#2b2118' },
    { type: 'IMPOSTA_ESTETICA', token: 'text', valore: '#f2e6c9' },
    { type: 'IMPOSTA_ESTETICA', token: 'accent', valore: '#c98a3b' },
    { type: 'IMPOSTA_ESTETICA', token: 'border', valore: '#6b5636' },
    { type: 'IMPOSTA_ESTETICA', token: 'topbar', valore: '#3a2d1f' },
  ]);
  await chiedi(page, 'fammi Filo piu’ retro’');

  const triggers = page.locator('.sn-refine-trigger');
  await expect(triggers).toHaveCount(5, { timeout: 10_000 });
  const nomi = (await triggers.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  expect(new Set(nomi).size).toBe(5);

  // Il nome deve essere LEGGIBILE: testo e sfondo del bottone non coincidono.
  const leggibile = await triggers.first().evaluate((el) => {
    const s = getComputedStyle(el);
    const t = el.querySelector('.sn-refine-trigger-name');
    return { colore: getComputedStyle(t).color, sfondo: s.backgroundColor, testo: t.textContent.trim() };
  });
  expect(leggibile.testo.length).toBeGreaterThan(3);
  expect(leggibile.colore).not.toBe(leggibile.sfondo);

  // Cinque campioni, cinque colori: e' il secondo modo di dire quale e' quale.
  const campioni = await page.locator('.sn-refine-trigger-swatch').evaluateAll(
    (els) => els.map((e) => ({ bg: getComputedStyle(e).backgroundColor, w: e.getBoundingClientRect().width })),
  );
  expect(campioni).toHaveLength(5);
  expect(new Set(campioni.map((c) => c.bg)).size).toBe(5);
  for (const c of campioni) expect(c.w).toBeGreaterThan(4);

  await page.screenshot({ path: 'tests/.shots/726-scuro.png' });

  // Col mouse sopra la pillola si inverte: il campione deve restare distinguibile
  // dal fondo, se no il secondo indizio sparisce proprio mentre si sta per cliccare.
  await triggers.filter({ hasText: 'Colore del testo' }).first().hover();
  await page.screenshot({ path: 'tests/.shots/726-scuro-hover.png' });
});

// ── C. Cambio che chiede conferma: anche li' il bottone ha un nome ─────
// Un colore di testo illeggibile sale a livello 2: l'utente conferma, e solo
// dopo compare il bottone. E' la stessa strada, con una porta in piu'.
test('C — dopo la conferma di un cambio rischioso il bottone dice l\u2019impostazione', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await rispostaCon(page, [
    { type: 'IMPOSTA_ESTETICA', token: 'accent', valore: '#8a5a2b' },
    { type: 'IMPOSTA_ESTETICA', token: 'text', valore: '#f8f6f0', _illegible: true, _confirm: { level: 2, text: 'Cambiare \u201cColore del testo\u201d a #f8f6f0 renderebbe il testo quasi illeggibile (colore troppo vicino allo sfondo). Applico comunque?' } },
  ]);
  await chiedi(page, 'scrivi tutto in bianco');

  // Il popup di conferma compare (il suo DOM sta in una radice chiusa: si
  // guida da tastiera, col bottone OK gia' a fuoco).
  await expect(page.locator('.sn-confirm-host')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Enter');

  // Applicata: ora ci sono DUE bottoni e ognuno dice la sua impostazione.
  const triggers = page.locator('.sn-refine-trigger');
  await expect(triggers).toHaveCount(2, { timeout: 10_000 });
  const nomi = (await triggers.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  expect(nomi.some((n) => n.includes("Colore d'accento"))).toBe(true);
  expect(nomi.some((n) => n.includes('Colore del testo'))).toBe(true);

  await triggers.filter({ hasText: 'Colore del testo' }).first().click();
  await expect(page.locator('.sn-refine-title')).toHaveText('Regola: Colore del testo', { timeout: 8_000 });
});
