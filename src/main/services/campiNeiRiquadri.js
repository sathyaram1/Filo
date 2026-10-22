// I campi segreti che il content script della pagina non vede (#810.7): nei riquadri incorporati di un altro sito
// (la carta di un servizio di pagamento) e dentro i componenti chiusi, che raggiunge solo il protocollo d'ispezione.
// Coordinate della finestra della pagina principale; le regole dei campi stanno in src/shared/campiSegreti.js.

const { riquadroArrivato } = require('./riquadroArrivato');

const ATTESA_MS = 1000;
const ATTESA_COMPONENTI_MS = 2500;

function entro(promessa, ms) {
  return Promise.race([Promise.resolve(promessa).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), ms))]);
}

function preambolo() {
  const G = globalThis.SN_GUARDIANO_STATICO;
  return `const luhn = ${G.luhn}; const cartaValida = ${G.cartaValida};`;
}

function codiceMisura() {
  return `(function () { ${preambolo()}
    try { return (${globalThis.SN_CAMPI_SEGRETI.crea})(window, cartaValida).campiInVista(); } catch (_) { return []; } })()`;
}

// Per il protocollo d'ispezione: `this` è la radice di un componente chiuso.
function codiceMisuraRadice() {
  return `function () { ${preambolo()}
    try { return (${globalThis.SN_CAMPI_SEGRETI.crea})(window, cartaValida).campiInVista(this); } catch (_) { return []; } }`;
}

// Dove un riquadro mostra il suo documento, nel documento che lo ospita: dentro bordo e margine interno.
function misuraRiquadro(el) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
  const pr = parseFloat(cs.paddingRight) || 0, pb = parseFloat(cs.paddingBottom) || 0;
  return { left: r.left + el.clientLeft + pl, top: r.top + el.clientTop + pt,
    width: el.clientWidth - pl - pr, height: el.clientHeight - pt - pb };
}

