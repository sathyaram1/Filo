// Strumenti e interazioni dell'editor (filo://editor): formattazione e font dal pannello di destra (#1433), incolla e
// zoom del foglio, l'Aiuto che formatta il documento. Un'app sola per tutto lo spec: il beforeEach azzera il documento
// (localStorage, condiviso fra le schede dell'editor) e gli strumenti del pannello (nel main), come a un avvio nuovo.

import { _electron as electron, expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { aggiungiStrumento, apriAiuto, apriPannello, chiediAllAiuto, strumento } from './helpers/strumentiEditor.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const EDITOR = 'filo://editor/editor.html';

let app = null;
let shell = null;
let userData = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = cartellaTemporanea('filo-test-');
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await primaFinestra(app);
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

// Chiudere un editor con modifiche le salva (src/main/tabs/chiusuraConCaselle.js): prima si chiude e si aspetta che
// le pagine dell'editor spariscano, poi si azzera, e la scheda usata per azzerare si chiude a sua volta.
async function chiudiTutteLeSchede() {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (!w || !w._filoTabs) return;
    for (const t of [...w._filoTabs.tabs]) {
      try { w._filoTabs.closeTab(t.id); } catch (_) {}
    }
  });
  await expect.poll(async () => app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const schede = w && w._filoTabs ? w._filoTabs.tabs.length : 0;
    const editor = webContents.getAllWebContents().filter((wc) => {
      try { return !wc.isDestroyed() && wc.getURL().startsWith('filo://editor'); } catch (_) { return false; }
    }).length;
    return schede === 1 && editor === 0;
  }), { timeout: 8_000 }).toBe(true);
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await app.evaluate(() => globalThis.SN_STORAGE.setRaw('sn_pannelli_app', null));
  const page = await openTab(EDITOR);
  await page.evaluate(() => { try { localStorage.removeItem('filo.editor.doc'); localStorage.removeItem('filo.editor.collection'); } catch (_) {} });
  await chiudiTutteLeSchede();
});

async function apriEditor() {
  const page = await openTab(EDITOR);
  await page.waitForSelector('#doc');
  await page.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  return page;
}

function salvato(page) {
  return page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('filo.editor.collection'));
    return c && c.files ? (c.files.find((f) => f.id === c.activeId) || c.files[0]) : null;
  });
}

// ───────────────────────── strumenti di formattazione ──────────────────────
test.describe('strumenti di formattazione', () => {
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

  test('il «+» del pannello elenca gli strumenti di formattazione', async () => {
    const page = await apriEditor();
    await apriPannello(page);
    await page.click('.pd-piu');
    for (const t of ['bold', 'italic', 'underline', 'undo', 'redo', 'text-size', 'align', 'font']) {
      await expect(page.locator(`.pd-catalogo .pd-voce[data-elemento="${t}"]`), t).toBeVisible();
    }
  });

  test('lo strumento Grassetto rende grassetto il testo selezionato', async () => {
    const page = await apriEditor();
    await aggiungiStrumento(page, 'bold');
    await setContentAndSelect(page, '<p>ciao mondo</p>');
    await strumento(page, 'bold').locator('.ed-fmt-btn').click();
    const html = await page.locator('#doc').innerHTML();
    // Senza lo strumento il testo resterebbe non formattato: qui DEVE comparire un tag
    // bold (o uno stile font-weight) attorno al testo selezionato.
    expect(html).toMatch(/<(strong|b)\b|font-weight\s*:\s*bold/i);
  });

  test('lo strumento Corsivo rende corsivo il testo selezionato', async () => {
    const page = await apriEditor();
    await aggiungiStrumento(page, 'italic');
    await setContentAndSelect(page, '<p>ciao mondo</p>');
    await strumento(page, 'italic').locator('.ed-fmt-btn').click();
    const html = await page.locator('#doc').innerHTML();
    expect(html).toMatch(/<(em|i)\b|font-style\s*:\s*italic/i);
  });

  test('lo strumento Allineamento centra il testo e l\'allineamento viene salvato', async () => {
    const page = await apriEditor();
    await aggiungiStrumento(page, 'align');
    await setContentAndSelect(page, '<p>centra questo</p>');
    await strumento(page, 'align').locator('.ed-fmt-btn[data-align="center"]').click();

    // Effetto immediato: un blocco dell'editor ha text-align:center.
    await expect.poll(() => page.evaluate(() => {
      for (const el of document.querySelectorAll('#doc *')) {
        if (el.style && el.style.textAlign === 'center') return 'center';
      }
      return '';
    })).toBe('center');

    // L'allineamento sopravvive al round-trip del salvataggio (attrs.align sul blocco).
    await page.keyboard.press('Control+s');
    const raw = await salvato(page);
    const block = (raw.content.content || []).find((b) => b.attrs && b.attrs.align);
    expect(block ? block.attrs.align : '').toBe('center');
  });

  test('lo strumento Dimensione testo ingrandisce il testo selezionato (e si salva)', async () => {
    const page = await apriEditor();
    await aggiungiStrumento(page, 'text-size');
    await setContentAndSelect(page, '<p>ingrandisci</p>');
    await strumento(page, 'text-size').locator('.ed-fmt-btn[data-size="up"]').click();

    const html = await page.locator('#doc').innerHTML();
    expect(html).toMatch(/font-size/i);

    // La dimensione deve sopravvivere al salvataggio (marca fontSize inline).
    await page.keyboard.press('Control+s');
    expect(JSON.stringify((await salvato(page)).content)).toContain('fontSize');
  });

  test('gli strumenti Indietro/Avanti annullano e ripetono una modifica', async () => {
    const page = await apriEditor();
    await aggiungiStrumento(page, 'undo');
    await aggiungiStrumento(page, 'redo');

    // Parti da un documento vuoto, poi digita un singolo carattere (una voce di
    // undo deterministica). Il clic nel foglio chiude il pannello: si riapre per i suoi tasti.
    await page.evaluate(() => {
      const doc = document.getElementById('doc');
      doc.innerHTML = '<p><br></p>';
    });
    await page.click('#doc');
    await page.keyboard.type('x');
    await expect.poll(() => page.locator('#doc').innerText()).toContain('x');

    await apriPannello(page);
    await strumento(page, 'undo').locator('.ed-fmt-btn').click();
    await expect.poll(() => page.locator('#doc').innerText()).not.toContain('x');

    await strumento(page, 'redo').locator('.ed-fmt-btn').click();
    await expect.poll(() => page.locator('#doc').innerText()).toContain('x');
  });
});

