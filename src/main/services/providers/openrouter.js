// Provider OpenRouter — client minimale con supporto streaming SSE.
//
// Oltre alle chat, dal router passano anche le tre funzioni che prima avevano
// bisogno dell'API diretta di un produttore: lettura ad alta voce
// (/audio/speech), dettatura (/audio/transcriptions) e indicizzazione
// (/embeddings). Stessa chiave, stessa lista di esclusione dei fornitori, e —
// dove il router non lo dice nella risposta — lo stesso riscontro su chi ha
// davvero servito, chiesto a posteriori (lookupServedBy). I classificatori
// (decisioni a domande chiuse) hanno il loro endpoint: `decisions`.

(function (global) {
  'use strict';

  const Ragionamento = require('./ragionamentoRimandato');

  const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
  const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
  const SPEECH_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
  const TRANSCRIPTIONS_ENDPOINT = 'https://openrouter.ai/api/v1/audio/transcriptions';
  const EMBEDDINGS_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';
  // I classificatori (Jev) non passano dalla chat: hanno un endpoint loro, ancora in alfa sul router.
  const DECISIONS_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
  const GENERATION_ENDPOINT = 'https://openrouter.ai/api/v1/generation';
  const AUTH_KEY_ENDPOINT = 'https://openrouter.ai/api/v1/auth/key';
  const CREDITS_ENDPOINT = 'https://openrouter.ai/api/v1/credits';

  function buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      // Header raccomandati da OpenRouter: opzionali, utili per la fairness dei rate limit.
      'HTTP-Referer': 'https://filo.local',
      'X-Title': 'Filo',
    };
  }

  // Il punto unico in cui la chiave entra in una chiamata (#629). Ogni
  // funzione qui sotto passa di qua, così il ripiego vale per tutte: chat,
  // spiega, traduci, voce, dettatura, vettori. Se OpenRouter rifiuta la
  // CHIAVE (401, 402, 403) e chi tiene le chiavi (SN_WALLET_MAIN, nel main)
  // ne conosce una di riserva per quella con cui si è partiti — la chiave
  // personale del portafoglio, quando la chiamata era partita con la chiave
  // scritta dall'utente — si rifà subito la stessa richiesta con la riserva,
  // nella stessa risposta. Rete, 429, 5xx e gli errori di modello non
  // c'entrano con la chiave e non passano di qui. Torna la risposta da
  // leggere più:
  //   keyUsed    la chiave che ha servito davvero (per le letture a posteriori,
  //              che vogliono la stessa chiave della generazione);
  //   keySource  'own' | 'personal' | 'factory' | '' — chi la registra decide
  //              da qui se la riga d'uso va scritta;
  //   keyFallback { status } se il ripiego è avvenuto, altrimenti null.
  // Se anche la riserva rifiuta, l'errore che risale è il SUO (con la
  // personale un 402 sono i crediti finiti), e il rifiuto della chiave
  // propria resta comunque registrato: la pagina Crediti lo mostra.
  // La prova di una chiave non ripiega (SN_WALLET_MAIN.senzaRipiego).
  // `makeInit(chiave, { own })` riceve anche se quella chiave è la propria: con l'interruttore della chiave propria
  // (#962) il corpo cambia lista di esclusione, e il ripiego sui crediti riparte con l'intera. `ripiegoAmmesso`, se
  // c'è, decide prima del ripiego se i crediti ammettono la chiamata: dove il router non applica la lista (voce,
  // dettatura) la si controlla qui, e se non la ammettono il rifiuto della chiave propria risale com'è.
  // `model` e `providerRouting` servono alla regola dei crediti (#830): coi crediti la richiesta di un modello fuori
  // politica non parte, e la chiave propria rifiutata non ripiega su di loro.
  async function fetchWithKey(url, apiKey, makeInit, { ripiegoAmmesso = null, model = '', providerRouting = null } = {}) {
    const startSource = await keySourceOf(apiKey);
    if (PAGA_FILO.has(startSource) && !(await ammessoCoiCrediti(model, providerRouting))) throw erroreCrediti(model);
    let res = await fetch(url, makeInit(apiKey, { own: startSource === 'own' }));
    let keyUsed = apiKey;
    let keyFallback = null;
    const W = global.SN_WALLET;
    const K = global.SN_WALLET_MAIN;
    if (!res.ok && W && W.isKeyRefusalStatus(res.status) && K && typeof K.alternativeKeyFor === 'function') {
      // Un 403 è un rifiuto della chiave solo se il corpo non parla di
      // moderazione: un testo segnalato lo è con qualunque chiave, e la
      // risposta deve risalire com'è (il corpo resta da leggere per chi la
      // racconta all'utente).
      const detail = (await res.clone().text().catch(() => '')).slice(0, 300);
      let alt = null;
      if (W.isKeyRefusal(res.status, detail)) {
        try { alt = await K.alternativeKeyFor(apiKey); } catch (_) { alt = null; }
      }
      if (alt && alt.key && !(await ammessoCoiCrediti(model, providerRouting))) {
        try { await K.noteOwnKeyRefusal({ status: res.status, detail, served: false }); } catch (_) {}
        contaRipiego(res.status, 'non_ammesso');
        throw erroreCrediti(model, { chiaveRifiutata: res.status });
      }
      if (alt && alt.key && typeof ripiegoAmmesso === 'function') {
        let ammesso = false;
        try { ammesso = await ripiegoAmmesso(); } catch (_) { ammesso = false; }
        if (!ammesso) {
          try { await K.noteOwnKeyRefusal({ status: res.status, detail, served: false }); } catch (_) {}
          contaRipiego(res.status, 'non_ammesso');
          alt = null;
        }
      }
      if (alt && alt.key) {
        const refused = { status: res.status, detail };
        // Il rifiuto si annota DOPO il ripiego: Crediti dice che Filo ha
        // usato i crediti solo se la personale ha risposto davvero.
        try {
          res = await fetch(url, makeInit(alt.key, { own: false }));
        } catch (e) {
          try { await K.noteOwnKeyRefusal({ ...refused, served: false }); } catch (_) {}
          contaRipiego(refused.status, 'fallito');
          throw e;
        }
        try { await K.noteOwnKeyRefusal({ ...refused, served: res.ok }); } catch (_) {}
        contaRipiego(refused.status, res.ok ? 'riuscito' : 'fallito');
        keyUsed = alt.key;
        keyFallback = { status: refused.status, from: 'own', to: alt.source || 'personal' };
        if (!res.ok) keyFallback.failed = res.status;
      }
    }
    const keySource = keyUsed === apiKey ? startSource : await keySourceOf(keyUsed);
    // La chiave propria ha appena servito una chiamata: il rifiuto ricordato
    // in Crediti (se c'era) non vale più, e spesa e residuo sono cambiati.
    if (res.ok && keySource === 'own' && K && typeof K.noteOwnKeySuccess === 'function') {
      try { K.noteOwnKeySuccess().catch(() => {}); } catch (_) {}
    }
    // Anche sulla risposta: così l'errore che httpError costruisce da un
    // rifiuto sa con quale chiave si era partiti e se il ripiego c'è stato
    // (e ha fallito), e chi lo racconta all'utente può dirlo per esteso.
    try { res.keySource = keySource; res.keyFallback = keyFallback; } catch (_) {}
    return { res, keyUsed, keySource, keyFallback };
  }

  // Il ripiego dalla chiave propria ai crediti, per status ed esito: lo contano i contatori del servizio (#1472).
  function contaRipiego(status, esito) {
    try { require('../contatoriServizio').misura('ripiegoChiave', status, esito); } catch (_) {}
  }

  // Chiavi che spendono i crediti di Filo. Una chiave di provenienza ignota ('') è quella dei test senza portafoglio.
  const PAGA_FILO = new Set(['personal', 'factory']);
  async function ammessoCoiCrediti(model, routing) {
    const C = global.SN_CONST;
    if (!model || !C || typeof C.creditsAllowModelLetto !== 'function') return true;
    return C.creditsAllowModelLetto(model, routing && routing.weights);
  }
  // Il codice e la frase del «nessun host ammesso» (#828); chi conosce la funzione la ricompone (modelGate).
  function erroreCrediti(model, { chiaveRifiutata = 0 } = {}) {
    const CE = global.SN_CHAT_ERRORS;
    const err = new Error(`NO_ALLOWED_HOST ${model}`);
    err.code = 'NO_ALLOWED_HOST';
    err.reason = 'crediti';
    err.provider = 'openrouter';
    err.model = model;
    err.hosts = [];
    if (chiaveRifiutata) err.chiaveRifiutata = chiaveRifiutata;
    if (CE && typeof CE.motivoCrediti === 'function') {
      err.motivo = CE.motivoCrediti(!!chiaveRifiutata);
      err.message = CE.fraseNessunHost({ modello: model, motivo: err.motivo, rimedio: CE.rimedioCrediti('opzioni', !!chiaveRifiutata) });
    }
    console.warn(`[Filo policy] "${model}" non è fra i modelli dei crediti di Filo: ${chiaveRifiutata ? 'niente ripiego dalla chiave propria' : 'richiesta non partita'}`);
    return err;
  }

  // Da dove viene una chiave ('own' | 'personal' | 'factory'), per chi tiene le chiavi; '' se non c'è chi lo sa.
  async function keySourceOf(apiKey) {
    const K = global.SN_WALLET_MAIN;
    if (!K || typeof K.keySourceOf !== 'function') return '';
    try { return (await K.keySourceOf(apiKey)) || ''; } catch (_) { return ''; }
  }

  // La lista di esclusione di una chiamata (#962): pagata con la chiave propria a interruttore acceso vale la sua
  // (`ownKeyIgnore`), pagata coi crediti di Filo, anche dopo un ripiego, sempre l'intera.
  function excludedFor(routing, ownKey) {
    const r = routing && typeof routing === 'object' ? routing : {};
    const list = ownKey && Array.isArray(r.ownKeyIgnore) ? r.ownKeyIgnore : r.ignore;
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }

  // Parte con la chiave propria e una lista sua? Chi tiene le chiavi si interroga solo se la lista c'è.
  async function startsOwn(apiKey, routing) {
    if (!routing || !Array.isArray(routing.ownKeyIgnore)) return false;
    return (await keySourceOf(apiKey)) === 'own';
  }

  // Traduce il livello di reasoning scelto dall'owner (#369) nel campo
  // `reasoning` che OpenRouter capisce. `wantThoughts` = il caller vuole anche i
  // token di ragionamento in streaming (onReasoning). Ritorna null se non c'è
  // nulla da chiedere (auto senza streaming = comportamento di prima).
  //   - 'off'  → { enabled: false }         (chiede al modello di non ragionare)
  //   - low/medium/high → { effort: <lvl> } (sforzo esplicito, quando supportato)
  // I modelli che non ragionano ignorano il campo: è best-effort.
  function reasoningField(level, wantThoughts) {
    if (level === 'off') return { enabled: false };
    const out = {};
    if (level === 'low' || level === 'medium' || level === 'high') out.effort = level;
    if (wantThoughts) out.enabled = true;
    return Object.keys(out).length ? out : null;
  }

  // Blocco `provider` per il routing (politica sui fornitori, #421). OpenRouter
  // di suo sceglie l'host col prezzo migliore, che può essere il produttore del
  // modello — escluso dalla politica di Filo. Con `ignore` gli diciamo quali NON
  // usare (forme base dei produttori); se dopo l'esclusione non resta nessun host
  // ammesso OpenRouter risponde con un errore, che risale come un normale errore
  // provider: la richiesta FALLISCE in modo evidente invece di passare da un host
  // escluso. `sort` sceglie l'ordine fra gli ammessi (latency/throughput) invece
  // del prezzo. `allow_fallbacks` resta acceso: fra gli host AMMESSI il ripiego
  // serve. Un modello da comprare solo dal produttore (#904) porta `only` anche senza `routing`, e
  // nessun ripiego: se il produttore non risponde l'errore deve vedersi (#1059).
  // Per lui anche `order` con il produttore primo, e niente `sort` che lo scavalchi (#1583): col solo `only` il router
  // ha servito Claude da AWS coi suoi crediti, e la chiave Anthropic dell'owner data a OpenRouter (BYOK) restava ferma.
  // `ownKey`: la chiamata è pagata con la chiave propria (la lista la sceglie excludedFor).
  function providerBlock(routing, model, { tools = false, ownKey = false } = {}) {
    const p = {};
    const r = routing && typeof routing === 'object' ? routing : {};
    const ignore = excludedFor(r, ownKey);
    if (ignore.length) p.ignore = ignore;
    if (r.sort === 'latency' || r.sort === 'throughput' || r.sort === 'price') {
      p.sort = r.sort;
    }
    if (r.allowFallbacks === false) p.allow_fallbacks = false;
    // Strumenti in richiesta → solo host che li supportano davvero (#700): un host che li ignora o
    // ne rompe il JSON fa fallire il turno senza che si capisca perché. Vale per OGNI chiamata con strumenti.
    if (tools) p.require_parameters = true;
    const C = global.SN_CONST;
    const rule = C && typeof C.producerOnlyRule === 'function' ? C.producerOnlyRule(model) : null;
    if (rule) {
      p.only = rule.only.slice();
      p.order = rule.only.slice();
      delete p.sort;
      p.allow_fallbacks = false;
    }
    if (zdrApplies(model, ownKey)) p.zdr = true;
    return Object.keys(p).length ? p : null;
  }

  // Ritenzione zero (#831): quando paga Filo, cioè con ogni chiave che non è la propria, solo host che non conservano
  // domanda e risposta. I modelli da comprare solo dal produttore hanno già `only` (#904) e restano fuori.
  function zdrApplies(model, ownKey) {
    if (ownKey) return false;
    const C = global.SN_CONST;
    return !(C && typeof C.producerOnlyRule === 'function' && C.producerOnlyRule(model));
  }

  // Il corpo serializzato per la chiave con cui parte, col suo blocco `provider`.
  function payloadFor(body, routing, model, own, opts = {}) {
    const pb = providerBlock(routing, model, { ...opts, ownKey: own });
    return JSON.stringify(pb ? { ...body, provider: pb } : body);
  }

  // Le definizioni degli strumenti nel corpo della richiesta, se ci sono.
  // `toolChoice` ('auto' | 'none' | 'required') è facoltativo.
  function toolsFields(tools, toolChoice) {
    const out = {};
    if (Array.isArray(tools) && tools.length) {
      out.tools = tools;
      if (toolChoice) out.tool_choice = toolChoice;
    }
    return out;
  }

  // Il 404 «nessun host» del router ha più cause, e solo quella sui parametri chiesti riguarda strumenti e
  // ragionamento: le altre hanno un rimedio diverso e non si ritentano. Prove: tests/unit/openrouterTools.test.mjs.
  function routerRefusal(text) {
    const t = String(text || '');
    if (/data policy|settings\/privacy/i.test(t)) return 'DATA_POLICY';
    if (/requested parameters|tool/i.test(t)) return 'PARAMS';
    if (/no endpoints found for\b/i.test(t)) return 'MODEL_UNAVAILABLE';
    if (/no allowed providers|no endpoints (found|available)/i.test(t)) return 'NO_PROVIDER_ALLOWED';
    return null;
  }
  const isParamsRefusal = (text) => routerRefusal(text) === 'PARAMS';

  // Una chiamata di chat (con o senza streaming). `require_parameters` scarta anche gli host che non
  // conoscono `reasoning`, e per un modello che non ragiona non ne resterebbe nessuno: il ragionamento
  // è facoltativo, gli strumenti no, quindi a quel rifiuto si rifà la richiesta senza.
  // Il rifiuto si ricorda per modello e vincoli: senza, ogni messaggio e ogni giro di strumenti lo ripaga in attesa.
  // Scade perché gli host di un modello cambiano, e uno nuovo che regge il ragionamento va ritrovato.
  const REASONING_REFUSED_MS = 60 * 60 * 1000;
  const reasoningRefused = new Map();
  function forgetReasoningRefusals() { reasoningRefused.clear(); }

  // `body` arriva senza `provider`: il blocco dipende dalla chiave con cui ogni invio parte (#962).
  async function postChat(body, apiKey, signal, routing) {
    const tools = !!body.tools;
    const send = (b, key) => fetchWithKey(ENDPOINT, key, (k, { own } = {}) => ({
      method: 'POST', headers: buildHeaders(k), body: payloadFor(b, routing, b.model, own, { tools }), signal,
    }), { model: b.model, providerRouting: routing });
    const { reasoning: _omesso, ...senzaRagionamento } = body;
    const refusalKey = tools && body.reasoning
      ? JSON.stringify([body.model, providerBlock(routing, body.model, { tools }), providerBlock(routing, body.model, { tools, ownKey: true })])
      : null;
    if (refusalKey) {
      if ((reasoningRefused.get(refusalKey) || 0) > Date.now()) return send(senzaRagionamento, apiKey);
      reasoningRefused.delete(refusalKey);
    }
    const first = await send(body, apiKey);
    if (first.res.ok || first.res.status !== 404 || !refusalKey) return first;
    const detail = await first.res.clone().text().catch(() => '');
    if (!isParamsRefusal(detail)) return first;
    const second = await send(senzaRagionamento, first.keyUsed);
    // I contatori (#1464) la contano: una richiesta in più, e una risposta senza ragionamento.
    second.ragionamentoTolto = true;
    if (second.res.ok) reasoningRefused.set(refusalKey, Date.now() + REASONING_REFUSED_MS);
    if (!second.keyFallback && first.keyFallback) {
      second.keyFallback = first.keyFallback;
      try { second.res.keyFallback = first.keyFallback; } catch (_) {}
    }
    return second;
  }

  // Le chiamate agli strumenti di una risposta NON in streaming, nella forma
  // piatta che usa il resto di Filo: { id, name, arguments (stringa JSON) }.
  function flatToolCalls(list) {
    const out = [];
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || !c.function) continue;
      out.push({
        id: String(c.id || ''),
        name: String(c.function.name || ''),
        arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments || {}),
      });
    }
    return out;
  }

  // In streaming le chiamate arrivano a pezzi: indice, poi id e nome, poi i frammenti da
  // accodare. `onStart` avvisa appena si conosce il NOME, per dire subito «Cerco sul web…».
  function createToolCallAccumulator(onStart) {
    const calls = [];
    const byIndex = new Map();
    return {
      push(deltas) {
        for (const d of Array.isArray(deltas) ? deltas : []) {
          if (!d) continue;
          const idx = Number.isInteger(d.index) ? d.index : calls.length;
          let call = byIndex.get(idx);
          if (!call) {
            call = { id: '', name: '', arguments: '', _started: false };
            byIndex.set(idx, call);
            calls.push(call);
          }
          if (d.id) call.id = String(d.id);
          const fn = d.function || {};
          if (fn.name) call.name += String(fn.name);
          if (typeof fn.arguments === 'string') call.arguments += fn.arguments;
          if (call.name && !call._started) {
            call._started = true;
            try { onStart && onStart({ id: call.id, name: call.name }); } catch (_) {}
          }
        }
      },
      list() {
        return calls.filter((c) => c.name).map(({ id, name, arguments: args }) => ({ id, name, arguments: args }));
      },
    };
  }

  // I `reasoning_details` si ricompongono per indice per RIMANDARLI tali e quali al giro dopo:
  // il fornitore li reinserisce e il modello riprende invece di ripensare tutto.
  function createReasoningDetailsAccumulator() {
    const items = [];
    const byIndex = new Map();
    const TEXT_FIELDS = ['text', 'summary', 'data'];
    return {
      push(deltas) {
        for (const d of Array.isArray(deltas) ? deltas : []) {
          if (!d || typeof d !== 'object') continue;
          const idx = Number.isInteger(d.index) ? d.index : items.length;
          let it = byIndex.get(idx);
          if (!it) {
            it = { ...d };
            byIndex.set(idx, it);
            items.push(it);
            continue;
          }
          for (const k of Object.keys(d)) {
            if (TEXT_FIELDS.includes(k) && typeof d[k] === 'string') it[k] = (typeof it[k] === 'string' ? it[k] : '') + d[k];
            else if (d[k] != null && k !== 'index') it[k] = d[k];
          }
        }
      },
      list() { return items.slice(); },
    };
  }

  function daAnthropic(model) {
    return String(model == null ? '' : model).trim().toLowerCase().replace(/^~/, '').startsWith('anthropic/');
  }

  // I punti di cache del piano (SN_FILO_CONTESTO.pianoDellaCache) li vogliono espliciti solo i modelli Anthropic: gli
  // altri riconoscono da soli il prefisso ripetuto e ricevono i messaggi tali e quali. Anthropic ne accetta al più 4.
  const MAX_PUNTI_CACHE = 4;
  const vuoleCacheEsplicita = daAnthropic;

  // I messaggi che partono: punti di cache e, per Claude, solo il ragionamento col prefisso intatto (ragionamentoRimandato.js).
  function messaggiDaMandare(model, messages, cache, tools) {
    return Ragionamento.daRimandare(conPuntiDiCache(model, messages, cache), { strumenti: tools, controlla: daAnthropic(model) });
  }

  // `caratteri` conta sul testo intero del messaggio: su un messaggio già diviso da un punto prima (la parte fissa e il
  // CONTESTO dell'utente stanno nello stesso system) si divide la parte in cui cade.
  function partiConPunto(content, caratteri, cacheControl) {
    if (typeof content === 'string') {
      const n = Number.isInteger(caratteri) && caratteri > 0 && caratteri < content.length ? caratteri : content.length;
      if (!content.slice(0, n).trim()) return null;
      const parti = [{ type: 'text', text: content.slice(0, n), cache_control: cacheControl }];
      if (n < content.length) parti.push({ type: 'text', text: content.slice(n) });
      return parti;
    }
    if (!Array.isArray(content)) return null;
    if (Number.isInteger(caratteri) && caratteri > 0 && content.every((p) => p && p.type === 'text')) {
      let fatti = 0;
      for (let i = 0; i < content.length; i++) {
        const t = String(content[i].text || '');
        if (fatti + t.length < caratteri) { fatti += t.length; continue; }
        const n = caratteri - fatti;
        if (!content.slice(0, i).map((p) => p.text).join('').concat(t.slice(0, n)).trim()) return null;
        if (n === t.length) return content.map((p, j) => (j === i ? { ...p, cache_control: cacheControl } : p));
        if (n === 0) return null;
        return [...content.slice(0, i), { ...content[i], text: t.slice(0, n), cache_control: cacheControl }, { type: 'text', text: t.slice(n) }, ...content.slice(i + 1)];
      }
    }
    let k = -1;
    content.forEach((p, i) => { if (p && p.type === 'text' && String(p.text || '').trim()) k = i; });
    return k < 0 ? null : content.map((p, i) => (i === k ? { ...p, cache_control: cacheControl } : p));
  }

  // Il testo resta lo stesso, carattere per carattere: cambia solo la forma (parti di testo) dei messaggi col punto.
  function conPuntiDiCache(model, messages, piano) {
    const punti = piano && Array.isArray(piano.punti) ? piano.punti : [];
    if (!punti.length || !Array.isArray(messages) || !vuoleCacheEsplicita(model)) return messages;
    const out = messages.slice();
    // Sullo stesso messaggio le divisioni si fanno da sinistra: ognuna conta sul testo intero.
    const ordinati = punti.slice(0, MAX_PUNTI_CACHE).map((p, i) => ({ p, i }))
      .sort((a, b) => ((a.p && a.p.indice) - (b.p && b.p.indice)) || ((Number.isInteger(a.p && a.p.caratteri) ? a.p.caratteri : Infinity) - (Number.isInteger(b.p && b.p.caratteri) ? b.p.caratteri : Infinity)) || (a.i - b.i))
      .map((x) => x.p);
    for (const p of ordinati) {
      const m = out[p && p.indice];
      if (!m || typeof m !== 'object') continue;
      const cc = p.durata === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
      const parti = partiConPunto(m.content, p.caratteri, cc);
      if (parti) out[p.indice] = { ...m, content: parti };
    }
    return out;
  }

  // Il costo in dollari che il router dichiara, null se non lo dice. Con una chiave del fornitore data a OpenRouter
  // (BYOK, #1582) `cost` è solo la sua commissione: il resto, `upstream_inference_cost`, conta lo stesso nel tetto.
  const numeroDetto = (v) => (v == null || v === '' ? NaN : Number(v));
  function costoDichiarato(cost, byok, upstream, parti) {
    const c = Number(cost);
    const base = Number.isFinite(c) ? c : null;
    if (byok !== true) return base;
    let up = numeroDetto(upstream);
    if (!Number.isFinite(up)) up = (parti || []).map(numeroDetto).filter(Number.isFinite).reduce((a, b) => a + b, 0);
    return up > 0 ? (base || 0) + up : base;
  }

  function costoDaUsage(usage) {
    const u = usage && typeof usage === 'object' ? usage : {};
    const d = u.cost_details && typeof u.cost_details === 'object' ? u.cost_details : {};
    return costoDichiarato(u.cost, u.is_byok, d.upstream_inference_cost, [d.upstream_inference_prompt_cost, d.upstream_inference_completions_cost]);
  }

  // 0 se assente: chi lo legge sa che deve stimare.
  function costUsdOf(usage) {
    const c = costoDaUsage(usage);
    return Number.isFinite(c) && c > 0 ? c : 0;
  }

  // Quanta parte del testo in ingresso è stata RIUSATA invece che ricalcolata
  // (#422). OpenRouter riporta i token letti dalla cache del fornitore in
  // `usage.prompt_tokens_details.cached_tokens` (0 o campo assente = nessun
  // riuso). È la sola prova che il prefisso immutabile dei prompt sta davvero
  // funzionando: senza questo numero "riuso a zero" e "riuso pieno" sono
  // indistinguibili.
  function cachedPromptTokens(usage) {
    if (!usage || typeof usage !== 'object') return 0;
    const d = usage.prompt_tokens_details || usage.promptTokensDetails || null;
    const v = (d && (d.cached_tokens != null ? d.cached_tokens : d.cachedTokens))
      != null ? (d.cached_tokens != null ? d.cached_tokens : d.cachedTokens)
      : usage.cached_tokens;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // L'host dice quanta parte del contesto ha letto dalla cache? Uno zero detto e un campo assente sono due cose (#1464).
  function cacheDetta(usage) {
    if (!usage || typeof usage !== 'object') return false;
    const d = usage.prompt_tokens_details || usage.promptTokensDetails || null;
    return Boolean(d && (d.cached_tokens != null || d.cachedTokens != null)) || usage.cached_tokens != null;
  }

  // I token di ragionamento della risposta; null se l'host non li dice (#1464).
  function reasoningTokensOf(usage) {
    const d = usage && typeof usage === 'object' ? (usage.completion_tokens_details || usage.completionTokensDetails || null) : null;
    const v = d ? (d.reasoning_tokens != null ? d.reasoning_tokens : d.reasoningTokens) : null;
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // I token SCRITTI in cache (i modelli coi punti espliciti): con le letture dicono se la cache scatta davvero.
  function cacheWriteTokens(usage) {
    if (!usage || typeof usage !== 'object') return 0;
    const d = usage.prompt_tokens_details || usage.promptTokensDetails || {};
    const n = Number(d.cache_write_tokens != null ? d.cache_write_tokens : d.cacheWriteTokens);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Chi ha DAVVERO servito la risposta (#421). OpenRouter lo riporta a livello di
  // risposta come `provider`; per robustezza guardiamo anche dentro la choice.
  function extractServedBy(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const v = obj.provider || obj.choices?.[0]?.provider || null;
    return (typeof v === 'string' && v.trim()) ? v.trim() : null;
  }

  async function listModels(apiKey) {
    const res = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter models: ${res.status}`);
    const data = await res.json();
    return (data.data || []).map((m) => ({
      id: m.id,
      name: m.name,
      pricing: m.pricing && {
        // OpenRouter espone i prezzi in USD per token: si riconverte in USD per 1M.
        input: parseFloat(m.pricing.prompt) * 1_000_000,
        output: parseFloat(m.pricing.completion) * 1_000_000,
      },
    }));
  }

  // Il tetto della risposta (#1097.3): un modello che si incarta si ferma lì, e `finish_reason: 'length'` lo dice.
  function maxTokensField(maxTokens) {
    const n = Math.round(Number(maxTokens));
    return Number.isFinite(n) && n > 0 ? { max_tokens: n } : {};
  }

  async function complete({ apiKey, model, messages, cache, reasoning, maxTokens, providerRouting, tools, toolChoice, signal }) {
    // usage.include: OpenRouter aggiunge alla risposta il costo in dollari
    // della chiamata (`usage.cost`), quello che conta sul tetto della chiave
    // personale (#598). Senza, il costo si stima dal listino.
    const inviati = messaggiDaMandare(model, messages, cache, tools);
    const body = { model, messages: inviati.messaggi, stream: false, usage: { include: true }, ...maxTokensField(maxTokens), ...toolsFields(tools, toolChoice) };
    const r = reasoningField(reasoning, false);
    if (r) body.reasoning = r;
    const { res, keyUsed, keySource, keyFallback, ragionamentoTolto } = await postChat(body, apiKey, signal, providerRouting);
    // status/provider strutturati sull'errore: chi lo mostra all'utente può
    // tradurlo in una frase comprensibile invece del codice HTTP nudo (#331).
    if (!res.ok) throw await httpError(res, { tools: !!body.tools, maxTokens: body.max_tokens, apiKey, model, providerRouting });
    const data = await res.json();
    const message = data.choices?.[0]?.message || {};
    const text = message.content || '';
    const usage = data.usage || {};
    return {
      text,
      toolCalls: flatToolCalls(message.tool_calls),
      reasoningDetails: Ragionamento.conImpronta(message.reasoning_details, inviati.impronta),
      finishReason: data.choices?.[0]?.finish_reason || null,
      servedBy: extractServedBy(data),
      keyUsed, keyFallback,
      ...(ragionamentoTolto ? { ragionamentoTolto: true } : {}),
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        cachedPromptTokens: cachedPromptTokens(usage),
        cacheDetta: cacheDetta(usage),
        reasoningTokens: reasoningTokensOf(usage),
        cacheWriteTokens: cacheWriteTokens(usage),
        costUsd: costUsdOf(usage),
        servedBy: extractServedBy(data),
        keySource, keyFallback,
      },
    };
  }

  // Streaming SSE — onDelta(textChunk) chiamato per ogni delta di testo,
  // onReasoning(chunk) per il ragionamento, onToolCall({ id, name }) appena si
  // conosce il nome di una chiamata a uno strumento. Ritorna
  // { text, toolCalls, reasoningDetails, finishReason, servedBy, usage }.
  async function streamComplete({ apiKey, model, messages, cache, reasoning, maxTokens, providerRouting, tools, toolChoice, onDelta, onReasoning, onToolCall, signal }) {
    const inviati = messaggiDaMandare(model, messages, cache, tools);
    const reqBody = { model, messages: inviati.messaggi, stream: true, usage: { include: true }, ...maxTokensField(maxTokens), ...toolsFields(tools, toolChoice) };
    // Reasoning: unisce il livello scelto dall'owner (#369) e la richiesta del
    // caller di STREAMARE i token di ragionamento (onReasoning). I modelli che
    // non ragionano semplicemente non ne emettono — best-effort.
    const r = reasoningField(reasoning, !!onReasoning);
    if (r) reqBody.reasoning = r;
    // Il rifiuto della chiave arriva con lo status, prima di qualunque delta:
    // il ripiego qui non ha ancora niente da azzerare nel chiamante.
    const { res, keyUsed, keySource, keyFallback, ragionamentoTolto } = await postChat(reqBody, apiKey, signal, providerRouting);
    if (!res.ok || !res.body) throw await httpError(res, { tools: !!reqBody.tools, maxTokens: reqBody.max_tokens, apiKey, model, providerRouting });

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';
    let servedBy = null;
    let finishReason = null;
    const calls = createToolCallAccumulator(onToolCall);
    const details = createReasoningDetailsAccumulator();
    let usage = { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, cacheWriteTokens: 0, cacheDetta: false, reasoningTokens: null };
    let generationId = null;

    // Una risposta rotta a metà si paga per quanto il modello aveva scritto: l'errore porta con sé l'id per chiederne il costo.
    const read = () => reader.read().catch((err) => {
      if (generationId && err && typeof err === 'object') {
        err.generationId = generationId;
        err.keySource = keySource;
        // La chiave serve a rileggere la generazione, ma un errore si stampa e si serializza: non enumerabile.
        Object.defineProperty(err, 'keyUsed', { value: keyUsed, enumerable: false, configurable: true });
      }
      throw err;
    });
    while (true) {
      const { done, value } = await read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          if (!generationId && typeof obj.id === 'string') generationId = obj.id;
          // Chi ha servito arriva in streaming insieme ai chunk (di norma con
          // l'ultimo): teniamo l'ultimo valore visto.
          const sb = extractServedBy(obj);
          if (sb) servedBy = sb;
          const choice = obj.choices?.[0] || {};
          const choiceDelta = choice.delta || {};
          if (choice.finish_reason) finishReason = choice.finish_reason;
          const reasoning = choiceDelta.reasoning;
          if (reasoning) {
            try { onReasoning && onReasoning(reasoning); } catch (_) {}
          }
          if (choiceDelta.reasoning_details) details.push(choiceDelta.reasoning_details);
          if (choiceDelta.tool_calls) calls.push(choiceDelta.tool_calls);
          const delta = choiceDelta.content;
          if (delta) {
            fullText += delta;
            try { onDelta && onDelta(delta); } catch (_) {}
          }
          if (obj.usage) {
            usage = {
              promptTokens: obj.usage.prompt_tokens || 0,
              completionTokens: obj.usage.completion_tokens || 0,
              cachedPromptTokens: cachedPromptTokens(obj.usage),
              cacheDetta: cacheDetta(obj.usage),
              reasoningTokens: reasoningTokensOf(obj.usage),
              cacheWriteTokens: cacheWriteTokens(obj.usage),
              costUsd: costUsdOf(obj.usage),
              servedBy: servedBy || extractServedBy(obj),
            };
          }
        } catch (_) {
        }
      }
    }
    // Fermato da un errore prima di scrivere qualcosa: è un guasto del servizio, che si riprova o passa al ripiego.
    if (finishReason === 'error' && !fullText && !calls.list().length) {
      const err = new Error('OpenRouter 502: il fornitore si è fermato a metà flusso');
      err.status = 502;
      err.provider = 'openrouter';
      if (servedBy) err.hostFallito = servedBy;
      produttoreNonRisponde(err, model);
      throw err;
    }
    return {
      text: fullText, toolCalls: calls.list(), reasoningDetails: Ragionamento.conImpronta(details.list(), inviati.impronta), finishReason, servedBy,
      keyUsed, keyFallback, usage: { ...usage, keySource, keyFallback },
      ...(ragionamentoTolto ? { ragionamentoTolto: true } : {}),
    };
  }

  // Errore HTTP con status e provider strutturati (come per le chat, #331).
  // Porta con sé anche da quale chiave si era partiti e se il ripiego sulla
  // personale c'è stato e ha fallito (fetchWithKey li lascia sulla risposta):
  // un 402 «la tua chiave» e un 402 «anche i crediti di Filo» sono due frasi
  // diverse per l'utente.
  // Quanto chiede di aspettare un 429 o un 5xx: Retry-After in secondi o come data, o l'istante in cui il tetto riparte.
  function attesaChiesta(res, ora = Date.now()) {
    const h = (n) => { try { return res && res.headers && typeof res.headers.get === 'function' ? res.headers.get(n) : null; } catch (_) { return null; } };
    const ra = String(h('retry-after') || '').trim();
    if (/^\d+(\.\d+)?$/.test(ra)) return Math.round(Number(ra) * 1000);
    if (ra) { const t = Date.parse(ra); if (Number.isFinite(t)) return Math.max(0, t - ora); }
    const reset = Number(h('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) return Math.max(0, (reset < 1e12 ? reset * 1000 : reset) - ora);
    return null;
  }

  // Un rifiuto per il tetto della risposta: nessun host ammesso regge quel `max_tokens`. Si dice, col numero (#1097.3).
  const RIFIUTO_TETTO = /max[_ ]?(?:new[_ ])?tokens|max(?:imum)?[_ ](?:output|completion)[_ ]tokens|output token limit/i;
  const CONTESTO = /maximum context|context[ _-]?(?:length|window)|tokens? limit exceeded/i;
  const numeroIn = (s, re) => {
    const m = re.exec(s);
    const n = m ? Number(String(m[1]).replace(/[.,]/g, '')) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // Finestra sforata da testo più tetto: { finestra, testo } quando il rifiuto ne dice le misure, null se è un altro errore.
  function sforoDiFinestra(errText, maxTokens) {
    const s = String(errText || '');
    if (!CONTESTO.test(s)) return null;
    const finestra = numeroIn(s, /maximum context (?:length|window) (?:is|of) ([\d.,]+)/i)
      || numeroIn(s, /limit exceeded:?\s*[\d.,]+\s*>\s*([\d.,]+)/i);
    const chiesti = numeroIn(s, /requested (?:about )?([\d.,]+)/i) || numeroIn(s, /limit exceeded:?\s*([\d.,]+)\s*>/i);
    const testo = numeroIn(s, /([\d.,]+) (?:tokens )?of (?:text )?input/i) || (chiesti && chiesti > maxTokens ? chiesti - maxTokens : null);
    return { finestra, testo };
  }
  // Il tetto è la causa quando ne prende più di metà finestra, o quando il testo da solo ci starebbe: un rifiuto per
  // un testo che da solo non ci sta resta di contesto. `stringibile`: la chat può anche accorciare la conversazione.
  function causaTetto(status, errText, maxTokens) {
    if (!maxTokens || ![400, 404, 413, 422].includes(status)) return null;
    const s = String(errText || '');
    if (/unsupported (?:parameter|value)/i.test(s)) return null;
    const sforo = sforoDiFinestra(s, maxTokens);
    if (!sforo) return RIFIUTO_TETTO.test(s) ? {} : null;
    const { finestra, testo } = sforo;
    if (finestra && maxTokens > finestra / 2) return { finestra };
    if (finestra && testo && testo < finestra) return { finestra, stringibile: true };
    return null;
  }

  // Un «nessun host per i parametri chiesti» con gli strumenti e un tetto: gli host dichiarati dicono quale dei due manca.
  // false: nessun host ammesso regge gli strumenti, il tetto non c'entra; true: li reggono, ma nessuno fino a quel
  // tetto; null: non si sa, e la frase li nomina tutti e due.
  async function tettoFraLeCause({ apiKey, model, maxTokens, providerRouting, tools, ownKey = false }) {
    let hosts = null;
    try { hosts = await modelHosts({ apiKey, model }); } catch (_) { hosts = null; }
    if (!Array.isArray(hosts) || !hosts.length) return null;
    const C = global.SN_CONST;
    const excluded = excludedFor(providerRouting, ownKey);
    const ammessi = C && typeof C.hostPolicyViolation === 'function'
      ? hosts.filter((h) => !C.hostPolicyViolation(h, model, excluded)) : hosts;
    if (ammessi.some((h) => h.tools == null || h.maxOut == null)) return null;
    const utili = tools ? ammessi.filter((h) => h.tools) : ammessi;
    if (!utili.length) return tools ? false : null;
    return utili.every((h) => h.maxOut < maxTokens) ? true : (tools ? null : false);
  }

  // L'host che ha dato l'errore, quando il router lo dice (`error.metadata.provider_name`): lo contano i contatori (#969).
  function hostDelGuasto(errText) {
    try {
      const j = JSON.parse(String(errText || ''));
      const n = j && j.error && j.error.metadata && j.error.metadata.provider_name;
      return typeof n === 'string' ? n.trim().slice(0, 60) : '';
    } catch (_) { return ''; }
  }

  async function httpError(res, { tools = false, maxTokens = null, apiKey = '', model = '', providerRouting = null } = {}) {
    const errText = await res.text().catch(() => '');
    const err = new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
    err.status = res.status;
    err.provider = 'openrouter';
    const host = hostDelGuasto(errText);
    if (host) err.hostFallito = host;
    const attesa = attesaChiesta(res);
    if (attesa != null) err.retryAfterMs = attesa;
    if (res.keySource) err.keySource = res.keySource;
    if (res.keyFallback) err.keyFallback = res.keyFallback;
    // Gli host si giudicano con la lista con cui è partita la risposta arrivata (#962).
    const ownKey = res.keySource === 'own';
    if (res.status === 404 && model && await nessunHostAmmesso(err, { apiKey, model, providerRouting, ownKey })) return err;
    if (res.status === 404 && model && await nessunHostZdr(err, { apiKey, model, providerRouting, ownKey, errText })) return err;
    // Con gli strumenti il router cerca solo host che li reggono: il suo 404 vuol dire che fra gli
    // ammessi non ce n'è, e chi lo racconta deve dire questo, non «riprova».
    const refusal = res.status === 404 ? routerRefusal(errText) : null;
    const perTetto = causaTetto(res.status, errText, maxTokens);
    if (perTetto && refusal !== 'PARAMS') {
      err.code = 'TETTO_RISPOSTA';
      err.maxTokens = maxTokens;
      if (perTetto.finestra) err.finestra = perTetto.finestra;
      if (perTetto.stringibile) err.stringibile = true;
    } else if (refusal === 'PARAMS') {
      // Il tetto è uno dei parametri che il router fa reggere agli host: il suo «nessun host» può venire da lì.
      const colpa = maxTokens ? await tettoFraLeCause({ apiKey, model, maxTokens, providerRouting, tools, ownKey }) : false;
      if (tools) err.code = 'NO_TOOL_HOST';
      else if (maxTokens && colpa !== false) err.code = 'TETTO_RISPOSTA';
      if (maxTokens && colpa !== false) err.maxTokens = maxTokens;
    } else if (refusal) err.code = refusal;
    produttoreNonRisponde(err, model, errText);
    return err;
  }

  // Un modello da comprare solo dal produttore (#904) non ripiega su altri host: se il produttore non risponde, a catena
  // finita la richiesta fallisce con la frase del #828 e questo motivo (#829). Il 500 è del router, non dell'host.
  const PRODUTTORE_GIU = new Set([408, 502, 503, 504, 529]);
  const NESSUN_AMMESSO = /no allowed providers|provider restrictions/i;
  function produttoreNonRisponde(err, model, errText = '') {
    const C = global.SN_CONST;
    const rule = model && C && typeof C.producerOnlyRule === 'function' ? C.producerOnlyRule(model) : null;
    if (!rule || (err.code && err.code !== 'NO_PROVIDER_ALLOWED' && err.code !== 'DATA_POLICY')) return false;
    const filtrati = err.status === 404 && NESSUN_AMMESSO.test(errText) && !/settings\/privacy/i.test(errText);
    if (!PRODUTTORE_GIU.has(err.status) && !filtrati) return false;
    const CE = global.SN_CHAT_ERRORS;
    const motivo = CE && typeof CE.motivoProduttoreGiu === 'function' ? CE.motivoProduttoreGiu(rule.nome) : '';
    console.warn(`[Filo policy] "${model}" lo serve solo ${rule.nome || rule.only.join(', ')}, che non risponde: ${err.message}`);
    err.dettaglio = err.message;
    err.message = CE ? CE.fraseNessunHost({ modello: model, motivo }) : `NO_ALLOWED_HOST ${model}`;
    err.code = 'NO_ALLOWED_HOST';
    err.reason = 'produttore';
    err.motivo = motivo;
    err.model = model;
    err.hosts = [];
    return true;
  }

  // Un 404 del router su un modello che servono solo host esclusi (#828). Lo dicono gli host dichiarati, non il testo
  // dell'errore, che il router può cambiare; e vince sugli altri motivi del 404, perché strumenti e tetto non contano più.
  async function nessunHostAmmesso(err, { apiKey, model, providerRouting, ownKey }) {
    let v = null;
    try { v = await hostVerdict({ apiKey, model, providerRouting, ownKey, filoPays: false }); } catch (_) { v = null; }
    if (!v || v.ok || v.reason !== 'excluded') return false;
    console.warn(`[Filo policy] "${model}" lo servono solo host esclusi (${v.excluded.join(', ')}): ${err.message}`);
    const CE = global.SN_CHAT_ERRORS;
    err.dettaglio = err.message;
    err.message = CE ? CE.fraseNessunHost({ modello: model, motivo: CE.motivoHostEsclusi(v.excluded) }) : `NO_ALLOWED_HOST ${model}`;
    err.code = 'NO_ALLOWED_HOST';
    err.reason = 'excluded';
    err.model = model;
    err.hosts = v.excluded;
    return true;
  }

  // Lo stesso 404 quando a svuotare la lista è la ritenzione zero (#831): nessun host che la dichiara è fra gli ammessi.
  // Lo dice il catalogo; senza, solo un rifiuto che la nomina. Il codice è quello di #828: la frase ha un punto solo.
  const RIFIUTI_SENZA_HOST = ['DATA_POLICY', 'NO_PROVIDER_ALLOWED', 'PARAMS'];
  async function nessunHostZdr(err, { apiKey, model, providerRouting, ownKey, errText }) {
    if (!zdrApplies(model, ownKey)) return false;
    const nomina = /zero data retention|\bzdr\b/i.test(String(errText || ''));
    if (!nomina && !RIFIUTI_SENZA_HOST.includes(routerRefusal(errText))) return false;
    let zdr = null;
    try { zdr = await zdrHostsOf({ apiKey, model }); } catch (_) { zdr = null; }
    const C = global.SN_CONST;
    const excluded = excludedFor(providerRouting, ownKey);
    const colpa = Array.isArray(zdr) && C && typeof C.hostPolicyViolation === 'function'
      ? !zdr.some((z) => !C.hostPolicyViolation(z, model, excluded)) : nomina;
    if (!colpa) return false;
    console.warn(`[Filo policy] "${model}": nessun host ammesso a ritenzione zero: ${err.message}`);
    const CE = global.SN_CHAT_ERRORS;
    err.dettaglio = err.message;
    err.code = 'NO_ALLOWED_HOST';
    err.reason = 'zdr';
    err.model = model;
    err.hosts = [];
    err.message = CE ? CE.fraseNessunHost({ modello: model, motivo: CE.motivoNessunHost(err) }) : `NO_ALLOWED_HOST ${model}`;
    return true;
  }

  // ─── Chi può servire un modello, prima di chiamarlo ───────────────────────
  // Sugli endpoint audio il router ignora il blocco `provider` (#713): l'esclusione si applica qui, sugli host
  // dichiarati. Regole: patterns/voce-dettatura-e-vettori-passano-dal-router-come-le-chat.md.
  const HOSTS_FRESH_MS = 60 * 60 * 1000;
  // Host ignoti fermano la voce (#1141): si rilegge presto, ma non a ogni frase di una dettatura.
  const HOSTS_RETRY_MS = 15 * 1000;
  const HOSTS_TIMEOUT_MS = 10 * 1000;
  const HOSTS_MAX_MODELS = 500;
  const hostsCache = new Map(); // id → { until, hosts, pending }

  function endpointsUrl(model) {
    const id = String(model == null ? '' : model).trim();
    const parts = id.split('/');
    if (parts.length !== 2 || parts.some((p) => !p || p === '.' || p === '..')) return '';
    return `${MODELS_ENDPOINT}/${parts.map(encodeURIComponent).join('/')}/endpoints`;
  }

  async function fetchModelHosts(apiKey, model) {
    const url = endpointsUrl(model);
    if (!url) return null;
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(HOSTS_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`OpenRouter endpoints ${res.status}`);
    const data = (await res.json()) || {};
    const list = data.data && Array.isArray(data.data.endpoints) ? data.data.endpoints : [];
    const hosts = [];
    for (const e of list) {
      const name = e && typeof e.provider_name === 'string' ? e.provider_name.trim() : '';
      const tag = e && typeof e.tag === 'string' ? e.tag.trim() : '';
      // Strumenti e tetto della risposta che l'host regge: dicono perché il router non ne ha trovato uno (#1097.3).
      const params = e && Array.isArray(e.supported_parameters) ? e.supported_parameters : null;
      const max = Number(e && e.max_completion_tokens);
      if (name || tag) {
        hosts.push({
          name, tag,
          tools: params ? params.includes('tools') : null,
          maxOut: Number.isFinite(max) && max > 0 ? max : (e && e.max_completion_tokens === null ? Infinity : null),
        });
      }
    }
    return hosts;
  }

  // [{ name, tag }] o null se non si sa. Un elenco scaduto si usa mentre si rilegge.
  async function modelHosts({ apiKey, model } = {}) {
    const key = String(model == null ? '' : model).trim();
    if (!key) return null;
    const hit = hostsCache.get(key);
    if (hit && hit.pending) return hit.hosts || hit.pending;
    if (hit && Date.now() < hit.until) return hit.hosts;
    const entry = { until: 0, hosts: hit ? hit.hosts : null, pending: null };
    entry.pending = fetchModelHosts(apiKey, key)
      .then((hosts) => {
        entry.hosts = hosts;
        entry.until = Date.now() + (hosts ? HOSTS_FRESH_MS : HOSTS_RETRY_MS);
        return entry.hosts;
      })
      .catch((e) => {
        console.warn(`[Filo policy] host di "${key}" non letti:`, (e && e.message) || e);
        entry.until = Date.now() + HOSTS_RETRY_MS;
        return entry.hosts;
      })
      .finally(() => { entry.pending = null; });
    hostsCache.delete(key);
    hostsCache.set(key, entry);
    while (hostsCache.size > HOSTS_MAX_MODELS) hostsCache.delete(hostsCache.keys().next().value);
    return entry.hosts || entry.pending;
  }

  // Gli host che dichiarano la ritenzione zero, dal catalogo del router: Map(id → [{ name, tag }]) o null se non si sa.
  // Serve dove il corpo non basta: l'audio, che ignora il blocco `provider`, e il perché di un «nessun host».
  const ZDR_ENDPOINT = `${MODELS_ENDPOINT.replace(/\/models$/, '')}/endpoints/zdr`;
  let zdrCache = { until: 0, map: null, pending: null };

  function zdrCatalog({ apiKey } = {}) {
    if (zdrCache.pending) return zdrCache.map || zdrCache.pending;
    if (Date.now() < zdrCache.until) return Promise.resolve(zdrCache.map);
    const entry = zdrCache;
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    entry.pending = fetch(ZDR_ENDPOINT, { headers, signal: AbortSignal.timeout(HOSTS_TIMEOUT_MS) })
      .then(async (res) => {
        if (!res.ok) throw new Error(`OpenRouter zdr ${res.status}`);
        const C = global.SN_CONST;
        return C && typeof C.zdrCatalogFrom === 'function' ? C.zdrCatalogFrom(await res.json()) : null;
      })
      .then((map) => {
        entry.map = map || entry.map;
        entry.until = Date.now() + (map ? HOSTS_FRESH_MS : HOSTS_RETRY_MS);
        return entry.map;
      })
      .catch((e) => {
        console.warn('[Filo policy] host a ritenzione zero non letti:', (e && e.message) || e);
        entry.until = Date.now() + HOSTS_RETRY_MS;
        return entry.map;
      })
      .finally(() => { entry.pending = null; });
    return entry.map || entry.pending;
  }

  async function zdrHostsOf({ apiKey, model } = {}) {
    const map = await zdrCatalog({ apiKey });
    if (!map) return null;
    return map.get(String(model == null ? '' : model).trim().toLowerCase().replace(/^~/, '')) || [];
  }

  // Lo stesso endpoint di un host: per etichetta quando ce l'hanno tutti e due (un fornitore può averne uno a
  // ritenzione zero e uno no), altrimenti per nome.
  function isZdrHost(h, zdr) {
    const low = (s) => String(s || '').trim().toLowerCase();
    return zdr.some((z) => (h.tag && z.tag ? low(h.tag) === low(z.tag) : !!low(h.name) && low(h.name) === low(z.name)));
  }

  function forgetModelHosts() { hostsCache.clear(); zdrCache = { until: 0, map: null, pending: null }; }

  function joinNames(names) {
    if (names.length < 2) return names.join('');
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
  }

  function uniqueNames(hosts) {
    const names = [];
    for (const h of hosts) {
      const n = h.name || h.tag;
      if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
    return names;
  }

  // Voce e dettatura partono solo se chi serve il modello è noto e TUTTO ammesso (#1141): con host misti il
  // router sceglie per prezzo e può dare l'audio proprio a quello escluso.
  // { ok: true } | { ok: false, reason: 'unknown' | 'mixed' | 'excluded', excluded: [nomi] }
  // Senza `ownKey` la lista la sceglie la chiave data (#962).
  // Quando paga Filo (`filoPays`; senza, lo dice la chiave data) vale anche la ritenzione zero (#831), con la stessa
  // regola: TUTTI gli host ammessi la dichiarano, perché anche qui la scelta fra loro la fa il router.
  async function hostVerdict({ apiKey, model, providerRouting, ownKey, filoPays }) {
    const C = global.SN_CONST;
    if (!C || typeof C.hostPolicyViolation !== 'function') return { ok: true };
    const own = ownKey === undefined ? await startsOwn(apiKey, providerRouting) : ownKey;
    const excluded = excludedFor(providerRouting, own);
    const paga = filoPays === undefined ? (own ? false : (await keySourceOf(apiKey)) !== 'own') : filoPays;
    const zdr = paga && zdrApplies(model, false);
    if (!excluded.length && !C.producerOnlyRule(model) && !zdr) return { ok: true };
    const hosts = await modelHosts({ apiKey, model });
    if (!Array.isArray(hosts) || !hosts.length) return { ok: false, reason: 'unknown', excluded: [] };
    const bad = hosts.filter((h) => C.hostPolicyViolation(h, model, excluded));
    if (bad.length) return { ok: false, reason: bad.length === hosts.length ? 'excluded' : 'mixed', excluded: uniqueNames(bad) };
    if (!zdr) return { ok: true };
    const dichiarati = await zdrHostsOf({ apiKey, model });
    if (!Array.isArray(dichiarati)) return { ok: false, reason: 'zdrunknown', excluded: [] };
    const senza = hosts.filter((h) => !isZdrHost(h, dichiarati));
    if (!senza.length) return { ok: true };
    return { ok: false, reason: senza.length === hosts.length ? 'zdr' : 'zdrmixed', excluded: uniqueNames(senza) };
  }

  const NO_HOST_KEYS = {
    unknown: ['err_audio_hosts_unknown', 'err_audio_hosts_unknown'],
    mixed: ['err_audio_mixed_host', 'err_audio_mixed_host_many'],
    excluded: ['err_audio_no_allowed_host', 'err_audio_no_allowed_host_many'],
    zdrunknown: ['err_audio_zdr_unknown', 'err_audio_zdr_unknown'],
    zdr: ['err_audio_zdr_host', 'err_audio_zdr_host_many'],
    zdrmixed: ['err_audio_zdr_mixed', 'err_audio_zdr_mixed_many'],
  };

  async function ensureAllowedHost({ apiKey, model, providerRouting, ownKey, filoPays }) {
    const v = await hostVerdict({ apiKey, model, providerRouting, ownKey, filoPays });
    if (v.ok) return;
    const I18n = global.SN_I18N;
    const [one, many] = NO_HOST_KEYS[v.reason];
    const chiave = v.excluded.length > 1 ? many : one;
    const err = new Error(I18n ? I18n.t(chiave, model, joinNames(v.excluded)) : `NO_ALLOWED_HOST ${model}`);
    err.code = 'NO_ALLOWED_HOST';
    err.reason = v.reason;
    err.provider = 'openrouter';
    err.model = model;
    err.hosts = v.excluded;
    throw err;
  }

  // Voce, dettatura e classificatori: il controllo degli host con la lista della chiave di partenza, e il ripiego sui
  // crediti solo se chi serve il modello lo ammette anche la loro (#962).
  async function hostCheckedFetch(url, { apiKey, model, providerRouting, body, signal }) {
    const source = await keySourceOf(apiKey);
    // Prima degli host: un modello che i crediti non pagano non arriva a chiedere chi lo serve.
    if (PAGA_FILO.has(source) && !(await ammessoCoiCrediti(model, providerRouting))) throw erroreCrediti(model);
    const own = source === 'own' && !!providerRouting && Array.isArray(providerRouting.ownKeyIgnore);
    await ensureAllowedHost({ apiKey, model, providerRouting, ownKey: own, filoPays: source !== 'own' });
    // Il ripiego sui crediti cambia chi paga: lista intera e ritenzione zero.
    const ripiegoAmmesso = source === 'own'
      ? async () => (await hostVerdict({ apiKey, model, providerRouting, ownKey: false, filoPays: true })).ok
      : null;
    return fetchWithKey(url, apiKey, (key, { own: o } = {}) => ({
      method: 'POST', headers: buildHeaders(key), body: payloadFor(body, providerRouting, model, o), signal,
    }), { ripiegoAmmesso, model, providerRouting });
  }

  // ─── Lettura ad alta voce ──────────────────────────────────────────────────
  // Chiede l'audio in PCM grezzo (16 bit, mono): il content script lo incapsula
  // in un WAV e lo suona, lo stesso formato che usava prima. Il router risponde
  // con i byte e basta: chi ha servito non è nella risposta, ma l'id della
  // generazione sì (header), e con quello si chiede dopo (lookupServedBy).
  async function synthesizeSpeech({ apiKey, model, text, voice, speed, providerRouting, signal }) {
    const body = { model, input: String(text == null ? '' : text), response_format: 'pcm' };
    if (voice) body.voice = voice;
    const sp = Number(speed);
    if (Number.isFinite(sp) && sp > 0 && sp !== 1) body.speed = sp;
    const { res, keyUsed, keySource, keyFallback } = await hostCheckedFetch(SPEECH_ENDPOINT, { apiKey, model, providerRouting, body, signal });
    if (!res.ok) throw await httpError(res);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) {
      const err = new Error('OpenRouter: audio vuoto');
      err.provider = 'openrouter';
      throw err;
    }
    const ct = String(res.headers.get('content-type') || '');
    const mimeType = /rate=\d+/.test(ct) ? ct : 'audio/pcm;rate=24000';
    return {
      audioBase64: buf.toString('base64'),
      mimeType,
      generationId: res.headers.get('x-generation-id') || null,
      keyUsed, keySource, keyFallback,
    };
  }

  // `audioBase64` sono i byte grezzi, niente data URI; senza `language` il modello riconosce
  // la lingua da sé.
  async function transcribe({ apiKey, model, audioBase64, format, language, providerRouting, signal }) {
    const body = { model, input_audio: { data: audioBase64, format: format || 'wav' } };
    if (language) body.language = language;
    const { res, keyUsed, keySource, keyFallback } = await hostCheckedFetch(TRANSCRIPTIONS_ENDPOINT, { apiKey, model, providerRouting, body, signal });
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const usage = data.usage || {};
    return {
      text: typeof data.text === 'string' ? data.text : '',
      servedBy: extractServedBy(data),
      generationId: res.headers.get('x-generation-id') || data.id || null,
      keyUsed, keyFallback,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        cachedPromptTokens: 0,
        seconds: Number(usage.seconds) || 0,
        // Per l'audio non ci sono token: l'unico numero sensato è il costo in dollari del router.
        costUsd: costoDaUsage(usage),
        keySource, keyFallback,
      },
    };
  }

  // `dim` chiede vettori accorciati; se ne arrivano di più lunghi si tagliano qui: contano le
  // prime componenti, e la ricerca vuole vettori tutti della stessa lunghezza.
  async function embed({ apiKey, model, texts, dim, providerRouting, signal }) {
    const input = (texts || []).map((t) => String(t == null ? '' : t));
    const body = { model, input };
    const d = Number(dim);
    if (Number.isInteger(d) && d > 0) body.dimensions = d;
    const { res, keyUsed, keySource, keyFallback } = await fetchWithKey(EMBEDDINGS_ENDPOINT, apiKey, (key, { own } = {}) => ({
      method: 'POST', headers: buildHeaders(key), body: payloadFor(body, providerRouting, model, own), signal,
    }), { model, providerRouting });
    if (!res.ok) throw await httpError(res, { apiKey, model, providerRouting });
    const data = await res.json();
    const rows = Array.isArray(data.data) ? data.data.slice() : [];
    rows.sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
    const vectors = rows.map((r) => {
      const v = Array.isArray(r.embedding) ? r.embedding : [];
      return (Number.isInteger(d) && d > 0 && v.length > d) ? v.slice(0, d) : v;
    });
    const usage = data.usage || {};
    return {
      vectors,
      servedBy: extractServedBy(data),
      generationId: res.headers.get('x-generation-id') || data.id || null,
      keyUsed, keyFallback,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: 0,
        cachedPromptTokens: 0,
        costUsd: costoDaUsage(usage),
        keySource, keyFallback,
      },
    };
  }

  // ─── Decisioni (classificatori) ───────────────────────────────────────────
  // Un classificatore non scrive: a ogni domanda chiusa di `questions` (per nome) risponde con una probabilità,
  // dopo aver letto `state`. Le risposte tornano per nome in `answers`, tali e quali; il costo lo dice il router.
  // `retryAfterMs` sull'errore è l'attesa chiesta da un 429, per chi rimette la richiesta in coda.
  async function decisions({ apiKey, model, state, questions, providerRouting, signal }) {
    const body = { model, state, questions };
    const { res, keyUsed, keySource, keyFallback } = await hostCheckedFetch(DECISIONS_ENDPOINT, { apiKey, model, providerRouting, body, signal });
    if (!res.ok) {
      const err = await httpError(res);
      const attesa = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : NaN);
      if (Number.isFinite(attesa) && attesa >= 0) err.retryAfterMs = attesa * 1000;
      throw err;
    }
    const data = (await res.json()) || {};
    const usage = data.usage || {};
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
      answers: data.answers && typeof data.answers === 'object' ? data.answers : {},
      model: typeof data.model === 'string' && data.model ? data.model : model,
      servedBy: extractServedBy(data),
      keyUsed, keyFallback,
      usage: {
        promptTokens: num(usage.input_tokens != null ? usage.input_tokens : usage.prompt_tokens),
        completionTokens: num(usage.output_tokens != null ? usage.output_tokens : usage.completion_tokens),
        cachedPromptTokens: cachedPromptTokens(usage),
        cacheDetta: cacheDetta(usage),
        costUsd: costoDaUsage(usage),
        keySource, keyFallback,
      },
    };
  }

  // Per voce e dettatura il fornitore non è nella risposta: si chiede con l'id della
  // generazione, consultabile qualche secondo dopo. Torna { servedBy, costUsd } o null.
  async function lookupServedBy({ apiKey, generationId, signal }) {
    if (!generationId) return null;
    const res = await fetch(`${GENERATION_ENDPOINT}?id=${encodeURIComponent(generationId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await httpError(res);
    const data = (await res.json()).data || {};
    const name = typeof data.provider_name === 'string' ? data.provider_name.trim() : '';
    return { servedBy: name || null, costUsd: costoDichiarato(data.total_cost, data.is_byok, data.upstream_inference_cost) };
  }

  // ─── Cosa sa OpenRouter di una chiave ─────────────────────────────────────
  // `GET /auth/key` con la chiave come Bearer: etichetta, tetto (null = nessun
  // tetto), spesa, residuo. La pagina Crediti lo mostra per la chiave propria.
  // Nessun ripiego qui: la domanda è proprio su QUELLA chiave.
  //
  // Il tetto su una chiave è facoltativo e di solito non c'è: allora quello
  // che resta da spendere è il credito dell'ACCOUNT (comprato meno consumato),
  // che OpenRouter dice a `GET /credits` con la stessa chiave. Si chiede solo
  // in quel caso, e se non risponde resta la sola spesa (primo giro di
  // verifica del ramo).
  async function keyInfo({ apiKey, signal }) {
    const res = await fetch(AUTH_KEY_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) throw await httpError(res);
    const data = (await res.json()).data || {};
    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const out = {
      label: typeof data.label === 'string' ? data.label : '',
      limit: num(data.limit),
      usage: num(data.usage) || 0,
      limit_remaining: num(data.limit_remaining),
      account: null,
    };
    // Il credito del conto serve sempre: è quello che resta a una chiave
    // senza tetto, e con un tetto è il numero che conta quando il conto ha
    // meno del residuo del tetto (secondo giro di verifica del ramo).
    try {
      const r2 = await fetch(CREDITS_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
      if (r2.ok) {
        const d2 = (await r2.json()).data || {};
        const credits = num(d2.total_credits);
        const used = num(d2.total_usage);
        if (credits != null) out.account = { credits, usage: used || 0 };
      }
    } catch (_) { out.account = null; }
    return out;
  }

  global.SN_PROVIDER_OPENROUTER = {
    listModels, complete, streamComplete, reasoningField, providerBlock, extractServedBy,
    cachedPromptTokens, cacheDetta, reasoningTokensOf, cacheWriteTokens, conPuntiDiCache, vuoleCacheEsplicita, synthesizeSpeech, transcribe, embed, decisions, lookupServedBy, keyInfo, fetchWithKey,
    modelHosts, forgetModelHosts, hostVerdict, forgetReasoningRefusals, zdrApplies, zdrHostsOf,
    createToolCallAccumulator, createReasoningDetailsAccumulator, toolsFields, maxTokensField, attesaChiesta, httpError,
    ENDPOINT, MODELS_ENDPOINT, SPEECH_ENDPOINT, TRANSCRIPTIONS_ENDPOINT, EMBEDDINGS_ENDPOINT, DECISIONS_ENDPOINT,
    GENERATION_ENDPOINT, AUTH_KEY_ENDPOINT, CREDITS_ENDPOINT, ZDR_ENDPOINT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
