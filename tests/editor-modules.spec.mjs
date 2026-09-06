// Suite accorpata: moduli e interazioni dell'editor (filo://editor).
//
// Unisce gli ex spec editor-format-modules / editor-font-search-drag /
// editor-paste-zoom / editor-module-drag / editor-chat-format in UN solo avvio
// di Electron. I test condividono un'unica app lanciata in beforeAll; ognuno
// apre comunque la SUA tab editor fresca. Lo stato dell'editor vive in
// localStorage (chiave filo.editor.doc), per-origine e quindi CONDIVISO fra le
// tab editor della stessa sessione: un beforeEach lo azzera prima di ogni test,
// così un doc seminato/modificato da un test non trapela nel successivo (com'era
// con un'app appena lanciata per test).
//
// I body dei test sono identici agli originali (stessi assert): cambia solo da
// dove arriva `openTab` (helper locale sull'app condivisa) e l'inquadramento in
// describe per file di provenienza.

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

// Prima di ogni test: azzera il doc editor in localStorage (origine condivisa
// fra le tab editor) e chiudi le tab residue, così ogni test riparte dal
// documento di default (blankDoc), come con un'app appena lanciata.
test.beforeEach(async () => {
  const page = await openTab(EDITOR);
  await page.evaluate(() => { try { localStorage.removeItem('filo.editor.doc'); localStorage.removeItem('filo.editor.collection'); } catch (_) {} });
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

// ───────────────────────── editor-format-modules ───────────────────────────
test.describe('moduli di formattazione', () => {
  // Aggiunge un modulo cliccando la prima cella vuota della griglia e scegliendolo
  // dal menu "Aggiungi modulo".
  async function addModule(page, type) {
    await page.locator('.ed-cell-empty').first().click();
    await page.locator(`.ed-overlay [data-add="${type}"]`).click();
    await page.waitForSelector(`.ed-module[data-type="${type}"]`);
  }

  // Imposta il contenuto dell'editor e seleziona l'intero primo paragrafo.
  async function setContentAndSelect(page, html) {
    await page.evaluate((h) => {
      const doc = document.getElementById('doc');
      doc.innerHTML = h;
      doc.dispatchEvent(new Event('input', { bubbles: true }));
      const block = doc.querySelector('p, h1, h2, h3');
      const range = document.createRange();
      range.selectNodeContents(block);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, html);
  }

  test('il menu "Aggiungi modulo" elenca i nuovi moduli di formattazione', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await page.locator('.ed-cell-empty').first().click();
    for (const t of ['bold', 'italic', 'underline', 'undo', 'redo', 'text-size', 'align']) {
      await expect(page.locator(`.ed-overlay [data-add="${t}"]`)).toHaveCount(1);
    }
  });

  test('il modulo Grassetto rende grassetto il testo selezionato', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await addModule(page, 'bold');
    await setContentAndSelect(page, '<p>ciao mondo</p>');
    await page.locator('.ed-module[data-type="bold"] .ed-fmt-btn').click();
    const html = await page.locator('#doc').innerHTML();
    // Senza il fix il testo resterebbe non formattato: qui DEVE comparire un tag
    // bold (o uno stile font-weight) attorno al testo selezionato.
    expect(html).toMatch(/<(strong|b)\b|font-weight\s*:\s*bold/i);
  });

  test('il modulo Corsivo rende corsivo il testo selezionato', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await addModule(page, 'italic');
    await setContentAndSelect(page, '<p>ciao mondo</p>');
    await page.locator('.ed-module[data-type="italic"] .ed-fmt-btn').click();
    const html = await page.locator('#doc').innerHTML();
    expect(html).toMatch(/<(em|i)\b|font-style\s*:\s*italic/i);
  });

  test('il modulo Allineamento centra il testo e l\'allineamento viene salvato', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await addModule(page, 'align');
    await setContentAndSelect(page, '<p>centra questo</p>');
    await page.locator('.ed-module[data-type="align"] .ed-fmt-btn[data-align="center"]').click();

    // Effetto immediato: un blocco dell'editor ha text-align:center.
    await expect.poll(() => page.evaluate(() => {
      for (const el of document.querySelectorAll('#doc *')) {
        if (el.style && el.style.textAlign === 'center') return 'center';
      }
      return '';
    })).toBe('center');

    // Persistenza: salva e rileggi il JSON serializzato → l'allineamento deve
    // sopravvivere al round-trip (attrs.align sul blocco).
    await page.keyboard.press('Control+s');
    const align = await page.evaluate(() => {
      const __c = JSON.parse(localStorage.getItem('filo.editor.collection'));
      const raw = __c && __c.files ? (__c.files.find((f) => f.id === __c.activeId) || __c.files[0]) : null;
      const block = (raw.content.content || []).find((b) => b.attrs && b.attrs.align);
      return block ? block.attrs.align : '';
    });
    expect(align).toBe('center');
  });

  test('il modulo Dimensione testo ingrandisce il testo selezionato (e si salva)', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await addModule(page, 'text-size');
    await setContentAndSelect(page, '<p>ingrandisci</p>');
    await page.locator('.ed-module[data-type="text-size"] .ed-fmt-btn[data-size="up"]').click();

    const html = await page.locator('#doc').innerHTML();
    expect(html).toMatch(/font-size/i);

    // La dimensione deve sopravvivere al salvataggio (marca fontSize inline).
    await page.keyboard.press('Control+s');
    const hasFontSize = await page.evaluate(() => {
      const __c = JSON.parse(localStorage.getItem('filo.editor.collection'));
      const raw = __c && __c.files ? (__c.files.find((f) => f.id === __c.activeId) || __c.files[0]) : null;
      const json = JSON.stringify(raw.content);
      return json.includes('fontSize');
    });
    expect(hasFontSize).toBe(true);
  });

  test('i moduli Indietro/Avanti annullano e ripetono una modifica', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await addModule(page, 'undo');
    await addModule(page, 'redo');

    // Parti da un documento vuoto, poi digita un singolo carattere (una voce di
    // undo deterministica).
    await page.evaluate(() => {
      const doc = document.getElementById('doc');
      doc.innerHTML = '<p><br></p>';
    });
    await page.click('#doc');
    await page.keyboard.type('x');
    await expect.poll(() => page.locator('#doc').innerText()).toContain('x');

    await page.locator('.ed-module[data-type="undo"] .ed-fmt-btn').click();
    await expect.poll(() => page.locator('#doc').innerText()).not.toContain('x');

    await page.locator('.ed-module[data-type="redo"] .ed-fmt-btn').click();
    await expect.poll(() => page.locator('#doc').innerText()).toContain('x');
  });
});