// ───────────────────────────── font picker ─────────────────────────────────
test.describe('font picker', () => {
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
    const page = await apriEditor();
    await aggiungiStrumento(page, 'font');

    const mod = strumento(page, 'font');
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
    const page = await apriEditor();
    await aggiungiStrumento(page, 'font');
    await selectParagraph(page);

    // Applica un font il cui valore CSS contiene virgolette doppie letterali
    // ("Times New Roman", Times, serif): è il caso che rompeva il round-trip.
    const sel = strumento(page, 'font').locator('.ed-font-select');
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

    await expect.poll(familyOf).toMatch(/Times New Roman/i);

    // Salva e verifica che la marca sia persistita.
    await page.keyboard.press('Control+s');
    await expect.poll(async () => JSON.stringify(await salvato(page))).toContain('Times New Roman');
    expect(JSON.stringify((await salvato(page)).content)).toContain('fontFamily');

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

  // Un punto della pagina che è DAVVERO su `dentro` e non su qualcos'altro: lo si chiede al browser
  // (`elementFromPoint`) invece di fidarsi di una coordinata scritta a mano. Il pannello aperto copre la
  // destra del foglio, e quanto ne copre dipende dalla larghezza della finestra.
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
    const page = await apriEditor();
    await aggiungiStrumento(page, 'font');

    const mod = strumento(page, 'font');
    const button = mod.locator('.ed-font-button');
    const pop = mod.locator('.ed-font-pop');

    // Click sul documento → si chiude (e con lui il pannello, che si riapre per il passo dopo).
    await button.click();
    await expect(pop).toBeVisible();
    const nelDoc = await puntoSu(page, '#doc');
    await page.mouse.click(nelDoc.x, nelDoc.y);
    await expect(pop).toBeHidden();

    // Click lontano dalla tendina → si chiude. L'angolo si sceglie DOPO aver
    // guardato dove sta la tendina: quello opposto, così è lontano davvero.
    await apriPannello(page);
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

    // Click su un altro comando del pannello → si chiude, e il pannello resta aperto.
    await apriPannello(page);
    await button.click();
    await expect(pop).toBeVisible();
    await strumento(page, 'search-replace').locator('[data-sr="find"]').click();
    await expect(pop).toBeHidden();
    await expect(page.locator('.pd-pannello')).toBeVisible();
  });

  // La finestra si stringe anche DOPO l'apertura. Il pannello sta sul bordo destro e lo segue, la tendina
  // (position: fixed) no: rientrare solo all'apertura la lascia dov'era, fuori dalla pagina e irraggiungibile.
  test('la tendina del font segue il pannello se la finestra si stringe mentre è aperta', async () => {
    const page = await apriEditor();
    await page.setViewportSize({ width: 1280, height: 800 });
    await aggiungiStrumento(page, 'font');

    const mod = strumento(page, 'font');
    const pop = mod.locator('.ed-font-pop');
    await mod.locator('.ed-font-button').click();
    await expect(pop).toBeVisible();

    // Aperta in una finestra larga sta comodamente dentro: è il punto di partenza, non ancora la prova.
    const prima = await page.evaluate(() => {
      const p = document.querySelector('.ed-font-pop').getBoundingClientRect();
      return { vw: window.innerWidth, left: p.left, right: p.right };
    });
    expect(prima.right).toBeLessThanOrEqual(prima.vw);
    expect(prima.left, 'a questa larghezza la tendina resterebbe fuori anche senza muoversi: il caso non prova niente').toBeGreaterThan(520);

    // Adesso la finestra si stringe, con la tendina ancora aperta.
    await page.setViewportSize({ width: 520, height: 800 });
    await expect(pop).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const p = document.querySelector('.ed-font-pop').getBoundingClientRect();
      return Math.round(p.right) <= window.innerWidth && Math.round(p.left) >= 0;
    }), { timeout: 3000, message: 'la tendina è rimasta fuori dalla finestra ristretta' }).toBe(true);

    // E resta usabile: i nomi dei font si vedono e si possono cliccare.
    await expect(pop.locator('.sn-select-option').first()).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
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

