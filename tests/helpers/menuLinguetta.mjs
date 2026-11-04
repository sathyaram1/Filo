// Il menu a comparsa della barra delle schede, come lo usa la persona: tasto destro su un elemento della shell, poi
// le voci lette e scelte nella finestra del menu in vista (è riusata, #1090: una nascosta ha le voci di prima).
import { expect } from '../fixtures/electron.mjs';

export async function tastoDestro(shell, selettore) {
  await shell.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
    }));
  }, selettore);
}

function nelMenu(app, js) {
  return app.evaluate(({ BrowserWindow }, js) => {
    const m = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible() && w.webContents.getURL().startsWith('data:text/html'));
    return m ? m.webContents.executeJavaScript(js) : null;
  }, js);
}

// [{ testo, spenta, icona }] del menu in vista, o null se nessun menu è aperto.
export async function vociDelMenu(app) {
  const s = await nelMenu(app, `JSON.stringify([...document.querySelectorAll('.item')]
    .map((e) => ({ testo: e.textContent.trim(), spenta: e.classList.contains('disabled'), icona: !!e.querySelector('svg') })))`);
  return s ? JSON.parse(s) : null;
}

// Aspetta il menu in vista che soddisfa `vale(voci)` e torna le sue voci.
export async function aspettaMenu(app, vale, message = 'il menu non si è aperto') {
  let voci = null;
  await expect.poll(async () => { voci = await vociDelMenu(app); return !!voci && vale(voci); }, { timeout: 8_000, message }).toBe(true);
  return voci;
}

export async function scegli(app, testo) {
  const ok = await nelMenu(app, `(() => {
    const b = [...document.querySelectorAll('button.item')].find((x) => x.textContent.trim() === ${JSON.stringify(testo)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  expect(ok, `voce «${testo}» non cliccabile nel menu`).toBe(true);
}

export async function fotoDelMenu(app, percorso) {
  await new Promise((r) => setTimeout(r, 500)); // la comparsa in dissolvenza
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const m = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible() && w.webContents.getURL().startsWith('data:text/html'));
    return m ? (await m.webContents.capturePage()).toPNG().toString('base64') : null;
  });
  if (png) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(percorso), { recursive: true });
    writeFileSync(percorso, Buffer.from(png, 'base64'));
  }
}

export function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs;
    return { ids: t.tabs.map((x) => x.id), urls: t.tabs.map((x) => x.url), activeId: t.activeId,
      activeUrl: (t.tabs.find((x) => x.id === t.activeId) || {}).url || null };
  });
}

export function apriEAspetta(app, url) {
  return app.evaluate(async ({ BrowserWindow }, url) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const id = tm.openTab(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const tab = tm.tabs.find((t) => t.id === id);
      if (tab && tab.url === url && !tab.loading) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return id;
  }, url);
}