// ──────────────────────── editor-font-search-drag ──────────────────────────
test.describe('font picker e drag dei moduli', () => {
  async function addFontModule(page) {
    await page.locator('.ed-cell-empty').first().click();
    await expect(page.locator('.ed-overlay [data-add="font"]')).toHaveCount(1);
    await page.locator('.ed-overlay [data-add="font"]').click();
    await page.waitForSelector('.ed-module[data-type="font"]');
  }

  function selectParagraph(page) {
    return page.evaluate(() => {
      const doc = document.getElementById('doc');
      doc.innerHTML = '<p>cambia font</p>';
      doc.dispatchEvent(new Event('input', { bubbles: true }));
      const range = document.createRange();
      range.selectNodeContents(doc.querySelector('p'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }

  test('il picker del font ha una ricerca, filtra mentre scrivi e applica il font cercato (Garamond)', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await addFontModule(page);

    const mod = page.locator('.ed-module[data-type="font"]');
    // Il dropdown custom (stile Filo) è presente: bottone + popup con campo ricerca.
    const button = mod.locator('.ed-font-button');
    await expect(button).toHaveCount(1);

    // Molti font disponibili, incluso Garamond.
    const total = await mod.locator('.ed-font-list .sn-select-option').count();
    expect(total).toBeGreaterThanOrEqual(30);
    await expect(mod.locator('.ed-font-list .sn-select-option', { hasText: 'Garamond' })).toHaveCount(1);

    await selectParagraph(page);

    // Apri il dropdown e cerca "garam": deve restare solo l'opzione Garamond visibile.
    await button.click();
    await expect(mod.locator('.ed-font-search')).toBeVisible();
    await mod.locator('.ed-font-search').fill('garam');
    const visible = mod.locator('.ed-font-list .sn-select-option:visible');
    await expect(visible).toHaveCount(1);
    await expect(visible.first()).toHaveText(/Garamond/);

    // Cliccando l'opzione filtrata il font viene applicato al testo selezionato.
    await visible.first().click();
    const html = await page.locator('#doc').innerHTML();
    expect(html).toMatch(/font-family\s*:\s*[^;"']*Garamond/i);
  });

  test('un font con nome composto (Times New Roman) sopravvive a salvataggio e riapertura', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await addFontModule(page);
    await selectParagraph(page);

    // Applica un font il cui valore CSS contiene virgolette doppie letterali
    // ("Times New Roman", Times, serif): è il caso che rompeva il round-trip.
    const sel = page.locator('.ed-module[data-type="font"] .ed-font-select');
    await sel.dispatchEvent('mousedown'); // salva la selezione corrente
    await sel.selectOption('"Times New Roman", Times, serif');

    // Helper: computed font-family dell'elemento che contiene il testo.
    const familyOf = () => page.evaluate(() => {
      const walker = document.createTreeWalker(document.getElementById('doc'), NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue && n.nodeValue.includes('cambia font')) {
          return getComputedStyle(n.parentElement).fontFamily;
        }
      }
      return '';
    });

    // Applicato subito (comportamento già corretto prima del fix).
    await expect.poll(familyOf).toMatch(/Times New Roman/i);

    // Salva e verifica che la marca sia persistita.
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('filo.editor.collection'));
      if (!c || !c.files) return '';
      const f = c.files.find((x) => x.id === c.activeId) || c.files[0];
      return JSON.stringify(f);
    })).toContain('Times New Roman');

    // Riapri il documento (reload → il body viene ri-renderizzato dal JSON
    // salvato): il font deve essere ancora quello scelto, non il default.
    await page.reload();
    await page.waitForSelector('#doc');
    await expect.poll(familyOf).toMatch(/Times New Roman/i);

    // Nessun attributo spurio generato da virgolette non escapate nello style.
    const spurious = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#doc *')) {
        for (const a of el.attributes) {
          if (/^(times|new|roman|serif)/i.test(a.name)) bad.push(a.name);
        }
      }
      return bad.join(',');
    });
    expect(spurious).toBe('');
  });

  // Un punto della pagina che è DAVVERO su `dentro` e non su qualcos'altro:
  // lo si chiede al browser (`elementFromPoint`) invece di fidarsi di una
  // coordinata scritta a mano. La tendina del font è `position: fixed` e nasce
  // dove capita il modulo: un angolo che su una macchina è vuoto, su un'altra —
  // altri font di sistema, altre altezze di riga, quindi un'altra griglia — sta
  // sotto la tendina, e il click che doveva chiuderla non la raggiunge nemmeno.
  // È la stessa causa del flake già annotato qui sotto per la topbar.
  async function puntoSu(page, selettore) {
    const p = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      // Si prova a scendere lungo la diagonale: il primo punto che appartiene
      // davvero all'elemento (o a un suo discendente) è quello buono.
      for (let f = 0.05; f < 0.95; f += 0.05) {
        const x = Math.round(r.left + r.width * f);
        const y = Math.round(r.top + r.height * f);
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        const sotto = document.elementFromPoint(x, y);
        if (sotto && (sotto === el || el.contains(sotto))) return { x, y };
      }
      return null;
    }, selettore);
    expect(p, `nessun punto cliccabile di ${selettore}: è tutto coperto`).toBeTruthy();
    return p;
  }

  test('il dropdown del font si chiude con un click fuori da esso', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await addFontModule(page);

    const mod = page.locator('.ed-module[data-type="font"]');
    const button = mod.locator('.ed-font-button');
    const pop = mod.locator('.ed-font-pop');

    // Click sul documento → si chiude.
    await button.click();
    await expect(pop).toBeVisible();
    const nelDoc = await puntoSu(page, '#doc');
    await page.mouse.click(nelDoc.x, nelDoc.y);
    await expect(pop).toBeHidden();

    // Click lontano dalla tendina → si chiude. L'angolo si sceglie DOPO aver
    // guardato dove sta la tendina: quello opposto, così è lontano davvero.
    await button.click();
    await expect(pop).toBeVisible();
    const angolo = await page.evaluate(() => {
      const r = document.querySelector('.ed-font-pop').getBoundingClientRect();
      const centroX = (r.left + r.right) / 2;
      const centroY = (r.top + r.bottom) / 2;
      return {
        x: centroX > window.innerWidth / 2 ? 2 : window.innerWidth - 3,
        y: centroY > window.innerHeight / 2 ? 2 : window.innerHeight - 3,
      };
    });
    await page.mouse.click(angolo.x, angolo.y);
    await expect(pop).toBeHidden();

    // Click su un controllo della topbar → si chiude. NB: la .ed-topbar è un
    // gruppo flottante con `pointer-events: none` sul contenitore (solo i suoi
    // figli reali sono cliccabili — vedi editor.css), quindi cliccare l'area vuota
    // passerebbe ATTRAVERSO al documento sotto (era la causa del flake in cloud:
    // #docWrap intercettava il click su .ed-topbar): va cliccato un controllo
    // vero. Usiamo il toggle della sidebar — asserisce l'invariante "click su un
    // elemento della toolbar chiude il dropdown del font". È l'ultimo controllo
    // perché ha un effetto collaterale (apre/chiude la sidebar).
    await button.click();
    await expect(pop).toBeVisible();
    await page.locator('#sidebarToggle').click();
    await expect(pop).toBeHidden();
  });

  // La tendina è larga almeno 180px anche quando il modulo che la apre è più
  // stretto, e i moduli stanno nella colonna di destra: allineata al bordo
  // sinistro del suo bottone, in una finestra stretta la metà destra finisce
  // fuori dallo schermo e i nomi dei font si leggono a metà. Senza il rientro
  // il primo assert è rosso: il bordo destro della tendina supera la finestra.
  test('la tendina del font resta dentro la finestra anche quando è stretta', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');
    await page.setViewportSize({ width: 520, height: 800 });
    await addFontModule(page);

    const mod = page.locator('.ed-module[data-type="font"]');
    await mod.locator('.ed-font-button').click();
    await expect(mod.locator('.ed-font-pop')).toBeVisible();

    const m = await page.evaluate(() => {
      const pop = document.querySelector('.ed-font-pop');
      const btn = document.querySelector('.ed-font-button');
      const p = pop.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      return {
        vw: window.innerWidth, left: p.left, right: p.right,
        // Se allineata al bottone la tendina non sarebbe uscita, questo caso non
        // prova niente: meglio saperlo subito che avere un verde vuoto.
        sarebbeUscita: b.left + p.width > window.innerWidth,
      };
    });
    expect(m.sarebbeUscita, 'a questa larghezza la tendina non sborderebbe comunque: il caso non prova niente').toBe(true);
    expect(m.right, 'la tendina esce dal bordo destro').toBeLessThanOrEqual(m.vw);
    expect(m.left, 'la tendina esce dal bordo sinistro').toBeGreaterThanOrEqual(0);

    // E si legge davvero: i nomi dei font sono cliccabili, non tagliati fuori.
    await expect(mod.locator('.ed-font-pop .sn-select-option').first()).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('un modulo si può afferrare da qualsiasi punto tenendo premuto (non solo dalla maniglia)', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');

    const mod = page.locator('.ed-module[data-type="word-count"]');
    await expect(mod).toHaveCount(1);
    const before = await mod.evaluate((el) => `${el.style.gridColumn}|${el.style.gridRow}`);
    const box = await mod.boundingBox();

    const empties = page.locator('.ed-cell-empty');
    const ebox = await empties.nth((await empties.count()) - 1).boundingBox();

    // Premo al CENTRO del modulo (non sulla maniglia ⠿), tengo premuto oltre la
    // soglia di hold, poi trascino: il drag deve partire da qui.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(320);
    await page.mouse.move(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2, { steps: 10 });
    expect(await page.evaluate(() => document.body.classList.contains('ed-dragging'))).toBe(true);
    await page.mouse.up();

    const after = await page
      .locator('.ed-module[data-type="word-count"]')
      .evaluate((el) => `${el.style.gridColumn}|${el.style.gridRow}`);
    expect(after).not.toBe(before);
  });

  test('un click rapido sul modulo NON avvia un trascinamento (i click restano click)', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');

    const mod = page.locator('.ed-module[data-type="word-count"]');
    const box = await mod.boundingBox();
    // Press + rilascio rapido (sotto la soglia di hold): niente drag.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate(() => document.body.classList.contains('ed-dragging'))).toBe(false);
  });
});

