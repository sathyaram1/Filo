// Comandi extra della dashboard + colorazione live senza flicker.
//
// FEEDBACK alpha:
//  - "/set timer 5:00 (o solo minuti, es. /set timer 8)" → avvia un timer.
//  - "/incognito" → apre una finestra in incognito.
//  - "il controllo dei comandi lampeggia: mentre scrivo un /comando che viene
//     verificato torna a neutro a ogni tasto. Tienilo rosso mentre c'è il
//     controllo." → in modalità terminale lo stato 'pending' ora è già rosso.
//
// I test ASSERISCONO il successo della feature (il timer compare, la finestra
// incognito si apre, la classe rossa c'è subito), non l'assenza di un errore.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function submit(page, command) {
  await page.evaluate((cmd) => {
    const input = document.getElementById('input');
    const form = document.getElementById('inputForm');
    input.value = cmd;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, command);
}

test('"/set timer 1" avvia un timer e lo mostra nell\'area live', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  // "/set timer 8" è riconosciuto come comando Filo (arancione), non rosso,
  // anche con gli argomenti.
  await input.fill('/set timer 8');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);

  // Inviando "/set timer 1" compare un timer "Timer" nell'area live con il
  // conto alla rovescia (~1:00).
  await submit(page, '/set timer 1');
  const card = page.locator('#live .dash-live-card');
  await expect(card).toHaveCount(1, { timeout: 8_000 });
  await expect(card.locator('.dash-live-text')).toContainText('Timer');
  await expect(card.locator('.dash-live-text')).toContainText(/\d:\d\d/);
});

test('"/set timer 5:00" interpreta minuti:secondi', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  await submit(page, '/set timer 5:00');
  const card = page.locator('#live .dash-live-card');
  await expect(card).toHaveCount(1, { timeout: 8_000 });
  // 5 minuti → il countdown parte vicino a 5:00 (4:59/5:00).
  await expect(card.locator('.dash-live-text')).toContainText(/[45]:\d\d/);
});

test('"/set timer" senza durata valida non crea timer e spiega l\'uso', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  await submit(page, '/set timer abc');
  // Nessun timer creato.
  await expect(page.locator('#live .dash-live-card')).toHaveCount(0);
  // Filo risponde con l'uso corretto nel thread.
  await expect(page.locator('.dash-bubble')).toContainText(/set timer/i, { timeout: 8_000 });
});

test('"/incognito" apre una finestra in incognito', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  // "/incognito" è un comando Filo riconosciuto (arancione).
  await input.fill('/incognito');
  await expect(input).toHaveClass(/is-cmd-filo/);

  await submit(page, '/incognito');

  // Il main crea una finestra incognito (TabManager effimero).
  const deadline = Date.now() + 15_000;
  let info = null;
  while (Date.now() < deadline) {
    info = await app.evaluate(({ BrowserWindow }) => {
      const incog = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
      if (!incog) return null;
      return { count: BrowserWindow.getAllWindows().length, incognito: !!(incog._filoTabs && incog._filoTabs.incognito) };
    });
    if (info) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  expect(info, 'la finestra incognito deve aprirsi').toBeTruthy();
  expect(info.incognito).toBe(true);
});

test('terminale: un "/comando" in verifica è già rosso (niente flicker a neutro)', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  // Attiva la modalità terminale via broadcast impostazioni.
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('newtab') || url.includes('dashboard')) {
        wc.send('filo:broadcast', {
          type: 'settings_updated',
          settings: { terminal: { enabled: true, shell: 'bash' } },
        });
      }
    }
  });
  await expect(input).toHaveAttribute('placeholder', /comando per la shell/, { timeout: 8_000 });

  // Digita un comando non ancora verificato e leggi la classe SUBITO dopo il
  // gestore 'input' (sincrono), PRIMA che parta il controllo "esiste?" con
  // debounce. Senza il fix lo stato 'pending' non riceveva colore (neutro):
  // il rosso sarebbe comparso solo ~250ms dopo, da cui il flicker.
  const cls = await page.evaluate(() => {
    const i = document.getElementById('input');
    i.value = '/zzqzx';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return i.className; // letto in modo sincrono
  });
  expect(cls).toMatch(/is-cmd-unknown/);
});
