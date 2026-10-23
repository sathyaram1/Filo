// Quanto costa un uso tipico di una funzione con un modello (#819): listino di OpenRouter per i token medi della funzione.
// Pura (niente rete, niente Electron): la usano Opzioni, Modelli predefiniti e la chat; il contesto lo compone il main.
// Regole: tests/unit/stimaCosto.test.mjs.

(function (global) {
  'use strict';

  const A = (global.SN_CONST && global.SN_CONST.ACTIONS) || {};

  // Medie prudenti, quando l'utente non ha ancora usato la funzione: stanno sul lato alto di un uso vero, così un
  // modello caro non sembra economico prima del primo uso. `voce`: si paga a durata, non a token.
  const TIPI = Object.freeze({
    conversazione: { prompt: 16000, completion: 900 },
    documento: { prompt: 8000, completion: 800 },
    traduzione: { prompt: 5000, completion: 5000 },
    testo: { prompt: 3000, completion: 500 },
    breve: { prompt: 1500, completion: 150 },
    immagine: { prompt: 3000, completion: 500 },
    vettori: { prompt: 2000, completion: 0 },
    voce: null,
  });

  const U = (s, p) => ({ s, p });
  const FUNZIONI = {
    [A.FILO_CHAT]: ['conversazione', U('messaggio', 'messaggi')],
    [A.DECKS_CHAT]: ['documento', U('messaggio', 'messaggi')],
    [A.HELP]: ['documento', U('passo', 'passi')],
    [A.FILO_DASHBOARD]: ['documento', U('aggiornamento', 'aggiornamenti')],
    [A.FILO_LESSON]: ['documento', U('conversazione', 'conversazioni')],
    [A.FILO_COMPACT]: ['documento', U('riordino', 'riordini')],
    [A.FILO_TAB_TRIAGE]: ['documento', U('riordino', 'riordini')],
    [A.FILO_TAB_SUMMARY]: ['documento', U('scheda', 'schede')],
    [A.EDITOR_SUMMARY]: ['documento', U('riassunto', 'riassunti')],
    [A.TRANSLATE_PAGE]: ['traduzione', U('pagina', 'pagine')],
    [A.EXPLAIN]: ['testo', U('spiegazione', 'spiegazioni')],
    [A.EXPLAIN_DEEP]: ['testo', U('spiegazione', 'spiegazioni')],
    [A.EXPLAIN_LINK]: ['testo', U('spiegazione', 'spiegazioni')],
    [A.TRANSLATE_SELECTION]: ['testo', U('traduzione', 'traduzioni')],
    [A.EDIT_TEXT]: ['testo', U('riscrittura', 'riscritture')],
    [A.SPELLCHECK_SEMANTIC]: ['testo', U('controllo', 'controlli')],
    [A.SPELLCHECK_CONTEXT]: ['testo', U('controllo', 'controlli')],
    [A.DECKS_OPINION]: ['testo', U('parere', 'pareri')],
    [A.HELP_INTENT_GUESS]: ['testo', U('controllo', 'controlli')],
    [A.HELP_INTENT_JUDGE]: ['testo', U('controllo', 'controlli')],
    [A.FILO_TAB_SEARCH]: ['testo', U('ricerca', 'ricerche')],
    [A.MANAGE_SEARCH]: ['testo', U('ricerca', 'ricerche')],
    [A.CATEGORIZE]: ['breve', U('pagina', 'pagine')],
    [A.FILO_CHAT_TRIAGE]: ['breve', U('chat', 'chat')],
    [A.EDITOR_TITLE]: ['breve', U('titolo', 'titoli')],
    [A.FEEDBACK_TITLE]: ['breve', U('segnalazione', 'segnalazioni')],
    [A.DECKS_AUTOTAG]: ['breve', U('giro', 'giri')],
    [A.DECKS_SEARCH_FILTER]: ['breve', U('giro', 'giri')],
    [A.SAFEBROWSE_JUDGE]: ['breve', U('sito', 'siti')],
    [A.GEOBLOCK_CLASSIFY]: ['breve', U('pagina', 'pagine')],
    [A.PROVIDER_TEST]: ['breve', U('prova', 'prove')],
    [A.MANAGE_SEARCH_CLASSIFY]: ['breve', U('giro', 'giri')],
    [A.DESCRIBE_IMAGE]: ['immagine', U('immagine', 'immagini')],
    [A.TRANSCRIBE_IMAGE]: ['immagine', U('immagine', 'immagini')],
    [A.FILE_NAME]: ['immagine', U('file', 'file')],
    [A.EMBED_COOKIE_CHECK]: ['immagine', U('riquadro', 'riquadri')],
    [A.ARCHIVE_EMBED]: ['vettori', U('scheda', 'schede')],
    [A.TTS]: ['voce', U('lettura', 'letture')],
    [A.TRANSCRIBE_AUDIO]: ['voce', U('dettatura', 'dettature')],
  };
  const FUNZIONE_IGNOTA = ['testo', U('uso', 'usi')];

  // Sotto questi campioni la media dell'utente è rumore: vale quella prudente.
  const CAMPIONI_MINIMI = 3;
  // La media corre sugli ultimi usi: ogni campione nuovo pesa almeno 1/FINESTRA.
  const FINESTRA = 50;
  const SOGLIA_PREDEFINITA = 5;
  const SOGLIA_MAX = 1000;

  function funzione(action) {
    const f = FUNZIONI[action] || FUNZIONE_IGNOTA;
    return { tipo: f[0], unita: f[1] };
  }
  function aConsumo(action) {
    return funzione(action).tipo === 'voce';
  }

  // ── Listino ──────────────────────────────────────────────────────────────
  // OpenRouter dà i prezzi in dollari per token, come stringhe; «-1» vuol dire «variabile» (il router automatico).
  function numeroListino(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function prezzoDaCatalogo(pricing) {
    if (!pricing || typeof pricing !== 'object') return null;
    const prompt = numeroListino(pricing.prompt);
    const completion = numeroListino(pricing.completion);
    if (prompt == null || completion == null) return null;
    const out = { prompt, completion };
    const req = numeroListino(pricing.request);
    if (req) out.request = req;
    const cache = numeroListino(pricing.input_cache_read);
    if (cache != null) out.cacheRead = cache;
    return out;
  }
  // Il catalogo intero (le voci di `/api/v1/models`) → { id: prezzo }. Le voci senza prezzo leggibile restano fuori.
  function listinoDaCatalogo(voci) {
    const out = Object.create(null);
    for (const m of Array.isArray(voci) ? voci : []) {
      const id = m && typeof m.id === 'string' ? m.id : '';
      const p = id ? prezzoDaCatalogo(m.pricing) : null;
      if (p) out[id] = p;
    }
    return out;
  }
  // `:nitro`, `:floor`, `:online` sono scorciatoie di smistamento che il catalogo non elenca: vale il modello base.
  function prezzoDi(listino, model) {
    if (!listino || !model) return null;
    const id = String(model).trim();
    if (Object.prototype.hasOwnProperty.call(listino, id)) return listino[id];
    const base = id.replace(/:(nitro|floor|online)$/i, '');
    return base !== id && Object.prototype.hasOwnProperty.call(listino, base) ? listino[base] : null;
  }

  // ── Registro d'uso (token medi per funzione) ─────────────────────────────
  // Un campione per uso: token in entrata (di cui letti dalla cache del fornitore), in uscita, dollari se il router
  // li ha detti. Le funzioni a consumo (voce, dettatura) tengono la spesa media per modello: lì i token non dicono niente.
  function aggiungiCampione(registro, action, { prompt = 0, completion = 0, cached = 0, usd = 0, model = '' } = {}) {
    const reg = registro && typeof registro === 'object' ? registro : {};
    if (!action) return reg;
    const r = reg[action] && typeof reg[action] === 'object' ? reg[action] : { n: 0, prompt: 0, completion: 0, cached: 0 };
    const p = Math.max(0, Number(prompt) || 0);
    const c = Math.max(0, Number(completion) || 0);
    const k = Math.min(p, Math.max(0, Number(cached) || 0));
    if (p + c > 0) {
      const n = Math.min((Number(r.n) || 0) + 1, FINESTRA);
      r.prompt = (Number(r.prompt) || 0) + (p - (Number(r.prompt) || 0)) / n;
      r.completion = (Number(r.completion) || 0) + (c - (Number(r.completion) || 0)) / n;
      r.cached = (Number(r.cached) || 0) + (k - (Number(r.cached) || 0)) / n;
      r.n = n;
    }
    const spesa = Number(usd) || 0;
    if (aConsumo(action) && spesa > 0 && model) {
      const modelli = r.modelli && typeof r.modelli === 'object' ? r.modelli : {};
      const m = modelli[model] || { n: 0, usd: 0 };
      const n = Math.min((Number(m.n) || 0) + 1, FINESTRA);
      // In coda l'ultimo usato: oltre dieci modelli esce quello usato meno di recente.
      delete modelli[model];
      modelli[model] = { n, usd: (Number(m.usd) || 0) + (spesa - (Number(m.usd) || 0)) / n };
      const nomi = Object.keys(modelli);
      if (nomi.length > 10) delete modelli[nomi[0]];
      r.modelli = modelli;
    }
    reg[action] = r;
    return reg;
  }

  // I token di un uso tipico: la media dell'utente se ce n'è abbastanza, altrimenti quella prudente del tipo.
  function tokenTipici(action, registro) {
    const r = registro && registro[action];
    if (r && Number(r.n) >= CAMPIONI_MINIMI && (Number(r.prompt) + Number(r.completion)) > 0) {
      return { prompt: Number(r.prompt) || 0, completion: Number(r.completion) || 0, cached: Number(r.cached) || 0, fonte: 'registro' };
    }
    const t = TIPI[funzione(action).tipo];
    return t ? { prompt: t.prompt, completion: t.completion, cached: 0, fonte: 'prudente' } : null;
  }

  function costoUsd(prezzo, token) {
    if (!prezzo || !token) return null;
    const cached = Math.min(token.prompt, token.cached || 0);
    const leggeCache = prezzo.cacheRead != null ? prezzo.cacheRead : prezzo.prompt;
    return (token.prompt - cached) * prezzo.prompt + cached * leggeCache + token.completion * prezzo.completion + (prezzo.request || 0);
  }

  // ── Numeri in parole ─────────────────────────────────────────────────────
  function it(n, decimali) {
    return Number(n).toLocaleString('it-IT', { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: decimali });
  }
  function cifraCrediti(v) {
    if (v < 0.1) return { testo: 'meno di 0,1 crediti', circa: false };
    const r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
    return { testo: `${it(r, 1)} ${r === 1 ? 'credito' : 'crediti'}`, circa: true };
  }
  function cifraDollari(v) {
    if (v < 0.0001) return { testo: 'meno di 0,0001 $', circa: false };
    const r = Number(v.toPrecision(2));
    return { testo: `${it(r, 6)} $`, circa: true };
  }
  // Quanti usi: interi sotto i cento, poi due cifre significative per difetto (1.234 → 1.200).
  function quanti(n) {
    if (n < 100) return Math.floor(n);
    const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.floor(n / mag) * mag;
  }

  // ── La stima ─────────────────────────────────────────────────────────────
  // ctx: { modo: 'crediti'|'dollari', creditiPerDollaro, listino: {id: prezzo}|null, registro }
  // entry: la voce del registro dei modelli ({ provider, model }).
  // → { ok: true, usd, valore, modo, unita, fonte, breve, testo } oppure { ok: false, motivo, breve, testo }.
  function stima(action, entry, ctx) {
    const c = ctx || {};
    const { unita } = funzione(action);
    const model = entry && entry.model ? String(entry.model) : '';
    const provider = entry && entry.provider ? String(entry.provider) : 'openrouter';
    const BREVI = { listino: 'listino non disponibile', consumo: 'costo da misurare' };
    const nonNota = (motivo, testo) => ({ ok: false, motivo, unita, breve: BREVI[motivo] || 'prezzo non noto', testo });
    if (!model) return null;
    if (provider !== 'openrouter') return nonNota('fornitore', 'Questo fornitore non pubblica un listino: Filo non stima il costo.');
    let usd = null;
    let fonte = '';
    if (aConsumo(action)) {
      const m = c.registro && c.registro[action] && c.registro[action].modelli && c.registro[action].modelli[model];
      if (!m || !(Number(m.usd) > 0)) {
        return nonNota('consumo', 'Questa funzione si paga a durata, non a token: Filo dice il costo di questo modello dopo che l\'hai usato.');
      }
      usd = Number(m.usd);
      fonte = 'misura';
    } else {
      if (!c.listino) return nonNota('listino', 'Listino di OpenRouter non disponibile adesso: Filo non stima il costo senza.');
      const prezzo = prezzoDi(c.listino, model);
      if (!prezzo) return nonNota('modello', `OpenRouter non elenca un prezzo per ${model}: Filo non stima il costo senza.`);
      const token = tokenTipici(action, c.registro);
      usd = costoUsd(prezzo, token);
      fonte = token.fonte;
    }
    const dollari = c.modo === 'dollari';
    const valore = dollari ? usd : usd * (Number(c.creditiPerDollaro) || 0);
    const cifra = dollari ? cifraDollari(valore) : cifraCrediti(valore);
    const perUso = `${cifra.circa ? 'circa ' : ''}${cifra.testo} per ${unita.s}`;
    const da = fonte === 'registro' ? `dal listino di OpenRouter e dai token medi dei tuoi ultimi ${unita.p}`
      : fonte === 'misura' ? 'da quanto ti è costato in media con questo modello'
        : 'dal listino di OpenRouter e da una media prudente per questa funzione (non l\'hai ancora usata abbastanza)';
    return {
      ok: true, usd, valore, modo: dollari ? 'dollari' : 'crediti', unita, fonte,
      breve: `${cifra.circa ? '≈ ' : ''}${cifra.testo}`,
      perUso,
      testo: `${perUso.charAt(0).toUpperCase()}${perUso.slice(1)}, ${da}.`,
    };
  }

  // La soglia dell'avviso dalle impostazioni: assente = 5 volte; 0 = mai.
  function soglia(settings) {
    const raw = settings && settings.costoModelli ? settings.costoModelli.soglia : undefined;
    if (raw === undefined || raw === null || raw === '') return SOGLIA_PREDEFINITA;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return SOGLIA_PREDEFINITA;
    return Math.min(SOGLIA_MAX, n);
  }

  // L'avviso accanto a una scelta: solo coi crediti di Filo, solo se il modello costa più di `soglia` volte quello
  // predefinito per la funzione. Informa e basta: la scelta resta salvata. '' quando non c'è niente da dire.
  // `scelta` e `predefinita` sono esiti di `stima`; `nome` è come l'utente chiama il modello.
  function avviso({ scelta, predefinita, soglia: s, saldo, nome } = {}) {
    if (!scelta || !scelta.ok || scelta.modo !== 'crediti') return '';
    if (!predefinita || !predefinita.ok || !(predefinita.usd > 0)) return '';
    const limite = Number(s);
    if (!(limite > 0)) return '';
    const volte = scelta.usd / predefinita.usd;
    if (!(volte > limite)) return '';
    const chi = nome ? `Con ${nome}` : 'Con questo modello';
    const u = scelta.unita;
    const tot = Number(saldo);
    if (Number.isFinite(tot) && tot > 0 && scelta.valore > 0) {
      const n = tot / scelta.valore;
      const saldoTesto = `${it(Math.floor(tot), 0)} ${Math.floor(tot) === 1 ? 'credito' : 'crediti'}`;
      if (n < 1) return `${chi} ogni ${u.s} costa ${cifraCrediti(scelta.valore).testo}: più dei ${saldoTesto} che hai.`;
      const q = quanti(n);
      return `${chi} i tuoi ${saldoTesto} bastano per circa ${it(q, 0)} ${q === 1 ? u.s : u.p}.`;
    }
    return `${chi} ogni ${u.s} costa circa ${it(Math.round(volte), 0)} volte quello del modello predefinito.`;
  }

  // Il modello dietro un nome della catena: la voce del registro, o un id grezzo del router (con «/» o «:»).
  function voceDi(ref, registry) {
    const nick = String(ref == null ? '' : ref).trim();
    if (!nick) return null;
    const e = registry && Object.prototype.hasOwnProperty.call(registry, nick) ? registry[nick] : null;
    if (e && e.provider && e.model) return { provider: String(e.provider), model: String(e.model) };
    if (e && e.openrouter) return { provider: 'openrouter', model: String(e.openrouter) };
    if (!e && /[/:]/.test(nick)) return { provider: 'openrouter', model: nick };
    return null;
  }

  // Stima e avviso di un nome della catena, contro il modello predefinito della funzione (`ctx.predefiniti[action]`).
  function valuta(action, ref, registry, ctx) {
    const c = ctx || {};
    const s = stima(action, voceDi(ref, registry), c);
    if (!s) return null;
    const p = c.predefiniti && c.predefiniti[action] ? stima(action, c.predefiniti[action], c) : null;
    return { ...s, avviso: avviso({ scelta: s, predefinita: p, soglia: c.soglia, saldo: c.saldo, nome: String(ref).trim() }) };
  }

  global.SN_STIMA_COSTO = {
    TIPI, CAMPIONI_MINIMI, FINESTRA, SOGLIA_PREDEFINITA, SOGLIA_MAX,
    funzione, aConsumo, listinoDaCatalogo, prezzoDaCatalogo, prezzoDi, aggiungiCampione, tokenTipici, costoUsd,
    stima, soglia, avviso, voceDi, valuta,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
