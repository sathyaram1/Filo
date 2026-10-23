// Sui siti spiegazione, Modifica, feedback e attacco red-team stanno nello strato sopra la scheda (#1509.1), una pagina
// filo://riquadri/ coi content script nel mondo isolato; gli altri pezzi di Filo nella pagina, in uno shadow root chiuso
// (#1071). Si guardano dall'hook SN_FILO_UI._test (prima la scheda, poi lo strato) e si toccano coi clic e coi tasti veri.

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
const ATTESA_MONDO_MS = 10_000;
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
  // Nel riquadro Filo si monta al primo tocco, dopo il frame, e expect.poll non riprova una funzione che lancia:
  // l'attesa sta qui (#1429).
  for (const fine = Date.now() + ATTESA_MONDO_MS; !m;) {
    try { m = await scelta(); } catch (e) {
      if (Date.now() > fine || frame.isDetached()) throw e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  sessioni.set(frame, m);
  const { result, exceptionDetails } = await m.s.send('Runtime.evaluate', {
    contextId: m.id, expression: code, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(`nelMondoDiFilo: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
  return result.value;
}

// Esegue `fn(arg)` nel mondo dei content script dello strato dei riquadri sopra la scheda di `page`.
// undefined se la scheda non ne ha uno (o è una pagina di Filo, dove i riquadri restano nel documento).
export async function nelloStrato(app, page, fn, arg = null) {
  const url = page.url();
  if (url.startsWith('filo://')) return undefined;
  const code = `(${fn.toString()})(${JSON.stringify(arg)})`;
  const r = await app.evaluate(async ({ BrowserWindow }, { u, mondo, code: c }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tm = win._filoTabs;
      const tab = (tm?.tabs || []).find((t) => {
        try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; }
      });
      if (!tab) continue;
      const s = tm.riquadri?.strati?.get(tab.view.webContents);
      if (!s || !s.pronta || s.vista.webContents.isDestroyed()) return { nessuno: true };
      return { valore: await s.vista.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: c }]) };
    }
    return { nessuno: true };
  }, { u: url, mondo: MONDO_CONTENT_SCRIPT, code });
  return r.nessuno ? undefined : r.valore;
}

// La Page di Playwright dello strato dei riquadri sopra la scheda di `page`: i suoi clic e i suoi tasti arrivano lì.
export async function paginaDelloStrato(app, page) {
  const { expect } = await import('@playwright/test');
  const url = page.url();
  let id = null;
  await expect.poll(async () => (id = await app.evaluate(({ BrowserWindow }, u) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tm = win._filoTabs;
      const tab = (tm?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
      const s = tab && tm.riquadri?.strati?.get(tab.view.webContents);
      if (s && s.pronta && !s.vista.webContents.isDestroyed()) return tab.view.webContents.id;
    }
    return null;
  }, url)), { message: 'lo strato dei riquadri non è nato', timeout: 0, intervals: [100] }).not.toBeNull();
  let pagina = null;
  await expect.poll(() => Boolean(pagina = app.windows().find((w) => w.url() === `filo://riquadri/riquadri.html#${id}`) || null),
    { message: 'la pagina dello strato non c\'è', timeout: 0, intervals: [100] }).toBe(true);
  return pagina;
}

const STATO = (s) => {
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
};

// Il primo nodo che risponde a `sel`, anche dentro un riquadro chiuso o nello strato sopra la scheda: rettangolo, testo,
// valore. null se non c'è. `nelloStrato: true` dice che il rettangolo è in px dello strato, cioè della vista.
export async function statoDi(app, page, sel, frame = null) {
  const qui = await nelMondoDiFilo(app, page, STATO, sel, frame);
  if (qui) return qui;
  const su = await nelloStrato(app, page, STATO, sel);
  return su ? { ...su, nelloStrato: true } : null;
}

export async function conta(app, page, sel, frame = null) {
  const CONTA = (s) => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    return (T ? T.trovaTutti(s) : document.querySelectorAll(s)).length;
  };
  const qui = await nelMondoDiFilo(app, page, CONTA, sel, frame);
  const su = await nelloStrato(app, page, CONTA, sel);
  return qui + (su || 0);
}

// Clic vero del mouse al centro del nodo: nello strato col suo mouse, dentro un riquadro incorporato spostato di dove sta.
export async function clicca(app, page, sel, { frame = null, ...opts } = {}) {
  const s = await statoDi(app, page, sel, frame);
  if (!s) throw new Error(`clicca: ${sel} non c'è`);
  if (s.nelloStrato) {
    const strato = await paginaDelloStrato(app, page);
    await strato.mouse.click(s.x + s.width / 2, s.y + s.height / 2, opts);
    return strato;
  }
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
  return page;
}

// Clic vero nel campo, poi il testo come lo inserisce la tastiera di dove sta il campo.
export async function scrivi(app, page, sel, testo, { frame = null } = {}) {
  const dove = await clicca(app, page, sel, { frame });
  await dove.keyboard.insertText(testo);
  return dove;
}

// Un tasto premuto sulla scheda come lo preme l'utente, passando dal main (before-input-event): è lì che Esc chiude i
// riquadri sopra la pagina. La tastiera di Playwright parla direttamente al documento e il main non la vede.
export async function tastoSullaScheda(app, page, keyCode) {
  await app.evaluate(({ BrowserWindow }, { u, k }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
      if (!tab) continue;
      tab.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: k });
      tab.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: k });
      return;
    }
  }, { u: page.url(), k: keyCode });
}

// Esegue `fn(arg)` dove stanno i riquadri di Filo della scheda: nello strato sopra un sito, se c'è, sennò nella scheda.
export async function neiRiquadri(app, page, fn, arg = null, frame = null) {
  if (!page.url().startsWith('filo://')) {
    const su = await nelloStrato(app, page, fn, arg);
    if (su !== undefined && su !== null) return su;
  }
  return nelMondoDiFilo(app, page, fn, arg, frame);
}

// La Page che riceve i tasti scritti nei riquadri: lo strato sopra un sito, la scheda stessa su una pagina di Filo.
export async function tastieraDi(app, page) {
  if (page.url().startsWith('filo://')) return page;
  return paginaDelloStrato(app, page);
}

// La Page dove sta il pannello Aiuto della scheda (#1509.3): lo strato sopra un sito, la scheda su una pagina di Filo.
// I suoi locator, i suoi clic e i suoi tasti arrivano al pannello.
export const paginaDellAiuto = tastieraDi;

// Il popup di conferma chiesto da un riquadro dello strato si disegna nello strato, già fuori dal sito. L'oggetto parla
// agli hook SN_CONFIRM_UI del suo mondo isolato: gli helper di confirm.mjs lo usano come una pagina di Filo.
export async function confermaNelloStrato(app, page, { timeout = 10_000 } = {}) {
  const { expect } = await import('@playwright/test');
  const strato = await paginaDelloStrato(app, page);
  const vista = {
    evaluate: (fn, arg = null) => nelloStrato(app, page, fn, arg),
    locator: (s) => strato.locator(s),
    screenshot: (o) => strato.screenshot(o),
    mouse: strato.mouse,
    keyboard: strato.keyboard,
  };
  await expect.poll(() => vista.evaluate(() => !!(globalThis.SN_CONFIRM_UI && globalThis.SN_CONFIRM_UI._test.state())),
    { message: 'il popup nello strato non è comparso', timeout }).toBe(true);
  return vista;
}
