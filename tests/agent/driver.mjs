// Driver per pilotare Filo (Electron) durante i test visivi/agentici.
//
// Espone:
//   launchFilo()           → { app, shell }   (userData isolato in temp)
//   bringToFront(app)
//   contentBounds(app)     → { x, y, width, height, scale }
//   captureComposite(...)  → PNG della finestra come la si vede: shell, viste e
//                            finestre figlie ricomposte. Gli screenshot Playwright
//                            per-pagina vedono una pagina sola.
//   activeView(app, shell) → la Page Playwright della tab attiva
//   markInteractables(...) → disegna badge numerati sugli elementi cliccabili e
//                            ritorna la mappa indice→{page,x,y,...}
//   clickMark / click / type / press / scroll / navigate / openTab / closeMenus
//
// Sistema di coordinate "composito": (0,0) in alto a sx della finestra. La shell
// (tab bar + barra indirizzi) occupa i primi SHELL_HEIGHT px; sotto c'è la view
// della tab attiva. Un click a y<SHELL_HEIGHT va alla shell, altrimenti alla view
// (con y-SHELL_HEIGHT nelle coordinate della pagina view).

import { _electron as electron } from 'playwright';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { argomentiScala } from '../helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(__dirname, '..', '..');
export const SHELL_HEIGHT = 88;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchFilo({ userDataPrefix = 'filo-agent-', extraEnv = {} } = {}) {
  // Cartella canonica e con uno spazio nel nome, come per ogni altra partenza:
  // tests/helpers/percorsi.mjs.
  const userData = cartellaTemporanea(userDataPrefix);
  // Produzione-like (relay log resta attivo), ma il servizio vero delle schede resta chiuso come in ogni prova.
  const env = { ...process.env, FILO_USER_DATA: userData, FILO_SERVIZI_CHIUSI: '1', ...extraEnv };
  delete env.NODE_ENV;
  // `argomentiScala` porta qui FILO_TEST_SCALE. Senza, il comando con cui si
  // GUARDA una modifica visiva girava sempre al 100% anche con la manopola
  // accesa, e non lo diceva: chi la usava per rivedere un rosso da 125% vedeva
  // un'immagine che non c'entrava niente.
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await sleep(1200); // attendi prima tab + paint
  app._filoUserData = userData;
  return { app, shell };
}

export async function closeFilo(app) {
  const ud = app._filoUserData;
  try { await app.close(); } catch (_) {}
  if (ud) { try { rmSync(ud, { recursive: true, force: true }); } catch (_) {} }
}

export async function bringToFront(app) {
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.show(); win.moveTop(); win.focus();
  });
  await sleep(250);
}

export async function contentBounds(app) {
  return app.evaluate(async ({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const b = win.getContentBounds();
    const d = screen.getDisplayMatching(b);
    return { ...b, scale: d.scaleFactor || 1 };
  });
}

// Cattura composita: la shell, le viste sopra di lei e le finestre figlie
// (menu, tooltip), ricomposte dentro Electron con capturePage. Non chiede niente
// allo schermo, quindi vale con la finestra parcheggiata fuori campo dei test
// (src/main/test-window-mode.js), sotto xvfb e su ogni sistema. Non sposta né
// mette a fuoco la finestra: un menu aperto si chiuderebbe, e la digitazione
// fra due passi finirebbe altrove.
export async function captureComposite(app, outPath) {
  const esito = await app.evaluate(componiFinestra);
  if (!esito.ok) throw new Error('captureComposite: ' + esito.errore);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(esito.png, 'base64'));
  if (esito.mancanti.length) {
    console.warn(`[captureComposite] ${outPath}: senza immagine, quindi assenti dallo scatto: ${esito.mancanti.join(', ')}`);
  }
  return outPath;
}

