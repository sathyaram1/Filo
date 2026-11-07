// In un frame di YouTube esegue le regole contro le pubblicità (#1974) e guarda se il video si è rotto: non parte, salta
// alla fine, o compare l'avviso di YouTube sui blocchi. Allora lo dice al main, che rimanda la scheda al solo «Salta».
// Il motore è youtube-scriptlet.js, il ripiego services/bloccoYouTube.js; regole: tests/unit/youtubeGuardia.test.mjs.
'use strict';

const R = require('../main/services/regoleYouTube.js');
const { sorgente } = require('./youtube-scriptlet.js');

const AVVISO = 'ytd-enforcement-message-view-model';
const CANALE_REGOLE = 'filo:youtube-regole';
const CANALE_PRONTE = 'filo:youtube-regole-pronte';
// Dal «play» al primo passo avanti del video: oltre, il lettore è fermo.
const PARTENZA_MS = 8000;
// Il video che arriva alla fine entro così poco dal suo inizio, e più avanti di quanto il tempo gli permetteva, ci è
// stato mandato.
const FINE_ENTRO_MS = 5000;
const SALTO_S = 2;
const DURATA_MIN_S = 30;
// Un gesto dell'utente o una pubblicità appena finita spiegano da soli un salto.
const GESTO_MS = 1500;
const PUBBLICITA_MS = 2000;

const inPubblicita = (v) => {
  try { return !!(v.closest && v.closest('.ad-showing, .ad-interrupting')); } catch (_) { return false; }
};

/** I sintomi, su una finestra qualunque: `segnala(motivo)` parte al più una volta. */
function guarda({ window: w, segnala, partenzaMs = PARTENZA_MS, ora = () => Date.now() }) {
  const doc = w.document;
  let detto = false;
  let oss = null;
  const di = (motivo) => {
    if (detto) return;
    detto = true;
    try { if (oss) oss.disconnect(); } catch (_) {}
    try { segnala(motivo); } catch (_) {}
  };
  let ultimoGesto = -Infinity;
  let ultimaPub = -Infinity;
  for (const t of ['pointerdown', 'keydown']) w.addEventListener(t, (e) => { if (e.isTrusted) ultimoGesto = ora(); }, true);

  const avvisi = doc.getElementsByTagName(AVVISO);
  oss = new w.MutationObserver(() => { if (avvisi.length) di('avviso'); });
  oss.observe(doc, { childList: true, subtree: true });

  const inizio = new WeakMap();
  const video = (e) => (e.target && e.target.tagName === 'VIDEO' ? e.target : null);
  const spiegato = (v) => {
    if (inPubblicita(v)) { ultimaPub = ora(); return true; }
    return ora() - ultimaPub < PUBBLICITA_MS || ora() - ultimoGesto < GESTO_MS;
  };

  // Una scheda dietro può non caricare il video finché non la guardi: lì si ricomincia a contare quando torna davanti.
  const attendi = (v) => {
    const t0 = v.currentTime;
    w.setTimeout(() => {
      if (detto || v.paused || v.ended || !v.isConnected) return;
      if (doc.visibilityState === 'hidden') {
        const torna = () => { if (doc.visibilityState === 'hidden') return; doc.removeEventListener('visibilitychange', torna); attendi(v); };
        doc.addEventListener('visibilitychange', torna);
        return;
      }
      if (spiegato(v) || Math.abs(v.currentTime - t0) > 0.1) return;
      di('fermo');
    }, partenzaMs);
  };
  doc.addEventListener('play', (e) => {
    const v = video(e);
    if (!v || inPubblicita(v)) { if (v) ultimaPub = ora(); return; }
    attendi(v);
  }, true);

  doc.addEventListener('playing', (e) => {
    const v = video(e);
    if (v && !inizio.has(v)) inizio.set(v, { t: ora(), pos: Number(v.currentTime) || 0 });
  }, true);
  for (const t of ['loadstart', 'emptied']) doc.addEventListener(t, (e) => { const v = video(e); if (v) inizio.delete(v); }, true);

  // Si conta da dove il video è partito: uno aperto a pochi secondi dalla fine (un indirizzo col minuto dentro) ci
  // arriva a passo normale.
  const allaFine = (e) => {
    const v = video(e);
    if (!v || detto || spiegato(v)) return;
    const s = inizio.get(v);
    const d = v.duration;
    if (s === undefined || !Number.isFinite(d) || d < DURATA_MIN_S || ora() - s.t > FINE_ENTRO_MS) return;
    const passati = ((ora() - s.t) / 1000) * Math.max(1, Number(v.playbackRate) || 1);
    if (v.currentTime >= d - 1 && v.currentTime - s.pos > passati + SALTO_S) di('fine');
  };
  doc.addEventListener('timeupdate', allaFine, true);
  doc.addEventListener('ended', allaFine, true);
}

/**
 * Dal preload: regole dal main, eseguite nel mondo della pagina, e la guardia se ce n'erano. Senza regole (scheda
 * tornata al solo «Salta», regole non ancora scaricate, interruttore spento) le richiede quando il main dice che ce ne
 * sono di nuove: YouTube passa al video dopo senza ricaricare la pagina.
 */
function avvia({ ipcRenderer, webFrame, window: w, href }) {
  if (!R.hostYouTube(R.hostDi(href))) return false;
  const prova = () => {
    let qui = href;
    try { qui = (w.location && w.location.href) || href; } catch (_) {}
    let regole = [];
    try { regole = ipcRenderer.sendSync(CANALE_REGOLE, qui) || []; } catch (_) { regole = []; }
    const src = sorgente(regole);
    if (!src) return false;
    webFrame.executeJavaScript(src, false).catch(() => {});
    guarda({ window: w, segnala: (motivo) => { try { ipcRenderer.send('filo:youtube-rotto', motivo); } catch (_) {} } });
    return true;
  };
  if (prova()) return true;
  const pronte = () => { if (prova()) ipcRenderer.removeListener(CANALE_PRONTE, pronte); };
  try { ipcRenderer.on(CANALE_PRONTE, pronte); } catch (_) {}
  return false;
}

module.exports = { avvia, guarda, AVVISO, PARTENZA_MS, FINE_ENTRO_MS, CANALE_PRONTE };