// ───────────────────────── editor-paste-zoom ───────────────────────────────
test.describe('paste e zoom del foglio', () => {
  test('incollare testo inserisce solo testo semplice (niente sfondo né span)', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('#doc');
    await page.click('#doc');

    const result = await page.evaluate(() => {
      const doc = document.getElementById('doc');
      doc.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(doc);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      const dt = new DataTransfer();
      dt.setData('text/plain', 'testo incollato');
      dt.setData('text/html', '<span style="background-color: rgb(200,0,0); color:#fff">testo incollato</span>');
      doc.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));

      return { html: doc.innerHTML.toLowerCase(), text: doc.textContent };
    });

    expect(result.text).toContain('testo incollato');
    expect(result.html).not.toContain('background');
    expect(result.html).not.toContain('<span');
  });

  test('zoom: Ctrl+= ingrandisce, Ctrl+0 ripristina, Ctrl+rotella (pinch) ingrandisce', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('#doc');
    await page.click('#doc');

    // Ctrl+= ingrandisce
    await page.keyboard.press('Control+Equal');
    let zoom = await page.evaluate(() => document.getElementById('doc').style.zoom);
    expect(parseFloat(zoom)).toBeGreaterThan(1);

    // Ctrl+0 ripristina a 1 (zoom rimosso)
    await page.keyboard.press('Control+Digit0');
    zoom = await page.evaluate(() => document.getElementById('doc').style.zoom);
    expect(zoom === '' || parseFloat(zoom) === 1).toBeTruthy();

    // Ctrl+rotella (come il pinch del trackpad) ingrandisce
    await page.evaluate(() => {
      document.getElementById('docWrap').dispatchEvent(
        new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true })
      );
    });
    zoom = await page.evaluate(() => document.getElementById('doc').style.zoom);
    expect(parseFloat(zoom)).toBeGreaterThan(1);
  });
});