// Gira nel processo main (passata a app.evaluate): niente riferimenti esterni.
async function componiFinestra({ BrowserWindow, nativeImage }) {
  const tutte = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const win = tutte.find((w) => w._filoTabs) || tutte[0];
  if (!win) return { ok: false, errore: 'nessuna finestra aperta' };
  const cb = win.getContentBounds();
  if (!cb.width || !cb.height) return { ok: false, errore: 'la finestra non ha area visibile (ridotta a icona?)' };
  const strati = [{ nome: 'shell', wc: win.webContents, x: 0, y: 0 }];
  // L'ordine dei figli è l'ordine di disegno. Filo nasconde schede e avvisi
  // azzerandone i bounds: Electron 33 non dice se una vista è visibile.
  const visita = (vista, ox, oy) => {
    for (const figlia of vista.children || []) {
      if (typeof figlia.getVisible === 'function' && !figlia.getVisible()) continue;
      const b = figlia.getBounds();
      if (b.width <= 0 || b.height <= 0) continue;
      const wc = figlia.webContents;
      if (wc && !wc.isDestroyed()) strati.push({ nome: wc.getURL(), wc, x: ox + b.x, y: oy + b.y });
      visita(figlia, ox + b.x, oy + b.y);
    }
  };
  visita(win.contentView, 0, 0);
  for (const f of win.getChildWindows()) {
    if (f.isDestroyed() || !f.isVisible() || f.isMinimized()) continue;
    const b = f.getContentBounds();
    strati.push({ nome: f.webContents.getURL(), wc: f.webContents, x: b.x - cb.x, y: b.y - cb.y });
  }

  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  // Una vista appena posata può non avere ancora un fotogramma: si riprova.
  const pixel = async (wc) => {
    for (let i = 0; i < 5; i++) {
      try {
        const img = await wc.capturePage();
        if (!img.isEmpty()) {
          const sf = img.getScaleFactors()[0] || 1;
          const bmp = img.toBitmap({ scaleFactor: sf });
          const width = img.getSize(sf).width;
          const height = width ? bmp.length / (4 * width) : 0;
          if (width > 0 && Number.isInteger(height) && height > 0) return { width, height, bmp };
        }
      } catch (_) { /* webContents in chiusura: si riprova, poi si dichiara */ }
      await pausa(150);
    }
    return null;
  };
  const immagini = await Promise.all(strati.map((s) => pixel(s.wc)));
  if (!immagini[0]) return { ok: false, errore: 'la shell non ha restituito nessuna immagine' };

  const W = immagini[0].width;
  const H = immagini[0].height;
  // Le viste si posano in pixel logici, le immagini sono in pixel fisici.
  const S = W / cb.width;
  const tela = Buffer.alloc(W * H * 4);
  const mancanti = [];
  // Alfa premoltiplicato (come lo dà Chromium): sopra = src + sotto·(1 − αsrc).
  strati.forEach((s, i) => {
    const img = immagini[i];
    if (!img) { mancanti.push(s.nome); return; }
    const dx = Math.round(s.x * S);
    const dy = Math.round(s.y * S);
    const x0 = Math.max(0, -dx);
    const x1 = Math.min(img.width, W - dx);
    for (let y = Math.max(0, -dy); y < img.height && y + dy < H; y++) {
      for (let x = x0; x < x1; x++) {
        const si = (y * img.width + x) * 4;
        const a = img.bmp[si + 3];
        if (a === 0) continue;
        const di = ((y + dy) * W + (x + dx)) * 4;
        if (a === 255) { img.bmp.copy(tela, di, si, si + 4); continue; }
        const k = (255 - a) / 255;
        for (let c = 0; c < 4; c++) tela[di + c] = Math.min(255, img.bmp[si + c] + Math.round(tela[di + c] * k));
      }
    }
  });
  const png = nativeImage.createFromBitmap(tela, { width: W, height: H }).toPNG();
  return { ok: true, png: png.toString('base64'), mancanti };
}

// Trova la Page della tab attiva interrogando il main per l'URL attivo.
export async function activeView(app, shell) {
  const activeUrl = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const tabs = win._filoTabs;
    if (!tabs) return null;
    const t = tabs.tabs.find((x) => x.id === tabs.activeId);
    return t ? t.view.webContents.getURL() : null;
  });
  if (!activeUrl) return null;
  // match per URL esatto; fallback per hostname
  const pages = app.windows();
  let p = pages.find((w) => { try { return w.url() === activeUrl; } catch { return false; } });
  if (!p) {
    const host = (() => { try { return new URL(activeUrl).hostname; } catch { return null; } })();
    p = pages.find((w) => { try { return new URL(w.url()).hostname === host; } catch { return false; } });
  }
  return p || null;
}

// Script eseguito in pagina: trova elementi interagibili visibili e ne ritorna i rect.
function COLLECT_FN() {
  const sel = 'a[href], button, input, textarea, select, [role="button"], [role="menuitem"], [contenteditable="true"], [data-add], [data-sr], .ed-switch-icon, .ed-cell-empty, .dash-carta, .dash-carta-voce, .dash-altro-app, .apps-item';
  const els = Array.from(document.querySelectorAll(sel));
  const out = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || '').trim().slice(0, 40);
    out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, tag: el.tagName.toLowerCase(), label });
  }
  return out;
}

