// Driver per pilotare Filo (Electron) durante i test visivi/agentici.
//
// Espone:
//   launchFilo()           → { app, shell }   (userData isolato in temp)
//   bringToFront(app)
//   contentBounds(app)     → { x, y, width, height, scale }
//   captureComposite(...)  → cattura della finestra composita (shell
//                            + WebContentsView + finestre figlie). Gli screenshot
//                            Playwright per-pagina NON mostrano la composizione.
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
import { mkdirSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { assicuraMotore } from '../helpers/motoreDelleProve.mjs';
import { argomentiScala } from '../helpers/scala.mjs';
import { primaFinestra } from '../helpers/primaFinestra.mjs';
import { paginaDellaScheda, bersaglioDi } from '../helpers/schede.mjs';
import { leggiTasto } from './combinazioni.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(__dirname, '..', '..');
export const SHELL_HEIGHT = 88;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchFilo({ userDataPrefix = 'filo-agent-', extraEnv = {} } = {}) {
  assicuraMotore({ radice: APP_ROOT });
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
  const shell = await primaFinestra(app);
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
    const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    if (!win) return;
    win.show(); win.moveTop(); win.focus();
  });
  await sleep(250);
}

export async function contentBounds(app) {
  return app.evaluate(async ({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const b = win.getContentBounds();
    const d = screen.getDisplayMatching(b);
    return { ...b, scale: d.scaleFactor || 1 };
  });
}

// HWND della finestra principale (stringa decimale dell'handle).
export async function windowHandle(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    // Filtra la window principale (quella con _filoTabs) per evitare di
    // prendere mini-window secondarie come il tooltip o il popup-menu.
    const all = BrowserWindow.getAllWindows();
    const win = all.find((w) => w._filoTabs) || all[0];
    const buf = win.getNativeWindowHandle();
    // little-endian; su 64-bit l'handle sta nei primi 8 byte.
    let v = 0n;
    for (let i = Math.min(buf.length, 8) - 1; i >= 0; i--) v = (v << 8n) | BigInt(buf[i]);
    return v.toString();
  });
}

// Cattura composita (shell + WebContentsView + finestre figlie): l'immagine è
// sempre l'area contenuto della finestra, col suo (0,0) in alto a sinistra.
//
// Windows: Win32 PrintWindow(PW_RENDERFULLCONTENT), che vede la finestra anche
// occlusa o fuori schermo. Linux con la finestra su uno schermo: `scrot` (o xwd
// + convert) ritagliato sulla finestra. Altrove, e quando nessuno schermo la
// mostra (parcheggiata dai test, src/main/test-window-mode.js), la compone
// Electron dalle sue superfici: chiederla al sistema darebbe un'immagine nera.
//
// IMPORTANTE (Windows): NON portare la finestra in foreground qui. Farlo
// ruberebbe il focus da tastiera alla WebContentsView attiva, rompendo la
// digitazione tra uno step e l'altro.
export async function captureComposite(app, outPath) {
  if (process.platform === 'linux') {
    const dove = await finestraSulloSchermo(app);
    if (dove) return captureCompositeLinux(app, outPath, dove);
    return captureCompositeElectron(app, outPath);
  }
  if (process.platform !== 'win32') return captureCompositeElectron(app, outPath);
  // Windows: Win32 PrintWindow
  const hwnd = await windowHandle(app);
  const safePath = outPath.replace(/\\/g, '\\\\');
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static void Shoot(IntPtr h, string path) {
    SetProcessDPIAware();
    RECT wr; GetWindowRect(h, out wr);
    int w = wr.R - wr.L, ht = wr.B - wr.T;
    Bitmap bmp = new Bitmap(w, ht);
    Graphics g = Graphics.FromImage(bmp);
    IntPtr hdc = g.GetHdc();
    PrintWindow(h, hdc, 2); // PW_RENDERFULLCONTENT
    g.ReleaseHdc(hdc); g.Dispose();
    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    bmp.Dispose();
  }
}
"@
[WinCap]::Shoot([IntPtr]${hwnd}, '${safePath}')
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    throw new Error('captureComposite PS fallita: ' + (e.stderr || e.message));
  }
  return outPath;
}