// ───────────────────────── editor-module-drag ──────────────────────────────
test.describe('drag di un modulo dall\'handle', () => {
  test('editor: trascino un modulo dall\'handle in una cella vuota', async () => {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-grid');

    const mod = page.locator('.ed-module[data-type="word-count"]');
    await expect(mod).toHaveCount(1);
    const before = await mod.evaluate((el) => `${el.style.gridColumn}|${el.style.gridRow}`);

    await mod.hover();
    const handle = mod.locator('.ed-mod-drag');
    const hbox = await handle.boundingBox();
    expect(hbox).toBeTruthy();

    // Cella vuota di destinazione (l'ultima, lontana dalla posizione iniziale).
    const empties = page.locator('.ed-cell-empty');
    const n = await empties.count();
    expect(n).toBeGreaterThan(0);
    const ebox = await empties.nth(n - 1).boundingBox();
    expect(ebox).toBeTruthy();

    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2, { steps: 10 });

    // Durante il drag il cursore "mano che afferra" è attivo (classe sul body).
    expect(await page.evaluate(() => document.body.classList.contains('ed-dragging'))).toBe(true);

    await page.mouse.up();

    // Il modulo si è spostato: la posizione in griglia è cambiata.
    const after = await page
      .locator('.ed-module[data-type="word-count"]')
      .evaluate((el) => `${el.style.gridColumn}|${el.style.gridRow}`);
    expect(after).not.toBe(before);

    // A drag finito il body non ha più la classe.
    expect(await page.evaluate(() => document.body.classList.contains('ed-dragging'))).toBe(false);
  });
});

