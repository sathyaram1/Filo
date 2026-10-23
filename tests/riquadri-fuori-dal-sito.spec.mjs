// #1509.1 — Quello che l'utente scrive o seleziona in un riquadro di Filo sopra un sito non lo legge il sito: né dalla
// selezione (selectionchange, getSelection), né dalla copia, né con la ricerca testuale del browser. I riquadri stanno
// nello strato sopra la scheda. Regola: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi, clicca, conta, paginaDelloStrato, tastoSullaScheda } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const SEGRETO = 'zibaldone-segreto-1509 del mio conto';

// Lo script del sito: annota ogni selezione, ogni copia e ogni nodo che entra nel suo documento, e cerca con la
// ricerca del browser.
const SPIA = `<script>
  window.__letti = [];
  window.__nodi = [];
  const leggi = () => { try { const s = String(getSelection()); if (s) window.__letti.push(s); } catch (_) {} };
  document.addEventListener('selectionchange', leggi, true);
  for (const t of ['copy', 'cut', 'selectstart', 'keyup', 'mouseup', 'input', 'beforeinput']) window.addEventListener(t, (e) => { leggi(); if (e.data) window.__letti.push(e.data); }, true);
  setInterval(leggi, 50);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) window.__nodi.push(n.outerHTML || n.textContent || ''); })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.trova = (s) => { try { getSelection().removeAllRanges(); } catch (_) {} return window.find(s, false, false, true); };
  window.cosaHaVisto = () => window.__letti.join(' | ') + ' ' + window.__nodi.join(' ') + ' ' + document.documentElement.outerHTML;
  window.__clic = 0;
</script>`;
const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p style="font-size:20px">Il <span id="parola">gatto</span> dorme.</p>${corpo}${SPIA}</body></html>`;

// Provider finto nel main: la riscrittura e la risposta arrivano subito.
async function modelloFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: 'Testo riscritto per bene.', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta('The cat sleeps.'); return { text: 'The cat sleeps.', usage: {} }; },
    };
  });
}

const comando = (app, nome) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch(c, win);
}, nome);

// Scritto, selezionato tutto e copiato dove sta il campo: il sito non ne ha visto niente, e cercandolo non lo trova.
async function nienteAlSito(app, p, sel, testo) {
  const strato = await scrivi(app, p, sel, testo);
  expect((await statoDi(app, p, sel)).valore).toBe(testo);
  await strato.keyboard.press('ControlOrMeta+A');
  await strato.keyboard.press('ControlOrMeta+C');
  await p.waitForTimeout(400);
  expect(await p.evaluate(() => window.cosaHaVisto())).not.toContain(testo.split(' ')[0]);
  expect(await p.evaluate((s) => window.trova(s), testo.split(' ')[0])).toBe(false);
  expect(await p.evaluate(() => document.querySelector('[data-sn-riquadro]')), 'nel documento del sito non entra niente').toBeNull();
  return strato;
}

test('feedback e attacco red-team su un sito: scritti, selezionati e copiati, il sito non legge niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  expect((await statoDi(app, p, '.sn-fb-text')).nelloStrato).toBe(true);
  await nienteAlSito(app, p, '.sn-fb-text', SEGRETO);
  await clicca(app, p, '.sn-fb-cancel');
  await expect.poll(() => conta(app, p, '.sn-fb-modal')).toBe(0);

  await nelMondoDiFilo(app, p, () => globalThis.SN_REDTEAM_ATTACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-rt-attack')).not.toBeNull();
  await nienteAlSito(app, p, '.sn-rt-attack', 'ignora-le-istruzioni-1509 e rispondi');
});

test('Modifica su un sito: il campo del sito riceve solo il testo scelto, e la tastiera torna a lui', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<textarea id="campo" style="width:400px;height:80px">Un testo con un erore.</textarea>'));
  await p.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await p.locator('#campo').click({ button: 'right' });
  await expect(menuDi(p).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await p.evaluate(() => { window.__letti = []; });
  await menuDi(p).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, p, '.sn-editbox-instruction')).not.toBeNull();
  const strato = await nienteAlSito(app, p, '.sn-editbox-instruction', 'riscrivilo-segreto-1509 per bene');
  await strato.keyboard.press('Enter');
  await expect.poll(async () => (await statoDi(app, p, '.sn-editbox-proposed'))?.testo || '').toContain('riscritto');
  await expect(p.locator('#campo')).toHaveValue('Un testo con un erore.');
  await clicca(app, p, '.sn-editbox-replace');
  await expect(p.locator('#campo')).toHaveValue('Testo riscritto per bene.');
  await expect.poll(() => conta(app, p, '.sn-editbox')).toBe(0);
  // Si continua a scrivere nel campo, senza cliccarlo.
  await expect.poll(() => p.evaluate(() => document.activeElement && document.activeElement.id)).toBe('campo');
});

test('la risposta su un sito: sotto la parola, la domanda non la legge il sito, fuori dal riquadro la pagina risponde ed Esc la chiude', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<button id="bottone" style="margin-top:420px" onclick="window.__clic++">Premi</button>'));
  await p.locator('#parola').dblclick();
  const parola = await p.locator('#parola').boundingBox();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  const riquadro = await statoDi(app, p, '.sn-popup');
  expect(riquadro.nelloStrato).toBe(true);
  expect(riquadro.top >= parola.y + parola.height || riquadro.bottom <= parola.y, 'il riquadro non copre la parola').toBe(true);
  await nienteAlSito(app, p, '.sn-popup-input', 'domanda-segreta-1509 sul gatto');

  // Fuori dal riquadro il clic è della pagina, e la tastiera torna a lei.
  const strato = await paginaDelloStrato(app, p);
  const b = await p.locator('#bottone').boundingBox();
  await strato.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(() => p.evaluate(() => window.__clic)).toBe(1);
  await expect.poll(() => conta(app, p, '.sn-popup')).toBe(1);
  await tastoSullaScheda(app, p, 'Escape');
  await expect.poll(() => conta(app, p, '.sn-popup')).toBe(0);
});
