// La Page di una scheda di Filo, riconosciuta dal bersaglio DevTools della sua vista e non dall'indirizzo: due schede
// sullo stesso host, la riserva della home, le finestre nascoste del controllo sui link hanno indirizzi uguali (#877).
// Prova: tests/fixture-openTab.spec.mjs.

const bersagli = new WeakMap();

// Il bersaglio di una Page non cambia finché la Page vive; un errore (pagina chiusa a metà) non resta in memoria.
function bersaglioDi(page) {
  let p = bersagli.get(page);
  if (!p) {
    p = (async () => {
      const s = await page.context().newCDPSession(page);
      try { return (await s.send('Target.getTargetInfo')).targetInfo.targetId; }
      finally { await s.detach().catch(() => {}); }
    })();
    bersagli.set(page, p);
    p.catch(() => bersagli.delete(page));
  }
  return p.catch(() => null);
}

/** La Page della scheda `id` (in qualunque finestra), o null se non c'è, o non ancora; `vale(page)` scarta le altre. */
export async function paginaDellaScheda(app, id, vale = () => true) {
  const bersaglio = await app.evaluate(({ BrowserWindow }, id) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const wc = w._filoTabs?.tabs?.find((t) => t.id === id)?.view?.webContents;
      if (wc && !wc.isDestroyed()) return wc.getOrCreateDevToolsTargetId();
    }
    return null;
  }, id);
  if (!bersaglio) return null;
  for (const page of app.windows()) {
    let ok = false;
    try { ok = vale(page); } catch (_) {}
    if (ok && (await bersaglioDi(page)) === bersaglio) return page;
  }
  return null;
}