// ───────────────────────── editor-chat-format ──────────────────────────────
test.describe('chat che formatta il documento', () => {
  // Porta l'editor sulla pagina che contiene il modulo chat (pagina 1, "Revisione").
  async function openEditorWithChat() {
    const page = await openTab(EDITOR);
    await page.waitForSelector('.ed-module[data-type="switch"]');
    await page.locator('.ed-switch-icon').nth(1).click();
    await page.waitForSelector('.ed-module[data-type="chat"]');
    return page;
  }

  // Sostituisce la risposta del modello con un testo fisso, così possiamo
  // pilotare l'output dell'LLM senza chiavi/rete.
  async function stubLlmReply(page, replyText) {
    await page.evaluate((text) => {
      window.chrome.runtime.sendMessage = (msg, cb) => {
        const resp = { ok: true, text };
        if (typeof cb === 'function') { Promise.resolve().then(() => cb(resp)); return undefined; }
        return Promise.resolve(resp);
      };
    }, replyText);
  }

  async function setDocHtml(page, html) {
    await page.evaluate((h) => {
      const doc = document.getElementById('doc');
      doc.innerHTML = h;
      doc.dispatchEvent(new Event('input', { bubbles: true }));
    }, html);
  }

  async function sendChat(page, command) {
    const input = page.locator('.ed-module[data-type="chat"] [data-chat="input"]');
    await input.click();
    await input.fill(command);
    await input.press('Enter');
  }

  test('«scrivi in grassetto tutti i titoli» mette in grassetto i titoli del documento', async () => {
    const page = await openEditorWithChat();
    await setDocHtml(page, '<h1>Primo titolo</h1><p>testo normale</p><h2>Secondo titolo</h2>');

    // Il modello risponde con le azioni di formattazione (blocco JSON).
    await stubLlmReply(page, '```json\n{"actions":[{"op":"format","target":"headings","style":"bold","value":true}],"reply":"Ho messo in grassetto tutti i titoli."}\n```');
    await sendChat(page, 'scrivi in grassetto tutti i titoli');

    // I titoli diventano grassetto, il paragrafo no.
    await expect.poll(() => page.evaluate(() => {
      const h1 = document.querySelector('#doc h1');
      const h2 = document.querySelector('#doc h2');
      const p = document.querySelector('#doc p');
      return {
        h1: !!(h1 && h1.querySelector('strong, b')),
        h2: !!(h2 && h2.querySelector('strong, b')),
        p: !!(p && p.querySelector('strong, b')),
      };
    })).toEqual({ h1: true, h2: true, p: false });

    // La chat mostra la conferma del modello.
    await expect(page.locator('.ed-chat-msg.assistant').last()).toHaveText('Ho messo in grassetto tutti i titoli.');

    // Il grassetto sopravvive al salvataggio (marca bold nel JSON dei titoli).
    await page.keyboard.press('Control+s');
    const headingBold = await page.evaluate(() => {
      const __c = JSON.parse(localStorage.getItem('filo.editor.collection'));
      const raw = __c && __c.files ? (__c.files.find((f) => f.id === __c.activeId) || __c.files[0]) : null;
      const headings = (raw.content.content || []).filter((b) => b.type === 'heading');
      return headings.length > 0 && headings.every((h) => (h.content || []).some((n) => (n.marks || []).some((mk) => mk.type === 'bold')));
    });
    expect(headingBold).toBe(true);
  });

  test('una risposta SENZA azioni resta testo normale (non modifica il documento)', async () => {
    const page = await openEditorWithChat();
    await setDocHtml(page, '<h1>Titolo</h1><p>contenuto</p>');

    await stubLlmReply(page, 'Il documento parla di un titolo e di un contenuto.');
    await sendChat(page, 'di cosa parla il documento?');

    await expect(page.locator('.ed-chat-msg.assistant').last())
      .toHaveText('Il documento parla di un titolo e di un contenuto.');

    // Nessuna formattazione applicata.
    const hasFormat = await page.evaluate(() => !!document.querySelector('#doc strong, #doc b, #doc em, #doc i'));
    expect(hasFormat).toBe(false);
  });

  test('le azioni di formattazione applicano corsivo, allineamento e font ai target giusti', async () => {
    const page = await openEditorWithChat();
    await setDocHtml(page, '<h1>Titolo</h1><p>paragrafo uno</p><p>paragrafo due</p>');

    // Esercita direttamente il motore di applicazione con più operazioni insieme.
    const touched = await page.evaluate(() => window.__filoEditorFormat.applyFormatActions([
      { op: 'format', target: 'paragraphs', style: 'italic', value: true },
      { op: 'align', target: 'headings', value: 'center' },
      { op: 'format', target: 'h1', style: 'fontFamily', value: 'Georgia' },
    ]));
    expect(touched).toBeGreaterThan(0);

    const state = await page.evaluate(() => {
      const h1 = document.querySelector('#doc h1');
      const ps = Array.from(document.querySelectorAll('#doc p'));
      return {
        paragraphsItalic: ps.length === 2 && ps.every((p) => !!p.querySelector('em, i')),
        headingCentered: !!(h1 && h1.style.textAlign === 'center'),
        headingFont: !!(h1 && /georgia/i.test(h1.innerHTML)),
      };
    });
    expect(state).toEqual({ paragraphsItalic: true, headingCentered: true, headingFont: true });
  });

  test('il parser riconosce le azioni e ignora il testo normale', async () => {
    const page = await openEditorWithChat();
    const r = await page.evaluate(() => {
      const f = window.__filoEditorFormat;
      return {
        fenced: f.parseFormatActions('Ecco:\n```json\n{"actions":[{"op":"format","target":"all","style":"bold","value":true}],"reply":"ok"}\n```'),
        bare: f.parseFormatActions('{"actions":[{"style":"italic","target":"headings"}],"reply":"x"}'),
        plain: f.parseFormatActions('Questa è solo una risposta testuale, senza JSON.'),
      };
    });
    expect(r.fenced && r.fenced.actions.length).toBe(1);
    expect(r.bare && r.bare.actions.length).toBe(1);
    expect(r.plain).toBeNull();
  });
});
