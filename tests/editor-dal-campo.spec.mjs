// #2389 — l'Editor nasce dal campo della chat: la bozza diventa un documento nuovo e lascia il campo, il velo cresce
// fino a dove l'editor disegna e torna nel campo alla chiusura, con la riduzione del movimento niente animazione, e
// nell'editor l'Aiuto di lato riscrive la parte selezionata. Fotogrammi dell'apertura in tests/.shots/editor-dal-campo/.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SHOTS = 'tests/.shots/editor-dal-campo';

async function finestraCon(app, prova) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return prova(x.url()); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}

async function home(app) {
  const h = await finestraCon(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
  await expect(h.locator('#tieni .dash-carta[data-tipo="editor"]')).toBeVisible({ timeout: 15_000 });
  return h;
}

const davanti = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  const t = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId);
  return t ? t.url : '';
});
const documenti = (ed) => ed.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('filo.editor.collection')).files.length; } catch (_) { return 0; }
});

test('la bozza del campo diventa un documento nuovo, il campo si svuota e l\'Aiuto sta di lato', async ({ app }) => {
  test.setTimeout(60_000);
  const h = await home(app);
  await h.fill('#input', 'Caro condominio,');
  await h.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  await expect.poll(() => davanti(app), { timeout: 10_000 }).toMatch(/^filo:\/\/editor\/editor\.html\?file=/);
  const ed = await finestraCon(app, (u) => u.startsWith('filo://editor/'));
  await expect(ed.locator('#doc p').first()).toHaveText('Caro condominio,');
  await expect(h.locator('#input')).toHaveValue('');
  await expect(ed.locator('html > .sn-sidebar')).toBeVisible();
  await expect(ed.locator('.sn-sidebar-input textarea')).toHaveAttribute('placeholder', 'Chiedi al documento…');
  // Il cursore è nel documento, in fondo: si continua a scrivere.
  await ed.keyboard.type(' vi scrivo');
  await expect(ed.locator('#doc p').first()).toHaveText('Caro condominio, vi scrivo');
  mkdirSync(SHOTS, { recursive: true });
  await ed.screenshot({ path: `${SHOTS}/editor-arrivato.png` });

  // Una seconda bozza è un altro documento, nello stesso editor: la prima resta.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const t = win._filoTabs.tabs.find((x) => x.url.startsWith('filo://newtab'));
    win._filoTabs.activate(t.id);
  });
  await expect.poll(() => h.evaluate(() => !document.querySelector('.dash-velo-editor'))).toBe(true);
  const prima = await documenti(ed);
  await h.fill('#input', 'Seconda lettera\n\nCon due paragrafi');
  await h.locator('#tieni .dash-carta[data-tipo="editor"]').click({ position: { x: 150, y: 20 } });
  await expect.poll(() => davanti(app), { timeout: 10_000 }).toMatch(/^filo:\/\/editor\//);
  const ed2 = await finestraCon(app, (u) => u.startsWith('filo://editor/'));
  await expect(ed2.locator('#doc p')).toHaveText(['Seconda lettera', '', 'Con due paragrafi']);
  await expect.poll(() => documenti(ed2)).toBe(prima + 1);
  const tabsEditor = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    return win._filoTabs.tabs.filter((x) => x.url.startsWith('filo://editor/')).length;
  });
  expect(tabsEditor).toBe(1);
});

test('col campo vuoto l\'Editor si apre come prima: nessun documento nuovo, nessun velo', async ({ app }) => {
  const h = await home(app);
  await h.fill('#input', '   ');
  await h.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  await expect.poll(() => davanti(app), { timeout: 10_000 }).toBe('filo://editor/editor.html');
  const ed = await finestraCon(app, (u) => u.startsWith('filo://editor/'));
  await ed.waitForSelector('#doc');
  await ed.waitForTimeout(500);
  expect(await documenti(ed)).toBeLessThanOrEqual(1);
  expect(await h.evaluate(() => !!document.querySelector('.dash-velo-editor'))).toBe(false);
  await expect(h.locator('#input')).toHaveValue('   ');
});