// Il riquadro che contiene `figlio`, misurato nel documento che lo ospita: il genitore riconosce il mittente di
// un messaggio, e il messaggio porta solo un segnale usa e getta.
async function boxNelGenitore(figlio) {
  const genitore = figlio.parent;
  // Un genitore ancora in arrivo perderebbe Filo per uno script: meglio la foto ferma che un riquadro muto.
  if (!riquadroArrivato(genitore)) return null;
  const segnale = `filo-riquadro-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const risposta = genitore.executeJavaScript(`new Promise((ok) => {
    const misura = ${misuraRiquadro};
    const fine = setTimeout(() => { removeEventListener('message', h, true); ok(null); }, ${ATTESA_MS - 100});
    function h(e) {
      if (e.data !== ${JSON.stringify(segnale)}) return;
      e.stopImmediatePropagation();
      for (const el of document.querySelectorAll('iframe, frame')) {
        if (el.contentWindow !== e.source) continue;
        clearTimeout(fine);
        removeEventListener('message', h, true);
        return ok(misura(el));
      }
    }
    addEventListener('message', h, true);
  })`);
  // Gli script di uno stesso riquadro girano in ordine: quando questo risponde, l'ascolto è già acceso.
  if ((await entro(genitore.executeJavaScript('0'), ATTESA_MS)) === null) return null;
  await entro(figlio.executeJavaScript(`parent.postMessage(${JSON.stringify(segnale)}, '*')`), ATTESA_MS);
  return entro(risposta, ATTESA_MS);
}

function interseca(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

// Dai riquadri annidati alla pagina (`scatole` dal più interno): ogni livello sposta le coordinate e ritaglia quello
// che il riquadro non mostra. Null se un livello non mostra niente.
function componi(scatole) {
  let dx = 0, dy = 0;
  let vista = null;
  for (const box of scatole) {
    const qui = { left: box.left, top: box.top, width: box.width, height: box.height };
    vista = vista ? interseca({ ...vista, left: vista.left + box.left, top: vista.top + box.top }, qui) : qui;
    dx += box.left;
    dy += box.top;
    if (!vista) return null;
  }
  return { dx, dy, vista };
}

function nellaPagina(campi, posa) {
  const out = [];
  for (const c of campi) {
    const spostato = { left: c.left + posa.dx, top: c.top + posa.dy, width: c.width, height: c.height };
    const r = posa.vista ? interseca(spostato, posa.vista) : spostato;
    if (r) out.push({ ...c, ...r });
  }
  return out;
}

// `{ campi, nonCoperti }`: `nonCoperti` quando un riquadro ha campi segreti ma non si è riusciti a ritrovarlo nella
// pagina, e l'immagine non deve partire.
async function campiSegretiNeiRiquadri(webContents) {
  let riquadri = [];
  // Un riquadro in arrivo non ha ancora campi da coprire.
  try { riquadri = webContents.mainFrame.framesInSubtree.filter((f) => f !== webContents.mainFrame && riquadroArrivato(f)); } catch (_) {}
  if (!riquadri.length) return { campi: [], nonCoperti: false };
  const codice = codiceMisura();
  const campi = [];
  let nonCoperti = false;
  await Promise.all(riquadri.map(async (f) => {
    const dentro = await entro(f.executeJavaScript(codice), ATTESA_MS);
    if (!Array.isArray(dentro) || !dentro.length) return;
    const scatole = [];
    for (let cur = f; cur.parent; cur = cur.parent) {
      const box = await boxNelGenitore(cur);
      if (!box) { nonCoperti = true; return; }
      scatole.push(box);
    }
    const posa = componi(scatole);
    if (posa) campi.push(...nellaPagina(dentro, posa));
  }));
  return { campi, nonCoperti };
}

// Le radici dei componenti chiusi in un albero di DOM.getDocument(pierce), con la catena dei riquadri dello stesso
// processo che le contengono (dal più esterno); e, per ogni riquadro, la sua catena col riquadro in fondo.
function radiciChiuse(radice) {
  const chiuse = [];
  const riquadri = new Map();
  const pila = [[radice, []]];
  while (pila.length) {
    const [n, catena] = pila.pop();
    if (!n) continue;
    if (n.shadowRootType === 'closed') chiuse.push({ id: n.backendNodeId, catena });
    if (n.nodeType === 1 && n.frameId) riquadri.set(n.frameId, [...catena, n.backendNodeId]);
    for (const f of n.children || []) pila.push([f, catena]);
    for (const f of n.shadowRoots || []) pila.push([f, catena]);
    if (n.contentDocument) pila.push([n.contentDocument, [...catena, n.backendNodeId]]);
  }
  return { chiuse, riquadri };
}

// L'albero intero di una pagina grande costa secondi e ferma Filo: si legge solo se la ricerca del protocollo, che
// entra anche nei componenti chiusi, trova più campi di quanti ne vedano gli script della pagina. Nel dubbio si legge.
const CAMPI_VISIBILI = `(function () {
  var n = 0;
  function radice(r, prof) {
    n += r.querySelectorAll('input, textarea').length;
    if (prof > 30) return;
    var tutti = r.querySelectorAll('*');
    for (var i = 0; i < tutti.length; i++) if (tutti[i].shadowRoot) radice(tutti[i].shadowRoot, prof + 1);
  }
  function finestra(w, prof) {
    radice(w.document, 0);
    for (var i = 0; prof < 12 && i < w.frames.length; i++) {
      var f = w.frames[i];
      try { if (!f.document) continue; } catch (e) { continue; }
      finestra(f, prof + 1);
    }
  }
  finestra(window, 0);
  return n;
})()`;
async function campoInUnChiuso(cmd, sid) {
  try {
    await cmd('DOM.getDocument', { depth: 0 }, sid);
    let trovati = 0;
    for (const query of ['<input>', '<textarea>']) {
      const { searchId, resultCount } = await cmd('DOM.performSearch', { query, includeUserAgentShadowDOM: false }, sid);
      cmd('DOM.discardSearchResults', { searchId }, sid).catch(() => {});
      trovati += resultCount;
    }
    if (!trovati) return false;
    const { result } = await cmd('Runtime.evaluate', { expression: CAMPI_VISIBILI, returnByValue: true }, sid);
    return !(result && result.value === trovati);
  } catch (_) {
    return true;
  }
}

// Una sessione d'ispezione per ogni processo dei riquadri (sessione '' = la pagina): i riquadri di un altro sito
// vivono in un processo loro, e il loro albero non sta in quello della pagina.
// In fila per pagina: chi trova l'ispettore già attaccato da una misura in corso non deve vederselo staccare sotto.
const inFila = new WeakMap();
function campiSegretiNeiComponentiChiusi(webContents) {
  const ora = (inFila.get(webContents) || Promise.resolve()).then(() => misuraComponentiChiusi(webContents));
  inFila.set(webContents, ora.catch(() => {}));
  return ora;
}

async function misuraComponentiChiusi(webContents) {
  const dbg = webContents.debugger;
  const nostro = !dbg.isAttached();
  if (nostro) { try { dbg.attach('1.3'); } catch (_) { return { campi: [], nonCoperti: false }; } }
  const cmd = (metodo, parametri = {}, sid = '') => (sid ? dbg.sendCommand(metodo, parametri, sid) : dbg.sendCommand(metodo, parametri));
  const sessioni = [{ sid: '', frameId: null }];
  const attese = [];
  const segui = (sid) => cmd('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {});
  const suMessaggio = (_e, metodo, p) => {
    if (metodo !== 'Target.attachedToTarget' || !p || !p.targetInfo || p.targetInfo.type !== 'iframe') return;
    sessioni.push({ sid: p.sessionId, frameId: p.targetInfo.targetId });
    attese.push(segui(p.sessionId));
  };
  dbg.on('message', suMessaggio);
  try {
    attese.push(segui(''));
    while (attese.length) await Promise.all(attese.splice(0));
    const conCampi = await Promise.all(sessioni.map((s) => campoInUnChiuso(cmd, s.sid)));
    if (!conCampi.some(Boolean)) return { campi: [], nonCoperti: false };
    const alberi = await Promise.all(sessioni.map(async (s) => {
      try { return { ...s, ...radiciChiuse((await cmd('DOM.getDocument', { depth: -1, pierce: true }, s.sid)).root) }; }
      catch (_) { return { ...s, chiuse: [], riquadri: new Map(), rotto: true }; }
    }));
    if (!alberi.some((a) => a.chiuse.length)) return { campi: [], nonCoperti: false };

    const chiama = async (sid, backendNodeId, funzione) => {
      try {
        const { object } = await cmd('DOM.resolveNode', { backendNodeId, objectGroup: 'filo-campi' }, sid);
        const { result } = await cmd('Runtime.callFunctionOn',
          { objectId: object.objectId, functionDeclaration: funzione, returnByValue: true }, sid);
        return result ? result.value : null;
      } catch (_) { return null; }
    };
    const misura = `function () { return (${misuraRiquadro})(this); }`;
    // Le scatole dal riquadro più interno alla pagina, attraverso i processi; null se un pezzo non si ritrova.
    const scatole = async (albero, catena, giri = 0) => {
      const out = [];
      for (const id of [...catena].reverse()) {
        const box = await chiama(albero.sid, id, misura);
        if (!box) return null;
        out.push(box);
      }
      if (!albero.sid) return out;
      const ospite = giri < 12 && alberi.find((a) => a.riquadri.has(albero.frameId));
      if (!ospite) return null;
      const su = await scatole(ospite, ospite.riquadri.get(albero.frameId), giri + 1);
      return su && out.concat(su);
    };

    const campi = [];
    let nonCoperti = false;
    const radice = codiceMisuraRadice();
    await Promise.all(alberi.flatMap((albero) => albero.chiuse.map(async ({ id, catena }) => {
      const dentro = await chiama(albero.sid, id, radice);
      if (!Array.isArray(dentro) || !dentro.length) return;
      const lista = await scatole(albero, catena);
      if (!lista) { nonCoperti = true; return; }
      const posa = componi(lista);
      if (posa) campi.push(...nellaPagina(dentro, posa));
    })));
    return { campi, nonCoperti };
  } finally {
    dbg.removeListener('message', suMessaggio);
    if (nostro) { try { dbg.detach(); } catch (_) {} }
    else {
      await Promise.all(sessioni.map((s) => cmd('Runtime.releaseObjectGroup', { objectGroup: 'filo-campi' }, s.sid).catch(() => {})));
      await cmd('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false }).catch(() => {});
      await Promise.all(sessioni.filter((s) => s.sid).map((s) => cmd('Target.detachFromTarget', { sessionId: s.sid }).catch(() => {})));
    }
  }
}

// Le due misure insieme. Senza risposta dal protocollo in tempo la foto parte coperta come prima: le pagine coi
// componenti chiusi sono rare, una foto che non parte mai no.
async function campiSegretiFuoriPagina(webContents) {
  const vuoto = { campi: [], nonCoperti: false };
  const [riquadri, chiusi] = await Promise.all([
    campiSegretiNeiRiquadri(webContents).catch(() => vuoto),
    entro(campiSegretiNeiComponentiChiusi(webContents), ATTESA_COMPONENTI_MS).then((r) => r || vuoto),
  ]);
  return { campi: riquadri.campi.concat(chiusi.campi), nonCoperti: riquadri.nonCoperti || chiusi.nonCoperti };
}

module.exports = { campiSegretiFuoriPagina, campiSegretiNeiRiquadri, campiSegretiNeiComponentiChiusi, codiceMisura, radiciChiuse, componi };