// Dove la finestra sta su uno schermo, in pixel dello schermo; null se lo
// schermo potrebbe non mostrarla: fuori schermo, trasparente, nascosta, o con
// un'altra applicazione in primo piano che potrebbe coprirla.
async function finestraSulloSchermo(app) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const all = BrowserWindow.getAllWindows();
    const win = all.find((w) => w._filoTabs) || all[0];
    if (!win || !win.isVisible() || win.isMinimized() || win.getOpacity() === 0) return null;
    const attiva = BrowserWindow.getFocusedWindow();
    if (!attiva || (attiva !== win && attiva.getParentWindow() !== win)) return null;
    const c = win.getContentBounds();
    const d = screen.getAllDisplays().find(({ bounds: s }) =>
      c.x >= s.x && c.y >= s.y && c.x + c.width <= s.x + s.width && c.y + c.height <= s.y + s.height);
    if (!d) return null;
    const k = d.scaleFactor || 1;
    return { x: Math.round(c.x * k), y: Math.round(c.y * k), width: Math.round(c.width * k), height: Math.round(c.height * k) };
  });
}

// Cattura X11: il framebuffer contiene già il composito, si ritaglia la finestra.
// Senza scrot né xwd + convert si ripiega sulla composizione di Electron.
// Niente moveTop né focus: chiuderebbero il menu aperto (si chiude quando perde il
// fuoco) e in xvfb, senza gestore di finestre, la madre finirebbe sopra le figlie.
async function captureCompositeLinux(app, outPath, dove) {
  const display = process.env.DISPLAY || ':0';
  const xEnv = { ...process.env, DISPLAY: display };
  const { x, y, width, height } = dove;
  const scrot = resolveExecutable('scrot');
  if (scrot) {
    try {
      execFileSync(scrot, ['-D', display, '-a', `${x},${y},${width},${height}`, '--overwrite', outPath], {
        stdio: 'pipe',
        encoding: 'utf8',
        env: xEnv,
      });
      return outPath;
    } catch (e) {
      throw new Error('captureCompositeLinux scrot fallita: ' + (e.stderr || e.message));
    }
  }

  const xwd = resolveExecutable('xwd');
  const convert = resolveExecutable('convert');
  if (xwd && convert) {
    const tmpXwd = outPath + '.xwd';
    try {
      const xwdData = execFileSync(xwd, ['-display', display, '-root', '-silent'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: xEnv,
      });
      writeFileSync(tmpXwd, xwdData);
      execFileSync(convert, [tmpXwd, '-crop', `${width}x${height}+${x}+${y}`, '+repage', outPath], { stdio: 'pipe' });
      return outPath;
    } catch (e) {
      throw new Error('captureCompositeLinux xwd/convert fallita: ' + (e.stderr || e.message));
    } finally {
      try { unlinkSync(tmpXwd); } catch (_) {}
    }
  }

  return captureCompositeElectron(app, outPath);
}

// Le superfici che si vedono ora, dal basso in alto: una copia sola per schermata e segni numerati, che divergendo
// davano al modello segni di cose fuori dalla schermata. Prova: tests/prova-da-utente-filo.spec.mjs.
async function elencoSuperfici(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const win = all.find((w) => w._filoTabs) || all[0];
    if (!win) return null;
    const cb = win.getContentBounds();
    const tm = win._filoTabs;
    const attiva = tm?.tabs?.find((t) => t.id === tm.activeId)?.view?.webContents || null;
    const conTetto = (p, ms, riserva) => Promise.race([p, new Promise((r) => setTimeout(() => r(riserva), ms))]);

    const strati = [];
    const visti = new Set();
    const interseca = (a, b) => {
      const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
      const r = Math.min(a.x + a.w, b.x + b.w), g = Math.min(a.y + a.h, b.y + b.h);
      return { x, y, w: Math.max(0, r - x), h: Math.max(0, g - y) };
    };
    const aggiungi = (wc, rect, clip, tipo) => {
      if (!wc || wc.isDestroyed() || visti.has(wc.id)) return;
      visti.add(wc.id);
      strati.push({ wc, rect, clip, tipo: tipo || (wc === attiva ? 'view' : 'strato') });
    };
    // Una vista figlia si vede solo dentro la madre: il ritaglio scende con la discesa.
    const discendi = (view, ox, oy, clip) => {
      for (const c of view.children || []) {
        // Nascosta con setVisible(false), come la home lasciata per una pagina: senza schermo vero la pagina si dice «visible».
        if (typeof c.getVisible === 'function' && !c.getVisible()) continue;
        const b = c.getBounds();
        const rect = { x: ox + b.x, y: oy + b.y, w: b.width, h: b.height };
        const dentro = interseca(rect, clip);
        if (!dentro.w || !dentro.h) continue;
        if (c.webContents) aggiungi(c.webContents, rect, dentro);
        discendi(c, rect.x, rect.y, dentro);
      }
    };
    const tutta = { x: 0, y: 0, w: cb.width, h: cb.height };
    aggiungi(win.webContents, tutta, tutta, 'shell');
    discendi(win.contentView, 0, 0, tutta);
    for (const f of win.getChildWindows()) {
      if (f.isDestroyed() || !f.isVisible()) continue;
      const fb = f.getContentBounds();
      const rect = { x: fb.x - cb.x, y: fb.y - cb.y, w: fb.width, h: fb.height };
      const dentro = interseca(rect, tutta);
      if (!dentro.w || !dentro.h) continue;
      aggiungi(f.webContents, rect, dentro);
      discendi(f.contentView, rect.x, rect.y, dentro);
    }

    // Una vista nascosta con setVisible(false) conserva i suoi bounds: lo sa solo la pagina.
    // Se è «hidden» anche la shell, il sistema crede coperta la finestra intera e la pagina non dice niente.
    const visibilita = (wc) => conTetto(wc.executeJavaScript('document.visibilityState').catch(() => 'visible'), 1000, 'visible');
    const pagineAttendibili = (await visibilita(win.webContents)) !== 'hidden';
    const superfici = [];
    for (const s of strati) {
      if (s.tipo !== 'shell' && pagineAttendibili && (await visibilita(s.wc)) === 'hidden') continue;
      superfici.push({ id: s.wc.id, bersaglio: s.wc.getOrCreateDevToolsTargetId(), rect: s.rect, clip: s.clip, tipo: s.tipo });
    }
    return { larghezza: cb.width, altezza: cb.height, superfici };
  });
}

