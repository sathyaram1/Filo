// Il filo dell'attesa (#578): il filo che corre a sinistra del blocco di attività, i suoi nodi e il gomitolo.
// Disegna e intitola, non decide: cosa succede lo dice il blocco (dashboard-attivita.js). Niente DOM al caricamento.
// Regole e racconto: patterns/il-filo-dell-attesa.md; titoli provati in tests/unit/filoAttesa.test.mjs.
(function (global) {
  'use strict';

  // ===== Titoli dei nodi =====
  // Calcolati, mai generati: [una azione, più azioni dello stesso tipo, nome breve quando i tipi sono diversi].
  const NUMERI = ['zero', 'una', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci'];
  const n = (k) => (k < NUMERI.length ? NUMERI[k] : String(k));
  const TITOLI = {
    CERCA_WEB: ['Cercato sul web', (k) => `Fatte ${n(k)} ricerche sul web`, 'ricerca'],
    CERCA_CHAT: ['Cercato fra le chat di prima', (k) => `Fatte ${n(k)} ricerche fra le chat`, 'chat di prima'],
    LEGGI_FILE: ['Letto un file', (k) => `Letti ${n(k)} file`, 'file'],
    LEGGI_DOCUMENTO: ['Letto un documento', (k) => `Letti ${n(k)} documenti`, 'documento'],
    LEGGI_TRASPARENZA: ['Riletta la trasparenza', (k) => `Rilette ${n(k)} pagine di trasparenza`, 'trasparenza'],
    LEGGI_IMPOSTAZIONI: ['Lette le impostazioni', (k) => `Lette le impostazioni ${n(k)} volte`, 'impostazioni'],
    CAPACITA_DETTAGLIO: ['Verificato cosa so fare', (k) => `Verificato cosa so fare ${n(k)} volte`, 'capacità'],
    NAVIGA: ['Aperta una pagina', (k) => `Aperte ${n(k)} pagine`, 'pagina'],
    APRI_FILE: ['Aperto un file', (k) => `Aperti ${n(k)} file`, 'file'],
    RINOMINA_FILE: ['Dato un nome ai file', (k) => `Dato un nome ai file ${n(k)} volte`, 'nomi dei file'],
    TIMER: ['Avviato un timer', (k) => `Avviati ${n(k)} timer`, 'timer'],
    SVEGLIA: ['Messa una sveglia', (k) => `Messe ${n(k)} sveglie`, 'sveglia'],
    CANCELLA_SVEGLIA: ['Tolta una sveglia', (k) => `Tolte ${n(k)} sveglie`, 'sveglia'],
    MODIFICA_SVEGLIA: ['Spostata una sveglia', (k) => `Spostate ${n(k)} sveglie`, 'sveglia'],
    EVENTO_CALENDARIO: ['Creato un evento', (k) => `Creati ${n(k)} eventi`, 'evento'],
    SALVA_APPUNTO: ['Scritto un appunto', (k) => `Scritti ${n(k)} appunti`, 'appunto'],
    SALVA_LEZIONE: ['Memorizzata una cosa', (k) => `Memorizzate ${n(k)} cose`, 'memoria'],
    DIMENTICA: ['Dimenticata una cosa', (k) => `Dimenticate ${n(k)} cose`, 'memoria'],
    CANCELLA_MEMORIA: ['Cancellata la memoria', (k) => `Cancellata la memoria ${n(k)} volte`, 'memoria'],
    CANCELLA_PAGINE: ['Cancellate pagine visitate', (k) => `Cancellate pagine visitate ${n(k)} volte`, 'pagine visitate'],
    IMPOSTA_PREFERENZA: ['Cambiata un\'impostazione', (k) => `Cambiate ${n(k)} impostazioni`, 'impostazione'],
    IMPOSTA_ESTETICA: ['Cambiato l\'aspetto', (k) => `Cambiati ${n(k)} dettagli dell'aspetto`, 'aspetto'],
    ANNULLA_CAMBIO: ['Rimesso com\'era', (k) => `Rimessi com'erano ${n(k)} cambi`, 'annullo'],
    TOGLI_PERMESSO_SITO: ['Tolto un permesso', (k) => `Tolti ${n(k)} permessi`, 'permesso'],
    ESEGUI_COMANDO: ['Eseguito un comando', (k) => `Eseguiti ${n(k)} comandi`, 'comando'],
    PULISCI_TAB: ['Riordinate le schede', (k) => `Riordinate le schede ${n(k)} volte`, 'schede'],
    CANCELLA_ARCHIVIO: ['Eliminate schede dall\'archivio', (k) => `Eliminate schede dall'archivio ${n(k)} volte`, 'archivio'],
    INVIA_FEEDBACK: ['Preparata una segnalazione', (k) => `Preparate ${n(k)} segnalazioni`, 'segnalazione'],
    ONBOARDING: ['Proseguita l\'accoglienza', (k) => `Proseguita l'accoglienza ${n(k)} volte`, 'accoglienza'],
    PROXY_TAB: ['Aperta la scheda da un altro paese', (k) => `Aperte ${n(k)} schede da un altro paese`, 'paese'],
    RIMUOVI_PROXY: ['Riportata la scheda in Italia', (k) => `Riportate ${n(k)} schede in Italia`, 'paese'],
    RIMUOVI_PROXY_TUTTE: ['Riportate le schede in Italia', (k) => `Riportate le schede in Italia ${n(k)} volte`, 'paese'],
    REGOLA_PROXY_DOMINIO: ['Salvata una regola sul paese', (k) => `Salvate ${n(k)} regole sul paese`, 'regola'],
    RIMUOVI_REGOLA_PROXY: ['Tolta una regola sul paese', (k) => `Tolte ${n(k)} regole sul paese`, 'regola'],
    COMANDO_FINESTRA: ['Azionata la finestra', (k) => `Azionata la finestra ${n(k)} volte`, 'finestra'],
    CARTA_HOME: ['Sistemata una carta della home', (k) => `Sistemate ${n(k)} carte della home`, 'carta'],
    SPOSTA_ICONA: ['Spostata un\'icona', (k) => `Spostate ${n(k)} icone`, 'icona'],
    STILE_PAGINA: ['Cambiato l\'aspetto della pagina', (k) => `Cambiato l'aspetto della pagina ${n(k)} volte`, 'aspetto della pagina'],
    RIPRISTINA_STILE_PAGINA: ['Rimessa la pagina com\'era', (k) => `Rimesse ${n(k)} pagine com'erano`, 'aspetto della pagina'],
    ZOOM_PAGINA: ['Cambiato lo zoom', (k) => `Cambiato lo zoom ${n(k)} volte`, 'zoom'],
    VOLUME: ['Cambiato il volume', (k) => `Cambiato il volume ${n(k)} volte`, 'volume'],
    BLUETOOTH: ['Comandato il Bluetooth', (k) => `Comandato il Bluetooth ${n(k)} volte`, 'Bluetooth'],
    WIFI: ['Comandato il Wi-Fi', (k) => `Comandato il Wi-Fi ${n(k)} volte`, 'Wi-Fi'],
  };
  const MAX_DETTAGLI = 3;

  const pulisci = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  // «Timer avviato · Pasta · 5 min» → «Pasta · 5 min»; «Cerco sul web: orari» → «orari». Senza separatore, niente.
  function dettaglioDi(testo) {
    const t = pulisci(testo);
    const m = t.match(/^[^·:]*?(?:\s·\s|:\s)(.+)$/);
    return m ? m[1].trim() : '';
  }
  const primoPezzo = (d) => pulisci(d).split(' · ')[0];
  function elenco(pezzi) {
    const unici = [];
    for (const p of pezzi) if (p && !unici.includes(p)) unici.push(p);
    const mostrati = unici.slice(0, MAX_DETTAGLI);
    const restano = unici.length - mostrati.length;
    return mostrati.length ? `${mostrati.join(', ')}${restano > 0 ? ` +${restano}` : ''}` : '';
  }

  // `voci`: [{ tipo, testo, esito: 'ok' | 'fallita' | 'chiesta', dettaglio? }]. Una fallita o in attesa di conferma
  // ha già la sua frase (la riga del diario dice cosa non è successo): il titolo non promette il contrario.
  function titoloNodo(voci) {
    const v = (Array.isArray(voci) ? voci : []).filter(Boolean);
    if (!v.length) return '';
    if (v.length === 1) {
      const x = v[0];
      const t = TITOLI[String(x.tipo || '').toUpperCase()];
      if (x.esito !== 'ok' || !t) return pulisci(x.testo) || (t ? t[0] : 'Azione');
      const d = pulisci(x.dettaglio) || dettaglioDi(x.testo);
      return d ? `${t[0]} · ${d}` : t[0];
    }
    const tipo = String(v[0].tipo || '').toUpperCase();
    const t = TITOLI[tipo];
    const stesso = !!t && v.every((x) => String(x.tipo || '').toUpperCase() === tipo && x.esito === 'ok');
    if (stesso) {
      const d = elenco(v.map((x) => primoPezzo(pulisci(x.dettaglio) || dettaglioDi(x.testo))));
      return d ? `${t[1](v.length)} · ${d}` : t[1](v.length);
    }
    const nomi = v.map((x) => {
      const tt = TITOLI[String(x.tipo || '').toUpperCase()];
      return tt ? tt[2] : primoPezzo(pulisci(x.testo).split(/:\s/)[0]).toLowerCase();
    });
    const d = elenco(nomi);
    const testa = v.every((x) => x.esito === 'fallita') ? `${v.length} azioni non riuscite` : `${v.length} azioni`;
    return d ? `${testa} · ${d}` : testa;
  }

  // ===== Il disegno =====
  const X = 13; // il filo corre al centro dello spazio a sinistra del blocco
  const RIGA = 12; // metà della prima riga di una sezione: lì sta il nodo
  const R_NODO = 3.4;
  const ARIA_GOMITOLO = 8; // px fra il bordo del gomitolo e il riassunto, quanti ne ha un gomitolo piccolo
  const SVG = 'http://www.w3.org/2000/svg';
  const facile = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;

  // La spirale si misura per lunghezza d'arco: ogni punto del filo va nel punto giusto dell'avvolgimento, e un
  // filo più lungo fa un gomitolo più grosso. Il raggio si ferma a ~11 px, quanto sta in una riga.
  const SPIRALE = (() => {
    const pts = [];
    let s = 0;
    let prev = null;
    for (let th = 0; th < 34.5; th += 0.04) {
      const r = 0.6 + 0.3 * th;
      const p = [Math.cos(th) * r, Math.sin(th) * r * 0.86];
      if (prev) s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      pts.push({ s, p });
      prev = p;
    }
    return pts;
  })();
  const SPIRALE_MAX = SPIRALE[SPIRALE.length - 1].s;
  function puntoSpirale(s) {
    const q = Math.max(0, Math.min(SPIRALE_MAX, s));
    let lo = 0;
    let hi = SPIRALE.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (SPIRALE[mid].s < q) lo = mid; else hi = mid;
    }
    return SPIRALE[lo].p;
  }
  // Il raggio del gomitolo per un filo lungo `l` pixel: serve ai test e a chi vuole sapere quanto è grosso.
  function raggioGomitolo(l) {
    const p = puntoSpirale(l);
    return Math.hypot(p[0], p[1] / 0.86);
  }

  function ms(v, base) {
    const t = String(v || '').trim();
    const m = t.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
    if (!m) return base;
    const x = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
    return Number.isFinite(x) ? Math.min(10000, Math.max(0, x)) : base;
  }

  let hint = null;
  function mostraHint(el, testo) {
    if (!testo) return;
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'dash-filo-hint';
      hint.setAttribute('role', 'tooltip');
      document.body.appendChild(hint);
    }
    const r = el.getBoundingClientRect();
    hint.textContent = testo;
    hint.style.left = `${r.left + r.width / 2}px`;
    hint.style.top = `${r.top}px`;
    hint.classList.add('dash-filo-hint-vis');
  }
  function nascondiHint() { if (hint) hint.classList.remove('dash-filo-hint-vis'); }

  // `wrap`: il blocco (position: relative), con la riga del gomitolo in cima; `body`: le righe sotto.
  // `apri(seg)`: cosa fa un clic su un nodo.
  function crea({ wrap, body, apri = () => {} }) {
    const piano = document.createElementNS(SVG, 'svg');
    piano.setAttribute('class', 'dash-activity-filo');
    piano.setAttribute('aria-hidden', 'true');
    piano.setAttribute('width', '26');
    const tratto = document.createElementNS(SVG, 'path');
    tratto.setAttribute('class', 'dash-activity-filo-tratto');
    piano.appendChild(tratto);
    wrap.appendChild(piano);

    const calmo = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } })();
    const durata = (nome, base) => {
      try { return ms(getComputedStyle(wrap).getPropertyValue(nome), base); } catch (_) { return base; }
    };

    const nodi = [];
    // fase/ampiezza/velocità dell'onda; `fine`: il punto più basso fermo (l'ultimo nodo), sotto il filo è vivo.
    const onda = { fase: 0, amp: 2.4, ampA: 3.2, vel: 0.06, velA: 0.065, fine: 0, tagliato: false, coda: 8 };
    // m: 0 disteso, 1 gomitolo. `punti`/`lung`: il filo fermato nel momento in cui parte l'avvolgimento.
    const avv = { m: 0, da: 0, a: 0, t0: 0, durata: 850, punti: null, lung: null };
    let vivo = true;
    let corre = false;
    let finito = false;

    function puntiDistesi(fondo, top = 0) {
      const pts = [];
      const passi = Math.max(12, Math.round((fondo - top) / 3));
      for (let i = 0; i <= passi; i++) {
        const y = top + (i / passi) * (fondo - top);
        const giu = Math.max(0, Math.min(1, (y - onda.fine) / 34));
        const x = onda.tagliato
          ? X + giu * 3.4 * Math.min(1, (y - onda.fine) / 60)
          : X + Math.sin(y * 0.16 + onda.fase) * onda.amp * giu;
        pts.push([x, y]);
      }
      return pts;
    }
    // Il cappio: il filo gira su sé stesso attorno al nodo e il giro si stringe.
    function conCappi(pts) {
      const aperti = nodi.filter((nd) => nd.stretta < 1);
      if (!aperti.length) return pts;
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        out.push(pts[i]);
        for (const nd of aperti) {
          if (pts[i][1] <= nd.y && (i + 1 >= pts.length || pts[i + 1][1] > nd.y)) {
            const r = 6.6 * (1 - facile(nd.stretta));
            for (let a = 0; a <= 24; a++) {
              const ang = -Math.PI / 2 + (a / 24) * Math.PI * 2.15;
              out.push([X + Math.cos(ang) * r * 0.95, nd.y + Math.sin(ang) * r]);
            }
          }
        }
      }
      return out;
    }
    function fondoVivo() { return body.hidden ? 24 : body.offsetTop + Math.max(18, body.offsetHeight); }
    function lunghezze(pts) {
      const l = [0];
      for (let i = 1; i < pts.length; i++) l.push(l[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return l;
    }
    function fermaNodiSulFilo(pts, lung) {
      for (const nd of nodi) {
        nd.y = nd.seg.offsetTop + RIGA;
        let k = 0;
        for (let j = 1; j < pts.length; j++) if (Math.abs(pts[j][1] - nd.y) < Math.abs(pts[k][1] - nd.y)) k = j;
        nd.s = lung[k];
        nd.y0 = nd.y;
      }
    }

    function quieto() {
      if (!finito) return false;
      if (avv.m !== avv.a) return false;
      if (Math.abs(onda.amp) > 0.02) return false;
      return nodi.every((nd) => nd.stretta >= 1 || (nd.riaperto && Date.now() - nd.riaperto > 400)) && nodi.every((nd) => !nd.strappo);
    }

    function disegna() {
      if (!vivo || !wrap.isConnected) { corre = false; return; }
      const ora = Date.now();
      onda.amp += (onda.ampA - onda.amp) * (calmo ? 1 : 0.06);
      onda.vel += (onda.velA - onda.vel) * 0.08;
      if (!calmo) onda.fase += onda.vel;

      if (avv.m !== avv.a) {
        const t = avv.durata > 0 && !calmo ? Math.min(1, (ora - avv.t0) / avv.durata) : 1;
        avv.m = lerp(avv.da, avv.a, facile(t));
        if (t >= 1) avv.m = avv.a;
      }

      const fondo = fondoVivo();
      const alto = Math.max(fondo + onda.coda + 6, 30);
      piano.setAttribute('height', String(alto));
      piano.style.height = `${alto}px`;

      let ultimo = 0;
      for (const nd of nodi) {
        if (avv.m === 0) nd.y = nd.seg.offsetTop + RIGA;
        if (nd.riaperto) {
          // Un passo fallito: il cappio si stringe e poi si riapre, e il nodo non si forma mai.
          const p = calmo ? 1 : Math.min(1, (ora - nd.riaperto) / 340);
          nd.stretta = 1 - 0.62 * facile(p);
        } else if (nd.stretta < 1) {
          nd.stretta = calmo || nd.durata <= 0 ? 1 : Math.min(1, (ora - nd.nato) / nd.durata);
          if (nd.stretta >= 1 && nd.dopo) { const f = nd.dopo; nd.dopo = null; f(); }
        }
        let cx = X;
        let cy = nd.y;
        if (avv.m > 0 && avv.lung) {
          const sp = puntoSpirale(nd.s);
          cx = lerp(X, X + sp[0], avv.m);
          cy = lerp(nd.y0, RIGA + sp[1], avv.m);
        }
        // Il puntino compare solo nell'ultimo tratto del cappio.
        let q = Math.max(0, (nd.stretta - 0.55) / 0.45);
        if (nd.riaperto) q = 0;
        let r = R_NODO * Math.min(1, q);
        if (nd.strappo) {
          const p = Math.min(1, (ora - nd.strappo) / 180);
          r *= 1 + Math.sin(Math.PI * p) / 3;
          if (p >= 1) nd.strappo = 0;
        }
        r *= 1 - avv.m * 0.5;
        nd.c.setAttribute('cx', cx.toFixed(2));
        nd.c.setAttribute('cy', cy.toFixed(2));
        nd.c.setAttribute('r', Math.max(0, r).toFixed(2));
        nd.presa.setAttribute('cx', cx.toFixed(2));
        nd.presa.setAttribute('cy', cy.toFixed(2));
        ultimo = Math.max(ultimo, nd.y);
      }
      if (avv.m === 0) onda.fine = ultimo;

      let pts;
      if (avv.m > 0 && avv.punti) {
        pts = avv.punti.map((p0, i) => {
          const sp = puntoSpirale(avv.lung[i]);
          return [lerp(p0[0], X + sp[0], avv.m), lerp(p0[1], RIGA + sp[1], avv.m)];
        });
      } else {
        pts = conCappi(puntiDistesi(fondo + onda.coda));
      }
      let d = '';
      for (let i = 0; i < pts.length; i++) d += `${i ? 'L' : 'M'}${pts[i][0].toFixed(2)},${pts[i][1].toFixed(2)}`;
      tratto.setAttribute('d', d);

      if (quieto()) { corre = false; return; }
      requestAnimationFrame(disegna);
    }
    function sveglia() {
      if (!vivo || corre) return;
      corre = true;
      requestAnimationFrame(disegna);
    }
    let osserva = null;
    try { osserva = new ResizeObserver(() => sveglia()); osserva.observe(body); } catch (_) {}
    sveglia();

    return {
      el: piano,
      sveglia,
      // Mentre il modello ragiona il filo ondeggia pieno; mentre uno strumento lavora si tende, il lavoro è altrove.
      pensa() { onda.ampA = calmo ? 0 : 3.2; onda.velA = 0.065; sveglia(); },
      agisce() { onda.ampA = calmo ? 0 : 0.3; onda.velA = 0.014; sveglia(); },
      // Fermato dall'utente: il filo si taglia e la punta si affloscia di lato.
      taglia() { onda.tagliato = true; onda.ampA = 0; onda.coda = 2; finito = true; sveglia(); },
      // Lavoro chiuso: quello che è già successo sta fermo.
      chiudi() { onda.ampA = 0; onda.velA = 0; onda.coda = 4; finito = true; sveglia(); },
      riapri() { finito = false; onda.tagliato = false; onda.coda = 8; sveglia(); },
      // Un nodo sulla riga `seg`: si annoda come un cappio che si stringe.
      nodo(seg, titolo = '') {
        const presa = document.createElementNS(SVG, 'circle');
        presa.setAttribute('class', 'dash-activity-nodo-presa');
        presa.setAttribute('r', '8');
        const c = document.createElementNS(SVG, 'circle');
        c.setAttribute('class', 'dash-activity-nodo');
        c.setAttribute('r', '0');
        piano.append(c, presa);
        const nd = {
          seg, c, presa, titolo, y: seg.offsetTop + RIGA, y0: 0, s: 0, nato: Date.now(), stretta: 0,
          durata: durata('--dash-filo-nodo', 450), riaperto: 0, strappo: 0, dopo: null,
        };
        presa.addEventListener('mouseenter', () => mostraHint(presa, nd.titolo));
        presa.addEventListener('mouseleave', nascondiHint);
        presa.addEventListener('click', () => { nascondiHint(); apri(seg); });
        nodi.push(nd);
        onda.fine = Math.max(onda.fine, nd.y);
        sveglia();
        const quando = (f) => { if (nd.stretta >= 1 && !nd.riaperto) f(); else if (!nd.riaperto) nd.dopo = f; };
        return {
          titolo(t) { nd.titolo = String(t || ''); },
          // L'esito è arrivato: un ultimo strappo, il raggio cresce di un terzo e torna.
          tiene() { quando(() => { nd.strappo = Date.now(); sveglia(); }); },
          cede() { quando(() => { nd.riaperto = Date.now(); sveglia(); }); },
        };
      },
      // Il filo si avvolge: gli stessi punti, mandati sulla spirale per lunghezza. Srotolare è il contrario.
      avvolgi(verso, { subito = false } = {}) {
        const a = verso ? 1 : 0;
        const dur = subito || calmo ? 0 : durata('--dash-filo-gomitolo', 850);
        if (a === 1) {
          const pts = puntiDistesi(fondoVivo() + onda.coda);
          const lung = lunghezze(pts);
          avv.punti = pts;
          avv.lung = lung;
          fermaNodiSulFilo(pts, lung);
          // Un gomitolo grosso sposta il riassunto quanto serve a lasciargli l'aria di uno piccolo.
          const largo = X + raggioGomitolo(lung[lung.length - 1]) + 1 + ARIA_GOMITOLO;
          wrap.style.setProperty('--dash-gomitolo-spazio', `${Math.max(0, Math.ceil(largo - 26))}px`);
        } else if (avv.m > 0) {
          // Il filo disteso di arrivo è quello delle righe già riaperte (anche se ancora chiuse dalla tendina).
          const fondo = body.offsetTop + Math.max(18, body.scrollHeight) + onda.coda;
          const salva = onda.amp;
          onda.amp = 0;
          const pts = puntiDistesi(fondo);
          onda.amp = salva;
          const lung = lunghezze(pts);
          avv.punti = pts;
          avv.lung = lung;
          fermaNodiSulFilo(pts, lung);
        }
        avv.da = avv.m;
        avv.a = a;
        avv.t0 = Date.now();
        avv.durata = dur;
        if (dur === 0) avv.m = a;
        sveglia();
        return dur;
      },
      get avvolto() { return avv.a === 1; },
      durataGomitolo() { return calmo ? 0 : durata('--dash-filo-gomitolo', 850); },
      distruggi() { vivo = false; try { osserva && osserva.disconnect(); } catch (_) {} nascondiHint(); },
    };
  }

  global.SN_FILO_ATTESA = { titoloNodo, dettaglioDi, TITOLI, crea, raggioGomitolo, puntoSpirale, SPIRALE_MAX, ms };
})(typeof globalThis !== 'undefined' ? globalThis : window);
