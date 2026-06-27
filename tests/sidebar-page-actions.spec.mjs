// L'agente "Aiuto" (sidebar on-page) deve poter eseguire le STESSE azioni del
// menu tasto destro sul contenuto della pagina: su testo (copia, taglia, cerca
// sul web, leggi ad alta voce, modifica), su immagini (copia/salva/cerca/copia
// link) e su link (apri in nuova scheda, copia, salva per dopo, condividi).
//
// Feedback alpha #192.1/.2/.3. Qui asseriamo il SUCCESSO dell'azione (la
// funzione giusta viene invocata sull'elemento/selezione giusti, l'azione
// esterna apre la scheda giusta, l'apertura link passa per il ponte NAVIGA),
// non la semplice assenza d'errore. Le azioni che escono verso l'esterno
// (cerca/condividi) passano dal popup di conferma di Filo.
//
// Giriamo su filo://newtab/ (pagina interna, contextIsolation off → un solo
// mondo) iniettando un'immagine e un link nel DOM: così possiamo stubbare
// window.open / SN_ACTIONS nello stesso mondo del content script.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Prepara la pagina: aspetta i content script, inietta img+link, installa le spie.
async function prep(page) {
  await page.waitForFunction(() => typeof window.__filoSidebarTest?.runPageAction === 'function', null, { timeout: 8000 });
  await page.evaluate(() => {
    window.SN_SIDEBAR.open();
    // Elementi bersaglio.
    const img = document.createElement('img');
    img.id = 'pic';
    img.src = 'https://example.com/cat.png';
    document.body.appendChild(img);
    const a = document.createElement('a');
    a.id = 'lnk';
    a.href = 'https://example.com/article';
    a.textContent = 'Un articolo';
    document.body.appendChild(a);

    // Spie deterministiche.
    window.__opened = [];
    window.__origOpen = window.open;
    window.open = (url) => { window.__opened.push(url); return null; };

    const A = window.SN_ACTIONS;
    window.__calls = { copy: [], copyImage: [], saveLink: [], shareLink: [], download: [], read: [], navItems: [] };
    A.__origCopy = A.copyToClipboard;
    A.copyToClipboard = (t) => { window.__calls.copy.push(t); };
    A.__origCopyImage = A.copyImage;
    A.copyImage = async (el) => { window.__calls.copyImage.push(el?.src || ''); };
    A.__origSaveLink = A.saveLink;
    A.saveLink = async (el) => { window.__calls.saveLink.push(el?.href || ''); };
    A.__origShareLink = A.shareLink;
    A.shareLink = async (el) => { window.__calls.shareLink.push(el?.href || ''); };
    A.__origDownload = A.downloadImage;
    A.downloadImage = (el) => { window.__calls.download.push(el?.src || ''); };
    const T = window.SN_TTS;
    T.__origRead = T.readAloud;
    T.readAloud = async (t) => { window.__calls.read.push(t); };

    // Spia sul ponte azioni-Filo (per open_link → NAVIGA), delegando all'originale.
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'filo_run_action') window.__calls.navItems.push(msg.action);
      return orig(msg, ...rest);
    };
  });
}

test('contratto: una risposta {action:"page"} viene riconosciuta come azione di pagina', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForFunction(() => typeof window.__filoSidebarTest?.parseAssistantOutput === 'function', null, { timeout: 8000 });
  const parsed = await page.evaluate(() => window.__filoSidebarTest.parseAssistantOutput(
    JSON.stringify({ action: 'page', page: { op: 'copy', text: 'ciao' }, text: 'fatto' })));
  expect(parsed.kind).toBe('page_action');
  expect(parsed.page.op).toBe('copy');
  // Un op sconosciuto NON è un'azione di pagina (cade nel parsing normale).
  const bad = await page.evaluate(() => window.__filoSidebarTest.parseAssistantOutput(
    JSON.stringify({ action: 'page', page: { op: 'rm_rf' } })));
  expect(bad.kind).not.toBe('page_action');
});

test('testo: copia è immediata (niente conferma) e copia il testo indicato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);
  const ok = await page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'copy', text: 'frase da copiare' }));
  expect(ok).toBe(true);
  expect(await page.evaluate(() => window.__calls.copy)).toEqual(['frase da copiare']);
  // Nessun popup di conferma per un'azione locale.
  await expect(page.locator('.sn-confirm-overlay')).toHaveCount(0);
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('fatto');
});

