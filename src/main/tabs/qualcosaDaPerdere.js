// «La scheda ha qualcosa da perdere»: testo scritto in un campo o in un'area modificabile, o un media che suona.
// Il passaggio di «Resta connesso» e la ricarica dopo la finestrella d'accesso (#759.2, #1629) non ricaricano in
// silenzio una pagina così. Prove: tests/unit/qualcosaDaPerdere.test.mjs, tests/cookies-resta-connesso-ricarica.spec.mjs.

const MONDO = 1001;
// Una pagina che non risponde non ferma chi chiede: senza risposta vale «niente da perdere».
const ATTESA_MS = 2000;
// Le aree ricordate per pagina: un editor ne crea tante, ne basta una scritta.
const TETTO_AREE = 64;

// A ogni dom-ready: ricorda le aree modificabili (contenteditable) dove l'utente ha scritto davvero, perché del loro
// contenuto non si sa cosa c'era all'arrivo.
const SEGUI_SCRITTURA = `(() => {
  if (window.__filoAreeScritte) return;
  const aree = window.__filoAreeScritte = new Set();
  document.addEventListener('input', (e) => {
    if (!e.isTrusted || aree.size >= ${TETTO_AREE}) return;
    let t = null;
    try { t = e.composedPath()[0]; } catch (_) { t = e.target; }
    if (!t || !t.isContentEditable) return;
    while (t.parentElement && t.parentElement.isContentEditable) t = t.parentElement;
    aree.add(t);
  }, true);
})()`;

const CAMPI = `
  const TESTO = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);
  const scritto = () => {
    try {
      for (const el of document.querySelectorAll('input, textarea')) {
        if (el.disabled || el.readOnly) continue;
        if (el.tagName === 'INPUT' && !TESTO.has(String(el.type || 'text').toLowerCase())) continue;
        const v = String(el.value || '');
        if (v.trim() && v !== el.defaultValue) return true;
      }
    } catch (_) {}
    return false;
  };
  const suona = () => {
    try {
      for (const m of document.querySelectorAll('video, audio')) {
        if (!m.paused && !m.ended && !m.muted && m.volume > 0) return true;
      }
    } catch (_) {}
    return false;
  };`;

const GUARDA_PAGINA = `(() => {${CAMPI}
  let aree = false;
  try {
    for (const a of window.__filoAreeScritte || []) {
      if (a.isConnected && String(a.innerText || a.textContent || '').trim()) { aree = true; break; }
    }
  } catch (_) {}
  return scritto() || aree || suona();
})()`;

// Nei riquadri arrivati (un modulo di commento incorporato): solo i campi, nel mondo della pagina.
const GUARDA_RIQUADRO = `(() => {${CAMPI}
  return scritto() || suona();
})()`;

function entro(p) {
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), ATTESA_MS);
    Promise.resolve(p).then((v) => { clearTimeout(t); ok(v); }, () => { clearTimeout(t); ok(null); });
  });
}

function segui(wc) {
  try { wc.executeJavaScriptInIsolatedWorld(MONDO, [{ code: SEGUI_SCRITTURA }]).catch(() => {}); } catch (_) {}
}

async function qualcosaDaPerdere(wc) {
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
  try { if (wc.isCurrentlyAudible()) return true; } catch (_) {}
  let p = null;
  try { p = wc.executeJavaScriptInIsolatedWorld(MONDO, [{ code: GUARDA_PAGINA }]); } catch (_) { p = null; }
  if (await entro(p) === true) return true;
  let riquadri = [];
  try {
    const { riquadroArrivato } = require('../services/riquadroArrivato');
    riquadri = wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame && riquadroArrivato(f));
  } catch (_) { riquadri = []; }
  for (const f of riquadri) {
    let q = null;
    try { q = f.executeJavaScript(GUARDA_RIQUADRO); } catch (_) { q = null; }
    if (await entro(q) === true) return true;
  }
  return false;
}

module.exports = { qualcosaDaPerdere, segui, SEGUI_SCRITTURA, GUARDA_PAGINA };
