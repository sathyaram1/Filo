// I cambi di stato come eventi del filo (#867): il nome di ogni impostazione, il confronto fra due
// scritture, la frase in parole, la fusione dei passi di un cursore e cosa scrivere per annullare.
// Logica pura: chi osserva le scritture è src/main/services/registroCambi.js; regole in tests/unit/cambi.test.mjs.

(function (global) {
  'use strict';

  // ── Le voci: ogni impostazione scrivibile, col nome della sua pagina ─────────
  // `livello` è quello che chiede la chat per rimetterla com'era (ANNULLA_CAMBIO): 2 se toccarla
  // chiede conferma anche a IMPOSTA_PREFERENZA. `segreto`: il valore non entra nel registro.
  const sino = (si, no) => (v) => (v ? si : no);
  const ATTIVO = sino('attivo', 'spento');
  const ATTIVA = sino('attiva', 'spenta');
  const numero = (v) => String(Number(v)).replace('.', ',');
  const percento = (v) => `${Math.round(Number(v) * 100)}%`;

  function etichettaColoreTab(k) {
    const meta = global.SN_TAB_COLOR && Array.isArray(global.SN_TAB_COLOR.IDENTITY_PARAM_META)
      ? global.SN_TAB_COLOR.IDENTITY_PARAM_META.find((m) => m.key === k) : null;
    return meta ? meta.label.toLowerCase() : 'un parametro';
  }
  function etichettaToken(k) {
    const t = global.SN_THEME_TOKENS && global.SN_THEME_TOKENS.get ? global.SN_THEME_TOKENS.get(k) : null;
    return t && t.label ? t.label.toLowerCase() : 'un dettaglio';
  }
  function etichettaFunzione(k) {
    const C = global.SN_CONST;
    const l = C && C.actionLabel ? C.actionLabel(k) : k;
    return l && l !== k ? l : 'una funzione';
  }
  const NOMI_CHIAVI = { openrouter: 'OpenRouter', tavily: 'Tavily' };

  const VOCI = {
    theme: { nome: 'tema', valori: { light: 'chiaro', dark: 'scuro', system: 'come il sistema' }, livello: 1 },
    textScale: { nome: 'dimensione del testo', valore: percento, livello: 1 },
    showHomeMessage: { nome: 'commento nella home', valore: sino('mostrato', 'nascosto'), livello: 1 },
    'homeSistema.*': { nome: (k) => `voce «${k === 'bluetooth' ? 'Bluetooth' : k}» nella home`, valore: sino('mostrata', 'nascosta'), livello: 1 },
    'tabPreview.enabled': { nome: 'anteprima delle schede', valore: ATTIVA, livello: 1 },
    'tabPreview.size': { nome: 'dimensione dell\'anteprima delle schede', livello: 1 },
    'tabColor.*': { nome: (k) => `colore delle tab, ${etichettaColoreTab(k)}`, valore: numero, livello: 1 },
    'themeTokens.*': { nome: (k) => `aspetto, ${etichettaToken(k)}`, valore: (v) => (v == null || v === '' ? 'predefinito' : String(v)), livello: 1 },
    agentStyle: { nome: 'stile dell\'agente', testo: true, livello: 2 },
    timerRingtone: { nome: 'suoneria del timer', valori: { default: 'standard', gentle: 'delicata', urgent: 'urgente', chime: 'carillon' }, livello: 1 },
    'terminal.enabled': { nome: 'modalità terminale', valore: ATTIVA, livello: 2 },
    'nomiSensati.scaricamenti': { nome: 'nome sensato ai file scaricati', valore: ATTIVO, livello: 2 },
    'terminal.shell': { nome: 'shell del terminale', valori: { powershell: 'PowerShell', cmd: 'Prompt dei comandi', bash: 'Bash' }, livello: 2 },
    'tts.voice': { nome: 'voce di riserva della lettura', valore: (v) => v || 'automatica', livello: 1 },
    'tts.rate': { nome: 'velocità di lettura', valore: (v) => `${numero(v)}×`, livello: 1 },
    'tts.pitch': { nome: 'tono di lettura', valore: numero, livello: 1 },
    'tts.modelVoice': { nome: 'voce naturale', valore: (v) => v || 'automatica', livello: 1 },
    'dictation.autoSend': { nome: 'invio di quello che detti nelle chat', valore: sino('da solo', 'a mano, dopo averlo corretto'), livello: 1 },
    'autoArchive.enabled': { nome: 'riordino automatico delle schede', valore: ATTIVO, livello: 1 },
    'autoArchive.onIdle': { nome: 'archiviazione quando Filo è inattivo', valore: ATTIVA, livello: 1 },
    'autoArchive.idleHours': { nome: 'ore di inattività prima di archiviare', valore: numero, livello: 1 },
    'autoArchive.onClose': { nome: 'riordino alla riapertura', valore: ATTIVO, livello: 1 },
    'notifications.durationSec': { nome: 'durata delle notifiche', valore: (v) => (Number(v) ? `${numero(v)} s` : 'finché non la chiudi'), livello: 1 },
    'notifications.soundEnabled': { nome: 'suono delle notifiche', valore: ATTIVO, livello: 1 },
    'notifications.sound': { nome: 'suono scelto per le notifiche', valori: { default: 'standard', gentle: 'delicata', urgent: 'urgente', chime: 'carillon' }, livello: 1 },
    'featureFlags.spellcheck': { nome: 'correttore ortografico', valore: ATTIVO, livello: 1 },
    'featureFlags.help': { nome: 'barra dell\'Aiuto', valore: ATTIVA, livello: 1 },
    'featureFlags.categorize': { nome: 'categorizzazione automatica', valore: ATTIVA, livello: 1 },
    blocklist: { nome: 'domini dove Filo non interviene', elenco: true, livello: 2 },
    provider: { nome: 'fornitore dei modelli', valori: { openrouter: 'OpenRouter' }, livello: 2 },
    useDefaultModels: { nome: 'modelli predefiniti', valore: sino('in uso', 'spenti'), livello: 2 },
    openWeightsOnly: { nome: 'solo modelli a pesi aperti', valore: sino('sì', 'no'), livello: 2 },
    'apiKeys.*': { nome: (k) => `chiave ${NOMI_CHIAVI[k] || 'di un servizio'}`, segreto: true },
    'models.*': { nome: (k) => `modello per «${etichettaFunzione(k)}»`, valore: (v) => v || 'nessuno', livello: 2 },
    'modelRegistry.*': { nome: (k) => `modello «${k}»`, valore: (v) => (v && v.model ? v.model : 'non c\'è'), livello: 2 },
    monthlyLimitEur: { nome: 'limite di spesa mensile', valore: (v) => `${numero(v)} €`, livello: 2 },
    'security.protectIpLeak': { nome: 'protezione dell\'IP locale (WebRTC)', valore: ATTIVA, livello: 2 },
    'security.blockPopups': { nome: 'blocco dei popup non richiesti', valore: ATTIVO, livello: 2 },
    'security.safeBrowse.enabled': { nome: 'avviso sui siti pericolosi', valore: ATTIVO, livello: 2 },
    'security.safeBrowse.safeBrowsingKey': { nome: 'chiave del controllo dei siti pericolosi', segreto: true },
    'security.safeBrowse.networkSignals': { nome: 'controlli di rete sui siti', valore: sino('attivi', 'spenti'), livello: 2 },
    'security.safeBrowse.llmJudge': { nome: 'giudizio AI sui siti sospetti', valore: ATTIVO, livello: 2 },
    'security.safeBrowse.sandbox': { nome: 'link sospetti in una finestra isolata', valore: sino('sì', 'no'), livello: 2 },
    'security.cookies.mode': { nome: 'gestione dei cookie', valori: { manual: 'manuale', default: 'automatica', privacy: 'privacy massima' }, livello: 2 },
    'security.cookies.trustedSites': { nome: 'siti fidati dove resti connesso', elenco: true, livello: 2 },
    'security.cookies.bannerSites': { nome: 'siti dove vedi i banner dei cookie', elenco: true, livello: 2 },
    'security.fingerprint.mode': { nome: 'protezione dal fingerprinting', valori: { off: 'spenta', default: 'automatica', privacy: 'privacy massima' }, livello: 2 },
    'security.adblock.enabled': { nome: 'blocco di pubblicità e tracker', valore: ATTIVO, livello: 2 },
    'security.adSkip.enabled': { nome: 'salta le pubblicità dei video', valore: ATTIVO, livello: 1 },
    'security.siteBlock.enabled': { nome: 'blocco dei siti in blacklist', valore: ATTIVO, livello: 2 },
    'security.siteBlock.useAdblockLists': { nome: 'liste pubbliche come blacklist', valore: sino('in uso', 'spente'), livello: 2 },
    'security.siteBlock.blacklist': { nome: 'domini in blacklist', elenco: true, livello: 2 },
    'security.downloads.confirmExecutables': { nome: 'domanda prima di scaricare un programma', valore: ATTIVA, livello: 2 },
    'security.downloads.trustedSites': { nome: 'siti fidati per i programmi', elenco: true, livello: 2 },
    'security.autoFeedback': { nome: 'segnalazione automatica dei problemi', valore: ATTIVA, livello: 2 },
    'proxy.datacenter': { nome: 'indirizzo del proxy economico', segreto: true },
    'proxy.residential': { nome: 'indirizzo del proxy residenziale', segreto: true },
    'proxy.bypass': { nome: 'siti esclusi dal proxy', valore: (v) => v || 'nessuno', livello: 2 },
    'proxy.defaultCountry': { nome: 'paese predefinito del proxy', valore: (v) => nomePaese(v), livello: 1 },
  };

  // ── Esclusioni: le scritture che NON diventano un evento, ognuna col suo perché ──
  // Unico posto dove si decide cosa non entra nel filo; la sentinella vuole un motivo per ognuna.
  const ESCLUSIONI = {
    'proxy.lastCountry': 'è l\'ultimo paese scelto per aprire una scheda: lo annota Filo, il gesto vero è la scheda',
    'security.cookies.bozza': 'è il testo a metà nella casella dei siti fidati: diventa un cambio quando entra nell\'elenco',
    'security.siteBlock.righeScartate': 'le righe scartate dalla blacklist sono un avviso sulla casella, non una scelta',
    'security.downloads.righeScartate': 'le righe scartate dai siti fidati sono un avviso sulla casella, non una scelta',
    'pricing.*': 'i prezzi dei modelli servono ai conti e nessuna pagina li scrive',
    usdToEur: 'il cambio dollaro-euro serve ai conti e nessuna pagina lo scrive',
    azzeramento: 'cancellare tutti i dati non lascia traccia: è proprio quello che si è chiesto',
    'timer:suona': 'un timer o una sveglia che arriva all\'ora e suona è il tempo che passa, non un cambio di qualcuno',
    'timer:ferma': 'fermare la suoneria chiude il giro del timer: rimetterlo non avrebbe più niente da far suonare',
    'timer:pausa': 'pausa e ripresa di un timer sono il suo pulsante play: si riprende da lì',
    'zoom:propria': 'una pagina che scala da sé il suo contenuto (l\'editor) tiene lei il suo zoom',
  };

  function jollyDi(chiave, tabella) {
    for (const k of Object.keys(tabella)) {
      if (!k.endsWith('.*')) continue;
      const base = k.slice(0, -2);
      if (chiave.startsWith(`${base}.`)) return { base, sotto: chiave.slice(base.length + 1), def: tabella[k] };
    }
    return null;
  }
  function genitoreJolly(percorso) {
    return Object.prototype.hasOwnProperty.call(VOCI, `${percorso}.*`)
      || Object.prototype.hasOwnProperty.call(ESCLUSIONI, `${percorso}.*`);
  }

  function voce(chiave) {
    const k = String(chiave || '');
    if (Object.prototype.hasOwnProperty.call(VOCI, k)) {
      const v = VOCI[k];
      return { ...v, nome: v.nome };
    }
    const j = jollyDi(k, VOCI);
    if (j) return { ...j.def, nome: typeof j.def.nome === 'function' ? j.def.nome(j.sotto) : j.def.nome };
    return null;
  }
  function esclusa(chiave) {
    const k = String(chiave || '');
    if (Object.prototype.hasOwnProperty.call(ESCLUSIONI, k)) return ESCLUSIONI[k];
    const j = jollyDi(k, ESCLUSIONI);
    return j ? j.def : null;
  }
  // I segmenti di un percorso: le chiavi dei token e dei modelli hanno punti dentro.
  function segmenti(chiave) {
    const k = String(chiave || '');
    for (const t of [VOCI, ESCLUSIONI]) {
      const j = jollyDi(k, t);
      if (j) return [...j.base.split('.'), j.sotto];
    }
    return k.split('.');
  }

  // ── Confronto ───────────────────────────────────────────────────────────────
  function semplice(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  function stabile(v) {
    if (Array.isArray(v)) return `[${v.map(stabile).join(',')}]`;
    if (semplice(v)) return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stabile(v[k])}`).join(',')}}`;
    return v === undefined ? 'undefined' : JSON.stringify(v);
  }
  function uguale(a, b) { return stabile(a) === stabile(b); }

  function foglie(a, b, base, out) {
    const jolly = base && genitoreJolly(base);
    const chiavi = new Set([...(semplice(a) ? Object.keys(a) : []), ...(semplice(b) ? Object.keys(b) : [])]);
    for (const k of chiavi) {
      const percorso = base ? `${base}.${k}` : k;
      const va = semplice(a) ? a[k] : undefined;
      const vb = semplice(b) ? b[k] : undefined;
      const scendi = !jolly && (semplice(va) || semplice(vb))
        && (semplice(va) || va === undefined) && (semplice(vb) || vb === undefined);
      if (scendi) foglie(va, vb, percorso, out);
      else if (!uguale(va, vb)) out.push({ chiave: percorso, prima: va, dopo: vb });
    }
    return out;
  }

  // `normalizza`: lo stesso di getSettings (default fusi), così una chiave assente non sembra tolta.
  function cambiImpostazioni(primaGrezze, dopoGrezze, normalizza) {
    const n = typeof normalizza === 'function' ? normalizza : (x) => x || {};
    const out = [];
    for (const c of foglie(n(primaGrezze), n(dopoGrezze), '', [])) {
      if (esclusa(c.chiave)) continue;
      const v = voce(c.chiave);
      if (v && v.segreto) {
        out.push({ chiave: c.chiave, segreto: true, vuotoPrima: !c.prima, vuotoDopo: !c.dopo });
      } else {
        out.push(c);
      }
    }
    return out;
  }

  function scaduto(t, adesso) {
    return !t.paused && new Date(t.endsAt).getTime() <= adesso;
  }
  function ricorrente(t) { return Array.isArray(t && t.repeat) && t.repeat.length > 0; }
  const CAMPI_TIMER = ['label', 'endsAt', 'repeat', 'atTime', 'kind'];

  // I timer e le sveglie per id. Il tempo che passa (suonare, ripartire, la pausa) non è un cambio.
  function cambiTimer(prima, dopo, adesso = Date.now()) {
    const mappa = (l) => new Map((Array.isArray(l) ? l : []).filter((t) => t && t.id).map((t) => [t.id, t]));
    const a = mappa(prima);
    const b = mappa(dopo);
    const out = [];
    for (const [id, t] of b) {
      if (!a.has(id)) out.push({ chiave: `timer:${id}`, prima: null, dopo: t });
    }
    for (const [id, t] of a) {
      if (b.has(id)) continue;
      if (t.ringing || (scaduto(t, adesso) && !ricorrente(t))) continue; // ESCLUSIONI['timer:ferma']
      out.push({ chiave: `timer:${id}`, prima: t, dopo: null });
    }
    for (const [id, t] of a) {
      const u = b.get(id);
      if (!u) continue;
      if (!!t.paused !== !!u.paused) continue; // ESCLUSIONI['timer:pausa']
      if (!t.ringing && u.ringing) continue; // ESCLUSIONI['timer:suona']
      if (t.ringing && !u.ringing) continue; // ESCLUSIONI['timer:ferma']
      if (scaduto(t, adesso) && ricorrente(t)) continue; // ESCLUSIONI['timer:suona']
      const cambiato = CAMPI_TIMER.some((k) => !uguale(t[k], u[k]));
      if (cambiato) out.push({ chiave: `timer:${id}`, prima: t, dopo: u });
    }
    return out;
  }

  function cambiRegoleProxy(prima, dopo) {
    const a = semplice(prima) ? prima : {};
    const b = semplice(dopo) ? dopo : {};
    const out = [];
    for (const dom of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ra = a[dom] || null;
      const rb = b[dom] || null;
      const nucleo = (r) => (r ? { country: r.country || '', tier: r.tier || null } : null);
      if (!uguale(nucleo(ra), nucleo(rb))) out.push({ chiave: `proxy:${dom}`, prima: ra, dopo: rb });
    }
    return out;
  }

  // ── Le frasi ────────────────────────────────────────────────────────────────
  const PAESI = {
    us: 'Stati Uniti', gb: 'Regno Unito', fr: 'Francia', de: 'Germania', es: 'Spagna', nl: 'Paesi Bassi', jp: 'Giappone', it: 'Italia',
  };
  function nomePaese(code) {
    const c = String(code || '').toLowerCase();
    return PAESI[c] || (c ? c.toUpperCase() : 'nessuno');
  }
  function breve(testo, max = 60) {
    const t = String(testo == null ? '' : testo).replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }
  function valoreDi(v, x) {
    if (x === undefined || x === null) {
      if (v && v.valore) { try { return String(v.valore(x)); } catch (_) {} }
      return 'nessuno';
    }
    if (v && v.valori && Object.prototype.hasOwnProperty.call(v.valori, x)) return v.valori[x];
    if (v && v.valore) { try { return String(v.valore(x)); } catch (_) {} }
    if (typeof x === 'boolean') return x ? 'sì' : 'no';
    return breve(typeof x === 'object' ? JSON.stringify(x) : String(x), 40);
  }
  function elencoDi(lista, n = 3) {
    const l = lista.map((x) => breve(x, 40));
    return l.length > n ? `${l.slice(0, n).join(', ')} e altri ${l.length - n}` : l.join(', ');
  }
  function oraDi(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function durataDi(t) {
    const sec = Math.round((new Date(t.endsAt).getTime() - new Date(t.startedAt).getTime()) / 1000);
    if (!Number.isFinite(sec) || sec <= 0) return '';
    const T = global.SN_TIME;
    return T && T.fmtDurationLabel ? T.fmtDurationLabel(sec) : `${Math.round(sec / 60)} min`;
  }
  function nomeTimer(t) {
    const label = breve(t && t.label, 40);
    if (t && t.kind === 'alarm') {
      const M = global.SN_FILO_MEMORY;
      const rip = ricorrente(t) && M && M.formatRepeat ? ` ${M.formatRepeat(t.repeat)}` : '';
      return `sveglia${label ? ` «${label}»` : ''} delle ${t.atTime || oraDi(t.endsAt)}${rip}`;
    }
    return `timer${label ? ` «${label}»` : ''}`;
  }

  function fraseCambio(c) {
    const k = String(c && c.chiave || '');
    if (k.startsWith('timer:')) {
      if (!c.prima && c.dopo) {
        const d = c.dopo.kind === 'alarm' ? '' : durataDi(c.dopo);
        return `nuov${c.dopo.kind === 'alarm' ? 'a' : 'o'} ${nomeTimer(c.dopo)}${d ? `, ${d}` : ''}`;
      }
      if (c.prima && !c.dopo) return `tolt${c.prima.kind === 'alarm' ? 'a' : 'o'} ${c.prima.kind === 'alarm' ? 'la' : 'il'} ${nomeTimer(c.prima)}`;
      if (c.prima && c.dopo) {
        const oraPrima = c.prima.kind === 'alarm' ? (c.prima.atTime || oraDi(c.prima.endsAt)) : oraDi(c.prima.endsAt);
        const oraDopo = c.dopo.kind === 'alarm' ? (c.dopo.atTime || oraDi(c.dopo.endsAt)) : oraDi(c.dopo.endsAt);
        if (oraPrima === oraDopo && !uguale(c.prima.label, c.dopo.label)) return `${nomeTimer(c.prima)} → «${breve(c.dopo.label, 40)}»`;
        if (c.dopo.kind === 'alarm') return `${nomeTimer(c.prima)} → ${oraDopo}`;
        return `${nomeTimer(c.dopo)}: scade alle ${oraPrima} → ${oraDopo}`;
      }
      return 'un timer';
    }
    if (k.startsWith('proxy:')) {
      const dom = k.slice(6);
      if (!c.prima && c.dopo) return `${dom} sempre da ${nomePaese(c.dopo.country)}`;
      if (c.prima && !c.dopo) return `${dom}: tolta la regola su ${nomePaese(c.prima.country)}`;
      return `${dom}: da ${nomePaese(c.prima && c.prima.country)} → da ${nomePaese(c.dopo && c.dopo.country)}`;
    }
    if (k.startsWith('zoom:')) {
      const p = (x) => (Number.isFinite(Number(x)) ? `${Math.round(Number(x))}%` : '?');
      return `zoom di ${k.slice(5)}: ${p(c.prima)} → ${p(c.dopo)}`;
    }
    const v = voce(k);
    const nome = v ? v.nome : 'un\'impostazione di Filo';
    if (c.segreto) {
      const cosa = c.vuotoPrima && !c.vuotoDopo ? 'inserita' : (!c.vuotoPrima && c.vuotoDopo ? 'tolta' : 'cambiata');
      return `${nome}: ${cosa}`;
    }
    if (v && v.elenco) {
      const a = Array.isArray(c.prima) ? c.prima.map(String) : [];
      const b = Array.isArray(c.dopo) ? c.dopo.map(String) : [];
      const piu = b.filter((x) => !a.includes(x));
      const meno = a.filter((x) => !b.includes(x));
      const parti = [];
      // Gli elenchi sono di siti: münchen.de, non la forma «xn--» con cui si salva.
      const N = global.SN_NOMI_SITO;
      const leggibili = (l) => elencoDi(N && N.leggibile ? l.map((x) => N.leggibile(x)) : l);
      if (piu.length) parti.push(`aggiunt${piu.length > 1 ? 'i' : 'o'} ${leggibili(piu)}`);
      if (meno.length) parti.push(`tolt${meno.length > 1 ? 'i' : 'o'} ${leggibili(meno)}`);
      return `${nome}: ${parti.join(', ') || 'riordinati'}`;
    }
    if (v && v.testo) {
      const dopo = String(c.dopo || '').trim();
      return dopo ? `${nome}: «${breve(dopo, 50)}»` : `${nome}: tolto`;
    }
    return `${nome}: ${valoreDi(v, c.prima)} → ${valoreDi(v, c.dopo)}`;
  }

  // Le frasi di un evento, una per cambio: chi le mostra sceglie quante.
  function frasi(evento) {
    return (evento && Array.isArray(evento.cambi) ? evento.cambi : []).map(fraseCambio);
  }
  function frase(evento, max = 3) {
    const f = frasi(evento);
    if (f.length <= max) return f.join('; ');
    return `${f.slice(0, max).join('; ')} e altri ${f.length - max} cambi`;
  }

  const DOVE = {
    preferences: 'dalle Preferenze',
    options: 'dalla pagina Modelli',
    altro: 'dalla pagina Altro',
    security: 'dalla pagina Sicurezza',
    credits: 'dalla pagina Crediti',
    newtab: 'dalla home',
    dashboard: 'dalla home',
    shell: 'dalla barra delle schede',
    'menu-scheda': 'dal menu della scheda',
    zoom: 'con un gesto sulla pagina',
  };
  function provenienza(evento) {
    const e = evento || {};
    if (e.annulla) return e.via === 'chat' ? 'annullato dalla chat' : 'annullato con un clic';
    switch (e.via) {
      case 'chat': return 'dalla chat';
      case 'assistente': return 'dall\'assistente della pagina';
      case 'importazione': return 'dall\'importazione dei dati';
      case 'pagina': return 'da un menu di Filo in una pagina web';
      case 'interfaccia': return DOVE[e.dove] || 'dalle impostazioni';
      default: return 'da Filo';
    }
  }

  // ── Fusione: un cursore trascinato è UN cambio ─────────────────────────────
  const FINESTRA_FUSIONE_MS = 4000;
  const FONDIBILI = new Set(['interfaccia', 'pagina', 'filo']);
  function fondibile(ultimo, nuovo) {
    if (!ultimo || !nuovo || ultimo.annulla || nuovo.annulla) return false;
    if (ultimo.tipo !== nuovo.tipo || ultimo.via !== nuovo.via || (ultimo.dove || '') !== (nuovo.dove || '')) return false;
    if (!FONDIBILI.has(nuovo.via)) return false;
    const da = new Date(ultimo.agg || ultimo.ts).getTime();
    if (!(new Date(nuovo.ts).getTime() - da <= FINESTRA_FUSIONE_MS)) return false;
    const chiavi = (e) => e.cambi.map((c) => c.chiave).sort().join('\n');
    return chiavi(ultimo) === chiavi(nuovo);
  }
  // Ritorna l'evento fuso, o null se i passi si annullano a vicenda (si è tornati al valore di partenza).
  function fondi(ultimo, nuovo) {
    const perChiave = new Map(nuovo.cambi.map((c) => [c.chiave, c]));
    const cambi = ultimo.cambi.map((c) => {
      const n = perChiave.get(c.chiave);
      if (c.segreto) return { ...c, vuotoDopo: n.vuotoDopo };
      return { ...c, dopo: n.dopo };
    }).filter((c) => c.segreto || !uguale(c.prima, c.dopo));
    if (!cambi.length) return null;
    return { ...ultimo, cambi, agg: nuovo.ts };
  }

  // ── Annullare ──────────────────────────────────────────────────────────────
  // Un evento è annullato se uno dopo di lui lo annulla e quello, a sua volta, non è stato annullato.
  function annullati(eventi) {
    const lista = Array.isArray(eventi) ? eventi : [];
    const out = new Map();
    for (let i = lista.length - 1; i >= 0; i--) {
      const e = lista[i];
      if (!e || !e.annulla || out.has(e.id)) continue;
      if (!out.has(e.annulla)) out.set(e.annulla, e.id);
    }
    return out;
  }
  function annullabile(evento) {
    return !!evento && Array.isArray(evento.cambi) && evento.cambi.some((c) => !c.segreto);
  }
  // Come CANCELLA_SVEGLIA: toccare più timer insieme chiede conferma.
  function livello(evento) {
    const cambi = (evento && evento.cambi) || [];
    let max = cambi.filter((c) => String(c.chiave || '').startsWith('timer:')).length > 1 ? 2 : 1;
    for (const c of cambi) {
      const k = String(c.chiave || '');
      if (k.startsWith('timer:') || k.startsWith('zoom:')) continue;
      if (k.startsWith('proxy:')) { max = Math.max(max, 1); continue; }
      const v = voce(k);
      max = Math.max(max, v && v.livello === 1 ? 1 : 2);
    }
    return max;
  }

  // Il pezzo di impostazioni che rimette `prima`. Le mappe sostituite intere (token, registro dei
  // modelli) si riscrivono complete a partire da quelle di adesso.
  function annulloImpostazioni(evento, correnti, sostituite) {
    const intere = sostituite instanceof Set ? sostituite : new Set(['modelRegistry', 'themeTokens']);
    const parziale = {};
    for (const c of (evento && evento.cambi) || []) {
      if (c.segreto) continue;
      const seg = segmenti(c.chiave);
      if (intere.has(seg[0]) && seg.length > 1) {
        const mappa = semplice(parziale[seg[0]]) ? parziale[seg[0]]
          : { ...((correnti && semplice(correnti[seg[0]])) ? correnti[seg[0]] : {}) };
        const sotto = seg.slice(1).join('.');
        if (c.prima === undefined) delete mappa[sotto];
        else mappa[sotto] = c.prima;
        parziale[seg[0]] = mappa;
        continue;
      }
      let nodo = parziale;
      for (let i = 0; i < seg.length - 1; i++) {
        if (!semplice(nodo[seg[i]])) nodo[seg[i]] = {};
        nodo = nodo[seg[i]];
      }
      const v = voce(c.chiave);
      nodo[seg[seg.length - 1]] = v && v.elenco ? elencoAnnullato(c, seg.reduce((x, k) => (semplice(x) ? x[k] : undefined), correnti)) : c.prima;
    }
    return parziale;
  }
  // Un elenco di siti si annulla a voci sull'elenco di adesso: via quelle che il cambio aggiunse, di nuovo
  // quelle che tolse. Rimettere l'elenco intero perdeva i siti cambiati dopo (#949).
  function elencoAnnullato(c, attuale) {
    const arr = (x) => (Array.isArray(x) ? x : []);
    const prima = arr(c.prima);
    const dopo = arr(c.dopo);
    const out = arr(attuale).filter((x) => prima.includes(x) || !dopo.includes(x));
    prima.forEach((x, i) => { if (!dopo.includes(x) && !out.includes(x)) out.splice(Math.min(i, out.length), 0, x); });
    return out;
  }

  // La lista dei timer rimessa com'era. Un timer tolto che nel frattempo sarebbe già scaduto non
  // torna: torna nell'elenco `saltati`, così chi annulla lo può dire.
  function annulloTimer(evento, lista, adesso = Date.now()) {
    const out = Array.isArray(lista) ? lista.slice() : [];
    const saltati = [];
    for (const c of (evento && evento.cambi) || []) {
      const id = String(c.chiave || '').slice(6);
      const idx = out.findIndex((t) => t && t.id === id);
      if (!c.prima) {
        if (idx >= 0) out.splice(idx, 1);
        continue;
      }
      if (!c.prima.paused && !ricorrente(c.prima) && new Date(c.prima.endsAt).getTime() <= adesso) {
        saltati.push(fraseCambio(c));
        continue;
      }
      // Una sveglia ricorrente rimessa dopo la sua ora riparte dalla prossima, invece di suonare subito.
      let voce = c.prima;
      const M = global.SN_FILO_MEMORY;
      if (ricorrente(voce) && new Date(voce.endsAt).getTime() <= adesso && M && M.nextAlarmOccurrence) {
        const dopo = M.nextAlarmOccurrence(voce, adesso);
        if (dopo) voce = { ...voce, endsAt: new Date(dopo).toISOString() };
      }
      if (idx >= 0) out[idx] = { ...out[idx], ...pick(voce, CAMPI_TIMER) };
      else out.unshift({ ...voce, ringing: false });
    }
    return { lista: out, saltati };
  }
  function pick(o, campi) {
    const r = {};
    for (const k of campi) if (o[k] !== undefined) r[k] = o[k];
    return r;
  }

  function annulloRegoleProxy(evento, regole) {
    const out = { ...(semplice(regole) ? regole : {}) };
    for (const c of (evento && evento.cambi) || []) {
      const dom = String(c.chiave || '').slice(6);
      if (c.prima) out[dom] = c.prima;
      else delete out[dom];
    }
    return out;
  }

  // ── Per il modello ─────────────────────────────────────────────────────────
  function quando(ts, adesso) {
    const min = Math.round((adesso - new Date(ts).getTime()) / 60000);
    if (!(min >= 1)) return 'ora';
    if (min < 60) return `${min} min fa`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h fa`;
    return `${Math.floor(h / 24)} giorni fa`;
  }
  // Le righe dei cambi recenti, dal più vecchio al più nuovo. Il testo dentro viene anche dai nomi
  // dei timer e dai valori scritti da un modello: chi le mette nel prompt le recinta (filoState.js).
  function righePerModello(eventi, { adesso = Date.now(), max = 40 } = {}) {
    // Un'importazione accoda eventi vecchi: per il modello contano in ordine di tempo.
    const tempo = (e) => new Date(e && e.ts).getTime() || 0;
    const lista = (Array.isArray(eventi) ? eventi : []).slice().sort((a, b) => tempo(a) - tempo(b));
    const chiusi = annullati(lista);
    const scelti = lista.slice(-max);
    const righe = scelti.map((e) => {
      const stato = chiusi.has(e.id) ? ` (annullato da ${chiusi.get(e.id)})` : '';
      const di = e.annulla ? ` annulla ${e.annulla}:` : '';
      const no = annullabile(e) ? '' : ' (non si annulla: il valore non è conservato)';
      return `- [${quando(e.agg || e.ts, adesso)} · ${provenienza(e)}] ${e.id}:${di} ${frase(e, 6)}${stato}${no}`;
    });
    return { righe, tolti: lista.length - scelti.length };
  }

  global.SN_CAMBI = {
    VOCI,
    ESCLUSIONI,
    FINESTRA_FUSIONE_MS,
    voce,
    esclusa,
    segmenti,
    uguale,
    cambiImpostazioni,
    cambiTimer,
    cambiRegoleProxy,
    fraseCambio,
    valore: (chiave, x) => valoreDi(voce(chiave), x),
    frasi,
    frase,
    provenienza,
    fondibile,
    fondi,
    annullati,
    annullabile,
    livello,
    annulloImpostazioni,
    annulloTimer,
    annulloRegoleProxy,
    righePerModello,
    nomePaese,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
