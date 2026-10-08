// Sui siti spiegazione, Modifica e feedback stanno in uno shadow root chiuso (#1071): i locator non ci entrano.
// Si guardano dall'hook SN_FILO_UI._test nel mondo dei content script (isolato sui siti, la pagina su filo://),
// e si toccano coi clic e coi tasti veri sulle coordinate che l'hook restituisce.

const MONDO_CONTENT_SCRIPT = 999;

// Esegue `fn(arg)` dove vivono i content script della scheda di `page`. `fn` deve bastare a sé stessa.
export async function nelMondoDiFilo(app, page, fn, arg = null) {
  const url = page.url();
  if (url.startsWith('filo://')) return page.evaluate(fn, arg);
  const code = `(${fn.toString()})(${JSON.stringify(arg)})`;
  return app.evaluate(async ({ BrowserWindow }, { u, mondo, code: c }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => {
        try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; }
      });
      if (tab) return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: c }]);
    }
    throw new Error(`nelMondoDiFilo: nessuna scheda su ${u}`);
  }, { u: url, mondo: MONDO_CONTENT_SCRIPT, code });
}

// Il primo nodo che risponde a `sel`, anche dentro un riquadro chiuso: rettangolo, testo, valore. null se non c'è.
export function statoDi(app, page, sel) {
  return nelMondoDiFilo(app, page, (s) => {
    const el = globalThis.SN_FILO_UI._test.trova(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      testo: el.innerText ?? el.textContent ?? '', valore: 'value' in el ? el.value : null,
      disabilitato: !!el.disabled, classi: String(el.className || ''),
      visibile: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
    };
  }, sel);
}

export async function conta(app, page, sel) {
  return nelMondoDiFilo(app, page, (s) => globalThis.SN_FILO_UI._test.trovaTutti(s).length, sel);
}

// Clic vero del mouse al centro del nodo.
export async function clicca(app, page, sel, opts = {}) {
  const s = await statoDi(app, page, sel);
  if (!s) throw new Error(`clicca: ${sel} non c'è`);
  await page.mouse.click(s.x + s.width / 2, s.y + s.height / 2, opts);
}

// Clic vero nel campo, poi il testo come lo inserisce la tastiera.
export async function scrivi(app, page, sel, testo) {
  await clicca(app, page, sel);
  await page.keyboard.insertText(testo);
}
