/* ——————————————————————————————————————————————————————
   Il copione. Un blocco = il pensiero e le azioni che ne sono nate.
   Le azioni di un blocco partono INSIEME: sono una decisione sola,
   quindi fanno un nodo solo. L'ultimo blocco non ha azioni: sfocia
   nella risposta.
—————————————————————————————————————————————————————— */
var BLOCCHI = [
  {
    spunto: 'da dove partire', ms: 4300,
    cot: "L'utente chiede gli orari dei treni per Bologna di domani mattina. Non ho un orario in memoria, quindi devo cercarlo. Comincio dal sito ufficiale e poi confronto con un secondo, perché i cambi stagionali sono spesso disallineati.",
    vivo: 'Cerco sul web…', gruppo: 'Cercato sul web', titoletto: 'Cercato gli orari di domani',
    azioni: [
      { icona: '🔎', fatto: 'Cercato sul web', breve: 'orari treni Bologna', esito: '8 risultati, fra orari ufficiali e siti di terzi.' },
    ],
    durataAzioni: 1900,
  },
  {
    spunto: 'manca il prezzo', ms: 3200,
    cot: "Il primo risultato dà tre partenze fra le 7 e le 9. Manca il prezzo, che l'utente non ha chiesto ma vorrà sapere subito dopo. Tanto vale guardare i tre siti insieme invece che uno alla volta: se sono d'accordo il numero è affidabile.",
    vivo: 'Guardo tre siti…', gruppo: 'Lette tre pagine', titoletto: 'Confrontati i prezzi sui tre siti',
    azioni: [
      { icona: '📄', fatto: 'Letta una pagina', breve: 'trenitalia.com', esito: '11 partenze fra le 06:10 e le 09:55. Diretto 7:42, 34 €.' },
      { icona: '📄', fatto: 'Letta una pagina', breve: 'italotreno.it', esito: 'Nessun diretto la mattina presto. 19 € con cambio.' },
      { icona: '📄', fatto: 'Letta una pagina', breve: 'omio.it', esito: 'Conferma i tre orari. 21 € il secondo con cambio.' },
    ],
    durataAzioni: 2400,
  },
  {
    spunto: 'quale mettere per primo', ms: 3000,
    cot: "I tre siti concordano, quindi i numeri li do per buoni. Prima di scrivere controllo gli scioperi: domani è venerdì e a gennaio ce ne sono stati. Se c'è un'agitazione, l'orario che sto per dare è carta straccia.",
    vivo: 'Controllo gli scioperi…', gruppo: 'Controllati gli scioperi', titoletto: 'Verificato che non ci siano scioperi',
    azioni: [
      { icona: '⚠️', fatto: 'Controllati gli scioperi', breve: 'nessuno', esito: 'Nessuna agitazione annunciata sulla tratta per domani.' },
    ],
    durataAzioni: 1700,
  },
  {
    spunto: 'come scriverlo', ms: 2800,
    cot: "Ho tutto. Metto il diretto per primo perché è quello che risolve la giornata a chi ha fretta, e cito gli altri due sotto con il prezzo, che è l'unico motivo per preferirli. Niente tabelle: sono tre righe. Lo sciopero non lo nomino: dire «non ci sono scioperi» a chi non ha chiesto di scioperi semina un dubbio che non aveva.",
    vivo: null, gruppo: 'Scritta la risposta', titoletto: 'Deciso come metterla in fila',
    azioni: null, durataAzioni: 0,
  },
];
var BLOCCO_EXTRA = {
  spunto: 'e i bagagli?', ms: 2600,
  cot: "Chi parte la mattina presto spesso ha un trolley. Sui regionali non c'è vincolo, sulle Frecce nemmeno, quindi non è un'informazione che cambia la scelta. La lascio fuori.",
  vivo: 'Controllo due regolamenti…', gruppo: 'Letti due regolamenti', titoletto: 'Controllate le regole sui bagagli',
  azioni: [
    { icona: '🧳', fatto: 'Letto un regolamento', breve: 'bagagli Frecce', esito: 'Nessun limite di pezzi, ingombro ragionevole.' },
    { icona: '🧳', fatto: 'Letto un regolamento', breve: 'bagagli regionali', esito: 'Nessun limite.' },
  ],
  durataAzioni: 2000,
};
var RISPOSTA = 'Domani mattina hai tre treni per Bologna: il diretto delle 7:42 (1 h 05, 34 €) e due con cambio a Firenze, alle 7:10 e alle 8:25 — più lenti ma la metà del prezzo.';
var PAROLE = ['Sta ragionando', 'Ci sto lavorando', 'Ci penso'];