// Ogni superficie di elencoSuperfici fotografata e sovrapposta col suo alfa, senza schermo. Non vede quello che disegna
// il sistema (dialoghi nativi, cornici): per quello serve uno schermo.
export async function captureCompositeElectron(app, outPath) {
  const elenco = await elencoSuperfici(app);
  if (!elenco) throw new Error('captureCompositeElectron: nessuna finestra di Filo aperta');
  const esito = await app.evaluate(async ({ webContents, nativeImage }, { larghezza, altezza, superfici }) => {
    const conTetto = (p, ms, riserva) => Promise.race([p, new Promise((r) => setTimeout(() => r(riserva), ms))]);
    const saltate = [];
    const immagini = [];
    for (const s of superfici) {
      const wc = webContents.fromId(s.id);
      if (!wc || wc.isDestroyed()) continue;
      const img = await conTetto(wc.capturePage().catch(() => null), 5000, null);
      if (!img || img.isEmpty()) { saltate.push(wc.getURL()); continue; }
      const k = Math.max(...(img.getScaleFactors?.() || [1]));
      immagini.push({ ...s, size: img.getSize(k), bmp: img.toBitmap({ scaleFactor: k }) });
    }
    if (!immagini.length || immagini[0].tipo !== 'shell') {
      throw new Error('captureCompositeElectron: la shell non si lascia fotografare');
    }

    const cb = { width: larghezza, height: altezza };
    const K = immagini[0].size.width / cb.width;
    const W = Math.round(cb.width * K), H = Math.round(cb.height * K);
    const tela = Buffer.alloc(W * H * 4);
    for (const { rect, clip, size, bmp } of immagini) {
      const px = Math.round(rect.x * K), py = Math.round(rect.y * K);
      const x0 = Math.max(0, Math.round(clip.x * K)), y0 = Math.max(0, Math.round(clip.y * K));
      const x1 = Math.min(W, Math.round((clip.x + clip.w) * K), px + size.width);
      const y1 = Math.min(H, Math.round((clip.y + clip.h) * K), py + size.height);
      for (let y = y0; y < y1; y++) {
        let d = (y * W + x0) * 4;
        let s = ((y - py) * size.width + (x0 - px)) * 4;
        for (let x = x0; x < x1; x++, d += 4, s += 4) {
          const a = bmp[s + 3];
          if (a === 255) { tela[d] = bmp[s]; tela[d + 1] = bmp[s + 1]; tela[d + 2] = bmp[s + 2]; tela[d + 3] = 255; }
          else if (a !== 0) {
            // Pixel premoltiplicati (Skia): sopra = sorgente + sotto × (1 − alfa).
            const resto = (255 - a) / 255;
            for (let i = 0; i < 4; i++) tela[d + i] = Math.min(255, bmp[s + i] + Math.round(tela[d + i] * resto));
          }
        }
      }
    }
    const png = nativeImage.createFromBitmap(tela, { width: W, height: H, scaleFactor: 1 }).toPNG();
    return { png: png.toString('base64'), saltate };
  }, elenco);
  // In un clone pulito la cartella delle foto non c'è ancora.
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, Buffer.from(esito.png, 'base64'));
  if (esito.saltate.length) console.warn(`[captureComposite] superfici che non si sono lasciate fotografare: ${esito.saltate.join(', ')}`);
  return outPath;
}

