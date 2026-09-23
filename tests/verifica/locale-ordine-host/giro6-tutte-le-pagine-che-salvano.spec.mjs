// Sesta volta che rientra la stessa famiglia: una pagina rimanda il
// salvataggio e conta su un avviso d'uscita. Qui si guardano INSIEME tutte le
// pagine che salvano da sole (Preferenze, Opzioni, «Altro» delle Opzioni,
// Editor) e tutte le uscite, invece di una porta per giro.

import { _electron as electron } from '@playwright/test';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const OPZIONI = 'filo://options/options.html';
const ALTRO = 'filo://options/altro.html';
const PREFERENZE = 'filo://preferences/preferences.html';
const EDITOR = 'filo://editor/editor.html';
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());

// ─── Opzioni: un campo ancora sotto il cursore ──────────────────────────────
// La pagina non ha il pulsante «Salva»: quello che si scrive deve arrivare a
// destinazione anche se si chiude la scheda senza prima uscire dal campo.

test('Opzioni: il limite di spesa appena digitato non si perde chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(OPZIONI);
  await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });
  await page.click('#monthlyLimit');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('47');

  await chiudiScheda(shell, 'options/options.html');

  await expect
    .poll(() => impostazioni(app).then((s) => s.monthlyLimitEur), {
      timeout: 8000,
      message: 'chiudendo la scheda col cursore ancora nel campo, il limite appena scritto sparisce',
    })
    .toBe(47);
});

// Controllo: uscendo dal campo prima di chiudere, la stessa strada salva.
// Serve a distinguere «si perde» da «il test guarda nel posto sbagliato».
test('Opzioni: uscendo dal campo prima di chiudere, il limite c\'è', async ({ app, shell, openTab }) => {
  const page = await openTab(OPZIONI);
  await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });
  await page.click('#monthlyLimit');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('48');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1200);

  await chiudiScheda(shell, 'options/options.html');
  await expect.poll(() => impostazioni(app).then((s) => s.monthlyLimitEur), { timeout: 8000 }).toBe(48);
});

// La pagina gemella, le Preferenze, salva a ogni tasto: stessa prova, stessa
// attesa. Se questa passa e quella sopra no, le due strade divergono.
test('Preferenze: lo stile appena digitato non si perde chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await page.click('#agentStyleText');
  await page.keyboard.type('scritto e chiuso subito');

  await chiudiScheda(shell, 'preferences');

  await expect
    .poll(() => impostazioni(app).then((s) => s.agentStyle || ''), { timeout: 8000 })
    .toBe('scritto e chiuso subito');
});

// ─── «Altro» delle Opzioni: i domini esclusi ────────────────────────────────

async function scriviBlocklist(page, testo) {
  await page.waitForSelector('#blocklist', { timeout: 15_000 });
  await page.evaluate((t) => {
    const el = document.getElementById('blocklist');
    el.value = t;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, testo);
}

// Scritto col cursore ancora dentro la casella: è il gesto vero, e non dipende
// da quanto ci mette la scheda a sparire.
test('Altro: i domini esclusi appena scritti non si perdono chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(ALTRO);
  await page.waitForSelector('#blocklist', { timeout: 15_000 });
  await page.click('#blocklist');
  await page.keyboard.type('esempio-escluso.test');

  await chiudiScheda(shell, 'options/altro.html');

  await expect
    .poll(() => impostazioni(app).then((s) => (s.blocklist || []).join(',')), {
      timeout: 8000,
      message: 'chiudendo la scheda dentro l\'attesa del salvataggio, i domini esclusi spariscono',
    })
    .toBe('esempio-escluso.test');
});

test('Altro: la conferma «Salvato» si spegne appena arriva un\'altra modifica', async ({ openTab }) => {
  const page = await openTab(ALTRO);
  await scriviBlocklist(page, 'primo.test');
  const acceso = () => page.evaluate(() => document.getElementById('savedHint').classList.contains('sn-show'));
  await expect.poll(acceso, { timeout: 6000 }).toBe(true);

  await scriviBlocklist(page, 'primo.test\nsecondo.test');
  await page.waitForTimeout(150);
  expect(await acceso(),
    'la conferma resta accesa mentre la modifica nuova non è ancora salvata')
    .toBe(false);
});

