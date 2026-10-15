// Le stime di costo dei modelli (#819): listino di OpenRouter, saldo e tariffa dei crediti, registro d'uso. Solo main.
// Non inventa prezzi: senza listino la stima dice che non c'è. Il listino non porta chiavi (il catalogo è pubblico).
// Le regole della stima stanno in src/shared/stimaCosto.js.

const CATALOGO = 'https://openrouter.ai/api/v1/models';
// Il catalogo semplice elenca solo i modelli di testo: voce, dettatura e vettori stanno in liste a parte.
const LISTE = ['', '?output_modalities=speech', '?output_modalities=transcription', '?output_modalities=embeddings'];
const FRESCO_MS = 6 * 60 * 60 * 1000;
const RIPROVA_MS = 60 * 1000;
const ATTESA_MS = 15 * 1000;

let ultimo = null; // { listino, at }
let fallitoAt = 0;
let inVolo = null;

async function scarica() {
  const S = globalThis.SN_STIMA_COSTO;
  const liste = await Promise.allSettled(LISTE.map(async (q) => {
    const res = await globalThis.fetch(CATALOGO + q, { signal: AbortSignal.timeout(ATTESA_MS) });
    if (!res.ok) throw new Error(`listino ${res.status}`);
    const data = await res.json();
    return Array.isArray(data && data.data) ? data.data : [];
  }));
  // Senza la lista principale (quella dei modelli di testo) il listino non c'è: le altre da sole sarebbero un buco.
  if (liste[0].status !== 'fulfilled') throw liste[0].reason;
  const voci = liste.flatMap((l) => (l.status === 'fulfilled' ? l.value : []));
  return S.listinoDaCatalogo(voci);
}

// Il listino in memoria, rifatto ogni sei ore. OpenRouter muto: vale l'ultimo letto, se c'è; altrimenti null, e si
// riprova al più una volta al minuto.
async function listino({ forza = false } = {}) {
  if (!forza && ultimo && Date.now() - ultimo.at < FRESCO_MS) return ultimo.listino;
  if (!forza && !ultimo && Date.now() - fallitoAt < RIPROVA_MS) return null;
  if (!inVolo) {
    inVolo = scarica().then((l) => {
      ultimo = { listino: l, at: Date.now() };
      return l;
    }, (e) => {
      fallitoAt = Date.now();
      console.warn('[Filo] listino dei modelli non letto:', (e && e.message) || e);
      return ultimo ? ultimo.listino : null;
    }).finally(() => { inVolo = null; });
  }
  return inVolo;
}

// I crediti di chi usa Filo: quelli del portafoglio sul server, o il conteggio locale senza portafoglio. Con la
// chiave scritta dall'utente paga lui a OpenRouter: dollari, e niente avviso.
async function moneta() {
  const WM = globalThis.SN_WALLET_MAIN;
  const W = globalThis.SN_WALLET;
  let fonte = 'none';
  try { fonte = WM && WM.keySource ? await WM.keySource() : 'none'; } catch (_) { fonte = 'none'; }
  if (fonte === 'own') return { modo: 'dollari', creditiPerDollaro: null, saldo: null };
  if (WM && WM.haPortafoglio && WM.haPortafoglio()) {
    let saldo = null;
    try {
      const s = await WM.saldoPerChat({ fresco: false });
      saldo = s && Number.isFinite(Number(s.balance)) && s.balance != null ? Number(s.balance) : null;
    } catch (_) { saldo = null; }
    return { modo: 'crediti', creditiPerDollaro: W.creditsPerUsd(WM.tariffaCrediti ? WM.tariffaCrediti() : {}), saldo };
  }
  const C = globalThis.SN_CREDITS;
  let saldo = null;
  try { const p = C ? await C.getPublic() : null; saldo = p && Number.isFinite(Number(p.balance)) ? Number(p.balance) : null; } catch (_) {}
  let usdToEur = 0.92;
  try { usdToEur = Number((await globalThis.SN_STORAGE.getSettings()).usdToEur) || 0.92; } catch (_) {}
  return { modo: 'crediti', creditiPerDollaro: C && C.creditiPerDollaro ? C.creditiPerDollaro(usdToEur) : null, saldo };
}

// Il primo modello della catena predefinita di ogni funzione: è il metro dell'avviso.
function predefiniti(d) {
  const S = globalThis.SN_STIMA_COSTO;
  const C = globalThis.SN_CONST;
  const out = {};
  const models = (d && d.models) || {};
  for (const action of Object.keys(models)) {
    const primo = C.parseModelRefs(models[action] || '')[0];
    const voce = primo ? S.voceDi(primo, (d && d.modelRegistry) || {}) : null;
    if (voce) out[action] = voce;
  }
  return out;
}

// Tutto quello che serve a stimare, in una volta: { modo, creditiPerDollaro, saldo, soglia, registro, listino,
// predefiniti, listinoAt }. `Defaults` è il deposito della configurazione condivisa.
async function contesto({ Defaults, forzaListino = false } = {}) {
  const S = globalThis.SN_STIMA_COSTO;
  let settings = {};
  try { settings = await globalThis.SN_STORAGE.getSettings(); } catch (_) {}
  let d = {};
  try { if (Defaults) { await Defaults.refreshIfStale().catch(() => {}); d = Defaults.get() || {}; } } catch (_) { d = {}; }
  const [m, l, registro] = await Promise.all([
    moneta(),
    listino({ forza: forzaListino }),
    globalThis.SN_COSTS && globalThis.SN_COSTS.registroToken ? globalThis.SN_COSTS.registroToken().catch(() => ({})) : {},
  ]);
  return {
    ...m,
    soglia: S.soglia(settings),
    registro: registro || {},
    listino: l,
    listinoAt: ultimo ? new Date(ultimo.at).toISOString() : null,
    predefiniti: predefiniti(d),
  };
}

module.exports = { contesto, listino };