/* —————————————————— utilità —————————————————— */
var opt = {}, vel = 1, corsa = null, bloccoVivo = null;

function leggiOpzioni() {
  ['filo', 'nodi', 'ragionamento', 'nodo', 'multi', 'coda', 'fine', 'parole'].forEach(function (n) {
    var v = document.querySelector('input[name="' + n + '"]:checked');
    opt[n] = v ? v.value : null;
  });
  opt.lungo = document.getElementById('lungo').checked;
  opt.calmo = document.getElementById('calmo').checked;
}
function V() { return PAROLE[Number(opt.parole) || 0]; }
function el(tag, cls, testo) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (testo != null) e.textContent = testo;
  return e;
}
function svgNS(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
function dur(ms) {
  var s = Math.round(ms / 1000);
  return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
}
function frasiChiuse(t) {
  return String(t || '').replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]/g) || [];
}
function ultimaFrase(t) {
  var p = String(t || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/);
  return p[p.length - 1] || '';
}
function attendi(ms) { return new Promise(function (r) { setTimeout(r, ms / vel); }); }

var hint = document.getElementById('hint');
function legaHint(nodo, testo) {
  nodo.addEventListener('mouseenter', function () {
    hint.textContent = testo;
    var r = nodo.getBoundingClientRect();
    hint.style.left = (r.left + r.width / 2) + 'px';
    hint.style.top = r.top + 'px';
    hint.classList.add('vis');
  });
  nodo.addEventListener('mouseleave', function () { hint.classList.remove('vis'); });
}

/* Le righe da mostrare: unite (pensiero + azioni) o separate. */
function costruisciRighe() {
  var blocchi = BLOCCHI.slice();
  if (opt.lungo) blocchi.splice(2, 0, BLOCCO_EXTRA);
  var out = [];
  blocchi.forEach(function (b, i) {
    var ultimo = !b.azioni;
    if (opt.nodi === 'unito') {
      out.push({ blocco: b, cot: b.cot, ms: b.ms, azioni: b.azioni, ultimo: ultimo });
    } else {
      out.push({ blocco: b, cot: b.cot, ms: b.ms, azioni: null, ultimo: ultimo, soloPensiero: !ultimo });
      if (b.azioni) out.push({ blocco: b, cot: null, ms: 0, azioni: b.azioni, ultimo: false });
    }
  });
  return out;
}

