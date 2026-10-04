// Ora, batteria, rete, Bluetooth e volume in fondo alla colonna destra della home (#873); dal loro riquadro si comandano (#874).
// Non legge il computer e non lo comanda (lo fa il main, dalla stessa porta della chat) e non sceglie le parole
// (src/shared/sistema.js): disegna, e si aggiorna senza rifare i nodi. Il DOM lo tocca init().
(function (global) {
  'use strict';

  const ORDINE = ['ora', 'batteria', 'rete', 'bluetooth', 'volume'];
  // L'ora la sa la pagina; le altre le legge il main, e solo per loro la home tiene sveglio il lettore.
  const DAL_COMPUTER = ['batteria', 'rete', 'bluetooth', 'volume'];
  const NOMI = { ora: "l'ora", batteria: 'la batteria', rete: 'la rete', bluetooth: 'il Bluetooth', volume: 'il volume' };
  // Il main legge finché qualcuno chiede: una home in vista chiede più spesso di quanto il lettore si addormenti.
  const RICHIAMO_MS = 30 * 1000;
  const ICONA_PX = 16;

  let send = null;
  let MSG = null;
  let host = null;
  let riga = null;
  let ICONS = {};
  let stato = null;
  let visibili = { ora: true, batteria: true, rete: true, bluetooth: true, volume: true };
  const voci = {};
  let box = null;
  let richiamo = null;
  let tickOra = null;
  let impostazioniLette = false;
  let svegliatoPerChat = 0;

  const Sis = () => global.SN_SISTEMA;
  const segue = () => DAL_COMPUTER.some((v) => visibili[v] !== false);
  const descrizione = () => Sis().descrivi(stato, new Date());

  function init(deps) {
    send = deps.send;
    MSG = deps.MSG;
    host = deps.host;
    ICONS = deps.ICONS || {};
    // L'ora sopra, grande; sotto la riga delle icone, che in una colonna stretta va a capo da sola.
    riga = document.createElement('div');
    riga.className = 'dash-sis-icone';
    for (const v of ORDINE) voci[v] = creaVoce(v);
    disegna();
    // La prima richiesta aspetta le impostazioni: chi ha nascosto le tre voci non sveglia il lettore a ogni scheda.
    setTimeout(() => { if (!impostazioniLette) { impostazioniLette = true; chiedi(); } }, 2000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { disegna(); chiedi({ subito: true }); }
      programmaRichiamo();
    });
    // Il browser se ne accorge per primo: il main rilegge subito invece di aspettare il suo giro.
    window.addEventListener('online', () => chiedi({ subito: true }));
    window.addEventListener('offline', () => chiedi({ subito: true }));
    programmaRichiamo();
    programmaOra();
  }

  async function chiedi({ subito = false } = {}) {
    if (!segue()) return;
    let r = null;
    try { r = await send({ type: MSG.SISTEMA_STATO, subito }); } catch (_) {}
    if (r && r.ok && r.stato) aggiornato(r.stato);
  }

  // Chi scrive in chat manderà presto un turno che vuole lo stato di adesso: il lettore parte mentre si scrive,
  // così all'invio la lettura è pronta. Serve solo alla home che non lo tiene già sveglio da sé.
  function scrive() {
    if (!send || segue() || document.visibilityState === 'hidden') return;
    const adesso = Date.now();
    if (adesso - svegliatoPerChat < 20 * 1000) return;
    svegliatoPerChat = adesso;
    send({ type: MSG.SISTEMA_STATO, perChat: true }).catch(() => {});
  }

  function programmaRichiamo() {
    if (richiamo) clearInterval(richiamo);
    richiamo = document.visibilityState === 'hidden' ? null : setInterval(() => chiedi(), RICHIAMO_MS);
  }

  // L'ora cambia al minuto pieno, non un minuto dopo l'apertura della scheda.
  function programmaOra() {
    if (tickOra) clearTimeout(tickOra);
    const adesso = new Date();
    const mancano = (60 - adesso.getSeconds()) * 1000 - adesso.getMilliseconds() + 50;
    tickOra = setTimeout(() => { disegna(); programmaOra(); }, mancano);
  }

  function aggiornato(nuovo) {
    stato = nuovo && typeof nuovo === 'object' ? nuovo : null;
    disegna();
  }

  // Una voce del computer che ricompare si legge subito; l'ultima che sparisce lascia dormire il lettore.
  function cambiaVisibili(nuove) {
    const prima = impostazioniLette ? segue() : null;
    visibili = nuove;
    impostazioniLette = true;
    disegna();
    if (prima === segue()) return;
    if (segue()) chiedi({ subito: true });
    else send({ type: MSG.SISTEMA_STATO, segue: false }).catch(() => {});
  }

  function applicaImpostazioni(settings) {
    cambiaVisibili(Sis().vociVisibili(settings));
  }

  function creaVoce(v) {
    const el = document.createElement('div');
    el.className = 'dash-sis-voce';
    el.dataset.voce = v;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.draggable = true;
    el.hidden = true;
    const icona = document.createElement('span');
    icona.className = 'dash-sis-icona';
    const testo = document.createElement('span');
    testo.className = 'dash-sis-testo';
    el.append(icona, testo);
    el.addEventListener('click', () => apriBox(v, el));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      apriBox(v, el, { x: e.clientX, y: e.clientY });
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        apriBox(v, el);
      }
    });
    // Trascinata in una chat, la voce porta la sua frase: «Batteria al 42%, in carica».
    el.addEventListener('dragstart', (e) => {
      const d = descrizione()[v];
      if (!d || !e.dataTransfer) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', d.copia);
      e.dataTransfer.effectAllowed = 'copy';
    });
    if (v === 'ora') host.append(el, riga);
    else riga.appendChild(el);
    return { el, icona, testo, chiaveIcona: null };
  }

  function svgDi(d, px = ICONA_PX) {
    const f = ICONS[d.icona];
    if (typeof f !== 'function') return '';
    return d.icona === 'battery' ? f(px, d.livello) : f(px);
  }

  function disegna() {
    if (!host) return;
    const d = descrizione();
    let qualcuna = false;
    let icone = false;
    for (const v of ORDINE) {
      const x = d[v];
      const voce = voci[v];
      const mostra = !!x && visibili[v] !== false;
      if (voce.el.hidden !== !mostra) voce.el.hidden = !mostra;
      if (!mostra) continue;
      qualcuna = true;
      if (v !== 'ora') icone = true;
      const chiave = x.icona ? `${x.icona}:${x.livello == null ? '' : x.livello}` : '';
      if (voce.chiaveIcona !== chiave) {
        voce.icona.innerHTML = x.icona ? svgDi(x) : '';
        voce.chiaveIcona = chiave;
      }
      if (voce.testo.textContent !== x.testo) voce.testo.textContent = x.testo;
      voce.testo.hidden = !x.testo;
      voce.el.title = x.hover;
      voce.el.setAttribute('aria-label', x.dettaglio.join(', '));
      voce.el.dataset.stato = x.offline ? 'offline' : x.bassa ? 'bassa' : x.spento ? 'spento' : '';
    }
    host.hidden = !qualcuna;
    riga.hidden = !icone;
    if (box) aggiornaBox(d);
  }

  // ── Il riquadro della voce: tasto destro, clic, Invio. Dice tutto quello che la voce sa, e la toglie ──

  function chiudiBox() {
    if (!box) return;
    box.el.remove();
    box = null;
    document.removeEventListener('mousedown', fuori, true);
    document.removeEventListener('keydown', tasto, true);
    window.removeEventListener('scroll', scorre, true);
    window.removeEventListener('resize', chiudiBox);
  }
  function fuori(e) { if (box && !box.el.contains(e.target)) chiudiBox(); }
  // Si chiude se scorre la pagina sotto, non se scorre il suo elenco (reti e dispositivi possono superare lo schermo).
  function scorre(e) { if (box && !(e.target instanceof Node && box.el.contains(e.target))) chiudiBox(); }
  function tasto(e) {
    if (!box) return;
    if (e.key === 'Escape') { e.preventDefault(); const da = box.ancora; chiudiBox(); if (da && da.isConnected) da.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.target && e.target.type === 'range') return;
    const opzioni = [...box.el.querySelectorAll('.sn-select-option:not([aria-disabled="true"]):not([hidden])')];
    if (!opzioni.length) return;
    e.preventDefault();
    const i = opzioni.indexOf(document.activeElement);
    const passo = e.key === 'ArrowDown' ? 1 : -1;
    opzioni[(i + passo + opzioni.length) % opzioni.length].focus();
  }

  function righeInfo(contenitore, d) {
    contenitore.replaceChildren(...d.dettaglio.map((r) => {
      const riga = document.createElement('div');
      riga.textContent = r;
      return riga;
    }));
  }

  function aggiornaBox(d) {
    const x = d[box.voce];
    if (!x || visibili[box.voce] === false) { chiudiBox(); return; }
    const testo = x.dettaglio.join('\n');
    if (box.info.dataset.testo !== testo) {
      righeInfo(box.info, x);
      box.info.dataset.testo = testo;
    }
    box.copia = x.copia;
    aggiornaComandi(x);
  }

  // ── I comandi nel riquadro (#874): la stessa porta dell'azione della chat, quindi lo stesso risultato ──

  // Il volume chiesto mentre un altro sta ancora partendo: vale l'ultimo, gli altri non si mettono in fila.
  let volumeVoluto = null;
  let volumeInVolo = false;

  async function comanda(richiesta) {
    let r = null;
    try { r = await send({ type: MSG.SISTEMA_COMANDA, richiesta }); } catch (_) {}
    return r && typeof r === 'object' ? r : { ok: false, frase: 'Filo non ha risposto: riprova.' };
  }

  function creaOpzione(testo, fn, cls = '') {
    const opt = document.createElement('div');
    opt.className = `sn-select-option${cls ? ` ${cls}` : ''}`;
    opt.setAttribute('role', 'menuitem');
    opt.tabIndex = 0;
    opt.textContent = testo;
    const vai = () => { if (opt.getAttribute('aria-disabled') !== 'true') fn(opt); };
    opt.addEventListener('click', vai);
    opt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vai(); }
    });
    return opt;
  }

  function inAttesa(opt, si) {
    if (!opt) return;
    opt.classList.toggle('dash-sis-occupato', si);
    if (si) opt.setAttribute('aria-disabled', 'true');
    else opt.removeAttribute('aria-disabled');
    if (si && !opt.querySelector('.dash-sis-rotella')) {
      const r = document.createElement('span');
      r.className = 'dash-sis-rotella';
      r.setAttribute('aria-hidden', 'true');
      opt.prepend(r);
    } else if (!si) {
      const r = opt.querySelector('.dash-sis-rotella');
      if (r) r.remove();
    }
  }

  // Un comando non riuscito dice perché, e se manca un permesso apre il posto dove si concede.
  function mostraErrore(dove, r) {
    if (!dove) return;
    dove.replaceChildren();
    dove.hidden = !r;
    if (!r) return;
    const frase = document.createElement('div');
    frase.textContent = r.frase || 'Il sistema non ha eseguito il comando.';
    dove.appendChild(frase);
    if (r.dove) {
      const come = document.createElement('div');
      come.className = 'dash-sis-come';
      come.textContent = r.dove;
      dove.appendChild(come);
    }
    if (r.apri) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dash-sis-apri';
      b.textContent = 'Apri le impostazioni';
      b.addEventListener('click', () => { send({ type: MSG.SISTEMA_APRI_IMPOSTAZIONI, chiave: r.apri }).catch(() => {}); });
      dove.appendChild(b);
    }
    if (box) posiziona(box.el, box.ancora, box.punto);
  }

  async function esegui(opt, richiesta, dopo) {
    const questo = box;
    inAttesa(opt, true);
    const r = await comanda(richiesta);
    if (!questo || box !== questo) return;
    inAttesa(opt, false);
    // L'annuncio del nuovo stato può arrivare mentre l'opzione aspettava: la si rietichetta adesso.
    const x = descrizione()[questo.voce];
    if (x) aggiornaComandi(x);
    mostraErrore(questo.errore, r.ok ? null : r);
    if (r.ok && dopo) dopo(r);
  }

  async function chiediVolume(livello) {
    volumeVoluto = livello;
    if (volumeInVolo) return;
    volumeInVolo = true;
    const questo = box;
    if (questo && questo.cursoreRiga) questo.cursoreRiga.classList.add('dash-sis-occupato');
    while (volumeVoluto != null) {
      const n = volumeVoluto;
      volumeVoluto = null;
      const r = await comanda({ cosa: 'volume', livello: n });
      if (box && box === questo) mostraErrore(questo.errore, r.ok ? null : r);
      if (!r.ok) volumeVoluto = null;
    }
    volumeInVolo = false;
    if (questo && questo.cursoreRiga) questo.cursoreRiga.classList.remove('dash-sis-occupato');
  }

  function etichettaRadioWifi(x) {
    if (x.wifi === true || (x.wifi == null && x.icona === 'wifi')) return 'Spegni il Wi-Fi';
    if (x.wifi === false || x.offline) return 'Accendi il Wi-Fi';
    return null;
  }

  // Gli elenchi (dispositivi abbinati, reti conosciute) si chiedono all'apertura: il primo che l'utente cerca è lì.
  async function caricaElenco(questo) {
    const cosa = questo.voce === 'rete' ? 'wifi' : 'bluetooth';
    // Le letture non aspettano i comandi e possono incrociarsi: vale l'ultima chiesta, non quella che arriva per ultima.
    const giro = (questo.letture = (questo.letture || 0) + 1);
    const lista = questo.elenco;
    lista.replaceChildren();
    const attesa = document.createElement('div');
    attesa.className = 'dash-sis-attesa';
    const rot = document.createElement('span');
    rot.className = 'dash-sis-rotella';
    rot.setAttribute('aria-hidden', 'true');
    attesa.append(rot, document.createTextNode(cosa === 'wifi' ? 'Leggo le reti conosciute…' : 'Leggo i dispositivi abbinati…'));
    lista.appendChild(attesa);
    const r = await comanda({ cosa, elenca: true });
    if (box !== questo || questo.letture !== giro) return;
    lista.replaceChildren();
    if (!r.ok) {
      const err = document.createElement('div');
      err.className = 'dash-sis-errore';
      lista.appendChild(err);
      mostraErrore(err, r);
      return;
    }
    const voci = Array.isArray(r.elenco) ? r.elenco : [];
    const titolo = document.createElement('div');
    titolo.className = 'dash-sis-titolo';
    titolo.textContent = voci.length
      ? (cosa === 'wifi' ? 'Reti conosciute' : 'Dispositivi abbinati')
      : (cosa === 'wifi' ? 'Il computer non conosce nessuna rete Wi-Fi' : 'Nessun dispositivo abbinato');
    lista.appendChild(titolo);
    for (const v of voci) lista.appendChild(voceElenco(questo, cosa, v));
    posiziona(questo.el, questo.ancora, questo.punto);
  }

  function voceElenco(questo, cosa, v) {
    if (cosa === 'wifi') {
      if (v.attiva) {
        const opt = creaOpzione(`Collegato a ${v.nome}`, () => {}, 'dash-sis-attuale');
        opt.setAttribute('aria-disabled', 'true');
        return opt;
      }
      const opt = creaOpzione(`Collegati a ${v.nome}`, (o) => esegui(o, { cosa: 'wifi', rete: v.nome }, () => caricaElenco(questo)));
      opt.title = v.nome;
      return opt;
    }
    const collegato = v.collegato === true;
    const opt = creaOpzione(`${collegato ? 'Scollega' : 'Collega'} ${v.nome}`, (o) => esegui(o, { cosa: 'bluetooth', dispositivo: v.nome, collega: !collegato }, () => caricaElenco(questo)));
    opt.title = v.nome;
    if (collegato) opt.classList.add('dash-sis-attuale');
    return opt;
  }

  function creaComandi(questo, x) {
    const v = questo.voce;
    if (v !== 'volume' && v !== 'bluetooth' && v !== 'rete') return null;
    const wrap = document.createElement('div');
    wrap.className = 'dash-sis-comandi';
    if (v === 'volume') {
      const riga = document.createElement('div');
      riga.className = 'dash-sis-cursore';
      const ico = document.createElement('span');
      ico.className = 'dash-sis-icona';
      const cursore = document.createElement('input');
      cursore.type = 'range';
      cursore.min = '0';
      cursore.max = '100';
      cursore.step = '1';
      cursore.setAttribute('aria-label', 'Volume del computer');
      const valore = document.createElement('span');
      valore.className = 'dash-sis-valore';
      cursore.addEventListener('input', () => { valore.textContent = `${cursore.value}%`; });
      cursore.addEventListener('change', () => chiediVolume(Number(cursore.value)));
      riga.append(ico, cursore, valore);
      const muto = creaOpzione('', (o) => esegui(o, { cosa: 'volume', muto: !(questo.ultimo && questo.ultimo.muto) }));
      wrap.append(riga, muto);
      Object.assign(questo, { cursore, valore, muto, icoVolume: ico, cursoreRiga: riga });
    } else {
      const radio = creaOpzione('', (o) => {
        const x2 = questo.ultimo || {};
        const acceso = v === 'rete' ? (o.dataset.accendi === '1') : !!x2.spento;
        esegui(o, { cosa: v === 'rete' ? 'wifi' : 'bluetooth', acceso });
      });
      wrap.appendChild(radio);
      const lista = document.createElement('div');
      lista.className = 'dash-sis-elenco';
      wrap.appendChild(lista);
      Object.assign(questo, { radio, elenco: lista });
    }
    const errore = document.createElement('div');
    errore.className = 'dash-sis-errore';
    errore.hidden = true;
    wrap.appendChild(errore);
    questo.errore = errore;
    return wrap;
  }

  function aggiornaComandi(x) {
    if (!box || !box.comandi) return;
    box.ultimo = x;
    if (box.voce === 'volume') {
      const fermo = !volumeInVolo && volumeVoluto == null && document.activeElement !== box.cursore;
      if (fermo) {
        box.cursore.value = String(Math.min(100, x.livello));
        box.valore.textContent = `${x.livello}%`;
      }
      box.icoVolume.innerHTML = svgDi(x, 14);
      if (!box.muto.classList.contains('dash-sis-occupato')) box.muto.textContent = x.muto ? 'Togli il muto' : 'Metti muto';
      return;
    }
    if (box.radio.classList.contains('dash-sis-occupato')) return;
    if (box.voce === 'bluetooth') {
      box.radio.textContent = x.spento ? 'Accendi il Bluetooth' : 'Spegni il Bluetooth';
      return;
    }
    const etichetta = etichettaRadioWifi(x);
    box.radio.hidden = !etichetta;
    if (etichetta) {
      box.radio.textContent = etichetta;
      box.radio.dataset.accendi = etichetta === 'Accendi il Wi-Fi' ? '1' : '0';
    }
  }

  function imposta(voce, mostra) {
    cambiaVisibili({ ...visibili, [voce]: mostra });
    send({ type: MSG.UPDATE_SETTINGS, settings: { homeSistema: { [voce]: mostra } } }).catch(() => {});
  }

  async function copia(opt) {
    try { await navigator.clipboard.writeText(box ? box.copia : ''); } catch (_) { chiudiBox(); return; }
    opt.textContent = 'Copiato';
    setTimeout(chiudiBox, 700);
  }

  function apriBox(v, ancora, punto) {
    chiudiBox();
    const d = descrizione();
    const x = d[v];
    if (!x) return;
    const el = document.createElement('div');
    el.className = 'sn-select-pop dash-sis-box';
    el.setAttribute('role', 'menu');
    el.dataset.voce = v;
    const info = document.createElement('div');
    info.className = 'dash-sis-info';
    righeInfo(info, x);
    info.dataset.testo = x.dettaglio.join('\n');
    el.appendChild(info);
    const questo = { el, info, voce: v, ancora, punto, copia: x.copia };
    const comandi = creaComandi(questo, x);
    if (comandi) { el.appendChild(comandi); questo.comandi = comandi; }
    const azioni = [['Copia', (opt) => copia(opt)], [`Nascondi ${NOMI[v]}`, () => { chiudiBox(); imposta(v, false); }]];
    for (const altra of ORDINE) {
      if (altra !== v && visibili[altra] === false && d[altra]) {
        azioni.push([`Mostra ${NOMI[altra]}`, () => { chiudiBox(); imposta(altra, true); }]);
      }
    }
    const altre = document.createElement('div');
    altre.className = 'dash-sis-altre';
    for (const [etichetta, fn] of azioni) altre.appendChild(creaOpzione(etichetta, fn));
    el.appendChild(altre);
    document.body.appendChild(el);
    box = questo;
    aggiornaComandi(x);
    posiziona(el, ancora, punto);
    if (questo.elenco && (v === 'bluetooth' || etichettaRadioWifi(x))) caricaElenco(questo);
    setTimeout(() => {
      document.addEventListener('mousedown', fuori, true);
      document.addEventListener('keydown', tasto, true);
      window.addEventListener('scroll', scorre, true);
      window.addEventListener('resize', chiudiBox);
    }, 0);
  }

  // Al clic il riquadro sale sopra la voce, che sta in fondo alla pagina; al tasto destro parte dal puntatore.
  function posiziona(el, ancora, punto) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x;
    let y;
    if (punto) {
      x = punto.x;
      y = punto.y + h > vh - 4 ? punto.y - h : punto.y;
    } else {
      const r = ancora.getBoundingClientRect();
      x = r.right - w;
      y = r.top - h - 6 >= 4 ? r.top - h - 6 : r.bottom + 6;
    }
    el.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, vh - h - 4))}px`;
  }

  global.SN_DASH_SISTEMA = { init, aggiornato, applicaImpostazioni, chiudiBox, scrive };
})(typeof globalThis !== 'undefined' ? globalThis : self);
