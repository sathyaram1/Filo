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

// Il pannello scivola dentro: le misure valgono a scivolata finita.
export async function pannelloFermo(barra) {
  await barra.waitForFunction(() => {
    const p = document.getElementById('pannello');
    return document.documentElement.classList.contains('aperta') && getComputedStyle(p).transform === 'none'
      && p.getBoundingClientRect().left >= 0;
  }, null, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 250));
}

// Un tasto vero, come arriva dalla tastiera: passa da before-input-event (i tasti di Playwright no).
export function premi(app, dove, keyCode, modifiers = []) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = arg.dove === 'shell' ? w.webContents : arg.dove === 'barra' ? w._filoTabs.barra.vista.webContents : t.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: arg.keyCode, modifiers: arg.modifiers });
  }, { dove, keyCode, modifiers });
}

// Sposta le icone nel menu del tasto destro come farebbe l'utente trascinandole.
export async function mettiNelMenu(app, ids, zona = 'secondary') {
  for (const id of ids) {
    const r = await app.evaluate(async (_, dati) => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: dati.id, target: dati.zona }, {}), { id, zona });
    if (!r || !r.ok) throw new Error(`mettiNelMenu: ${id} non spostata`);
  }
}

// Il menu di Filo aperto adesso (una finestra data: con le voci; anche il suggerimento è data:, ma senza .menu).
export async function menuAperto(app, { tetto = 5000 } = {}) {
  const fine = Date.now() + tetto;
  while (Date.now() < fine) {
    for (const w of app.windows()) {
      let url = '';
      try { url = w.url(); } catch (_) { continue; }
      if (url.startsWith('data:text/html') && await w.$('.menu').catch(() => null)) return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// Le voci del menu, come le legge l'utente.
export function vociDelMenu(menu) {
  return menu.evaluate(() => [...document.querySelectorAll('.item')].map((b) => b.textContent.trim()));
}

// La scelta chiude il menu: il clic non aspetta una pagina che non c'è più.
export async function scegliNelMenu(menu, testo) {
  await menu.evaluate((t) => {
    const b = [...document.querySelectorAll('button.item')].find((x) => x.textContent.includes(t));
    if (!b) throw new Error(`voce «${t}» assente`);
    b.click();
  }, testo).catch((e) => { if (/assente/.test(String(e && e.message))) throw e; });
}
