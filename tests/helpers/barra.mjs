// La barra laterale nelle prove (#871): la sua vista, il suo stato nel main, e le icone da
// rimettere nel menu per chi prova le strade del tasto destro che un utente può ancora avere.

export async function barraPage(app, { tetto = 10_000 } = {}) {
  const scadenza = Date.now() + tetto;
  while (Date.now() < scadenza) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/barra.html'); } catch (_) { return false; } });
    if (p) {
      await p.waitForLoadState('domcontentloaded').catch(() => {});
      await p.waitForFunction(() => document.querySelectorAll('#nav .ico').length > 0, null, { timeout: 5000 }).catch(() => {});
      return p;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('barra: la vista della barra laterale non è nata');
}

// Lo stato vero, dal main: aperta, perché, dove sta la vista e cosa c'è nella barra.
export function statoBarra(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const b = w && w._filoTabs.barra;
    if (!b) return null;
    const v = b.vista && !b.vista.webContents.isDestroyed() ? b.vista : null;
    return {
      aperta: b.aperta,
      motivo: b.motivo,
      bounds: v ? v.getBounds() : null,
      bar: b.layout ? [...b.layout.bar] : null,
      primary: b.layout ? [...b.layout.primary] : null,
      secondary: b.layout ? [...b.layout.secondary] : null,
      schermoIntero: !!w._filoTabs.contentFullscreen,
      alto: w._filoTabs._altezzaCornice(),
    };
  });
}

export function comandaBarra(app, cosa) {
  return app.evaluate(({ BrowserWindow }, c) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (c === 'chiudi') w._filoTabs.barra.chiudi();
    else w._filoTabs.barra.apri(c);
  }, cosa);
}

// Sposta le icone nel menu del tasto destro come farebbe l'utente trascinandole.
export async function mettiNelMenu(app, ids, zona = 'secondary') {
  for (const id of ids) {
    const r = await app.evaluate(async (_, dati) => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: dati.id, target: dati.zona }, {}), { id, zona });
    if (!r || !r.ok) throw new Error(`mettiNelMenu: ${id} non spostata`);
  }
}
