// Le stime di costo dei modelli (#819): listino di OpenRouter, saldo e tariffa dei crediti, registro d'uso. Solo main.
// Non inventa prezzi: senza listino la stima dice che non c'è. Il listino non porta chiavi (il catalogo è pubblico).
// Le regole della stima stanno in src/shared/stimaCosto.js.

const CATALOGO = 'https://openrouter.ai/api/v1/models';
// Il catalogo semplice elenca solo i modelli di testo: voce, dettatura e vettori stanno in liste a parte.
const LISTE = ['', '?output_modalities=speech', '?output_modalities=transcription', '?output_modalities=embeddings'];
const FRESCO_MS = 6 * 60 * 60 * 1000;
const RIPROVA_MS = 60 * 1000;
const ATTESA_MS = 15 * 1000;

let ultimo = null; // { listino, finestre, at }
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
  try { globalThis.SN_CONST.registraCatalogoPesi(voci); } catch (_) {}
  return { listino: S.listinoDaCatalogo(voci), finestre: finestreDaCatalogo(voci) };
}

// La finestra di ogni modello (token in entrata e in uscita insieme), dallo stesso catalogo: misura le riletture
// della chat prima che un rifiuto la insegni (#868.7).
function finestreDaCatalogo(voci) {
  const out = Object.create(null);
  for (const m of Array.isArray(voci) ? voci : []) {
    const n = Number(m && m.context_length);
    if (m && typeof m.id === 'string' && Number.isFinite(n) && n > 0) out[m.id] = n;
  }
  return out;
}

// La finestra dell'ultimo listino letto, o null: non scarica niente (chi la vuole fresca chiede prima `listino()`).
// Le scorciatoie di smistamento valgono il modello base, come per i prezzi.
function finestra(model) {
  const f = ultimo && ultimo.finestre;
  const id = String(model || '').trim();
  if (!f || !id) return null;
  if (Object.prototype.hasOwnProperty.call(f, id)) return f[id];
  const base = id.replace(/:(nitro|floor|online)$/i, '');
  return base !== id && Object.prototype.hasOwnProperty.call(f, base) ? f[base] : null;
}

// Il listino in memoria, rifatto ogni sei ore. OpenRouter muto: vale l'ultimo letto, se c'è; altrimenti null, e si
// riprova al più una volta al minuto.
async function listino({ forza = false } = {}) {
  if (!forza && ultimo && Date.now() - ultimo.at < FRESCO_MS) return ultimo.listino;
  if (!forza && !ultimo && Date.now() - fallitoAt < RIPROVA_MS) return null;
  if (!inVolo) {
    inVolo = scarica().then((x) => {
      ultimo = { listino: x.listino, finestre: x.finestre, at: Date.now() };
      return x.listino;
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

// Un cambio di modello chiesto in chat (#819), prima della conferma: deve poter partire come dalla griglia delle
// Opzioni (configurazione personale, nomi che esistono, modello adatto alla funzione), e dice quanto costerà.
// → { rifiuto, perModello } oppure { costo } (la frase del costo e dell'avviso, o perché manca).
const ATTESA_CHAT_MS = 4000;
async function verificaCambio({ action, refs } = {}, { Defaults } = {}) {
  const S = globalThis.SN_STIMA_COSTO;
  const C = globalThis.SN_CONST;
  const Caps = globalThis.SN_MODEL_CAPS;
  let settings = {};
  try { settings = await globalThis.SN_STORAGE.getSettings(); } catch (_) {}
  if (settings.useDefaultModels !== false) {
    return {
      rifiuto: 'stai usando i modelli predefiniti, e con loro il modello di ogni funzione lo sceglie Filo',
      perModello: 'Dillo all\'utente: per scegliere lui il modello di una funzione serve spegnere «Usa modelli predefiniti» in Opzioni → Modelli e tenere lì i suoi modelli. Non spegnerlo tu se non te lo chiede.',
    };
  }
  const registry = settings.modelRegistry || {};
  const lista = (Array.isArray(refs) ? refs : []).map((r) => String(r || '').trim()).filter(Boolean);
  const ignoti = lista.filter((r) => !S.voceDi(r, registry));
  if (ignoti.length) {
    const nomi = Object.keys(registry);
    return {
      rifiuto: `${ignoti.map((r) => `«${r}»`).join(', ')} non ${ignoti.length > 1 ? 'sono fra i tuoi modelli' : 'è fra i tuoi modelli'}`,
      perModello: `I modelli del registro sono: ${nomi.length ? nomi.join(', ') : 'nessuno'}. Usa uno di questi, o un id di OpenRouter (con «/»), se è chiaro quale vuole l'utente; altrimenti chiediglielo.`,
    };
  }
  for (const r of lista) {
    const voce = S.voceDi(r, registry);
    const meta = registry[r] && C.entryModalities ? C.entryModalities(registry[r], r) : null;
    const ok = Caps ? Caps.modelMatchesAction(voce.provider, voce.model, action, meta || undefined) : { ok: true };
    if (ok && ok.ok === false) return { rifiuto: `«${r}» non va bene per questa funzione: ${ok.reason || 'non sa fare quello che serve'}` };
  }
  const ctx = await Promise.race([
    contesto({ Defaults }).catch(() => null),
    new Promise((res) => { const t = setTimeout(() => res(null), ATTESA_CHAT_MS); if (t.unref) t.unref(); }),
  ]);
  // Il listino in ritardo non è un costo zero: si dice, come la riga delle Opzioni, e lo scaricamento resta in volo.
  return { costo: ctx ? fraseCosto(action, lista, registry, ctx) : LISTINO_IN_RITARDO };
}
const LISTINO_IN_RITARDO = 'Il listino di OpenRouter non è arrivato in tempo: Filo non stima il costo senza. Lo trovi in Opzioni, accanto al modello.';

// «Circa 133 crediti per messaggio. Con opus i tuoi 4.300 crediti bastano per circa 32 messaggi.»
function fraseCosto(action, refs, registry, ctx) {
  const S = globalThis.SN_STIMA_COSTO;
  const stime = refs.map((r) => ({ r, v: S.valuta(action, r, registry, ctx) })).filter((x) => x.v);
  if (!stime.length) return '';
  const cifre = stime.length === 1
    ? (stime[0].v.ok ? `${stime[0].v.perUso.charAt(0).toUpperCase()}${stime[0].v.perUso.slice(1)}.` : stime[0].v.testo)
    : `${stime.map((x) => `${x.r}: ${x.v.ok ? x.v.perUso : x.v.breve}`).join('; ')}.`;
  const avvisi = [...new Set(stime.map((x) => x.v.avviso).filter(Boolean))];
  return [cifre, ...avvisi].join(' ');
}

module.exports = { contesto, listino, finestra, verificaCambio, fraseCosto };
