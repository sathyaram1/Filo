// L'elenco degli utenti nella chat della home, per chi gestisce Filo (#679).
//
// Arriva a pagine da cinquanta col totale vero: la riga deve dire quanti sono
// in tutto, quali sta mostrando e come vedere i prossimi — altrimenti con più
// di cinquanta iscritti l'owner ne vede cinquanta e non sa che ce ne sono altri.
//
// Il main qui è finto (il comando è dell'owner e la sessione di prova non lo è):
// si guarda cosa vede chi scrive il comando.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Centoventi iscritti finti, serviti a pagine dal main finto.
async function finteRisposte(page) {
  await page.evaluate(() => {
    const tutti = Array.from({ length: 120 }, (_, i) => ({
      email: `utente${String(i).padStart(3, '0')}@esempio.it`,
      name: '',
      balance: 100 + i,
    }));
    const vero = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === 'owner_list_users') {
        const dopo = String(msg.after || '');
        const trovati = tutti.filter((u) => u.email.startsWith(String(msg.cerca || '')));
        const pagina = trovati.filter((u) => !dopo || u.email > dopo).slice(0, 50);
        const r = {
          ok: true,
          users: pagina,
          total: trovati.length,
          next: pagina.length >= 50 ? pagina[pagina.length - 1].email : '',
        };
        if (cb) { cb(r); return; }
        return Promise.resolve(r);
      }
      return vero(msg, cb);
    };
  });
}

async function scrivi(page, testo) {
  await page.fill('#input', testo);
  await page.press('#input', 'Enter');
}

test('l’elenco degli utenti dice quanti sono, quali mostra e come vedere gli altri', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await finteRisposte(page);

  await scrivi(page, '/users');
  const bolle = page.locator('#bubbles');
  await expect(bolle).toContainText('Utenti registrati 1-50 di 120', { timeout: 8000 });
  await expect(bolle).toContainText('utente000@esempio.it');
  await expect(bolle).toContainText('utente049@esempio.it');
  await expect(bolle).not.toContainText('utente050@esempio.it');
  await expect(bolle).toContainText('/users altri');
  await page.screenshot({ path: 'tests/.shots/679-utenti-prima-pagina.png', fullPage: false });

  await scrivi(page, '/users altri');
  await expect(bolle).toContainText('Utenti registrati 51-100 di 120', { timeout: 8000 });
  await expect(bolle).toContainText('utente050@esempio.it');

  await scrivi(page, '/users altri');
  await expect(bolle).toContainText('Utenti registrati 101-120 di 120', { timeout: 8000 });
  await expect(bolle).toContainText('utente119@esempio.it');
  await page.screenshot({ path: 'tests/.shots/679-utenti-ultima-pagina.png', fullPage: false });
});

// #679.3 — la centesima persona si guarda scrivendone l'indirizzo, senza
// sfogliare e senza passare dal comando che regala crediti.
test('scrivendo l’indirizzo dopo /users si vede quella persona sola', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await finteRisposte(page);

  await scrivi(page, '/users utente099@esempio.it');
  const bolle = page.locator('#bubbles');
  const ultima = bolle.locator('.dash-bubble-filo').last();
  await expect(ultima).toContainText('utente099@esempio.it — 199 crediti', { timeout: 8000 });
  await expect(ultima).toContainText('Trovato:');
  await expect(bolle).not.toContainText('utente000@esempio.it');
  await page.screenshot({ path: 'tests/.shots/679-3-utenti-cerca.png', fullPage: false });

  await scrivi(page, '/users nessuno@altrove.it');
  await expect(bolle.locator('.dash-bubble-filo').last()).toContainText('Nessun utente', { timeout: 8000 });
});
