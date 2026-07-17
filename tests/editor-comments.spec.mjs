// Commenti dell'editor (pagina "Revisione"): creazione, PERSISTENZA
// dell'evidenziazione dopo il reload (feedback #212) e rimozione.
//
// Il bug: i commenti venivano salvati nel JSON del documento ma con ancora
// vuota ({from:0,to:0}) e al reload non venivano ri-applicati al testo: il
// contatore diceva "1" ma nessuna frase era evidenziata. Questi test asseriscono
// il SUCCESSO (lo span evidenziato esiste e avvolge il testo giusto), non
// l'assenza di errori: prima del fix "riapertura" e "testo modificato" sono rossi.

import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const EDITOR = 'filo://editor/editor.html';

let app = null;
let shell = null;
let userData = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'filo-test-'));
  app = await electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  app = null; shell = null; userData = null;
});

async function openTab(url) {
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === target; }
      catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error(`openTab: nessuna window per ${url}`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

// Stato pulito prima di ogni test: il doc vive in localStorage (condiviso fra
// le tab della stessa origine), va azzerato; poi chiudi le tab residue.
test.beforeEach(async () => {
  const page = await openTab(EDITOR);
  await page.evaluate(() => { try { localStorage.removeItem('filo.editor.doc'); } catch (_) {} });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (!w || !w._filoTabs) return;
    for (const t of [...w._filoTabs.tabs]) {
      try { w._filoTabs.closeTab(t.id); } catch (_) {}
    }
  });
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
  }), { timeout: 8_000 }).toBe(1);
});

// Scrive il contenuto del documento e passa alla pagina "Revisione" (dove vive
// il modulo Commenta).
async function setupDocOnReviewPage(page, html) {
  await page.waitForSelector('.ed-grid');
  await page.evaluate((h) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-module[data-type="comment"]');
}

// Crea un commento sul testo `phrase` (deve esistere nel documento): clicca il
// modulo Commenta, seleziona la frase come farebbe l'utente col mouse (range +
// mouseup) e salva dal prompt.
async function addComment(page, phrase, commentText) {
  await page.locator('.ed-module[data-type="comment"] .ed-mod-pad').click();
  await page.evaluate((needle) => {
    const doc = document.getElementById('doc');
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.nodeValue.indexOf(needle);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + needle.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      doc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error(`testo non trovato: ${needle}`);
  }, phrase);
  await page.waitForSelector('#cmText');
  await page.fill('#cmText', commentText);
  await page.click('#cmSave');
}

const highlightTexts = (page) => page.evaluate(
  () => Array.from(document.querySelectorAll('#doc .ed-commented')).map((s) => s.textContent)
);

test.describe('commenti: evidenziazione persistente', () => {
  test('il commento evidenzia il testo e l\'evidenziazione SOPRAVVIVE alla riapertura', async () => {
    const page = await openTab(EDITOR);
    await setupDocOnReviewPage(page, '<p>questa è una frase da commentare per il test</p>');
    await addComment(page, 'frase da commentare', 'serve più contesto qui');

    // Subito dopo la creazione: testo evidenziato e contatore a 1.
    expect(await highlightTexts(page)).toEqual(['frase da commentare']);
    await expect(page.locator('.ed-module[data-type="comment"] .cm-count')).toHaveText('1');

    // L'ancora salvata è reale (offset nel testo + frase), non {0,0}.
    await page.keyboard.press('Control+s');
    const anchor = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('filo.editor.doc'));
      return raw.comments[0] && raw.comments[0].anchor;
    });
    expect(anchor.text).toBe('frase da commentare');
    expect(anchor.to).toBeGreaterThan(anchor.from);

    // Riapertura (reload → il documento è ri-renderizzato dal JSON): il
    // commento deve essere ANCORA evidenziato sulla stessa frase. Prima del
    // fix qui c'erano 0 evidenziazioni (con il contatore fermo a 1).
    await page.reload();
    await page.waitForSelector('#doc .ed-commented', { timeout: 8_000 });
    expect(await highlightTexts(page)).toEqual(['frase da commentare']);

    // Cliccando l'evidenziazione ri-applicata si apre la lista commenti.
    await page.click('#doc .ed-commented');
    await expect(page.locator('.ed-overlay')).toContainText('serve più contesto qui');
  });

  test('l\'evidenziazione resta sulla frase giusta anche se il testo prima cambia', async () => {
    const page = await openTab(EDITOR);
    await setupDocOnReviewPage(page, '<p>inizio del documento e poi la parte importante alla fine</p>');
    await addComment(page, 'parte importante', 'rivedere');

    // Modifica il testo PRIMA del commento (gli offset originali slittano).
    await page.evaluate(() => {
      const doc = document.getElementById('doc');
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue.startsWith('inizio')) { n.nodeValue = 'PREMESSA AGGIUNTA, ' + n.nodeValue; break; }
      }
      doc.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.keyboard.press('Control+s');
    await page.reload();

    // Dopo il reload l'evidenziazione è ancora sulla frase commentata.
    await page.waitForSelector('#doc .ed-commented', { timeout: 8_000 });
    expect(await highlightTexts(page)).toEqual(['parte importante']);
  });

  test('eliminare un commento rimuove l\'evidenziazione (anche dopo un reload)', async () => {
    const page = await openTab(EDITOR);
    await setupDocOnReviewPage(page, '<p>frase con un commento da eliminare subito</p>');
    await addComment(page, 'commento da eliminare', 'via questo');
    await page.keyboard.press('Control+s');
    await page.reload();
    await page.waitForSelector('#doc .ed-commented', { timeout: 8_000 });

    // Apri la lista dal modulo e elimina.
    await page.locator('.ed-switch-icon').nth(1).click();
    await page.waitForSelector('.ed-module[data-type="comment"]');
    await page.locator('.ed-module[data-type="comment"] .ed-mod-pad').click();
    await page.locator('.ed-overlay [data-del]').click();

    // Niente più evidenziazione né conteggio, e il testo del documento è intatto.
    await expect(page.locator('#doc .ed-commented')).toHaveCount(0);
    await expect(page.locator('.ed-module[data-type="comment"] .cm-count')).toHaveText('0');
    await expect(page.locator('#doc')).toContainText('frase con un commento da eliminare subito');
  });
});