test('il velo finisce dove l\'editor disegna il testo, e alla chiusura torna nel campo', async ({ app }) => {
  test.setTimeout(60_000);
  const h = await home(app);
  // Le misure del velo a ogni fotogramma dell'apertura.
  await h.evaluate(() => {
    window.__veli = [];
    const guarda = () => {
      const v = document.querySelector('.dash-velo-editor');
      const p = v && v.querySelector('.dash-velo-testo p');
      if (v) window.__veli.push({ box: v.getBoundingClientRect().toJSON(), testo: p ? p.getBoundingClientRect().toJSON() : null, stato: window.SN_DASH_EDITOR_CAMPO._stato() });
      requestAnimationFrame(guarda);
    };
    requestAnimationFrame(guarda);
  });
  const campo = await h.locator('#inputForm').boundingBox();
  await h.fill('#input', 'Caro condominio,');
  await h.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  await expect.poll(() => davanti(app), { timeout: 10_000 }).toMatch(/^filo:\/\/editor\//);
  const ed = await finestraCon(app, (u) => u.startsWith('filo://editor/'));
  await expect(ed.locator('#doc p').first()).toHaveText('Caro condominio,');
  const veli = await h.evaluate(() => window.__veli);
  expect(veli.length).toBeGreaterThan(3);
  // Parte dal campo e arriva a tutta la finestra.
  expect(Math.abs(veli[0].box.left - campo.x)).toBeLessThan(40);
  const ultimo = veli[veli.length - 1];
  expect(ultimo.box.width).toBeGreaterThan(campo.width + 100);
  const vero = await ed.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#doc p'));
    return document.querySelector('#doc p').getBoundingClientRect().toJSON();
  });
  // Nessun salto: l'ultimo fotogramma del velo ha il testo dove l'editor lo disegna.
  expect(Math.abs(ultimo.testo.left - vero.left)).toBeLessThan(2);
  expect(Math.abs(ultimo.testo.top - vero.top)).toBeLessThan(2);

  // Chiuso l'editor, la home torna davanti e il velo si restringe nel campo, poi sparisce.
  await h.evaluate(() => { window.__veli = []; });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const t = win._filoTabs.tabs.find((x) => x.url.startsWith('filo://editor/'));
    win._filoTabs.closeTab(t.id);
  });
  await expect.poll(() => davanti(app)).toMatch(/^filo:\/\/newtab/);
  await expect.poll(() => h.evaluate(() => !document.querySelector('.dash-velo-editor'))).toBe(true);
  const ritorno = await h.evaluate(() => window.__veli);
  expect(ritorno.some((v) => v.stato && v.stato.stato === 'chiude')).toBe(true);
  const fine = ritorno[ritorno.length - 1];
  expect(fine.box.width).toBeLessThan(campo.width + 30);
  await expect(h.locator('#input')).toHaveValue('');
  await expect(h.locator('#input')).toBeFocused();
});