// ─────────────────────── l'Aiuto formatta il documento ──────────────────────
test.describe('l\'Aiuto formatta il documento', () => {
  // L'Aiuto risponde nel main con un modello finto: il resto, dalla pagina all'applicazione, è il codice vero.
  async function aiutoRisponde(risposta) {
    await app.evaluate(async (_e, r) => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
        models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
      const risponde = async ({ attempts, messages }) => {
        const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
        const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop' };
        return { ...base, text: sistema.includes('# Protocollo di risposta') ? JSON.stringify(r) : 'ok' };
      };
      globalThis.SN_PROVIDERS.completeWithFallback = risponde;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
    }, risposta);
  }

  async function setDocHtml(page, html) {
    await page.evaluate((h) => {
      const doc = document.getElementById('doc');
      doc.innerHTML = h;
      doc.dispatchEvent(new Event('input', { bubbles: true }));
    }, html);
  }

  test('«scrivi in grassetto tutti i titoli» all\'Aiuto mette in grassetto i titoli del documento', async () => {
    await aiutoRisponde({ text: 'Ho messo in grassetto tutti i titoli.', formatta: [{ op: 'format', target: 'headings', style: 'bold', value: true }] });
    const page = await apriEditor();
    await setDocHtml(page, '<h1>Primo titolo</h1><p>testo normale</p><h2>Secondo titolo</h2>');
    await apriAiuto(app, page);
    await chiediAllAiuto(page, 'scrivi in grassetto tutti i titoli');

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

    // L'Aiuto mostra la conferma del modello, non il suo JSON.
    await expect(page.locator('.sn-sidebar-msg-assistant').last()).toHaveText('Ho messo in grassetto tutti i titoli.');

    // Il grassetto sopravvive al salvataggio (marca bold nel JSON dei titoli).
    await page.locator('#doc h1').click();
    await page.keyboard.press('Control+s');
    const headings = ((await salvato(page)).content.content || []).filter((b) => b.type === 'heading');
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.every((h) => (h.content || []).some((n) => (n.marks || []).some((mk) => mk.type === 'bold')))).toBe(true);
  });

  test('una risposta dell\'Aiuto SENZA azioni resta testo e non modifica il documento', async () => {
    await aiutoRisponde({ text: 'Il documento parla di un titolo e di un contenuto.' });
    const page = await apriEditor();
    await setDocHtml(page, '<h1>Titolo</h1><p>contenuto</p>');
    await apriAiuto(app, page);
    await chiediAllAiuto(page, 'di cosa parla il documento?');

    await expect(page.locator('.sn-sidebar-msg-assistant').last())
      .toHaveText('Il documento parla di un titolo e di un contenuto.');

    // Nessuna formattazione applicata, e niente «Annulla» per una modifica che non c'è stata.
    const hasFormat = await page.evaluate(() => !!document.querySelector('#doc strong, #doc b, #doc em, #doc i'));
    expect(hasFormat).toBe(false);
    await expect(page.locator('.ed-toast-action', { hasText: 'Annulla' })).toHaveCount(0);
  });

  test('le azioni di formattazione applicano corsivo, allineamento e font ai target giusti', async () => {
    const page = await apriEditor();
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
    const page = await apriEditor();
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
