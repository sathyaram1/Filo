// Stessa famiglia del giro scorso, l'altra metà: campi che diventano una
// modifica solo quando il cursore ne esce. L'avviso d'uscita arriva anche qui,
// ma non trova niente da salvare, e quello che si vede sullo schermo sparisce.

import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const CORRETTORE = 'filo://spellcheck/spellcheck.html';

async function chiudiScheda(shell, frammento) {
  const id = await shell.evaluate(async (f) => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    const t = lista.find((x) => (x.url || '').includes(f));
    return t ? t.id : null;
  }, frammento);
  expect(id, `la scheda ${frammento} non compare fra quelle aperte`).toBeTruthy();
  await shell.evaluate((i) => window.filoShell.tabs.close(i), id);
}

// Apre il menu del titolo col tasto destro e sceglie «Rinomina»: è la strada
// dell'utente, non una scorciatoia interna.
async function apriRinomina(page) {
  await page.waitForSelector('#docTitle', { timeout: 20_000 });
  await page.click('#docTitle', { button: 'right' });
  await page.waitForSelector('.ed-title-ctxmenu', { timeout: 5000 });
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).first().click();
  await page.waitForSelector('.ed-doc-title-input', { timeout: 5000 });
}

const titoloMostrato = async (page) => {
  await page.waitForSelector('#docTitle', { timeout: 20_000 });
  return page.locator('#docTitle').innerText();
};

test('Editor: il nome appena scritto per il documento non si perde chiudendo la scheda', async ({ shell, openTab }) => {
  const page = await openTab(EDITOR);
  await apriRinomina(page);
  await page.keyboard.type('nome scritto e chiuso subito');

  await chiudiScheda(shell, 'editor');
  await new Promise((r) => setTimeout(r, 1500));

  const riaperto = await openTab(EDITOR);
  await expect
    .poll(() => titoloMostrato(riaperto), {
      timeout: 8000,
      message: 'chiudendo la scheda col cursore ancora nel campo del nome, il nome nuovo sparisce',
    })
    .toContain('nome scritto e chiuso subito');
});

// Controllo: confermando con Invio prima di chiudere, lo stesso nome resta.
test('Editor: confermando il nome con Invio, il nome c\'è', async ({ shell, openTab }) => {
  const page = await openTab(EDITOR);
  await apriRinomina(page);
  await page.keyboard.type('nome confermato con invio');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  await chiudiScheda(shell, 'editor');
  await new Promise((r) => setTimeout(r, 1500));

  const riaperto = await openTab(EDITOR);
  await expect.poll(() => titoloMostrato(riaperto), { timeout: 8000 }).toContain('nome confermato con invio');
});

// ─── Correttore: una regola già scritta, corretta al volo ───────────────────

const regole = (app) => app.evaluate(async () => {
  const raw = await globalThis.SN_STORAGE.getRaw();
  return (raw && raw.sn_autocorrect) || {};
});

async function aggiungiRegola(page, parola, correzione) {
  await page.waitForSelector('#newWord', { timeout: 20_000 });
  await page.fill('#newWord', parola);
  await page.fill('#newCorrection', correzione);
  await page.click('#addAutocorrect');
  await page.waitForSelector('.sn-spell-row input', { timeout: 5000 });
}

test('Correttore: la correzione appena riscritta non si perde chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(CORRETTORE);
  await aggiungiRegola(page, 'perke', 'perché');
  await expect.poll(() => regole(app).then((r) => r.perke || ''), { timeout: 8000 }).toBe('perché');

  // La riga esiste: adesso la si corregge e si chiude senza uscire dal campo.
  const campoCorrezione = page.locator('.sn-spell-row input').nth(1);
  await campoCorrezione.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('perché sì');

  await chiudiScheda(shell, 'spellcheck');

  await expect
    .poll(() => regole(app).then((r) => r.perke || ''), {
      timeout: 8000,
      message: 'chiudendo la scheda col cursore ancora nel campo, la correzione riscritta sparisce',
    })
    .toBe('perché sì');
});

test('Correttore: uscendo dal campo prima di chiudere, la correzione c\'è', async ({ app, shell, openTab }) => {
  const page = await openTab(CORRETTORE);
  await aggiungiRegola(page, 'qwal', 'qual');
  await expect.poll(() => regole(app).then((r) => r.qwal || ''), { timeout: 8000 }).toBe('qual');

  const campoCorrezione = page.locator('.sn-spell-row input').nth(1);
  await campoCorrezione.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('qual è');
  await page.keyboard.press('Tab');

  await expect.poll(() => regole(app).then((r) => r.qwal || ''), { timeout: 8000 }).toBe('qual è');
  await chiudiScheda(shell, 'spellcheck');
});