test('con la riduzione del movimento l\'editor si apre senza animazione', async ({ app }) => {
  const h = await home(app);
  await h.emulateMedia({ reducedMotion: 'reduce' });
  await h.evaluate(() => {
    window.__velo = false;
    new MutationObserver(() => { if (document.querySelector('.dash-velo-editor')) window.__velo = true; }).observe(document.body, { childList: true });
  });
  await h.fill('#input', 'Caro condominio,');
  await h.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  await expect.poll(() => davanti(app), { timeout: 10_000 }).toMatch(/^filo:\/\/editor\//);
  const ed = await finestraCon(app, (u) => u.startsWith('filo://editor/'));
  await expect(ed.locator('#doc p').first()).toHaveText('Caro condominio,');
  expect(await h.evaluate(() => window.__velo)).toBe(false);
  await expect(h.locator('#input')).toHaveValue('');
});

test('nell\'editor l\'Aiuto vede la selezione e «riscrivilo più breve» cambia solo quel paragrafo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__aiutoVisto = [];
    const risponde = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop' };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: 'ok' };
      globalThis.__aiutoVisto.push(sistema);
      return { ...base, text: JSON.stringify({ text: 'Fatto: più breve.', formatta: [{ op: 'riscrivi', target: 'selection', testo: 'Ci vediamo giovedì.' }] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risponde;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
  });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && typeof window.SN_SIDEBAR?.open === 'function');
  await ed.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>Caro condominio,</p><p>vi scrivo per dirvi che la riunione di giovedì sera, quella sulle spese, si farà come previsto nella sala comune.</p><p>Saluti</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Il paragrafo selezionato col triplo clic, come l'utente.
  await ed.locator('#doc p').nth(1).click({ clickCount: 3 });
  await ed.evaluate(() => window.SN_SIDEBAR.open());
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.fill('.sn-sidebar-input textarea', 'riscrivilo più breve');
  await ed.press('.sn-sidebar-input textarea', 'Enter');
  await expect(ed.locator('.sn-sidebar-msg-assistant').last()).toContainText('più breve');
  await expect(ed.locator('#doc p')).toHaveText(['Caro condominio,', 'Ci vediamo giovedì.', 'Saluti']);
  const visto = await app.evaluate(() => globalThis.__aiutoVisto.join('\n'));
  expect(visto).toContain('La parte del documento che l\'utente ha selezionato');
  expect(visto).toMatch(/selezionato[\s\S]*vi scrivo per dirvi che la riunione/);
  expect(visto).toContain('"op":"riscrivi"');
  // Annullabile, come le altre modifiche di Filo.
  await expect(ed.locator('.ed-toast-action', { hasText: 'Annulla' })).toBeVisible();
  await ed.locator('.ed-toast-action', { hasText: 'Annulla' }).click();
  await expect(ed.locator('#doc p').nth(1)).toContainText('vi scrivo per dirvi');

  // Senza selezione il modello non ha la parte da riscrivere, e una «riscrivi» non tocca niente.
  await ed.locator('#doc p').first().click();
  await ed.fill('.sn-sidebar-input textarea', 'riscrivilo più breve');
  await ed.press('.sn-sidebar-input textarea', 'Enter');
  await expect(ed.locator('.sn-sidebar-msg-assistant').last()).toContainText('Selezionala di nuovo');
  await expect(ed.locator('#doc p').nth(1)).toContainText('vi scrivo per dirvi');
  const ultimo = await app.evaluate(() => globalThis.__aiutoVisto[globalThis.__aiutoVisto.length - 1]);
  expect(ultimo).toContain('digli di selezionarla');
});

test('fotogrammi dell\'apertura: nessun fotogramma bianco fra la home e l\'editor', async ({ app }) => {
  test.skip(process.platform !== 'linux' || !process.env.DISPLAY || spawnSync('ffmpeg', ['-version']).status !== 0, 'fotogrammi solo con ffmpeg su X');
  test.setTimeout(60_000);
  const h = await home(app);
  const area = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const c = win.getContentBounds();
    const a = win._filoTabs._areaPagina();
    return { x: c.x + a.x, y: c.y + a.y, w: a.width, h: a.height };
  });
  const cartella = join(SHOTS, 'fotogrammi');
  rmSync(cartella, { recursive: true, force: true });
  mkdirSync(cartella, { recursive: true });
  await h.fill('#input', 'Caro condominio,\nvi scrivo per la riunione di giovedì.');
  const w = area.w - (area.w % 2);
  const hh = area.h - (area.h % 2);
  const rec = spawn('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-framerate', '30', '-video_size', `${w}x${hh}`,
    '-i', `${process.env.DISPLAY}+${area.x},${area.y}`, '-t', '2.2', join(cartella, 'f%03d.png')]);
  const finito = new Promise((ok) => rec.on('exit', ok));
  await new Promise((r) => setTimeout(r, 300));
  await h.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  await finito;
  const file = readdirSync(cartella).filter((f) => f.endsWith('.png')).sort();
  expect(file.length).toBeGreaterThan(20);
  // Un fotogramma «bianco» ha più di un terzo dell'area pagina in bianco pieno: lo sfondo di Filo non lo è mai.
  const bianchi = await app.evaluate(async ({ nativeImage }, percorsi) => {
    const out = [];
    for (const n of percorsi) {
      const img = nativeImage.createFromPath(n);
      const buf = img.toBitmap();
      let bianco = 0;
      for (let i = 0; i < buf.length; i += 16) if (buf[i] > 250 && buf[i + 1] > 250 && buf[i + 2] > 250) bianco++;
      if (bianco / (buf.length / 16) > 0.33) out.push(n);
    }
    return out;
  }, { cartella: join(process.cwd(), cartella), file });
  expect(bianchi).toEqual([]);
});