/* ——————————————————————————————————————————————————————
   Il blocco di attività.
—————————————————————————————————————————————————————— */
function creaBlocco(host, suStop) {
  var blocco = el('div', 'blocco');
  var righe = el('div', 'righe');
  var capo = el('div', 'capo');
  blocco.append(capo, righe);
  host.append(blocco);

  var segmenti = [], apertoIdx = -1, arrotolato = false, vivo = true;
  var rail = null, railPath = null, nodi = [], filiOrizz = [];
  var onda = { fase: 0, amp: 2.4, ampObiettivo: 2.4, vel: 0.06, ultimoNodoY: 0, tagliato: false };

  if (opt.filo === 'verticale') {
    blocco.classList.add('verticale');
    rail = svgNS('svg');
    rail.setAttribute('class', 'rail');
    rail.setAttribute('width', 26);
    railPath = svgNS('path');
    rail.append(railPath);
    blocco.append(rail);
  }
  requestAnimationFrame(disegna);

  function disegna() {
    if (!vivo) return;
    for (var q = 0; q < filiOrizz.length; q++) {
      var f = filiOrizz[q];
      if (!opt.calmo) f.fase += onda.vel;
      var dd = '', m = 10;
      for (var j = 0; j <= m; j++) {
        var fx = (j / m) * 24;
        dd += (j ? 'L' : 'M') + fx.toFixed(1) + ',' +
          (6 + Math.sin((fx / 24) * Math.PI * 2 + f.fase) * onda.amp * Math.sin((j / m) * Math.PI)).toFixed(2);
      }
      f.p.setAttribute('d', dd);
    }
    if (!rail) { requestAnimationFrame(disegna); return; }

    // I nodi stanno sulla LORO riga: se una sezione si apre, quello che sta
    // sotto scende, e il nodo scende con la sua riga.
    for (var k = 0; k < nodi.length; k++) {
      var ny = nodi[k].seg.el.offsetTop + 15;
      nodi[k].c.setAttribute('cy', ny);
      if (nodi[k].alone) nodi[k].alone.setAttribute('cy', ny);
      if (k === nodi.length - 1) onda.ultimoNodoY = ny;
    }

    var H = Math.max(18, righe.offsetHeight);
    rail.setAttribute('height', H + 16);
    rail.style.height = (H + 16) + 'px';
    if (!arrotolato) {
      onda.amp += (onda.ampObiettivo - onda.amp) * 0.07;
      if (!opt.calmo) onda.fase += onda.vel;
      var Hd = H + (onda.tagliato ? 2 : 8), d = '', n = Math.max(10, Math.round(Hd / 4));
      for (var i = 0; i <= n; i++) {
        var y = (i / n) * Hd;
        var giu = Math.max(0, Math.min(1, (y - onda.ultimoNodoY) / 34));
        // Tagliato: la punta si affloscia di lato invece di ondeggiare.
        var x = onda.tagliato
          ? 13 + giu * 3.2 * Math.min(1, (y - onda.ultimoNodoY) / 60)
          : 13 + Math.sin(y * 0.16 + onda.fase) * onda.amp * giu;
        d += (i ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(1);
      }
      railPath.setAttribute('d', d);
    }
    requestAnimationFrame(disegna);
  }

  function piazzaNodo(seg, azione, titolo) {
    if (!rail) return;
    var y = seg.el.offsetTop + 15;
    var alone = null;
    if (azione) {
      alone = svgNS('circle');
      alone.setAttribute('cx', 13); alone.setAttribute('cy', y); alone.setAttribute('r', 6);
      alone.setAttribute('fill', 'none');
      alone.setAttribute('stroke', 'var(--dash-accent)');
      alone.setAttribute('stroke-width', 1);
      alone.setAttribute('opacity', 0.35);
      rail.append(alone);
    }
    var c = svgNS('circle');
    c.setAttribute('cx', 13); c.setAttribute('cy', y); c.setAttribute('r', 0);
    c.style.transition = 'r 340ms cubic-bezier(.3,1.8,.5,1)';
    rail.append(c);
    requestAnimationFrame(function () { c.setAttribute('r', azione ? 3.6 : 2.7); });
    legaHint(c, titolo);
    nodi.push({ c: c, alone: alone, seg: seg });
    onda.ultimoNodoY = y;
  }

  function apri(i) {
    if (righe.style.maxHeight && righe.style.maxHeight !== 'none' && righe.style.maxHeight !== '0px') {
      righe.style.maxHeight = 'none';
    }
    apertoIdx = (apertoIdx === i) ? -1 : i;
    segmenti.forEach(function (s, k) { s.el.classList.toggle('aperto', k === apertoIdx); });
  }

  function scriviEtichetta(seg, t) {
    if (seg.eti.textContent === t) return;
    seg.eti.classList.add('giu');
    setTimeout(function () { seg.eti.textContent = t; seg.eti.classList.remove('giu'); }, 170);
  }

  // Il titolo di un nodo. Con una sola azione è il suo nome; con più azioni
  // il verbo al plurale è gratis, e cambia solo quanti dettagli seguono.
  function titoloNodo(desc, ms) {
    var az = desc.azioni, b = desc.blocco;
    if (az.length === 1) {
      if (opt.nodo === 'durata') return az[0].fatto + ' · ' + dur(ms);
      if (opt.nodo === 'dettaglio') return az[0].fatto + ' · ' + az[0].breve;
      return az[0].fatto;
    }
    if (opt.multi === 'llm') return b.titoletto;
    var quanti = opt.multi === 'uno' ? 1 : (opt.multi === 'due' ? 2 : 3);
    var mostrati = az.slice(0, quanti).map(function (a) { return a.breve; });
    var restano = az.length - mostrati.length;
    return b.gruppo + ' · ' + mostrati.join(', ') + (restano > 0 ? ' +' + restano : '');
  }

  return {
    blocco: blocco,

    apriRiga: function (desc) {
      var wrap = el('div', 'seg vivo');
      var testa = el('div', 'seg-testa');
      var ico = el('span', 'seg-ico');
      var eti = el('span', 'seg-eti');
      testa.append(ico, eti);
      var trama = el('div', 'trama');
      var stop = el('button', 'stop', 'ferma');
      stop.type = 'button';
      stop.title = 'Ferma il lavoro';
      var corpo = el('div', 'seg-corpo');
      var cotEl = el('div', 'seg-cot');
      corpo.append(cotEl);
      wrap.append(testa, trama, stop, corpo);
      righe.append(wrap);

      var idx = segmenti.length;
      testa.addEventListener('click', function () { apri(idx); });
      trama.addEventListener('click', function () { apri(idx); });
      stop.addEventListener('click', function (e) { e.stopPropagation(); suStop(); });

      var seg = { el: wrap, testa: testa, ico: ico, eti: eti, trama: trama, corpo: corpo, cotEl: cotEl,
                  desc: desc, acc: '', viste: 0, filo: null };
      segmenti.push(seg);

      var conTrama = desc.cot && opt.ragionamento === 'trama';
      if (desc.cot) {
        onda.ampObiettivo = 3.2; onda.vel = 0.06;
        // Con la trama la riga È la trama: nessuna scritta di stato.
        testa.style.display = conTrama ? 'none' : '';
        if (!conTrama) trama.style.display = 'none';
        if (opt.ragionamento === 'niente' || opt.ragionamento === 'frase' || opt.ragionamento === 'parziale') {
          eti.textContent = V() + '…';
        }
        if (!conTrama) filoVivo(seg);
      } else {
        trama.style.display = 'none';
      }
      return seg;
    },

    ragiona: function (seg, pezzo) {
      seg.acc += pezzo;
      seg.cotEl.textContent = seg.acc;
      seg.corpo.scrollTop = seg.corpo.scrollHeight;
      if (opt.ragionamento === 'trama') {
        seg.trama.textContent = seg.acc.replace(/\s+/g, ' ').slice(-80);
      } else if (opt.ragionamento === 'parziale') {
        seg.eti.textContent = V() + ' · ' + ultimaFrase(seg.acc);
      } else if (opt.ragionamento === 'frase') {
        var fr = frasiChiuse(seg.acc);
        if (fr.length > seg.viste) {
          seg.viste = fr.length;
          scriviEtichetta(seg, V() + ' · ' + fr[fr.length - 1].trim());
        }
      }
    },

    // Il modello chiama gli strumenti: il filo si annoda qui, e al posto
    // della trama compare l'azione. Più strumenti insieme = un nodo solo.
    parteAzione: function (seg) {
      var b = seg.desc.blocco;
      seg.el.classList.remove('vivo');
      seg.trama.remove();
      seg.testa.style.display = '';
      spegniFilo(seg);
      if (opt.filo === 'verticale') seg.ico.style.display = 'none';
      else seg.ico.textContent = seg.desc.azioni[0].icona;
      seg.eti.textContent = b.vivo;
      onda.ampObiettivo = 1.7; onda.vel = 0.13;
      piazzaNodo(seg, true, b.gruppo);
    },

    finisceAzione: function (seg, ms) {
      scriviEtichetta(seg, titoloNodo(seg.desc, ms));
      seg.desc.azioni.forEach(function (a) {
        var riga = el('div', 'att-riga');
        riga.append(el('span', 'att-riga-ico', a.icona), el('span', null, a.fatto + ' · ' + a.breve + ' — ' + a.esito));
        seg.corpo.append(riga);
      });
      onda.ampObiettivo = 3.2; onda.vel = 0.06;
    },

    // Modalità a nodi separati: anche il solo pensiero si annoda.
    annodaPensiero: function (seg, ms) {
      chiudiRigaViva(seg);
      var t = 'Riflettuto';
      if (opt.nodo === 'durata') t += ' · ' + dur(ms);
      if (opt.nodo === 'dettaglio') t += ' · ' + seg.desc.blocco.spunto;
      seg.eti.textContent = t;
      piazzaNodo(seg, false, t);
    },

    // L'ULTIMO pensiero, quello che decide come scrivere: tre destini.
    chiudiUltimo: function (seg, ms) {
      if (opt.coda === 'nodo') {
        chiudiRigaViva(seg);
        var t = seg.desc.blocco.gruppo;
        if (opt.nodo === 'durata') t += ' · ' + dur(ms);
        if (opt.nodo === 'dettaglio') t += ' · ' + seg.desc.blocco.spunto;
        seg.eti.textContent = t;
        piazzaNodo(seg, false, t);
      } else if (opt.coda === 'coda') {
        // Nessun nodo: è la coda del filo, e si legge srotolando il gomitolo.
        chiudiRigaViva(seg);
        seg.testa.style.display = 'none';
        seg.el.classList.add('coda');
      } else {
        chiudiRigaViva(seg);
        seg.el.remove();
        var i = segmenti.indexOf(seg);
        if (i >= 0) segmenti.splice(i, 1);
      }
    },

    // Fermato dall'utente: il filo si taglia, la punta si affloscia.
    taglia: function (seg) {
      if (seg) {
        chiudiRigaViva(seg);
        seg.testa.style.display = '';
        seg.eti.textContent = 'Fermato qui';
        seg.el.classList.add('coda');
      }
      onda.tagliato = true;
      onda.ampObiettivo = 0;
      blocco.classList.add('fermato');
    },

    chiudi: function (riassunto, msTot) {
      onda.ampObiettivo = 0.4; onda.vel = 0.012;
      if (opt.fine === 'sparisce') { vivo = false; blocco.remove(); return; }
      if (opt.fine === 'resta') return;
      arrotolato = true;
      blocco.classList.add('arrotolabile');
      var svg = svgNS('svg');
      svg.setAttribute('width', 20); svg.setAttribute('height', 20);
      svg.setAttribute('viewBox', '0 0 20 20');
      var d = '';
      for (var a = 0; a < Math.PI * 4.6; a += 0.08) {
        var r = 0.9 + a * 0.55;
        d += (d ? 'L' : 'M') + (10 + Math.cos(a) * r).toFixed(2) + ',' + (10 + Math.sin(a) * r * 0.86).toFixed(2);
      }
      var p = svgNS('path');
      p.setAttribute('d', d);
      svg.append(p);
      capo.append(svg, el('span', 'seg-eti', riassunto + ' · ' + dur(msTot)));
      var len = 200;
      try { len = p.getTotalLength(); } catch (e) {}
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      if (opt.calmo) p.style.strokeDashoffset = 0;
      else {
        p.style.transition = 'stroke-dashoffset 700ms cubic-bezier(.4,0,.2,1)';
        requestAnimationFrame(function () { p.style.strokeDashoffset = 0; });
      }
      var chiuso = false;
      function mostra(v) {
        chiuso = !v;
        righe.style.maxHeight = righe.scrollHeight + 'px';
        righe.style.opacity = v ? '' : '0';
        if (rail) rail.style.display = v ? '' : 'none';
        requestAnimationFrame(function () { righe.style.maxHeight = v ? righe.scrollHeight + 'px' : '0px'; });
        if (v) setTimeout(function () { if (!chiuso) righe.style.maxHeight = 'none'; }, 460);
      }
      mostra(false);
      capo.addEventListener('click', function () { mostra(chiuso); });
    },

    ferma: function () { vivo = false; },
  };

  function chiudiRigaViva(seg) {
    seg.el.classList.remove('vivo');
    seg.trama.remove();
    spegniFilo(seg);
    seg.ico.style.display = 'none';
  }
  function filoVivo(seg) {
    if (opt.filo === 'rotella') { seg.ico.className = 'rotella'; seg.ico.textContent = ''; return; }
    if (opt.filo !== 'orizzontale') { seg.ico.style.display = 'none'; return; }
    seg.ico.style.width = '26px';
    var fsvg = svgNS('svg');
    fsvg.setAttribute('class', 'orizz');
    fsvg.setAttribute('width', 24); fsvg.setAttribute('height', 12);
    fsvg.setAttribute('viewBox', '0 0 24 12');
    var fp = svgNS('path');
    fsvg.append(fp);
    seg.ico.append(fsvg);
    seg.filo = { p: fp, fase: 0 };
    filiOrizz.push(seg.filo);
  }
  function spegniFilo(seg) {
    if (seg.filo) {
      var w = filiOrizz.indexOf(seg.filo);
      if (w >= 0) filiOrizz.splice(w, 1);
      seg.filo = null;
    }
    seg.ico.className = 'seg-ico';
    seg.ico.textContent = '';
    seg.ico.style.width = '';
    seg.ico.style.display = '';
  }
}

/* ——————————————————————————————————————————————————————
   La corsa.
—————————————————————————————————————————————————————— */
var segVivo = null, fermato = false;

async function gioca() {
  if (bloccoVivo) bloccoVivo.ferma();
  var mio = corsa = {};
  fermato = false;
  segVivo = null;
  leggiOpzioni();
  var host = document.getElementById('blocco');
  host.textContent = '';
  var risposta = document.getElementById('risposta');
  risposta.textContent = '';
  risposta.classList.remove('interrotta');

  var inizio = Date.now();
  var b = creaBlocco(host, function () {
    // FERMA: il turno finisce qui, e lo si vede.
    if (corsa !== mio || fermato) return;
    fermato = true;
    corsa = {};
    b.taglia(segVivo);
    b.chiudi('Fermato', Date.now() - inizio);
    risposta.classList.add('interrotta');
    risposta.textContent = 'Fermato prima della risposta.';
  });
  bloccoVivo = b;
  var righe = costruisciRighe();

  await attendi(700);
  if (corsa !== mio) return;

  for (var i = 0; i < righe.length; i++) {
    var desc = righe[i];
    var seg = b.apriRiga(desc);
    segVivo = seg;
    var t = Date.now();

    if (desc.cot) {
      var pos = 0;
      while (pos < desc.cot.length) {
        var n = 2 + Math.floor(Math.random() * 8);
        b.ragiona(seg, desc.cot.slice(pos, pos + n));
        pos += n;
        await attendi((desc.ms / desc.cot.length) * n * (0.4 + Math.random() * 1.4));
        if (corsa !== mio) return;
      }
    }

    if (desc.azioni) {
      b.parteAzione(seg);
      var ta = Date.now();
      await attendi(desc.blocco.durataAzioni);
      if (corsa !== mio) return;
      b.finisceAzione(seg, Date.now() - ta);
    } else if (desc.ultimo) {
      b.chiudiUltimo(seg, Date.now() - t);
    } else if (desc.soloPensiero) {
      b.annodaPensiero(seg, Date.now() - t);
    }
    segVivo = null;
    await attendi(260);
    if (corsa !== mio) return;
  }

  b.chiudi('Ha cercato sul web, letto tre pagine e controllato gli scioperi', Date.now() - inizio);
  await attendi(420);
  if (corsa !== mio) return;

  for (var k = 1; k <= RISPOSTA.length; k += 2) {
    risposta.textContent = RISPOSTA.slice(0, k);
    await attendi(22);
    if (corsa !== mio) return;
  }
  risposta.textContent = RISPOSTA;
}

/* —————————————————— comandi —————————————————— */
var PRESET = {
  filo:   { filo: 'verticale', nodi: 'unito',  ragionamento: 'trama',    nodo: 'dettaglio', multi: 'due', coda: 'coda', fine: 'arrotola' },
  cinque: { filo: 'rotella',   nodi: 'diviso', ragionamento: 'trama',    nodo: 'due',       multi: 'tre', coda: 'perde', fine: 'resta' },
  oggi:   { filo: 'rotella',   nodi: 'diviso', ragionamento: 'parziale', nodo: 'dettaglio', multi: 'tre', coda: 'perde', fine: 'resta' },
};
document.querySelectorAll('[data-preset]').forEach(function (b) {
  b.addEventListener('click', function () {
    var p = PRESET[b.dataset.preset];
    Object.keys(p).forEach(function (k) {
      var i = document.querySelector('input[name="' + k + '"][value="' + p[k] + '"]');
      if (i) i.checked = true;
    });
    gioca();
  });
});
document.querySelectorAll('input[type=radio]').forEach(function (i) { i.addEventListener('change', gioca); });
document.getElementById('lungo').addEventListener('change', gioca);
document.getElementById('calmo').addEventListener('change', gioca);
document.getElementById('rigioca').addEventListener('click', gioca);
document.getElementById('vel').addEventListener('input', function (e) { vel = Number(e.target.value); });
document.getElementById('tema').addEventListener('change', function (e) {
  document.body.classList.toggle('scuro', e.target.checked);
});
gioca();