// Risolve il percorso di un eseguibile, restituisce null se non trovato.
function resolveExecutable(name) {
  try {
    const path = execSync(`which ${name}`, { stdio: 'pipe', encoding: 'utf8' }).trim();
    return path || null;
  } catch (_) {
    return null;
  }
}

// Per scheda e non per indirizzo: due home, o due schede sullo stesso sito, hanno lo stesso (#877). Una scheda appena
// nata si aspetta un poco, finché Playwright non ne ha la Page.
export async function activeView(app, shell) {
  const scadenza = Date.now() + 2000;
  for (;;) {
    const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)?._filoTabs.activeId || null);
    const page = id ? await paginaDellaScheda(app, id) : null;
    if (page || !id || Date.now() > scadenza) return page;
    await sleep(100);
  }
}

// Gli interagibili visibili, anche negli shadow root chiusi di Filo (la sua conferma): visti, devono avere un segno.
// Le schede della barra e la loro crocetta sono div e span: senza segno chi pilota non cambiava né chiudeva una scheda.
// `soloFilo`: solo quelli nelle radici di Filo, per il mondo isolato dei siti.
function COLLECT_FN(soloFilo = false) {
  const sel = 'a[href], button, input, textarea, select, [role="button"], [role="menuitem"], [role="tab"], [contenteditable="true"], [data-add], [data-sr], .pd-striscia, .pd-voce, .dash-carta, .dash-carta-voce, .dash-altro-app, .apps-item, #tabs .tab, #tabs .tab > .close';
  const UI = globalThis.SN_FILO_UI;
  const radici = [];
  const giu = (radice, diFilo) => {
    radici.push({ radice, diFilo });
    for (const el of radice.querySelectorAll('*')) {
      let r = el.shadowRoot;
      let nostra = diFilo;
      if (!r && UI && UI.ombraDi) { try { r = UI.ombraDi(el); nostra = true; } catch (_) {} }
      if (r) giu(r, nostra);
    }
  };
  giu(document, false);
  const els = radici.filter((x) => !soloFilo || x.diFilo).flatMap((x) => Array.from(x.radice.querySelectorAll(sel)));
  const out = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    // data-tip è l'hover di Filo: l'unico nome di un'icona senza testo, come la crocetta della scheda.
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent.trim() || el.getAttribute('data-tip') || '').trim().slice(0, 40);
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

// Le superfici di elencoSuperfici con la loro Page: senza gli strati sopra la scheda (il menu del tasto destro sulle
// pagine web, i riquadri) un modello vedeva voci che non poteva cliccare.
async function superficiVisibili(app, shell, view) {
  const elenco = await elencoSuperfici(app);
  if (!elenco) return [];
  const perBersaglio = new Map();
  for (const page of app.windows()) {
    const b = await bersaglioDi(page);
    if (b) perBersaglio.set(b, page);
  }
  // Una scheda appena nata può non avere ancora il suo bersaglio fra le pagine: la sua Page la dà activeView.
  const riserva = { shell, view };
  return elenco.superfici
    .map((s) => ({ id: s.id, tipo: s.tipo, x: s.rect.x, y: s.rect.y, clip: s.clip, pagina: perBersaglio.get(s.bersaglio) || riserva[s.tipo] }))
    .filter((s) => s.pagina);
}

// Sui siti i pezzi di Filo (la conferma, i riquadri) stanno in radici chiuse che vede solo il mondo dei suoi content
// script: il numero lo dà Filo (tests/unit/mondoContentScript.test.mjs).
const { MONDO: MONDO_CONTENT_SCRIPT } = require('../../src/preload/mondo-esente.js');
async function segniNelMondoDiFilo(app, id) {
  const code = `(${COLLECT_FN.toString()})(true)`;
  try {
    return await app.evaluate(async ({ webContents }, { id, mondo, code }) => {
      const wc = webContents.fromId(id);
      if (!wc || wc.isDestroyed()) return [];
      const r = await Promise.race([
        wc.executeJavaScriptInIsolatedWorld(mondo, [{ code }]).catch(() => []),
        new Promise((ok) => setTimeout(() => ok([]), 2000)),
      ]);
      return Array.isArray(r) ? r : [];
    }, { id, mondo: MONDO_CONTENT_SCRIPT, code });
  } catch (_) { return []; }
}