test('testo: leggi ad alta voce invoca il TTS sul testo indicato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);
  const ok = await page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'read_aloud', text: 'leggimi questo' }));
  expect(ok).toBe(true);
  expect(await page.evaluate(() => window.__calls.read)).toEqual(['leggimi questo']);
});

test('testo: cerca sul web chiede conferma; Annulla non cerca, OK apre la ricerca Google', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);

  // 1) Annulla → nessuna ricerca.
  await page.evaluate(() => { window.__filoSidebarTest.runPageAction({ op: 'search_text', text: 'gatti buffi' }); });
  const overlay = page.locator('.sn-confirm-overlay');
  await expect(overlay).toBeVisible();
  await overlay.locator('.sn-confirm-btn-cancel').click();
  await expect(overlay).toHaveCount(0);
  expect(await page.evaluate(() => window.__opened.length)).toBe(0);
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('annullata');

  // 2) OK → apre la ricerca Google con il testo.
  await page.evaluate(() => { window.__filoSidebarTest.runPageAction({ op: 'search_text', text: 'gatti buffi' }); });
  await expect(overlay).toBeVisible();
  await overlay.locator('.sn-confirm-btn-ok').click();
  await expect(overlay).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
  const url = await page.evaluate(() => window.__opened[0]);
  expect(url).toContain('google.com/search');
  expect(url).toContain(encodeURIComponent('gatti buffi'));
});

test('immagine: cerca immagine risolve il selettore, chiede conferma e apre Lens con il src', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);
  await page.evaluate(() => { window.__filoSidebarTest.runPageAction({ op: 'search_image', selector: '#pic' }); });
  const overlay = page.locator('.sn-confirm-overlay');
  await expect(overlay).toBeVisible();
  await overlay.locator('.sn-confirm-btn-ok').click();
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
  const url = await page.evaluate(() => window.__opened[0]);
  expect(url).toContain('lens.google.com');
  expect(url).toContain(encodeURIComponent('https://example.com/cat.png'));
});

test('immagine: salva immagine è immediata e agisce sull\'immagine indicata', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);
  const ok = await page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'save_image', selector: '#pic' }));
  expect(ok).toBe(true);
  expect(await page.evaluate(() => window.__calls.download)).toEqual(['https://example.com/cat.png']);
  await expect(page.locator('.sn-confirm-overlay')).toHaveCount(0);
});

test('link: copia link risolve il selettore e copia l\'href', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);
  const ok = await page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'copy_link', selector: '#lnk' }));
  expect(ok).toBe(true);
  expect(await page.evaluate(() => window.__calls.copy)).toEqual(['https://example.com/article']);
});

test('link: salva link per dopo è immediato e salva l\'href indicato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);
  const ok = await page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'save_link', selector: '#lnk' }));
  expect(ok).toBe(true);
  expect(await page.evaluate(() => window.__calls.saveLink)).toEqual(['https://example.com/article']);
  // "Salva per dopo" è locale: nessun popup di conferma.
  await expect(page.locator('.sn-confirm-overlay')).toHaveCount(0);
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('fatto');
});

test('link: condividi link chiede conferma; OK invoca la condivisione sull\'href', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);
  await page.evaluate(() => { window.__filoSidebarTest.runPageAction({ op: 'share_link', selector: '#lnk' }); });
  const overlay = page.locator('.sn-confirm-overlay');
  await expect(overlay).toBeVisible();
  await overlay.locator('.sn-confirm-btn-ok').click();
  await expect.poll(() => page.evaluate(() => window.__calls.shareLink.length)).toBe(1);
  expect(await page.evaluate(() => window.__calls.shareLink[0])).toBe('https://example.com/article');
});

test('link: apri in nuova scheda passa per il ponte NAVIGA (azione di sistema di #192.1)', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);
  await page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'open_link', selector: '#lnk' }));
  await expect.poll(() => page.evaluate(() => window.__calls.navItems.length)).toBeGreaterThan(0);
  const nav = await page.evaluate(() => window.__calls.navItems.find((a) => a.type === 'NAVIGA'));
  expect(nav).toBeTruthy();
  expect(nav.url).toBe('https://example.com/article');
});

test('link: bersaglio mancante → nessuna azione, log "non trovato"', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await prep(page);
  const ok = await page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'copy_link', selector: '#does-not-exist' }));
  expect(ok).toBe(false);
  expect(await page.evaluate(() => window.__calls.copy.length)).toBe(0);
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('non trovato');
});
