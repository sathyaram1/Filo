// Il quaderno delle memorie (#872): cosa Filo ha capito dell'utente, riga per riga, con la data e il salto al punto del
// filo da cui ogni riga è nata. Qui si corregge, si toglie (la riga resta fra le nascoste) e si rimette.
// Regole: patterns/il-quaderno-delle-memorie-e-l-indice-del-filo.md; i dati li tiene src/shared/filoMemory.js.

(function () {
  'use strict';

  const { MSG } = window.SN_MSG;
  const Storage = window.SN_STORAGE;
  const $ = (id) => document.getElementById(id);

  const NOMI = { PROFILO: 'Chi sei', PREFERENZE: 'Cosa preferisci' };
  const nomeGruppo = (nome) => {
    if (NOMI[nome]) return NOMI[nome];
    const t = String(nome || '').replace(/_+/g, ' ').trim().toLowerCase();
    return t ? t[0].toUpperCase() + t.slice(1) : 'Altro';
  };

  function icona(nome, size = 15) {
    const I = window.SN_ICONS;
    return I && typeof I[nome] === 'function' ? I[nome](size) : '';
  }

  const send = (m) => Promise.resolve(chrome.runtime.sendMessage(m)).catch(() => null);

  function quando(iso, { lunga = false } = {}) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    if (lunga) return d.toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const g = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const oggi = g(new Date());
    if (g(d) === oggi) return `oggi, ${ora}`;
    if (g(d) === oggi - 864e5) return `ieri, ${ora}`;
    const stessoAnno = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('it-IT', stessoAnno ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Stato ────────────────────────────────────────────────────────────────

  let dati = null;
  let inModifica = null; // la chiave della riga che l'utente sta correggendo
  let ultimaNascosta = null;

  const chiave = (it) => {
    if (it.tipo === 'nascosta') return `n:${it.id}`;
    if (it.tipo === 'sito') return `s:${it.host}`;
    if (it.via && it.via.lezione) return `l:${it.via.lezione.ts}|${it.via.lezione.text}`;
    return `m:${it.via.modulo}|${it.via.riga}`;
  };

  function gruppi(d) {
    const out = [];
    const posto = (n) => (n === 'PROFILO' ? 0 : n === 'PREFERENZE' ? 1 : 2);
    for (const m of [...(d.moduli || [])].sort((a, b) => posto(a.nome) - posto(b.nome))) {
      if (!m.righe || !m.righe.length) continue;
      out.push({ id: `m:${m.nome}`, titolo: nomeGruppo(m.nome), righe: m.righe.map((r) => ({ ...r, tipo: 'riga' })) });
    }
    if (d.lezioni && d.lezioni.length) out.push({ id: 'lezioni', titolo: 'Imparato da poco', righe: d.lezioni.map((r) => ({ ...r, tipo: 'riga' })) });
    if (d.sempreAperte && d.sempreAperte.length) {
      out.push({ id: 'siti', titolo: 'Siti sempre aperti', righe: d.sempreAperte.map((s) => ({ tipo: 'sito', host: s.host, testo: `Tieni sempre aperto ${s.host}`, nata: s.ts, fonti: [] })) });
    }
    if (d.nascoste && d.nascoste.length) {
      out.push({ id: 'nascoste', titolo: 'Nascoste', nascoste: true, righe: d.nascoste.map((n) => ({ ...n, tipo: 'nascosta' })) });
    }
    return out;
  }

  // ── Disegno: le righe che restano sono lo stesso nodo (fuoco, menu, campo aperto non si chiudono) ─────────

  const nodi = new Map();
  const gruppiEl = new Map();

  function disegna() {
    const box = $('gruppi');
    const gs = gruppi(dati || {});
    $('vuoto').hidden = gs.length > 0;
    const vivi = new Set();
    const gruppiVivi = new Set();
    let prima = null;
    for (const g of gs) {
      gruppiVivi.add(g.id);
      let ge = gruppiEl.get(g.id);
      if (!ge) { ge = creaGruppo(g); gruppiEl.set(g.id, ge); }
      ge.titolo.textContent = g.titolo;
      ge.conto.textContent = String(g.righe.length);
      if (ge.el.previousElementSibling !== prima || ge.el.parentNode !== box) box.insertBefore(ge.el, prima ? prima.nextSibling : box.firstChild);
      prima = ge.el;
      let dopo = null;
      for (const it of g.righe) {
        const k = chiave(it);
        vivi.add(k);
        let r = nodi.get(k);
        if (!r) { r = { el: document.createElement('div') }; nodi.set(k, r); }
        r.it = it;
        if (inModifica !== k) riempiRiga(r);
        if (r.el.parentNode !== ge.lista || r.el.previousElementSibling !== dopo) ge.lista.insertBefore(r.el, dopo ? dopo.nextSibling : ge.lista.firstChild);
        dopo = r.el;
      }
    }
    // Il campo aperto resta anche se il compattatore ha appena riordinato la sua riga: al salvataggio il main ritrova la
    // riga nuova dalle fonti, e quello che l'utente sta scrivendo non si perde.
    const aperta = inModifica ? nodi.get(inModifica) : null;
    for (const [k, r] of nodi) if (!vivi.has(k) && k !== inModifica) { r.el.remove(); nodi.delete(k); }
    for (const [id, ge] of gruppiEl) {
      if (!gruppiVivi.has(id) && !(aperta && ge.lista.contains(aperta.el))) { ge.el.remove(); gruppiEl.delete(id); }
    }
  }

  function creaGruppo(g) {
    const el = document.createElement('section');
    el.className = 'qd-gruppo';
    el.dataset.gruppo = g.id;
    const h = document.createElement('h2');
    const titolo = document.createElement('span');
    const conto = document.createElement('span');
    conto.className = 'qd-conto';
    h.append(titolo, conto);
    const lista = document.createElement('div');
    lista.className = 'qd-lista';
    if (g.nascoste) {
      // Le nascoste non entrano nelle conversazioni: chiuse finché l'utente non le cerca.
      const det = document.createElement('details');
      det.className = 'qd-nascoste';
      const sum = document.createElement('summary');
      sum.append(h);
      h.style.display = 'inline-flex';
      det.append(sum, lista);
      el.append(det);
    } else {
      el.append(h, lista);
    }
    return { el, titolo, conto, lista };
  }

  function tasto(nome, titolo, fn, classe = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `qd-tasto ${classe}`.trim();
    b.title = titolo;
    b.setAttribute('aria-label', titolo);
    b.innerHTML = icona(nome);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  }

  function riempiRiga(r) {
    if (r.smonta) r.smonta();
    const it = r.it;
    const el = r.el;
    el.className = `qd-riga${it.tipo === 'nascosta' ? ' qd-nascosta' : ''}`;
    el.dataset.chiave = chiave(it);
    el.draggable = true;
    el.textContent = '';
    const corpo = document.createElement('div');
    corpo.className = 'qd-corpo';
    const t = document.createElement('span');
    t.className = 'qd-testo';
    t.textContent = it.testo;
    if (it.tipo === 'riga') {
      t.title = 'Doppio clic per correggere';
      t.addEventListener('dblclick', () => correggi(r));
    }
    corpo.append(t);
    const meta = document.createElement('div');
    meta.className = 'qd-meta';
    const fonti = Array.isArray(it.fonti) ? it.fonti : [];
    if (fonti.length) {
      const origine = nascita(fonti);
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'qd-salto';
      a.textContent = quando(origine.ts) || 'nel filo';
      a.title = `Vai alla conversazione da cui è nata (${quando(origine.ts, { lunga: true })})`;
      a.addEventListener('click', () => vai(origine));
      meta.append(a);
      if (fonti.length > 1) {
        const n = document.createElement('span');
        n.textContent = `${fonti.length} punti del filo`;
        n.title = 'Il tasto destro sulla riga li elenca tutti';
        meta.append(n);
      }
    } else if (it.nata && it.tipo !== 'sito') {
      const n = document.createElement('span');
      n.textContent = quando(it.nata);
      n.title = quando(it.nata, { lunga: true });
      meta.append(n);
    }
    if (it.corretta) {
      const c = document.createElement('span');
      c.textContent = 'corretta da te';
      c.title = quando(it.corretta, { lunga: true });
      meta.append(c);
    }
    if (it.tipo === 'nascosta' && it.tolta) {
      const c = document.createElement('span');
      c.textContent = `tolta ${quando(it.tolta)}`;
      meta.append(c);
    }
    meta.hidden = !meta.childNodes.length;
    corpo.append(meta);
    const errore = document.createElement('div');
    errore.className = 'qd-errore';
    errore.hidden = true;
    corpo.append(errore);
    r.errore = errore;
    el.append(corpo);
    const tasti = document.createElement('div');
    tasti.className = 'qd-tasti';
    if (it.tipo === 'riga') {
      tasti.append(tasto('pencil', 'Correggi', () => correggi(r)));
      tasti.append(tasto('close', 'Togli dalla memoria', () => togli(it), 'qd-via'));
    } else if (it.tipo === 'sito') {
      tasti.append(tasto('close', 'Non tenerlo più aperto', () => togli(it), 'qd-via'));
    } else {
      tasti.append(tasto('undo', 'Rimetti in memoria', () => rimetti(it)));
      tasti.append(tasto('trash', 'Cancella per sempre', () => perSempre(it), 'qd-via'));
    }
    el.append(tasti);
  }

  // ── Azioni ───────────────────────────────────────────────────────────────

  function esito(testo, { rimetti: id = null } = {}) {
    const e = $('esito');
    e.textContent = testo;
    if (id) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Rimetti';
      b.addEventListener('click', () => rimetti({ id }));
      e.append(' · ', b);
    }
    e.hidden = false;
    clearTimeout(esito.t);
    esito.t = setTimeout(() => { e.hidden = true; }, id ? 9000 : 4000);
  }

  async function togli(it) {
    // Dal tasto destro su una riga in correzione: quello che c'era nel campo non si salva, si toglie la riga.
    const aperta = inModifica === chiave(it) ? nodi.get(inModifica) : null;
    if (aperta && aperta.chiudi) await aperta.chiudi(false);
    const r = await send(it.tipo === 'sito' ? { type: MSG.FILO_MEMORY_FORGET, sempreAperta: it.host } : { type: MSG.FILO_MEMORY_FORGET, ...it.via });
    tolta(r, it.tipo === 'sito' ? `${it.host} non resta più aperto` : '');
    await carica();
  }

  function tolta(r, testo = '') {
    if (r && r.ok && r.tolta) {
      ultimaNascosta = r.id || null;
      esito(testo || 'Tolta: non entra più nelle conversazioni', { rimetti: r.id || null });
    } else {
      esito('Non c\'era più: ecco com\'è adesso');
    }
  }

  async function rimetti(it) {
    const r = await send({ type: MSG.FILO_MEMORY_RESTORE, id: it.id });
    esito(r && r.ok && r.rimessa ? 'Rimessa in memoria' : 'Non c\'era più: ecco com\'è adesso');
    if (ultimaNascosta === it.id) ultimaNascosta = null;
    await carica();
  }

  async function perSempre(it) {
    const C = window.SN_CONFIRM_UI;
    const ok = C ? await C.confirm({
      title: 'Cancellare per sempre?',
      text: `«${it.testo}» sparisce anche dal quaderno, e Filo non la riscrive dalla stessa conversazione.`,
      okLabel: 'Cancella',
    }) : false;
    if (!ok) return;
    const r = await send({ type: MSG.FILO_MEMORY_FOREVER, id: it.id });
    esito(r && r.ok && r.cancellata ? 'Cancellata per sempre' : 'Non c\'era più: ecco com\'è adesso');
    await carica();
  }

  // Dove una riga è nata: il primo messaggio dell'utente fra le sue fonti, se c'è (la risposta di Filo viene dopo).
  const nascita = (fonti) => fonti.find((f) => f.role === 'user') || fonti[0];
  const nomeFonte = (f) => `${f.role === 'user' ? 'Vai al tuo messaggio' : 'Vai alla risposta di Filo'} · ${quando(f.ts)}`;

  function vai(fonte) {
    if (!fonte || !fonte.id) return;
    try { chrome.tabs.create({ url: `filo://dashboard/dashboard.html?evento=${encodeURIComponent(fonte.id)}` }); } catch (_) {}
  }

  // La correzione si scrive sul posto: Invio, ✓ o uscire dalla riga la salvano (vuota, la toglie); Esc o × lasciano
  // com'era. Un clic dentro la riga non porta via il fuoco dal campo, sennò salverebbe prima di fare quello che chiede.
  function correggi(r) {
    if (r.it.tipo !== 'riga') return;
    if (inModifica === chiave(r.it)) { const c = r.el.querySelector('.qd-campo'); if (c) c.focus(); return; }
    if (inModifica) { const altra = nodi.get(inModifica); if (altra && altra.chiudi) altra.chiudi(true); }
    const k = chiave(r.it);
    inModifica = k;
    const t = r.el.querySelector('.qd-testo');
    const campo = document.createElement('textarea');
    campo.className = 'qd-campo';
    campo.rows = 1;
    campo.value = r.it.testo;
    campo.setAttribute('aria-label', 'Correggi la riga');
    const adatta = () => { campo.style.height = 'auto'; campo.style.height = `${campo.scrollHeight}px`; };
    t.replaceWith(campo);
    r.el.draggable = false;
    const tasti = r.el.querySelector('.qd-tasti');
    tasti.replaceChildren(
      tasto('check', 'Salva la correzione', () => chiudi(true)),
      tasto('close', 'Annulla la correzione', () => chiudi(false)),
    );
    adatta();
    campo.focus();
    campo.setSelectionRange(campo.value.length, campo.value.length);
    let finito = false;
    const tieni = (e) => { if (e.target !== campo) e.preventDefault(); };
    // Il fuoco che va nel menu del tasto destro di Filo non esce dalla riga: le sue voci agiscono sul campo o sulla
    // riga. Dopo, il fuoco non torna da sé, e uscire è il primo clic fuori dalla riga.
    const nostra = (el) => { try { return !!(el && window.SN_FILO_UI && window.SN_FILO_UI.inside(el)); } catch (_) { return false; } };
    const fuori = (e) => {
      const verso = e.relatedTarget;
      if (!finito && !(verso && (r.el.contains(verso) || nostra(verso)))) chiudi(true);
    };
    const clicFuori = (e) => {
      if (finito || r.el.contains(document.activeElement)) return;
      const t = e.composedPath()[0];
      if (!r.el.contains(t) && !nostra(t)) chiudi(true);
    };
    const smonta = () => {
      r.el.removeEventListener('mousedown', tieni);
      r.el.removeEventListener('focusout', fuori);
      document.removeEventListener('mousedown', clicFuori, true);
      r.smonta = null;
    };
    const chiudi = async (salva) => {
      if (finito) return;
      finito = true;
      r.chiudi = null;
      const nuovo = campo.value.replace(/\s+/g, ' ').trim();
      if (salva && nuovo !== r.it.testo) {
        const fonti = (Array.isArray(r.it.fonti) ? r.it.fonti : []).map((f) => f && f.id).filter(Boolean);
        const res = await send({ type: MSG.FILO_MEMORY_EDIT, via: r.it.via, testo: nuovo, fonti });
        if (!res || !res.ok) {
          const errore = res && res.rifiuto && res.error ? String(res.error) : 'Non sono riuscito a salvarla: riprova.';
          if (!campo.isConnected) { smonta(); esito(errore); return; }
          // Resta lei la riga in correzione, anche se intanto si era aperto il campo di un'altra.
          finito = false;
          r.chiudi = chiudi;
          inModifica = k;
          r.errore.textContent = errore;
          r.errore.hidden = false;
          campo.focus();
          return;
        }
        smonta();
        if (inModifica === k) inModifica = null;
        if ('tolta' in res) tolta(res);
        else esito(res.corretta ? 'Corretta: vale dal prossimo messaggio' : 'Non c\'era più: ecco com\'è adesso');
        await carica();
        const dopo = res.testo ? [...nodi.values()].find((x) => x.it && x.it.testo === res.testo) : null;
        if (dopo) { dopo.el.classList.remove('qd-viva'); void dopo.el.offsetWidth; dopo.el.classList.add('qd-viva'); }
        return;
      }
      smonta();
      if (inModifica === k) inModifica = null;
      riempiRiga(r);
      disegna();
    };
    r.chiudi = chiudi;
    r.smonta = smonta;
    r.el.addEventListener('mousedown', tieni);
    r.el.addEventListener('focusout', fuori);
    document.addEventListener('mousedown', clicFuori, true);
    campo.addEventListener('input', () => { adatta(); r.errore.hidden = true; });
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chiudi(true); }
      else if (e.key === 'Escape') { e.preventDefault(); chiudi(false); }
    });
  }

  // ── Tasto destro: le voci della riga nel menu di Filo ────────────────────

  function rigaDi(target) {
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    const box = el && el.closest ? el.closest('.qd-riga') : null;
    return box ? nodi.get(box.dataset.chiave) || null : null;
  }

  function vociMenu(target) {
    const r = rigaDi(target);
    if (!r) return [];
    const it = r.it;
    const voci = [];
    if (it.tipo === 'riga') {
      voci.push({ type: 'item', icon: icona('pencil', 16), label: 'Correggi', onClick: () => correggi(r) });
      voci.push({ type: 'item', icon: icona('close', 16), label: 'Togli dalla memoria', onClick: () => { togli(it).catch(() => {}); } });
    } else if (it.tipo === 'sito') {
      voci.push({ type: 'item', icon: icona('close', 16), label: 'Non tenerlo più aperto', onClick: () => { togli(it).catch(() => {}); } });
    } else {
      voci.push({ type: 'item', icon: icona('undo', 16), label: 'Rimetti in memoria', onClick: () => { rimetti(it).catch(() => {}); } });
      voci.push({ type: 'item', icon: icona('trash', 16), label: 'Cancella per sempre', onClick: () => { perSempre(it).catch(() => {}); } });
    }
    const fonti = Array.isArray(it.fonti) ? it.fonti : [];
    if (fonti.length === 1) voci.push({ type: 'item', icon: icona('filoLogo', 16), label: 'Vai al punto del filo', onClick: () => vai(fonti[0]) });
    // Tante fonti: le prime dove la riga è nata, l'ultima dove è stata ripresa; le altre stanno nel filo fra le due.
    const elenco = fonti.length > 8 ? [...fonti.slice(0, 7), fonti[fonti.length - 1]] : (fonti.length > 1 ? fonti : []);
    for (const f of elenco) voci.push({ type: 'item', icon: icona('filoLogo', 16), label: nomeFonte(f), onClick: () => vai(f) });
    voci.push({ type: 'item', icon: icona('copy', 16), label: 'Copia il testo', onClick: () => { navigator.clipboard.writeText(it.testo).catch(() => {}); } });
    return voci;
  }
  window.SN_VOCI_PAGINA = Array.isArray(window.SN_VOCI_PAGINA) ? window.SN_VOCI_PAGINA : [];
  if (!window.SN_VOCI_PAGINA.includes(vociMenu)) window.SN_VOCI_PAGINA.push(vociMenu);

  // Una riga si trascina in una chat come il suo testo.
  document.addEventListener('dragstart', (e) => {
    const r = rigaDi(e.target);
    if (!r || !e.dataTransfer) return;
    e.dataTransfer.setData('text/plain', r.it.testo);
    e.dataTransfer.effectAllowed = 'copy';
  });

  // ── Caricamento, e aggiornamenti da fuori (chat, compattatore, un'altra scheda) ─────────

  let giro = 0;
  async function carica() {
    const mio = ++giro;
    const r = await send({ type: MSG.FILO_QUADERNO });
    if (mio !== giro || !r || !r.ok) return;
    dati = r;
    disegna();
    document.body.dataset.pronto = '1';
  }

  let attesa = null;
  const presto = () => { clearTimeout(attesa); attesa = setTimeout(() => { carica().catch(() => {}); }, 120); };

  async function avvia() {
    try {
      const settings = await Storage.getSettings();
      window.SN_PAGE_THEME = settings.theme;
      window.SN_PAGE_BOOTSTRAP.applyTheme(settings.theme);
    } catch (_) {}
    await carica();
    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (m && (m.type === MSG.FILO_MEMORY_CHANGED || m.type === MSG.FILO_CHATS_UPDATED)) presto();
      });
    } catch (_) {}
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') presto(); });
  }

  avvia().catch((e) => console.warn('[Filo] quaderno', e));
})();
