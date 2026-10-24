// L'avviso del sito pericoloso sta in una vista sopra la scheda (#813.5), non nella pagina: qui la si trova, si guarda
// cosa copre e si scrive come scrive la tastiera vera, nel webContents che ha il fuoco.
// Regole: patterns/un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md

export async function vistaAvviso(app, ms = 8000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la vista dell\'avviso non è nata');
}

export function copertura(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm) continue;
      const tab = tm.tabs.find((t) => t.id === tm.activeId);
      const v = tm.avvisoSito.vista;
      const figli = w.contentView.children;
      const vb = v ? v.getBounds() : null;
      const tb = tab.view.getBounds();
      const col = webContents.getFocusedWebContents();
      let tastiera = 'altro';
      if (v && col === v.webContents) tastiera = 'avviso';
      else if (col === tab.view.webContents) tastiera = 'pagina';
      return {
        coperta: tm.avvisoSito.coperta() === tab,
        sopra: !!v && figli.indexOf(v) > figli.indexOf(tab.view),
        stessiBordi: !!vb && vb.x === tb.x && vb.y === tb.y && vb.width === tb.width && vb.height === tb.height && tb.width > 0,
        tastiera,
      };
    }
    return null;
  });
}

export async function scriviDallaTastiera(app, testo) {
  await app.evaluate(({ webContents }, t) => {
    const wc = webContents.getFocusedWebContents();
    if (!wc) throw new Error('nessun webContents ha la tastiera');
    for (const ch of t) {
      const tasto = ch === '\r' ? 'Return' : ch;
      wc.sendInputEvent({ type: 'keyDown', keyCode: tasto });
      wc.sendInputEvent({ type: 'char', keyCode: ch });
      wc.sendInputEvent({ type: 'keyUp', keyCode: tasto });
    }
  }, testo);
}

export const COPERTA = { coperta: true, sopra: true, stessiBordi: true, tastiera: 'avviso' };