function DRAW_FN(marks) {
  let layer = document.getElementById('__filo_marks__');
  if (layer) layer.remove();
  layer = document.createElement('div');
  layer.id = '__filo_marks__';
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  for (const m of marks) {
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;left:' + (m.x - m.w / 2) + 'px;top:' + (m.y - m.h / 2) + 'px;width:' + m.w + 'px;height:' + m.h + 'px;border:1.5px solid #e34;box-sizing:border-box;';
    const tag = document.createElement('div');
    tag.textContent = m.i;
    tag.style.cssText = 'position:fixed;left:' + (m.x - m.w / 2) + 'px;top:' + (m.y - m.h / 2 - 13) + 'px;background:#e34;color:#fff;font:bold 11px monospace;padding:0 3px;line-height:13px;';
    layer.appendChild(b); layer.appendChild(tag);
  }
  document.documentElement.appendChild(layer);
}

function CLEAR_FN() { const l = document.getElementById('__filo_marks__'); if (l) l.remove(); }

// Disegna i badge numerati su shell+view e ritorna la mappa.
// Ritorna [{ i, page:'shell'|'view', x, y, tag, label, cx, cy }] dove (cx,cy) sono
// coordinate COMPOSITE (per riferimento del modello) e (x,y) di pagina (per il click).
export async function markInteractables(app, shell) {
  const view = await activeView(app, shell);
  const shellMarks = await shell.evaluate(COLLECT_FN);
  const viewMarks = view ? await view.evaluate(COLLECT_FN) : [];
  const map = [];
  let i = 0;
  for (const m of shellMarks) map.push({ i: ++i, page: 'shell', ...m, cx: Math.round(m.x), cy: Math.round(m.y) });
  for (const m of viewMarks) map.push({ i: ++i, page: 'view', ...m, cx: Math.round(m.x), cy: Math.round(m.y) + SHELL_HEIGHT });
  // disegna
  await shell.evaluate(DRAW_FN, map.filter((m) => m.page === 'shell').map((m) => ({ i: m.i, x: m.x, y: m.y, w: m.w, h: m.h })));
  if (view) await view.evaluate(DRAW_FN, map.filter((m) => m.page === 'view').map((m) => ({ i: m.i, x: m.x, y: m.y, w: m.w, h: m.h })));
  return { map, view };
}

export async function clearMarks(app, shell) {
  try { await shell.evaluate(CLEAR_FN); } catch (_) {}
  const view = await activeView(app, shell);
  if (view) { try { await view.evaluate(CLEAR_FN); } catch (_) {} }
}

// Click su un mark dalla mappa (coordinate di pagina → robusto, niente pixel-hunting).
export async function clickMark(app, shell, map, index) {
  const m = map.find((x) => x.i === index);
  if (!m) throw new Error('mark ' + index + ' inesistente');
  await clearMarks(app, shell);
  const page = m.page === 'shell' ? shell : await activeView(app, shell);
  await page.mouse.click(m.x, m.y);
  await sleep(400);
}

// Click libero in coordinate composite.
export async function clickComposite(app, shell, cx, cy) {
  await clearMarks(app, shell);
  if (cy < SHELL_HEIGHT) {
    await shell.mouse.click(cx, cy);
  } else {
    const view = await activeView(app, shell);
    if (view) await view.mouse.click(cx, cy - SHELL_HEIGHT);
  }
  await sleep(400);
}

export async function typeText(app, shell, text) {
  const view = await activeView(app, shell);
  const page = view || shell;
  await page.keyboard.type(text, { delay: 10 });
  await sleep(200);
}

export async function pressKey(app, shell, key) {
  const view = await activeView(app, shell);
  const page = view || shell;
  await page.keyboard.press(key);
  await sleep(200);
}

export async function scrollBy(app, shell, dy) {
  const view = await activeView(app, shell);
  const page = view || shell;
  await page.mouse.wheel(0, dy);
  await sleep(250);
}

export async function navigate(app, shell, url) {
  await shell.evaluate(async (u) => {
    const snap = await window.filoShell.tabs.snapshot();
    const tabs = snap.tabs || snap;
    const active = tabs.find?.((t) => t.active) || tabs[0];
    if (active) await window.filoShell.tabs.navigate(active.id, u);
  }, url);
  await sleep(1000);
}

export async function openTab(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await sleep(1000);
}

export { sleep };
