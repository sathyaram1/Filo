// Verifica #582, giro 6 — input limite sulla superficie GEMELLA.
//
// Il giro 4 ha battuto il riquadro dei feedback con testo lunghissimo, nomi di
// allegato lunghissimi, campi vuoti e clic ripetuti. La Gestione mostra la
// STESSA segnalazione, con gli stessi campi scelti da chi manda, e nei giri
// passati le due superfici sono sempre state contate insieme: quello che regge
// di là deve reggere anche di qua.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const GESTIONE = 'filo://manage/manage.html';
const BUCKET = 'filo-8b9cb.firebasestorage.app';
const BASE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/feedback%2F`;

// Niente deve uscire dal riquadro della scheda: la misura si prende dal
// contenitore del dettaglio, non dalla finestra, così vale a qualunque zoom.
async function sbordanti(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#mgDetail');
    if (!root) return ['manca il dettaglio'];
    const limite = root.getBoundingClientRect();
    const fuori = [];
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > limite.right + 2 || r.left < limite.left - 2) {
        fuori.push(`${el.className || el.tagName}: ${Math.round(r.left)}…${Math.round(r.right)} vs ${Math.round(limite.left)}…${Math.round(limite.right)}`);
      }
    }
    return fuori.slice(0, 8);
  });
}

async function apri(page, fb) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.__mgTest);
  await page.evaluate((x) => {
    window.__mgTest.setAdmin(false);
    window.__mgTest.setData([x]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(x._id);
  }, fb);
  await expect(page.locator('#mgDetail')).toBeVisible();
}

test('Gestione: testo lunghissimo e nome d’allegato lunghissimo non escono dalla scheda', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  await apri(page, {
    _id: 'limiti-582-g6',
    seq: 9584,
    subSeq: 0,
    number: 9584,
    status: 'open',
    name: 'T'.repeat(2000),
    text: 'parolalunghissimasenzaspazi'.repeat(400),
    url: `https://esempio.invalid/${'x'.repeat(1500)}`,
    clientId: 'tester@example.com',
    createdAt: '2026-09-11T10:00:00Z',
    images: [`${BASE}1788891497000_33333333-3333-4333-8333-333333333333.png?alt=media`],
    files: [{
      name: `${'nomelunghissimosenzaspazi'.repeat(160)}.txt`,
      url: `${BASE}1788891497003_44444444-4444-4444-8444-444444444444.txt?alt=media`,
      type: 'text/plain',
    }],
  });
  await page.waitForTimeout(1200);
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/582-giro6-gestione-limiti.png', fullPage: true });
  expect(await sbordanti(page), 'qualcosa esce dal riquadro della scheda').toEqual([]);
});

test('Gestione: campi vuoti e allegati senza nome — la scheda si apre lo stesso', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  await apri(page, {
    _id: 'vuoti-582-g6',
    seq: 9585,
    subSeq: 0,
    number: 9585,
    status: 'open',
    name: '   ',
    text: '',
    url: '',
    clientId: '',
    createdAt: '2026-09-11T10:00:00Z',
    images: [''],
    files: [{ name: '', url: `${BASE}1788891497004_55555555-5555-4555-8555-555555555555.txt?alt=media`, type: '' }],
  });
  await expect(page.locator('.mg-bubble').first()).toBeVisible();
  expect(await sbordanti(page), 'qualcosa esce dal riquadro della scheda').toEqual([]);
});

test('Gestione: clic ripetuti in fretta su una pillola — nessun errore, la scheda regge', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  const errori = [];
  page.on('pageerror', (e) => errori.push(String(e)));
  await apri(page, {
    _id: 'clic-582-g6',
    seq: 9586,
    subSeq: 0,
    number: 9586,
    status: 'open',
    name: 'Clic ripetuti',
    text: 'in allegato il registro',
    url: 'https://esempio.invalid/x',
    clientId: 'tester@example.com',
    createdAt: '2026-09-11T10:00:00Z',
    images: [],
    files: [{
      name: 'registro.txt',
      url: `${BASE}1788891497005_66666666-6666-4666-8666-666666666666.txt?alt=media`,
      type: 'text/plain',
    }],
  });
  const pillola = page.locator('a.mg-file-link').first();
  await expect(pillola).toBeVisible();
  for (let i = 0; i < 8; i++) await pillola.click({ force: true });
  await page.waitForTimeout(1200);
  await expect(page.locator('#mgDetail')).toBeVisible();
  expect(errori, `errori di pagina dopo i clic ripetuti: ${errori.join(' | ')}`).toEqual([]);
});
