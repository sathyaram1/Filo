// Il motore delle regole di iniezione di YouTube (#1974), scritto da zero: gira nel mondo della pagina prima dei suoi
// script, con le regole che il main ha letto dalle liste (services/regoleYouTube.js). Non deve dipendere da niente fuori
// da `motore`, che si spedisce come testo. Regole: tests/unit/youtubeScriptlet.test.mjs.
'use strict';

/* eslint-disable no-new-func */
function motore(regole, W, esponi) {
  const N = {
    parse: W.JSON.parse, stringify: W.JSON.stringify, apply: Reflect.apply, def: Object.defineProperty,
    desc: Object.getOwnPropertyDescriptor, own: Object.prototype.hasOwnProperty, now: Date.now,
  };
  const proprio = (o, k) => o !== null && typeof o === 'object' && N.apply(N.own, o, [k]);
  const oggetto = (o) => o !== null && typeof o === 'object';

  // ─── testi e schemi ──────────────────────────────────────────────────────
  // «/corpo/flag» è un'espressione regolare con le sue flag; il resto è un testo da cercare così com'è.
  function schema(s, flagTesto, intero) {
    const t = String(s == null ? '' : s);
    if (t === '') return /^/;
    const m = /^\/(.+)\/([dgimsuy]*)$/.exec(t);
    if (m) { try { return new RegExp(m[1], m[2] || undefined); } catch (_) { return null; } }
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(intero ? '^' + esc + '$' : esc, flagTesto);
  }
  const prova = (re, s) => { if (!re) return false; re.lastIndex = 0; return re.test(s); };

  function coppie(extra) {
    const o = {};
    for (let i = 0; i + 1 < extra.length; i += 2) o[extra[i]] = extra[i + 1];
    return o;
  }

  // «url:/re/ method:POST» o un solo schema, che vale per l'indirizzo.
  function richiestaCorrisponde(props, det) {
    const p = String(props || '').trim();
    if (!p) return true;
    for (const pezzo of p.split(/\s+/)) {
      const m = /^([a-zA-Z]+):(.*)$/.exec(pezzo);
      const nominato = m && !/^https?$/i.test(m[1]);
      const chiave = nominato ? m[1] : 'url';
      if (!prova(schema(nominato ? m[2] : pezzo), String(det[chiave] == null ? '' : det[chiave]))) return false;
    }
    return true;
  }

  // ─── percorsi da potare (json-prune) ─────────────────────────────────────
  // a.b.c toglie c; «[]» o «*» passa per ogni figlio; «[-]» toglie l'elemento dell'elenco in cui il resto esiste;
  // «{-}» toglie la chiave in cui il resto esiste.
  function esiste(o, parti, i) {
    if (i >= parti.length) return true;
    if (!oggetto(o)) return false;
    const p = parti[i];
    if (p === '[]' || p === '*' || p === '[-]' || p === '{-}') {
      for (const k of Object.keys(o)) if (esiste(o[k], parti, i + 1)) return true;
      return false;
    }
    if (!proprio(o, p)) return false;
    return i === parti.length - 1 ? true : esiste(o[p], parti, i + 1);
  }

  function togli(o, parti, i) {
    if (!oggetto(o) || i >= parti.length) return false;
    const p = parti[i];
    let fatto = false;
    if (p === '[-]' && Array.isArray(o)) {
      for (let k = o.length - 1; k >= 0; k--) if (esiste(o[k], parti, i + 1)) { o.splice(k, 1); fatto = true; }
      return fatto;
    }
    if (p === '{-}') {
      for (const k of Object.keys(o)) if (esiste(o[k], parti, i + 1)) { delete o[k]; fatto = true; }
      return fatto;
    }
    if (p === '[]' || p === '*') {
      for (const k of Object.keys(o)) if (togli(o[k], parti, i + 1)) fatto = true;
      return fatto;
    }
    if (!proprio(o, p)) return false;
    if (i === parti.length - 1) { delete o[p]; return true; }
    return togli(o[p], parti, i + 1);
  }

  const percorsi = (s) => String(s || '').split(/\s+/).filter(Boolean).map((x) => x.split('.'));

  function potatore(rawPota, rawServe) {
    const pota = percorsi(rawPota);
    const serve = percorsi(rawServe);
    return (o) => {
      if (!oggetto(o) || !pota.length) return false;
      if (serve.length && !serve.every((p) => esiste(o, p, 0))) return false;
      let fatto = false;
      for (const p of pota) if (togli(o, p, 0)) fatto = true;
      return fatto;
    };
  }

  // ─── JSONPath di uBlock, la parte che le liste usano ─────────────────────
  // .a ..a .* [*] [n] [?filtro] e in coda «=valore», «+=oggetto» o niente (togli). Il filtro vale sul nodo stesso:
  // [?.a] tiene il nodo se ha a; [?.a=="x"] [?.a*="x"] [?.a^="x"] [?.a$="x"] [?.a!="x"] [?.a=/re/]; [?!.a] lo nega.
  function leggiChiave(q, i) {
    let j = i;
    if (q[j] === '"') {
      j++;
      let s = '';
      while (j < q.length && q[j] !== '"') { if (q[j] === '\\') j++; s += q[j++]; }
      return { chiave: s, fine: j + 1 };
    }
    while (j < q.length && !'.[]=!^$+'.includes(q[j]) && !(q[j] === '*' && q[j + 1] === '=')) j++;
    return { chiave: q.slice(i, j), fine: j };
  }

  function chiusa(q, i) {
    let prof = 0;
    let virg = false;
    for (let j = i; j < q.length; j++) {
      const c = q[j];
      if (virg) { if (c === '\\') j++; else if (c === '"') virg = false; continue; }
      if (c === '"') virg = true;
      else if (c === '[') prof++;
      else if (c === ']') { prof--; if (prof === 0) return j; }
    }
    return -1;
  }

  // I passi del percorso fino a `fine` (o a un operatore, nel filtro); ritorna { passi, fine }.
  function passiDi(q, i, nelFiltro) {
    const passi = [];
    while (i < q.length) {
      const c = q[i];
      if (c === '.' && q[i + 1] === '.') {
        const k = leggiChiave(q, i + 2);
        passi.push({ tipo: 'discendi', chiave: k.chiave });
        i = k.fine;
      } else if (c === '.') {
        if (q[i + 1] === '*' && q[i + 2] !== '=') { passi.push({ tipo: 'tutti' }); i += 2; continue; }
        const k = leggiChiave(q, i + 1);
        passi.push({ tipo: 'chiave', chiave: k.chiave });
        i = k.fine;
      } else if (c === '[') {
        const f = chiusa(q, i);
        if (f < 0) throw new Error('jsonpath');
        const dentro = q.slice(i + 1, f);
        if (dentro === '*' || dentro === '') passi.push({ tipo: 'tutti' });
        else if (dentro[0] === '?') passi.push({ tipo: 'filtro', filtro: filtroDi(dentro.slice(1)) });
        else if (/^-?\d+$/.test(dentro)) passi.push({ tipo: 'indice', indice: Number(dentro) });
        else if (dentro[0] === '"') passi.push({ tipo: 'chiave', chiave: N.parse(dentro) });
        else passi.push({ tipo: 'chiave', chiave: dentro });
        i = f + 1;
      } else if (nelFiltro) {
        break;
      } else {
        const k = leggiChiave(q, i);
        if (k.fine === i) break;
        passi.push({ tipo: 'chiave', chiave: k.chiave });
        i = k.fine;
      }
    }
    return { passi, fine: i };
  }

  function valoreJson(s) {
    const t = String(s).trim();
    if (t[0] === '/' && /\/[a-z]*$/.test(t) && t.length > 1) return { re: schema(t) };
    try { return { v: N.parse(t) }; } catch (_) { return { v: t }; }
  }

  function filtroDi(f) {
    let s = f;
    let nega = false;
    if (s[0] === '!') { nega = true; s = s.slice(1); }
    const p = passiDi(s, 0, true);
    const resto = s.slice(p.fine);
    const m = /^(==|!=|\*=|\^=|\$=|=)([\s\S]*)$/.exec(resto);
    return { nega, passi: p.passi, op: m ? m[1] : '', valore: m ? valoreJson(m[2]) : null };
  }

  function figli(v) {
    if (!oggetto(v)) return [];
    return Object.keys(v).map((k) => ({ padre: v, chiave: Array.isArray(v) ? Number(k) : k, valore: v[k] }));
  }

  function discendi(v, chiave, out, prof) {
    if (!oggetto(v) || prof > 64) return;
    for (const f of figli(v)) {
      if (f.chiave === chiave && !Array.isArray(v)) out.push(f);
      discendi(f.valore, chiave, out, prof + 1);
    }
  }

  function confronta(op, valore, x) {
    if (!op) return true;
    if (valore && valore.re) return op === '=' && prova(valore.re, String(x));
    const v = valore ? valore.v : undefined;
    if (op === '==' || op === '=') return x === v;
    if (op === '!=') return x !== v;
    if (typeof x !== 'string') return false;
    if (op === '*=') return x.includes(String(v));
    if (op === '^=') return x.startsWith(String(v));
    if (op === '$=') return x.endsWith(String(v));
    return false;
  }

  function cammina(nodi, passi, creaUltima) {
    let cur = nodi;
    passi.forEach((p, n) => {
      const out = [];
      for (const nodo of cur) {
        const v = nodo.valore;
        if (p.tipo === 'chiave') {
          if (oggetto(v) && (proprio(v, p.chiave) || (creaUltima && n === passi.length - 1 && !Array.isArray(v)))) {
            out.push({ padre: v, chiave: p.chiave, valore: v[p.chiave] });
          }
        } else if (p.tipo === 'tutti') {
          out.push(...figli(v));
        } else if (p.tipo === 'indice') {
          if (Array.isArray(v)) {
            const k = p.indice < 0 ? v.length + p.indice : p.indice;
            if (k >= 0 && k < v.length) out.push({ padre: v, chiave: k, valore: v[k] });
          }
        } else if (p.tipo === 'discendi') {
          discendi(v, p.chiave, out, 0);
        } else if (p.tipo === 'filtro') {
          const trovati = cammina([{ valore: v }], p.filtro.passi, false);
          const ok = trovati.some((t) => confronta(p.filtro.op, p.filtro.valore, t.valore));
          if (ok !== p.filtro.nega) out.push(nodo);
        }
      }
      cur = out;
    });
    return cur;
  }

  // La coda di assegnazione si cerca fuori da parentesi e virgolette.
  function compila(q) {
    const s = String(q || '');
    let prof = 0;
    let virg = false;
    let taglio = -1;
    let op = '';
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (virg) { if (c === '\\') j++; else if (c === '"') virg = false; continue; }
      if (c === '"') virg = true;
      else if (c === '[') prof++;
      else if (c === ']') prof--;
      else if (prof === 0 && c === '+' && s[j + 1] === '=') { taglio = j; op = '+='; break; }
      else if (prof === 0 && c === '=') { taglio = j; op = '='; break; }
    }
    const percorso = taglio < 0 ? s : s.slice(0, taglio);
    const p = passiDi(percorso, 0, false);
    let valore = null;
    if (taglio >= 0) {
      const grezzo = s.slice(taglio + op.length).trim();
      const r = /^repl\(([\s\S]*)\)$/.exec(grezzo);
      if (r) {
        const d = N.parse(r[1]);
        const re = /^\/.+\/[a-z]*$/.test(d.regex) ? schema(d.regex) : new RegExp(d.regex);
        valore = { repl: re, con: String(d.replacement == null ? '' : d.replacement) };
      } else {
        valore = { v: N.parse(grezzo) };
      }
    }
    return { passi: p.passi, op, valore };
  }

  function adesso(v) {
    if (typeof v === 'string') return v.split('${now}').join(String(N.now()));
    if (Array.isArray(v)) return v.map(adesso);
    if (oggetto(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = adesso(v[k]); return o; }
    return v;
  }

  /** Applica la modifica all'oggetto (sul posto); true se ha toccato qualcosa. */
  function modifica(c, radice) {
    const nodi = cammina([{ padre: null, chiave: null, valore: radice }], c.passi, c.op === '=');
    if (!nodi.length) return false;
    if (!c.op) {
      const perPadre = new Map();
      for (const n of nodi) {
        if (!n.padre) continue;
        if (!perPadre.has(n.padre)) perPadre.set(n.padre, []);
        perPadre.get(n.padre).push(n.chiave);
      }
      for (const [padre, chiavi] of perPadre) {
        if (Array.isArray(padre)) [...new Set(chiavi)].sort((a, b) => b - a).forEach((k) => padre.splice(k, 1));
        else chiavi.forEach((k) => { delete padre[k]; });
      }
      return perPadre.size > 0;
    }
    let fatto = false;
    for (const n of nodi) {
      if (c.op === '+=') {
        if (oggetto(n.valore) && oggetto(c.valore.v)) { Object.assign(n.valore, adesso(c.valore.v)); fatto = true; }
      } else if (n.padre) {
        if (c.valore.repl) {
          if (typeof n.valore !== 'string') continue;
          c.valore.repl.lastIndex = 0;
          n.padre[n.chiave] = n.valore.replace(c.valore.repl, c.valore.con);
        } else {
          n.padre[n.chiave] = adesso(c.valore.v);
        }
        fatto = true;
      }
    }
    return fatto;
  }

  // Prima si guarda senza toccare: solo un oggetto che la regola cambia davvero si copia.
  function modificaCopia(c, o) {
    if (!oggetto(o)) return o;
    const nodi = cammina([{ padre: null, chiave: null, valore: o }], c.passi, c.op === '=');
    if (!nodi.length) return o;
    let copia;
    try { copia = N.parse(N.stringify(o)); } catch (_) { return o; }
    modifica(c, copia);
    return copia;
  }

  // ─── agganci alla pagina ─────────────────────────────────────────────────
  function avvolgi(padre, nome, trappola) {
    if (!padre || typeof padre[nome] !== 'function') return;
    padre[nome] = new Proxy(padre[nome], { apply: trappola });
  }

  function percorsoFunzione(radice, catena) {
    const parti = String(catena || '').split('.');
    let o = radice;
    for (let i = 0; i < parti.length - 1; i++) { o = o[parti[i]]; if (o == null) return null; }
    return { padre: o, nome: parti[parti.length - 1] };
  }

  function dettagliFetch(args) {
    const r = args[0];
    const init = oggetto(args[1]) ? args[1] : {};
    const det = { url: '', method: 'GET' };
    try {
      if (W.Request && r instanceof W.Request) { det.url = r.url; det.method = r.method; } else det.url = String(r);
    } catch (_) {}
    if (init.method) det.method = String(init.method);
    return det;
  }

  function rispostaNuova(prima, testo) {
    const nuova = new W.Response(testo, { status: prima.status, statusText: prima.statusText, headers: prima.headers });
    for (const k of ['url', 'redirected', 'type']) {
      try { N.def(nuova, k, { value: prima[k] }); } catch (_) {}
    }
    return nuova;
  }

  // Ogni chiamata a fetch che corrisponde passa per `trasforma(testo) → testo nuovo | null`.
  function sulleRisposteFetch(props, trasforma) {
    avvolgi(W, 'fetch', (t, questo, args) => {
      const p = N.apply(t, questo, args);
      let det;
      try { det = dettagliFetch(args); } catch (_) { return p; }
      if (!richiestaCorrisponde(props, det)) return p;
      return p.then((r) => r.clone().text().then((testo) => {
        const nuovo = trasforma(testo);
        return nuovo == null || nuovo === testo ? r : rispostaNuova(r, nuovo);
      }).catch(() => r));
    });
  }

  // Lo stesso per XMLHttpRequest: la risposta si riscrive quando è completa, una volta per richiesta.
  function sulleRisposteXhr(props, trasforma) {
    const Base = W.XMLHttpRequest;
    if (typeof Base !== 'function') return;
    const dati = new WeakMap();
    const Nuova = class XMLHttpRequest extends Base {
      open(method, url, ...resto) {
        try { dati.set(this, { conta: richiestaCorrisponde(props, { method: String(method), url: String(url) }) }); } catch (_) {}
        return super.open(method, url, ...resto);
      }
      get response() {
        const r = super.response;
        const d = dati.get(this);
        if (!d || !d.conta || this.readyState !== 4) return r;
        if (d.fatta && d.da === r) return d.risultato;
        let out = r;
        try {
          if (typeof r === 'string') {
            const t = trasforma(r);
            if (t != null) out = t;
          } else if (this.responseType === 'json' && oggetto(r)) {
            const t = trasforma(N.stringify(r));
            if (t != null) out = N.parse(t);
          }
        } catch (_) { out = r; }
        d.fatta = true; d.da = r; d.risultato = out;
        return out;
      }
      get responseText() {
        const tipo = this.responseType;
        if (tipo !== '' && tipo !== 'text') return super.responseText;
        const r = this.response;
        return typeof r === 'string' ? r : super.responseText;
      }
    };
    W.XMLHttpRequest = Nuova;
  }

  const testoJson = (fn) => (testo) => {
    let o;
    try { o = N.parse(testo); } catch (_) { return null; }
    return fn(o) ? N.stringify(o) : null;
  };

  // ─── catene di proprietà (set, aopr, aopw) ───────────────────────────────
  // Ogni anello della catena diventa una proprietà che si accorge quando l'oggetto sotto cambia, e lo riaggancia:
  // `var ytInitialPlayerResponse = {…}` scritto dalla pagina passa da qui. Gli agganci di due regole si incatenano.
  function aggancia(radice, catena, finale) {
    const parti = String(catena || '').split('.');
    const passo = (owner, i) => {
      if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) return;
      const prop = parti[i];
      if (i === parti.length - 1) { finale(owner, prop); return; }
      const prima = N.desc(owner, prop);
      if (prima && prima.configurable === false) { passo(owner[prop], i + 1); return; }
      let v = prima ? (prima.get ? undefined : prima.value) : undefined;
      const leggi = function () { return prima && prima.get ? N.apply(prima.get, this, []) : v; };
      try {
        N.def(owner, prop, {
          configurable: true, enumerable: prima ? prima.enumerable : true,
          get: leggi,
          set(nuovo) {
            if (prima && prima.set) N.apply(prima.set, this, [nuovo]); else v = nuovo;
            passo(N.apply(leggi, this, []), i + 1);
          },
        });
      } catch (_) { return; }
      passo(owner[prop], i + 1);
    };
    passo(radice, 0);
  }

  function valoreSet(s, fidato) {
    const t = String(s == null ? '' : s);
    const noti = {
      undefined: undefined, null: null, true: true, false: false, '': '', "''": '', '""': '',
      noopFunc: function () {}, trueFunc: () => true, falseFunc: () => false, emptyArr: [], emptyObj: {},
      emptyStr: '', yes: 'yes', no: 'no', on: 'on', off: 'off',
    };
    if (N.apply(N.own, noti, [t])) {
      const v = noti[t];
      return Array.isArray(v) ? { v: [] } : (oggetto(v) ? { v: {} } : { v });
    }
    if (/^-?\d+(\.\d+)?$/.test(t)) return { v: Number(t) };
    if (fidato) { try { return { v: N.parse(t) }; } catch (_) { return { v: t }; } }
    return null;
  }

  function imposta(catena, s, fidato) {
    const val = valoreSet(s, fidato);
    if (!val) return;
    aggancia(W, catena, (owner, prop) => {
      try {
        N.def(owner, prop, { configurable: true, enumerable: true, get: () => val.v, set: () => {} });
      } catch (_) {}
    });
  }

  function interrompi(catena, lettura) {
    const errore = () => { throw new W.ReferenceError(Math.random().toString(36).slice(2)); };
    aggancia(W, catena, (owner, prop) => {
      const prima = N.desc(owner, prop);
      let v = prima ? prima.value : undefined;
      try {
        N.def(owner, prop, lettura
          ? { configurable: true, get: errore, set(n) { v = n; } }
          : { configurable: true, get: () => v, set: errore });
      } catch (_) {}
    });
  }

  // ─── testo dei nodi (rpnt, rmnt) ─────────────────────────────────────────
  // Il parser consegna i cambi all'osservatore prima di eseguire lo script: il testo si riscrive prima che giri.
  function suiNodi(nomeNodo, cambia, opz) {
    const doc = W.document;
    if (!doc || typeof W.MutationObserver !== 'function') return;
    const reNodo = schema(nomeNodo, 'i', true);
    const cond = opz.condition ? schema(opz.condition, 'ms') : null;
    const escludi = opz.excludes ? schema(opz.excludes, 'ms') : null;
    const includi = opz.includes ? schema(opz.includes, 'ms') : null;
    let resta = Number(opz.sedCount) > 0 ? Number(opz.sedCount) : Infinity;
    let oss = null;
    const tratta = (testo) => {
      const padre = testo.parentNode;
      if (!padre || !prova(reNodo, padre.nodeName)) return;
      const prima = testo.nodeValue || '';
      if (cond && !prova(cond, prima)) return;
      if (escludi && prova(escludi, prima)) return;
      if (includi && !prova(includi, prima)) return;
      const dopo = cambia(prima);
      if (dopo == null || dopo === prima) return;
      testo.nodeValue = dopo;
      if (--resta <= 0 && oss) oss.disconnect();
    };
    oss = new W.MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'characterData') { if (r.target.nodeType === 3) tratta(r.target); continue; }
        for (const n of r.addedNodes) {
          if (n.nodeType === 3) tratta(n);
          else if (n.nodeType === 1 && prova(reNodo, n.nodeName)) for (const c of n.childNodes) if (c.nodeType === 3) tratta(c);
        }
      }
    });
    oss.observe(doc, { childList: true, subtree: true, characterData: true });
  }

  // ─── timer (nano-stb, nostif) ────────────────────────────────────────────
  function sulTimer(nome, decidi) {
    avvolgi(W, nome, (t, questo, args) => {
      const a = Array.from(args);
      let testo = '';
      try { testo = typeof a[0] === 'function' ? Function.prototype.toString.call(a[0]) : String(a[0]); } catch (_) { testo = ''; }
      return N.apply(t, questo, decidi(a, testo) || a);
    });
  }

  const ritardoCorrisponde = (filtro, ms) => {
    const f = String(filtro == null ? '' : filtro).trim();
    if (f === '' || f === '*') return true;
    const neg = f[0] === '!';
    const n = Number(neg ? f.slice(1) : f);
    return Number.isFinite(n) ? ((Number(ms) || 0) === n) !== neg : true;
  };

  // ─── gli scriptlet ───────────────────────────────────────────────────────
  const S = {
    set: (catena, valore) => imposta(catena, valore, false),
    'trusted-set': (catena, valore) => imposta(catena, valore, true),
    'json-prune': (pota, serve) => {
      const f = potatore(pota, serve);
      avvolgi(W.JSON, 'parse', (t, questo, args) => { const o = N.apply(t, questo, args); try { f(o); } catch (_) {} return o; });
      if (W.Response && W.Response.prototype) {
        avvolgi(W.Response.prototype, 'json', (t, questo, args) => N.apply(t, questo, args).then((o) => { try { f(o); } catch (_) {} return o; }));
      }
    },
    'json-prune-fetch-response': (pota, serve, ...extra) => {
      sulleRisposteFetch(coppie(extra).propsToMatch, testoJson(potatore(pota, serve)));
    },
    'json-prune-xhr-response': (pota, serve, ...extra) => {
      sulleRisposteXhr(coppie(extra).propsToMatch, testoJson(potatore(pota, serve)));
    },
    'json-edit-fetch-response': (q, ...extra) => {
      const c = compila(q);
      sulleRisposteFetch(coppie(extra).propsToMatch, testoJson((o) => modifica(c, o)));
    },
    'json-edit-xhr-response': (q, ...extra) => {
      const c = compila(q);
      sulleRisposteXhr(coppie(extra).propsToMatch, testoJson((o) => modifica(c, o)));
    },
    'trusted-replace-xhr-response': (cerca, con, props) => {
      const re = schema(cerca, 'gms');
      sulleRisposteXhr(props, (testo) => { if (!re) return null; re.lastIndex = 0; return testo.replace(re, con || ''); });
    },
    'trusted-rpfr': (cerca, con, props) => {
      const re = schema(cerca, 'gms');
      sulleRisposteFetch(props, (testo) => { if (!re) return null; re.lastIndex = 0; return testo.replace(re, con || ''); });
    },
    'trusted-edit-inbound-object': (catena, posizione, q) => {
      const c = compila(q);
      const pos = Number(posizione) || 0;
      const f = percorsoFunzione(W, catena);
      if (!f) return;
      avvolgi(f.padre, f.nome, (t, questo, args) => {
        const a = Array.from(args);
        try { if (oggetto(a[pos])) a[pos] = modificaCopia(c, a[pos]); } catch (_) {}
        return N.apply(t, questo, a);
      });
    },
    rpnt: (nodo, cerca, con, ...extra) => {
      const re = schema(cerca, 'gms');
      if (!re) return;
      suiNodi(nodo, (t) => { re.lastIndex = 0; return re.test(t) ? (re.lastIndex = 0, t.replace(re, con || '')) : null; }, coppie(extra));
    },
    rmnt: (nodo, cerca, ...extra) => {
      const re = schema(cerca, 'ms');
      suiNodi(nodo, (t) => (prova(re, t) ? '' : null), coppie(extra));
    },
    'nano-stb': (ago, ritardo, fattore) => {
      const re = schema(ago || '');
      const ms = ritardo === undefined || ritardo === '' ? '1000' : ritardo;
      let k = Number(fattore);
      if (!Number.isFinite(k) || k <= 0) k = 0.05;
      k = Math.min(50, Math.max(0.001, k));
      sulTimer('setTimeout', (a, testo) => {
        if (!prova(re, testo) || !ritardoCorrisponde(ms, a[1])) return null;
        a[1] = (Number(a[1]) || 0) * k;
        return a;
      });
    },
    nostif: (ago, ritardo) => {
      const re = schema(ago || '');
      sulTimer('setTimeout', (a, testo) => {
        if (!prova(re, testo) || !ritardoCorrisponde(ritardo, a[1])) return null;
        a[0] = function () {};
        return a;
      });
    },
    aopr: (catena) => interrompi(catena, true),
    aopw: (catena) => interrompi(catena, false),
    // Un riquadro appena aggiunto non dà alla pagina la sua copia pulita di fetch o Request.
    'trusted-prevent-dom-bypass': (metodo, prop) => {
      const f = percorsoFunzione(W, metodo);
      if (!f || !prop) return;
      avvolgi(f.padre, f.nome, (t, questo, args) => {
        const r = N.apply(t, questo, args);
        try {
          const n = args[0];
          const riquadri = n && n.nodeType === 1
            ? (n.nodeName === 'IFRAME' ? [n] : Array.from(n.querySelectorAll ? n.querySelectorAll('iframe') : []))
            : [];
          for (const fr of riquadri) {
            // Mondo della pagina, come riquadri-vuoti.js: un tocco da qui il preload del riquadro non lo toglie.
            const w = fr['contentWindow'];
            if (w) N.def(w, prop, { value: W[prop], configurable: true, writable: true });
          }
        } catch (_) {}
        return r;
      });
    },
  };

  if (esponi) return { schema, richiestaCorrisponde, potatore, compila, modifica, modificaCopia, valoreSet, S };
  let fatte = 0;
  for (const r of Array.isArray(regole) ? regole : []) {
    const fn = Array.isArray(r) ? S[r[0]] : null;
    if (!fn) continue;
    try { fn(...r.slice(1).map(String)); fatte++; } catch (_) {}
  }
  return fatte;
}

/** Il testo da eseguire nel mondo della pagina; vuoto se non c'è niente da fare. */
function sorgente(regole) {
  if (!Array.isArray(regole) || !regole.length) return '';
  return `(${motore.toString()})(${JSON.stringify(regole)}, window, false);`;
}

module.exports = { motore, sorgente };
