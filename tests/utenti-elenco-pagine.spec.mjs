// L'elenco delle persone nella chat della home, per chi gestisce Filo (#679, per pseudonimo dal #895).
//
// Arriva a pagine da cinquanta col totale vero: la riga deve dire quante sono
// in tutto, quali sta mostrando e come vedere le prossime — altrimenti con più
// di cinquanta portafogli l'owner ne vede cinquanta e non sa che ce ne sono altri.
//
// La vista del portafoglio qui è finta (il comando è dell'owner e la sessione di
// prova non lo è): si guarda cosa vede chi scrive il comando. Il giro col main
// vero, con poche persone, sta in regalo-per-pseudonimo.spec.mjs.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Sedici cifre esadecimali come gli pseudonimi veri; la persona 0 è la più nuova.
const pseudo = (i) => `${(0x1000 + i).toString(16)}c0ffee12abcd`;

// Centoventi persone con un portafoglio, servite dalla vista finta.
async function vistaFinta(page) {
  await page.evaluate((tutte) => {
    const vero = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === window.SN_MSG.MSG.WALLET_OWNER_OVERVIEW) {
        const r = { ok: true, overview: { users: tutte } };
        if (cb) { cb(r); return; }
        return Promise.resolve(r);
      }
      return vero(msg, cb);
    };
  }, Array.from({ length: 120 }, (_, i) => ({
    pseudonym: pseudo(i),
    balance: { credits: 100 + i },
    invitedBy: 'owner',
    createdAt: new Date(Date.UTC(2026, 8, 1) - i * 60_000).toISOString(),
  })));
}

async function scrivi(page, testo) {
  await page.fill('#input', testo);
  await page.press('#input', 'Enter');
}

test('l’elenco delle persone dice quante sono, quali mostra e come vedere le altre', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await vistaFinta(page);
  const bolle = page.locator('#bubbles');
  const ultima = () => bolle.locator('.dash-bubble-filo').last();

  await scrivi(page, '/users');
  await expect(ultima()).toContainText('Persone con un portafoglio 1-50 di 120', { timeout: 8000 });
  await expect(ultima()).toContainText(`• ${pseudo(0)} — 100 crediti, invitata da te`);
  await expect(ultima()).toContainText(pseudo(49));
  await expect(ultima()).not.toContainText(pseudo(50));
  await expect(ultima()).toContainText('/users altri');
  expect(await ultima().innerText()).not.toContain('@');
  await page.screenshot({ path: 'tests/.shots/679-utenti-prima-pagina.png', fullPage: false });

  await scrivi(page, '/users altri');
  await expect(ultima()).toContainText('Persone con un portafoglio 51-100 di 120', { timeout: 8000 });
  await expect(ultima()).toContainText(pseudo(50));

  await scrivi(page, '/users altri');
  await expect(ultima()).toContainText('Persone con un portafoglio 101-120 di 120', { timeout: 8000 });
  await expect(ultima()).toContainText(`• ${pseudo(119)} — 219 crediti`);
  await expect(ultima()).not.toContainText('/users altri');
  await page.screenshot({ path: 'tests/.shots/679-utenti-ultima-pagina.png', fullPage: false });

  await scrivi(page, '/users altri');
  await expect(ultima()).toContainText('Non ho altre persone da mostrare', { timeout: 8000 });
});

// #679.3 — la centesima persona si guarda scrivendone l'inizio dello pseudonimo,
// senza sfogliare e senza passare dal comando che regala crediti.
test('scrivendo l’inizio dello pseudonimo dopo /users si vede quella persona sola', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await vistaFinta(page);
  const bolle = page.locator('#bubbles');
  const ultima = () => bolle.locator('.dash-bubble-filo').last();

  await scrivi(page, `/users ${pseudo(99).slice(0, 6).toUpperCase()}`);
  await expect(ultima()).toContainText(`${pseudo(99)} — 199 crediti`, { timeout: 8000 });
  await expect(ultima()).toContainText('Trovata:');
  await expect(bolle).not.toContainText(pseudo(0));
  await page.screenshot({ path: 'tests/.shots/679-3-utenti-cerca.png', fullPage: false });

  await scrivi(page, '/users ffff');
  await expect(ultima()).toContainText('Non trovo uno pseudonimo che comincia per «ffff»', { timeout: 8000 });

  // L'indirizzo email non arriva all'owner: lo dice invece di cercare a vuoto.
  await scrivi(page, '/users utente099@esempio.it');
  await expect(ultima()).toContainText('si cercano per pseudonimo', { timeout: 8000 });
});
