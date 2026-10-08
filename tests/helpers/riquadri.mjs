// Sui siti spiegazione, Modifica, feedback e attacco red-team stanno in uno shadow root chiuso (#1071): i locator
// non ci entrano.
// Si guardano dall'hook SN_FILO_UI._test nel mondo dei content script (isolato sui siti, la pagina su filo://),
// e si toccano coi clic e coi tasti veri sulle coordinate che l'hook restituisce.

const MONDO_CONTENT_SCRIPT = 999;

// Esegue `fn(arg)` dove vivono i content script della scheda di `page`, o del riquadro incorporato `frame`.
// `fn` deve bastare a sé stessa.
export async function nelMondoDiFilo(app, page, fn, arg = null, frame = null) {
  const url = page.url();
  if (url.startsWith('filo://')) return (frame || page).evaluate(fn, arg);
  const code = `(${fn.toString()})(${JSON.stringify(arg)})`;
  if (frame && frame !== page.mainFrame()) return nelRiquadro(page, frame, code);
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

// Il mondo isolato di un riquadro incorporato lo raggiunge solo il protocollo di debug: si cerca il contesto
// isolato del frame che ha Filo dentro, e lo si tiene finché il frame non cambia pagina.
const sessioni = new WeakMap();
async function nelRiquadro(page, frame, code) {
  const scelta = async () => {
    for (const da of [frame, page]) {
      let s = null;
      try { s = await page.context().newCDPSession(da); } catch (_) { continue; }
      const contesti = [];
      s.on('Runtime.executionContextCreated', ({ context }) => contesti.push(context));
      await s.send('Runtime.enable');
      for (const c of contesti.filter((x) => x.auxData && x.auxData.type === 'isolated')) {
        const { result } = await s.send('Runtime.evaluate', {
          contextId: c.id, returnByValue: true,
          expression: 'location.href + "|" + (typeof globalThis.SN_FILO_UI)',
        }).catch(() => ({ result: {} }));
        if (result && result.value === `${frame.url()}|object`) return { s, id: c.id };
      }
      await s.detach().catch(() => {});
    }
    throw new Error(`nelMondoDiFilo: nessun mondo di Filo nel riquadro ${frame.url()}`);
  };
  let m = sessioni.get(frame);
  if (!m) { m = await scelta(); sessioni.set(frame, m); }
  const { result, exceptionDetails } = await m.s.send('Runtime.evaluate', {
    contextId: m.id, expression: code, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(`nelMondoDiFilo: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
  return result.value;
}

// Il primo nodo che risponde a `sel`, anche dentro un riquadro chiuso: rettangolo, testo, valore. null se non c'è.
export function statoDi(app, page, sel, frame = null) {
  return nelMondoDiFilo(app, page, (s) => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    const el = T ? T.trova(s) : document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      testo: el.textContent || '', valore: 'value' in el ? el.value : null,
      disabilitato: !!el.disabled, classi: String(el.className || ''),
      visibile: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
    };
  }, sel, frame);
}

export async function conta(app, page, sel, frame = null) {
  return nelMondoDiFilo(app, page, (s) => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    return (T ? T.trovaTutti(s) : document.querySelectorAll(s)).length;
  }, sel, frame);
}

// Clic vero del mouse al centro del nodo (dentro un riquadro incorporato, spostato di dove sta il riquadro).
export async function clicca(app, page, sel, { frame = null, ...opts } = {}) {
  const s = await statoDi(app, page, sel, frame);
  if (!s) throw new Error(`clicca: ${sel} non c'è`);
  let dx = 0;
  let dy = 0;
  if (frame && frame !== page.mainFrame()) {
    const box = await (await frame.frameElement()).boundingBox();
    const bordo = await frame.evaluate(() => [window.innerWidth, window.innerHeight]);
    dx = box.x + (box.width - bordo[0]) / 2;
    dy = box.y + (box.height - bordo[1]) / 2;
  }
  // Il mouse di Playwright parla in pixel CSS, zoom della scheda compreso: le coordinate della pagina vanno bene così.
  await page.mouse.click(dx + s.x + s.width / 2, dy + s.y + s.height / 2, opts);
}

// Clic vero nel campo, poi il testo come lo inserisce la tastiera.
export async function scrivi(app, page, sel, testo, { frame = null } = {}) {
  await clicca(app, page, sel, { frame });
  await page.keyboard.insertText(testo);
}
