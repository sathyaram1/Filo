// Il riquadro «Dai un nome sensato» (#950) delle pagine di Filo: propone il nome letto dal contenuto, lo lascia
// modificare, rinomina con un clic e offre «Annulla». Non tocca il disco: lo fa il main (handlers/file.js).
// Lo usano gli scaricamenti e la chat; stile in src/styles/theme.css (.sn-rinomina).

(function (global) {
  'use strict';

  const doc = global.document;
  const MSG = () => (global.SN_MSG && global.SN_MSG.MSG) || {};
  const send = (msg) => global.chrome.runtime.sendMessage(msg);

  // L'etichetta della voce: la stessa in ogni pagina che la offre (la sentinella del manifesto la legge qui).
  const VOCE_MENU = { label: 'Dai un nome sensato' };

  let aperto = null;     // { el, chiudi }
  let menuAperto = null; // { el, chiudi }

  // Il nome di prima resta a un tasto destro di distanza anche dopo che il riquadro con «Annulla» si è chiuso:
  // percorso attuale → nome con cui il file era prima della prima rinomina fatta da questa pagina.
  const rimettibili = new Map();
  function ricorda(r) {
    if (!r || !r.a || !r.prima || r.invariato) return;
    const prima = (rimettibili.get(r.da) || {}).prima || r.prima;
    rimettibili.delete(r.da);
    const nomeAttuale = String(r.a).split(/[\\/]/).pop();
    if (nomeAttuale !== prima) rimettibili.set(r.a, { prima });
  }
  function nomeDiPrima(percorso) {
    const x = rimettibili.get(String(percorso || ''));
    return x ? x.prima : '';
  }

  // La voce del menu compare solo se c'è un modello per farla funzionare; la risposta vale qualche secondo.
  let stato = { at: 0, valore: false, attesa: null };
  function disponibile() {
    if (Date.now() - stato.at < 5000) return Promise.resolve(stato.valore);
    if (stato.attesa) return stato.attesa;
    stato.attesa = send({ type: MSG().FILE_NOME_STATO })
      .then((r) => !!(r && r.disponibile))
      .catch(() => false)
      .then((v) => { stato = { at: Date.now(), valore: v, attesa: null }; return v; });
    return stato.attesa;
  }
  function tipoSupportato(nome) {
    const N = global.SN_NOMI_FILE;
    return !!(N && N.tipoDi(nome));
  }

  // ── menu del tasto destro (stesso aspetto di quello degli scaricamenti) ──
  function chiudiMenu() {
    if (!menuAperto) return;
    const m = menuAperto;
    menuAperto = null;
    m.chiudi();
  }
  function menu(x, y, voci, { ancora = null } = {}) {
    chiudiMenu();
    const el = doc.createElement('div');
    el.className = 'sn-select-pop sn-rinomina-menu';
    el.setAttribute('role', 'menu');
    const esegui = (fn) => { chiudiMenu(); fn(); };
    for (const [label, fn] of voci) {
      const opt = doc.createElement('div');
      opt.className = 'sn-select-option';
      opt.setAttribute('role', 'menuitem');
      opt.tabIndex = 0;
      opt.textContent = label;
      opt.addEventListener('mouseenter', () => opt.classList.add('sn-hover'));
      opt.addEventListener('mouseleave', () => opt.classList.remove('sn-hover'));
      opt.addEventListener('click', () => esegui(fn));
      opt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); esegui(fn); }
      });
      el.appendChild(opt);
    }
    doc.body.appendChild(el);
    const vw = global.innerWidth;
    const vh = global.innerHeight;
    el.style.left = `${Math.max(4, Math.min(x, vw - el.offsetWidth - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, vh - el.offsetHeight - 4))}px`;
    const fuori = (e) => { if (!el.contains(e.target)) chiudiMenu(); };
    const tasto = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      chiudiMenu();
      if (ancora) try { ancora.focus(); } catch (_) {}
    };
    menuAperto = {
      el,
      chiudi: () => {
        el.remove();
        doc.removeEventListener('mousedown', fuori, true);
        doc.removeEventListener('keydown', tasto, true);
        global.removeEventListener('blur', chiudiMenu);
        global.removeEventListener('resize', chiudiMenu);
        doc.removeEventListener('scroll', chiudiMenu, true);
      },
    };
    setTimeout(() => {
      if (!menuAperto || menuAperto.el !== el) return;
      doc.addEventListener('mousedown', fuori, true);
      doc.addEventListener('keydown', tasto, true);
      global.addEventListener('blur', chiudiMenu);
      global.addEventListener('resize', chiudiMenu);
      doc.addEventListener('scroll', chiudiMenu, true);
    }, 0);
    const primo = el.querySelector('.sn-select-option');
    if (primo) try { primo.focus({ preventScroll: true }); } catch (_) {}
    return el;
  }

  // ── il riquadro ──
  function chiudi() {
    if (!aperto) return;
    const a = aperto;
    aperto = null;
    a.chiudi();
  }

  function posiziona(el, ancora) {
    const r = ancora.getBoundingClientRect();
    const vw = global.innerWidth;
    const vh = global.innerHeight;
    const larghezza = Math.min(440, vw - 16);
    el.style.width = `${larghezza}px`;
    el.style.left = `${Math.max(8, Math.min(r.left, vw - larghezza - 8))}px`;
    // Il lato si sceglie una volta: il riquadro cresce (testo d'errore, conferma) dal lato che resta fermo.
    if (vh - r.bottom >= 170 || r.top < 170) {
      el.style.top = `${Math.min(Math.max(8, r.bottom + 6), vh - 60)}px`;
      el.style.bottom = 'auto';
    } else {
      el.style.bottom = `${Math.max(8, vh - r.top + 6)}px`;
      el.style.top = 'auto';
    }
  }

  function apri({ ancora, percorso = '', downloadId = '', nome = '', suRinominato, suRimesso } = {}) {
    chiudi();
    chiudiMenu();
    const N = global.SN_NOMI_FILE;
    const { base: baseAttuale, ext } = N ? N.scomponi(nome) : { base: nome, ext: '' };
    const el = doc.createElement('div');
    el.className = 'sn-rinomina';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Dai un nome sensato');

    const riga = doc.createElement('div');
    riga.className = 'sn-rinomina-riga';
    const campo = doc.createElement('input');
    campo.type = 'text';
    campo.className = 'sn-rinomina-campo';
    campo.spellcheck = false;
    campo.value = baseAttuale;
    campo.setAttribute('aria-label', 'Nome nuovo');
    const coda = doc.createElement('span');
    coda.className = 'sn-rinomina-ext';
    coda.textContent = ext;
    coda.title = 'L’estensione resta questa';
    coda.hidden = !ext;
    const ok = doc.createElement('button');
    ok.type = 'button';
    ok.className = 'sn-rinomina-ok';
    ok.textContent = 'Rinomina';
    riga.append(campo, coda, ok);

    const statoEl = doc.createElement('div');
    statoEl.className = 'sn-rinomina-stato';
    statoEl.setAttribute('aria-live', 'polite');
    const rotella = doc.createElement('span');
    rotella.className = 'sn-rinomina-rotella';
    const statoTesto = doc.createElement('span');
    statoEl.append(rotella, statoTesto);

    el.append(riga, statoEl);
    doc.body.appendChild(el);
    posiziona(el, ancora);

    let toccato = false;
    let lavora = false;
    let fatto = null;
    let attivo = true;
    let timerChiusura = null;
    // Un Invio dato mentre Filo legge ancora vale per il nome che sta arrivando, non per quello vecchio.
    let caricando = true;
    let confermaInAttesa = false;

    const mostraStato = (testo, { carica = false, errore = false } = {}) => {
      statoEl.hidden = !testo;
      rotella.hidden = !carica;
      statoEl.classList.toggle('sn-rinomina-errore', !!errore);
      statoTesto.textContent = testo || '';
    };

    const fuori = (e) => { if (!el.contains(e.target) && !(ancora && ancora.contains(e.target))) chiudi(); };
    const tasti = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chiudi(); }
    };
    aperto = {
      el,
      chiudi: () => {
        attivo = false;
        clearTimeout(timerChiusura);
        el.remove();
        doc.removeEventListener('mousedown', fuori, true);
        doc.removeEventListener('keydown', tasti, true);
        global.removeEventListener('resize', chiudi);
        if (ancora && doc.contains(ancora)) try { ancora.focus({ preventScroll: true }); } catch (_) {}
      },
    };
    setTimeout(() => {
      if (!attivo) return;
      doc.addEventListener('mousedown', fuori, true);
      doc.addEventListener('keydown', tasti, true);
      global.addEventListener('resize', chiudi);
    }, 0);

    campo.addEventListener('input', () => {
      toccato = true;
      if (confermaInAttesa) {
        confermaInAttesa = false;
        ok.disabled = false;
        mostraStato('Leggo il file…', { carica: true });
      }
    });
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); conferma(); }
    });
    ok.addEventListener('click', () => conferma());
    try { campo.focus({ preventScroll: true }); campo.select(); } catch (_) {}

    const bersaglio = downloadId ? { downloadId } : { percorso };

    mostraStato('Leggo il file…', { carica: true });
    const senzaProposta = (frase) => {
      caricando = false;
      if (!attivo || fatto) return;
      if (confermaInAttesa) { confermaInAttesa = false; ok.disabled = false; }
      mostraStato(frase || 'Non sono riuscito a leggere il file: scrivi tu il nome', { errore: true });
      try { campo.focus({ preventScroll: true }); } catch (_) {}
    };
    send({ type: MSG().FILE_NOME_PROPONI, ...bersaglio }).then((r) => {
      if (!(r && r.ok && r.proposta)) { senzaProposta(r && r.frase); return; }
      caricando = false;
      if (!attivo || fatto) return;
      mostraStato('');
      if (!toccato) {
        campo.value = r.proposta;
        try { campo.focus({ preventScroll: true }); campo.select(); } catch (_) {}
      }
      if (confermaInAttesa) {
        confermaInAttesa = false;
        ok.disabled = false;
        conferma();
      }
    }).catch(() => senzaProposta(''));

    async function conferma() {
      if (lavora || fatto || confermaInAttesa) return;
      if (caricando && !toccato) {
        confermaInAttesa = true;
        ok.disabled = true;
        mostraStato('Rinomino appena ho il nome…', { carica: true });
        return;
      }
      const voluto = campo.value;
      if (!voluto.trim()) { mostraStato('Scrivi un nome', { errore: true }); campo.focus(); return; }
      lavora = true;
      ok.disabled = true;
      campo.disabled = true;
      let r = null;
      try { r = await send({ type: MSG().FILE_RINOMINA, ...bersaglio, nome: voluto }); } catch (_) { r = null; }
      lavora = false;
      if (!attivo) return;
      if (!r || !r.ok) {
        ok.disabled = false;
        campo.disabled = false;
        mostraStato((r && r.frase) || 'Rinomina non riuscita', { errore: true });
        return;
      }
      fatto = r;
      ricorda(r);
      if (typeof suRinominato === 'function') try { suRinominato(r); } catch (_) {}
      mostraFatto(r);
    }

    function mostraFatto(r) {
      riga.hidden = true;
      const esito = doc.createElement('div');
      esito.className = 'sn-rinomina-esito';
      const testo = doc.createElement('span');
      testo.className = 'sn-rinomina-esito-testo';
      testo.textContent = r.invariato ? 'Il nome era già questo' : `Rinominato: ${r.nome}`;
      testo.title = r.nome;
      esito.appendChild(testo);
      if (r.cambiato) mostraStato('Quel nome era già preso nella cartella: ho aggiunto un numero');
      else mostraStato('');
      if (!r.invariato) {
        const annulla = doc.createElement('button');
        annulla.type = 'button';
        annulla.className = 'sn-rinomina-annulla';
        annulla.textContent = 'Annulla';
        annulla.title = `Rimetti «${r.prima}»`;
        annulla.addEventListener('click', async () => {
          annulla.disabled = true;
          clearTimeout(timerChiusura);
          let x = null;
          try { x = await send({ type: MSG().FILE_RIMETTI_NOMI, coppie: [{ attuale: r.a, prima: r.prima }] }); } catch (_) { x = null; }
          const e0 = x && Array.isArray(x.esiti) ? x.esiti[0] : null;
          if (!attivo) return;
          if (e0 && e0.ok) {
            rimettibili.delete(r.a);
            testo.textContent = e0.cambiato ? `Il nome di prima era preso: ora è ${e0.nome}` : `Nome di prima rimesso: ${e0.nome}`;
            annulla.remove();
            if (typeof suRimesso === 'function') try { suRimesso(e0); } catch (_) {}
            timerChiusura = setTimeout(chiudi, 4000);
          } else {
            annulla.disabled = false;
            mostraStato((e0 && e0.frase) || 'Non sono riuscito a rimettere il nome di prima', { errore: true });
          }
        });
        esito.appendChild(annulla);
        try { annulla.focus({ preventScroll: true }); } catch (_) {}
      }
      el.insertBefore(esito, statoEl);
      // Resta finché il puntatore ci sta sopra: l'Annulla non scappa a chi lo sta per premere.
      const programma = () => { clearTimeout(timerChiusura); timerChiusura = setTimeout(chiudi, 8000); };
      el.addEventListener('mouseenter', () => clearTimeout(timerChiusura));
      el.addEventListener('mouseleave', programma);
      programma();
    }
    return el;
  }

  // Un riquadro con una riga sola d'esito, ancorato come quello della rinomina.
  function esito(ancora, testo, { errore = false } = {}) {
    chiudi();
    const el = doc.createElement('div');
    el.className = 'sn-rinomina';
    el.setAttribute('role', 'status');
    const riga = doc.createElement('div');
    riga.className = errore ? 'sn-rinomina-stato sn-rinomina-errore' : 'sn-rinomina-esito';
    const t = doc.createElement('span');
    t.className = 'sn-rinomina-esito-testo';
    t.textContent = testo;
    t.title = testo;
    riga.appendChild(t);
    el.appendChild(riga);
    doc.body.appendChild(el);
    posiziona(el, ancora);
    const fuori = (e) => { if (!el.contains(e.target)) chiudi(); };
    const tasti = (e) => { if (e.key === 'Escape') { e.preventDefault(); chiudi(); } };
    const timer = setTimeout(chiudi, 5000);
    aperto = {
      el,
      chiudi: () => {
        clearTimeout(timer);
        el.remove();
        doc.removeEventListener('mousedown', fuori, true);
        doc.removeEventListener('keydown', tasti, true);
      },
    };
    setTimeout(() => {
      if (!aperto || aperto.el !== el) return;
      doc.addEventListener('mousedown', fuori, true);
      doc.addEventListener('keydown', tasti, true);
    }, 0);
    return el;
  }

  // La voce «Rimetti il nome di prima» dei menu: c'è solo per un file rinominato da questa pagina.
  const VOCE_RIMETTI = 'Rimetti il nome di prima';
  async function rimetti({ ancora, percorso, suRimesso } = {}) {
    const prima = nomeDiPrima(percorso);
    if (!prima) return null;
    let x = null;
    try { x = await send({ type: MSG().FILE_RIMETTI_NOMI, coppie: [{ attuale: percorso, prima }] }); } catch (_) { x = null; }
    const e0 = x && Array.isArray(x.esiti) ? x.esiti[0] : null;
    if (e0 && e0.ok) {
      rimettibili.delete(String(percorso));
      // Prima l'esito, poi chi aggiorna: un elenco che si ridisegna toglie l'ancora a cui il riquadro si appoggia.
      if (ancora) esito(ancora, e0.cambiato ? `Il nome di prima era preso: ora è ${e0.nome}` : `Nome di prima rimesso: ${e0.nome}`);
      if (typeof suRimesso === 'function') try { suRimesso(e0); } catch (_) {}
      return e0;
    }
    if (ancora) esito(ancora, (e0 && e0.frase) || 'Non sono riuscito a rimettere il nome di prima', { errore: true });
    return null;
  }

  global.SN_RINOMINA_UI = {
    apri, chiudi, menu, chiudiMenu, disponibile, tipoSupportato, nomeDiPrima, rimetti,
    VOCE: VOCE_MENU.label, VOCE_RIMETTI,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