const pagineSegnate = new Set();

// Disegna i badge numerati su ogni superficie visibile e ritorna la mappa.
// Ritorna [{ i, page:'shell'|'view'|'strato', x, y, tag, label, cx, cy }] dove (cx,cy) sono
// coordinate COMPOSITE (per riferimento del modello) e (x,y) di pagina (per il click).
// La Page di ogni segno sta in `m.pagina`, non enumerabile: la mappa resta stampabile.
export async function markInteractables(app, shell) {
  const view = await activeView(app, shell);
  const superfici = await superficiVisibili(app, shell, view);
  // Solo se l'elenco non si è potuto fare: una scheda che l'elenco ha scartato non si vede neanche nella schermata.
  if (!superfici.length) {
    superfici.push({ tipo: 'shell', x: 0, y: 0, pagina: shell });
    if (view) superfici.push({ tipo: 'view', x: 0, y: SHELL_HEIGHT, pagina: view });
  }
  const map = [];
  let i = 0;
  for (const s of superfici) {
    let segni = [];
    try { segni = await s.pagina.evaluate(COLLECT_FN); } catch (_) { continue; }
    if (s.id != null && !/^filo:/.test(s.pagina.url())) {
      const gia = new Set(segni.map((m) => `${Math.round(m.x)},${Math.round(m.y)}`));
      for (const m of await segniNelMondoDiFilo(app, s.id)) if (!gia.has(`${Math.round(m.x)},${Math.round(m.y)}`)) segni.push(m);
    }
    const qui = [];
    for (const m of segni) {
      const cx = m.x + s.x;
      const cy = m.y + s.y;
      // Un elemento nella parte della superficie tagliata via dalla madre o dalla finestra non sta nella schermata.
      if (s.clip && (cx < s.clip.x || cy < s.clip.y || cx > s.clip.x + s.clip.w || cy > s.clip.y + s.clip.h)) continue;
      const voce = { i: ++i, page: s.tipo, ...m, cx: Math.round(cx), cy: Math.round(cy) };
      Object.defineProperty(voce, 'pagina', { value: s.pagina, enumerable: false });
      map.push(voce);
      qui.push({ i: voce.i, x: m.x, y: m.y, w: m.w, h: m.h });
    }
    try { await s.pagina.evaluate(DRAW_FN, qui); pagineSegnate.add(s.pagina); } catch (_) {}
  }
  return { map, view };
}

export async function clearMarks(app, shell) {
  try { await shell.evaluate(CLEAR_FN); } catch (_) {}
  const view = await activeView(app, shell);
  if (view) { try { await view.evaluate(CLEAR_FN); } catch (_) {} }
  for (const p of pagineSegnate) {
    pagineSegnate.delete(p);
    if (p === shell || p === view || p.isClosed()) continue;
    try { await p.evaluate(CLEAR_FN); } catch (_) {}
  }
}

// Click su un mark dalla mappa (coordinate di pagina → robusto, niente pixel-hunting).
// `opzioni` come in page.mouse.click ({ button: 'right' }, { clickCount: 2 }); ritorna la Page cliccata, quella che
// riceve i tasti dopo.
export async function clickMark(app, shell, map, index, opzioni = {}) {
  const m = map.find((x) => x.i === index);
  if (!m) throw new Error('mark ' + index + ' inesistente');
  await clearMarks(app, shell);
  const page = m.pagina && !m.pagina.isClosed() ? m.pagina : (m.page === 'shell' ? shell : await activeView(app, shell));
  await page.mouse.click(m.x, m.y, opzioni);
  await sleep(400);
  return page;
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

// `dove`: la Page che ha il fuoco (quella dell'ultimo clic, per esempio la barra indirizzi nella shell); senza, la scheda.
export async function typeText(app, shell, text, dove = null) {
  const page = (dove && !dove.isClosed() && dove) || (await activeView(app, shell)) || shell;
  await page.keyboard.type(text, { delay: 10 });
  await sleep(200);
}

export async function pressKey(app, shell, key, dove = null) {
  const page = (dove && !dove.isClosed() && dove) || (await activeView(app, shell)) || shell;
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