// ─── Editor: il documento dell'utente ───────────────────────────────────────

async function scriviNelDocumento(page, testo) {
  await page.waitForSelector('#doc', { timeout: 20_000 });
  await page.click('#doc');
  await page.keyboard.type(testo);
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 5000 }).toContain(testo);
}

const testoDoc = (page) => page.locator('#doc').innerText();

test('Editor: il testo appena scritto non si perde chiudendo la scheda', async ({ shell, openTab }) => {
  const page = await openTab(EDITOR);
  await scriviNelDocumento(page, 'ultima frase scritta prima di chiudere');

  await chiudiScheda(shell, 'editor');
  await new Promise((r) => setTimeout(r, 1500));

  const riaperto = await openTab(EDITOR);
  await riaperto.waitForSelector('#doc', { timeout: 20_000 });
  await expect
    .poll(() => testoDoc(riaperto), {
      timeout: 8000,
      message: 'chiudendo la scheda subito dopo aver scritto, l\'ultima frase del documento sparisce',
    })
    .toContain('ultima frase scritta prima di chiudere');
});

// Controllo: con due secondi di pausa lo stesso testo resta.
test('Editor: aspettando un attimo prima di chiudere, il testo c\'è', async ({ shell, openTab }) => {
  const page = await openTab(EDITOR);
  await scriviNelDocumento(page, 'frase scritta con calma');
  await page.waitForTimeout(2000);

  await chiudiScheda(shell, 'editor');
  await new Promise((r) => setTimeout(r, 1500));

  const riaperto = await openTab(EDITOR);
  await riaperto.waitForSelector('#doc', { timeout: 20_000 });
  await expect.poll(() => testoDoc(riaperto), { timeout: 8000 }).toContain('frase scritta con calma');
});

// L'uscita più brusca: si scrive e si spegne Filo. Serve una cartella dati che
// sopravviva alla chiusura, quindi l'app si apre a mano.
async function scriviNelDocumentoEspegni(testo, attesaMs) {
  const userData = cartellaTemporanea('filo-test-editor-uscita-');
  const avvia = async () => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: RADICE,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
    },
  });
  const apriEditor = async (app) => {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), EDITOR);
    const scadenza = Date.now() + 20_000;
    let page = null;
    while (Date.now() < scadenza) {
      page = app.windows().find((w) => w.url().includes('editor'));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(page, 'la scheda dell\'editor non si è aperta').toBeTruthy();
    return page;
  };

  let app = await avvia();
  try {
    const page = await apriEditor(app);
    await scriviNelDocumento(page, testo);
    if (attesaMs) await page.waitForTimeout(attesaMs);
  } finally {
    await chiudiApp(app);
  }

  app = await avvia();
  let ritrovato = '';
  try {
    const page = await apriEditor(app);
    await page.waitForSelector('#doc', { timeout: 20_000 });
    await page.waitForTimeout(800);
    ritrovato = await testoDoc(page);
  } finally {
    await chiudiApp(app);
  }
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  return ritrovato;
}

test('Editor: spegnendo Filo subito dopo aver scritto, il testo non si perde', async () => {
  test.setTimeout(180_000);
  const atteso = 'scritto e poi spengo Filo';
  expect(await scriviNelDocumentoEspegni(atteso, 0),
    'spegnendo Filo subito dopo aver scritto, l\'ultima frase del documento sparisce')
    .toContain(atteso);
});

test('Editor: aspettando un attimo prima di spegnere Filo, il testo c\'è', async () => {
  test.setTimeout(180_000);
  const atteso = 'scritto, aspetto, poi spengo Filo';
  expect(await scriviNelDocumentoEspegni(atteso, 2500),
    'il testo non arriva nemmeno con la pausa').toContain(atteso);
});
