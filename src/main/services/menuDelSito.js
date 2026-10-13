// Il menu che un sito ha per il tasto destro (#975), dalla parte del main: rigira al sito il tasto destro che l'utente
// ha chiesto dalla voce «Menu di <sito>», conta le scelte e propone una volta di dare il tasto destro al sito.
// Il sito è sempre quello del frame mittente. Regole: patterns/il-menu-del-sito-e-una-voce-di-filo.md.
'use strict';

const SOGLIA = 3;
const TETTO_SITI = 2000;
const PROPOSTA_SEC = 30;

function t(chiave, ...args) {
  try { return globalThis.SN_I18N.t(chiave, ...args); } catch (_) { return chiave; }
}

/** L'host di un indirizzo web, senza www. PURA. */
function sitoDi(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) { return ''; }
}

/** La voce dell'elenco copre il sito? Stesso confronto del content script. PURA. */
function copre(voce, sito) {
  return typeof voce === 'string' && !!voce && !!sito && (sito === voce || sito.endsWith(`.${voce}`));
}

/** L'elenco dopo aver dato (o tolto) il tasto destro al menu del sito. Togliere toglie ogni voce che lo copre. PURA. */
function elencoDopo(elenco, sito, primo) {
  const prima = Array.isArray(elenco) ? elenco.filter((d) => typeof d === 'string' && d) : [];
  if (primo) return prima.some((d) => copre(d, sito)) ? prima : [...prima, sito].sort();
  return prima.filter((d) => !copre(d, sito));
}

/** Una scelta in più: torna le scelte aggiornate e se è il momento della proposta. PURA. */
function conta(scelte, sito, { primo = false, ora = Date.now() } = {}) {
  const tutte = scelte && typeof scelte === 'object' && !Array.isArray(scelte) ? { ...scelte } : {};
  const prima = tutte[sito] && typeof tutte[sito] === 'object' ? tutte[sito] : {};
  const voce = { n: (Number(prima.n) || 0) + 1, proposto: prima.proposto === true, alle: ora };
  const proponi = !primo && !voce.proposto && voce.n >= SOGLIA;
  if (proponi) voce.proposto = true;
  tutte[sito] = voce;
  const siti = Object.keys(tutte);
  if (siti.length > TETTO_SITI) {
    siti.sort((a, b) => (Number(tutte[a]?.alle) || 0) - (Number(tutte[b]?.alle) || 0));
    for (const via of siti.slice(0, siti.length - TETTO_SITI)) delete tutte[via];
  }
  return { scelte: tutte, proponi };
}

function frameDelMittente(sender) {
  const wc = sender && sender.wc;
  const frame = sender && sender.frame;
  if (!wc || (wc.isDestroyed && wc.isDestroyed()) || !frame) return null;
  let url = '';
  try { url = frame.url || ''; } catch (_) { return null; }
  let principale = false;
  try { principale = !!wc.mainFrame && frame.frameTreeNodeId === wc.mainFrame.frameTreeNodeId; } catch (_) { principale = false; }
  return { wc, sito: sitoDi(url), principale, incognito: !!(sender.win && sender.win._filoIncognito) };
}

async function impostazioni() {
  try { return (await globalThis.SN_STORAGE.getSettings()) || {}; } catch (_) { return {}; }
}

async function scrivi(sito, primo) {
  const s = await impostazioni();
  const prima = Array.isArray(s.menuDelSito) ? s.menuDelSito : [];
  const dopo = elencoDopo(prima, sito, primo);
  if (dopo.length === prima.length && dopo.every((d, i) => d === prima[i])) return;
  const { applySettingsUpdate } = require('./handlers');
  await applySettingsUpdate({ menuDelSito: dopo });
}

const chiaveScelte = () => globalThis.SN_CONST.STORAGE_KEYS.MENU_DEL_SITO_SCELTE;
let coda = Promise.resolve();
function inFila(fn) {
  const giro = coda.then(fn, fn);
  coda = giro.catch(() => {});
  return giro;
}

function proponi(win, sito) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('shell:toast', {
      text: t('menu_del_sito_proposta', sito),
      opts: { durationSec: PROPOSTA_SEC, key: `menu-del-sito-${sito}`, actions: [{ label: t('menu_del_sito_si'), menuDelSito: sito }] },
    });
  } catch (_) {}
}

async function segnaScelta(sito, win) {
  const primo = (await impostazioni()).menuDelSito;
  const giaSuo = Array.isArray(primo) && primo.some((d) => copre(d, sito));
  const esito = await inFila(async () => {
    const Storage = globalThis.SN_STORAGE;
    const r = conta(await Storage.getRaw(chiaveScelte(), {}), sito, { primo: giaSuo });
    await Storage.setRaw(chiaveScelte(), r.scelte);
    return r;
  });
  if (esito.proponi) proponi(win, sito);
}

// Il tasto destro vero sul punto dove l'utente l'aveva fatto: il ponte del page-preload lo lascia al sito. In un
// riquadro di un altro sito il clic del main non arriva: lo rigira il content script del riquadro.
async function apri(msg, sender, { win, view } = {}) {
  const f = frameDelMittente(sender);
  if (!f || !f.sito) return { ok: false };
  let cliccato = false;
  if (f.principale && view) {
    let zoom = 1;
    try { zoom = f.wc.getZoomFactor(); } catch (_) { zoom = 1; }
    let b = null;
    try { b = view.getBounds(); } catch (_) { b = null; }
    const p = b && require('./adSkip').puntoNellaVista(msg, zoom, b.width, b.height);
    if (p) {
      try { require('./permessiPagine').clicDiFilo(f.wc); } catch (_) {}
      try {
        f.wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
        f.wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'right', clickCount: 1 });
        f.wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'right', clickCount: 1 });
        cliccato = true;
      } catch (_) { cliccato = false; }
    }
  }
  if (!f.incognito) segnaScelta(f.sito, win).catch(() => {});
  return { ok: true, cliccato };
}

// Dal tasto destro di Filo sul sito: in incognito si toglie e basta, perché aggiungere scriverebbe dove si è stati.
async function cambia(msg, sender) {
  const f = frameDelMittente(sender);
  if (!f || !f.sito) return { ok: false };
  const primo = !!(msg && msg.primo);
  if (primo && f.incognito) return { ok: false };
  await scrivi(f.sito, primo);
  return { ok: true };
}

// Il «Sì» della proposta, dalla shell: vale solo per un sito a cui Filo l'ha davvero proposto.
async function accetta(msg) {
  const sito = String((msg && msg.sito) || '').toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(sito)) return { ok: false };
  let scelte = {};
  try { scelte = await globalThis.SN_STORAGE.getRaw(chiaveScelte(), {}); } catch (_) { scelte = {}; }
  if (!scelte || !scelte[sito] || scelte[sito].proposto !== true) return { ok: false };
  await scrivi(sito, true);
  return { ok: true, frase: t('menu_del_sito_accettato', sito) };
}

module.exports = { apri, cambia, accetta, sitoDi, copre, elencoDopo, conta, SOGLIA, TETTO_SITI };
