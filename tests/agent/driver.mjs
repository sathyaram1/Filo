// Driver per pilotare Filo (Electron) durante i test visivi/agentici.
//
// Espone:
//   launchFilo()           → { app, shell }   (userData isolato in temp)
//   bringToFront(app)
//   contentBounds(app)     → { x, y, width, height, scale }
//   captureComposite(...)  → cattura OS-level della finestra composita (shell
//                            + WebContentsView native). Gli screenshot Playwright
//                            per-pagina NON mostrano la composizione nativa, per
//                            questo serve una cattura a livello di sistema.
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
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(__dirname, '..', '..');
export const SHELL_HEIGHT = 88;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchFilo({ userDataPrefix = 'filo-agent-', extraEnv = {} } = {}) {
  const userData = mkdtempSync(join(tmpdir(), userDataPrefix));
  const env = { ...process.env, FILO_USER_DATA: userData, ...extraEnv };
  delete env.NODE_ENV; // produzione-like (relay log resta attivo)
  const app = await electron.launch({ args: ['.'], cwd: APP_ROOT, env });
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

// HWND della finestra principale (stringa decimale dell'handle).
export async function windowHandle(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const buf = win.getNativeWindowHandle();
    // little-endian; su 64-bit l'handle sta nei primi 8 byte.
    let v = 0n;
    for (let i = Math.min(buf.length, 8) - 1; i >= 0; i--) v = (v << 8n) | BigInt(buf[i]);
    return v.toString();
  });
}

// Cattura nativa in PNG via Win32 PrintWindow(PW_RENDERFULLCONTENT): cattura il
// contenuto reale della finestra (shell + WebContentsView composite) anche se
// non è in primo piano/occlusa. Niente dipendenza dal focus → robusto.
export async function captureComposite(app, outPath) {
  await bringToFront(app);
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
  const sel = 'a[href], button, input, textarea, select, [role="button"], [role="menuitem"], [contenteditable="true"], [data-add], [data-sr], .ed-switch-icon, .ed-cell-empty, .dash-suggestion, .apps-item';
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
