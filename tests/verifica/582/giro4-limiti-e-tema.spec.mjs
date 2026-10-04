// Verifica #582, giro 4 — input limite e tema scuro sulle superfici toccate.
//
// Quello che il lavoro ha cambiato si vede in due posti: la riga con
// l'indirizzo della pagina e le pillole degli allegati (col loro segnaposto).
// Qui si prova che reggono il testo lungo, i nomi assurdi, il campo vuoto e il
// tema scuro — e che nessuna riga esce dal riquadro.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const RIQUADRO = 'filo://feedback/feedback.html';

async function apriCon(page, fb) {
  await page.evaluate((x) => { window.SN_FEEDBACK.list = async () => [x]; }, fb);
  await page.locator('#refresh').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 10_000 });
}

// Nessun elemento sporge in orizzontale dal riquadro della scheda.
async function sbordanti(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.fb-card');
    if (!card) return ['nessuna scheda'];
    const limite = card.getBoundingClientRect().right + 2;
    const fuori = [];
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > limite) {
        fuori.push(`${el.className || el.nodeName} sporge di ${Math.round(r.right - limite)}px`);
      }
    }
    return fuori;
  });
}

test('testo lunghissimo, nome d’allegato lunghissimo, indirizzo al massimo: niente sborda', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await apriCon(page, {
    _id: 'limiti-582',
    status: 'open',
    name: 'X'.repeat(200),
    text: 'parola '.repeat(1430), // ~10.000 caratteri
    url: `https://esempio.invalid/${'z'.repeat(1900)}`, // il tetto del database è 2000
    images: [],
    files: [{ name: 'A'.repeat(4000), url: 'https://esempio.invalid/x.txt', type: 'text/plain' }],
    createdAt: '2026-09-11T10:00:00Z',
  });
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/582-giro4-limiti.png' });
  expect(await sbordanti(page), 'qualcosa esce dal riquadro della scheda').toEqual([]);

  // L'indirizzo mostrato resta corto e dice che è tagliato.
  const scritta = ((await page.locator('.fb-meta a[href^="http"]').first().textContent()) || '').trim();
  expect(scritta.length).toBeLessThanOrEqual(80);
  expect(scritta).toMatch(/[…]/);
});

test('campi vuoti e soli spazi: la scheda si apre lo stesso', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await apriCon(page, {
    _id: 'vuoti-582',
    status: 'open',
    name: '   ',
    text: '   ',
    url: '',
    images: [''],
    files: [{ name: '', url: '', type: '' }],
    createdAt: '2026-09-11T10:00:00Z',
  });
  await expect(page.locator('.fb-meta a[href^="http"]')).toHaveCount(0);
  expect(await sbordanti(page)).toEqual([]);
});

test('tema scuro: indirizzo, pillole e segnaposto restano leggibili', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await page.evaluate(() => { document.documentElement.setAttribute('data-sn-theme', 'dark'); });
  await apriCon(page, {
    _id: 'scuro-582',
    status: 'open',
    name: 'Tema scuro',
    text: 'La pagina non si apre.',
    url: 'https://esempio.invalid/una/pagina/che/non/si/apre?x=1',
    images: ['https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1757000000000_11111111-2222-3333-4444-555555555555.png?alt=media'],
    files: [{ name: 'registro.txt', url: 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1757000000000_11111111-2222-3333-4444-555555555556.txt?alt=media', type: 'text/plain' }],
    createdAt: '2026-09-11T10:00:00Z',
  });
  // Il segnaposto dell'immagine e la nota della pillola arrivano dal main.
  await expect(page.locator('.fb-img-broken')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.fb-file-note')).toHaveCount(1, { timeout: 10_000 });
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/582-giro4-scuro.png' });
  expect(await sbordanti(page)).toEqual([]);
});

test('clic ripetuti in fretta su una pillola: nessun errore, la scheda regge', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await apriCon(page, {
    _id: 'clic-582',
    status: 'open',
    name: 'Clic ripetuti',
    text: 'niente',
    url: 'https://esempio.invalid/x',
    images: [],
    files: [{ name: 'registro.txt', url: 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1757000000000_11111111-2222-3333-4444-555555555556.txt?alt=media', type: 'text/plain' }],
    createdAt: '2026-09-11T10:00:00Z',
  });
  const pillola = page.locator('a.fb-file').first();
  for (let i = 0; i < 8; i++) await pillola.click({ force: true });
  await page.waitForTimeout(1500);
  expect(errori, `errori in pagina: ${errori.join(' | ')}`).toEqual([]);
  await expect(page.locator('.fb-card')).toHaveCount(1);
});
