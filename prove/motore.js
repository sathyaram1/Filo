/* ——————————————————————————————————————————————————————
   Il copione. Un blocco = il pensiero e l'azione che ne è nata.
   L'ultimo blocco non ha azione: sfocia nella risposta.
—————————————————————————————————————————————————————— */
var BLOCCHI = [
  {
    spunto: 'da dove partire', ms: 4300,
    cot: "L'utente chiede gli orari dei treni per Bologna di domani mattina. Non ho un orario in memoria, quindi devo cercarlo. Comincio dal sito ufficiale e poi confronto con un secondo, perché i cambi stagionali sono spesso disallineati.",
    azione: { icona: '🔎', vivo: 'Cerco sul web…', fatto: 'Cercato sul web', dettaglio: 'orari treni Bologna',
      esito: '8 risultati, fra orari ufficiali e siti di terzi.', ms: 1900 },
  },
  {
    spunto: 'manca il prezzo', ms: 3200,
    cot: "Il primo risultato dà tre partenze fra le 7 e le 9. Manca il prezzo, che l'utente non ha chiesto ma vorrà sapere subito dopo. Provo a recuperarlo dalla stessa pagina prima di rispondere.",
    azione: { icona: '📄', vivo: 'Leggo la pagina…', fatto: 'Letta una pagina', dettaglio: 'orari ufficiali',
      esito: 'Tabella con 11 partenze fra le 06:10 e le 09:55.', ms: 1800 },
  },
  {
    spunto: 'quanto costano', ms: 3000,
    cot: "Tre treni: due con cambio e uno diretto. Il diretto costa di più ma arriva prima, e senza i prezzi non posso dirlo. Controllo su un secondo sito, così se i due sono d'accordo il numero è affidabile.",
    azione: { icona: '💶', vivo: 'Controllo i prezzi…', fatto: 'Confrontati i prezzi', dettaglio: 'due siti',
      esito: '34 €, 19 €, 21 €. Il secondo sito conferma.', ms: 1700 },
  },
  {
    spunto: 'come scriverlo', ms: 2600,
    cot: "Ho tutto. Metto il diretto per primo perché è quello che risolve la giornata a chi ha fretta, e cito gli altri due sotto con il prezzo, che è l'unico motivo per preferirli. Niente tabelle: sono tre righe.",
    azione: null,
  },
];
var BLOCCHI_EXTRA = [
  {
    spunto: 'e gli scioperi?', ms: 2800,
    cot: "Domani è venerdì e a gennaio ci sono stati scioperi. Vale la pena controllare: se c'è uno sciopero l'orario che sto per dare è carta straccia.",
    azione: { icona: '⚠️', vivo: 'Controllo gli scioperi…', fatto: 'Controllati gli scioperi', dettaglio: 'nessuno',
      esito: 'Nessuna agitazione annunciata sulla tratta per domani.', ms: 1800 },
  },
];
var RISPOSTA = 'Domani mattina hai tre treni per Bologna: il diretto delle 7:42 (1 h 05, 34 €) e due con cambio a Firenze, alle 7:10 e alle 8:25 — più lenti ma la metà del prezzo.';
var PAROLE = ['Sta ragionando', 'Ci sto lavorando', 'Ci penso'];

/* —————————————————— utilità —————————————————— */
var opt = {}, vel = 1, corsa = null, bloccoVivo = null;

function leggiOpzioni() {
  ['filo', 'nodi', 'ragionamento', 'nodo', 'fine', 'parole'].forEach(function (n) {
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

/* Le righe da mostrare: unite (pensiero + azione) o separate. */
function costruisciRighe() {
  var blocchi = BLOCCHI.slice();
  if (opt.lungo) blocchi.splice(2, 0, BLOCCHI_EXTRA[0]);
  var out = [];
  blocchi.forEach(function (b) {
    if (opt.nodi === 'unito') {
      out.push({ cot: b.cot, ms: b.ms, azione: b.azione, spunto: b.spunto });
    } else {
      out.push({ cot: b.cot, ms: b.ms, azione: null, spunto: b.spunto, titoloPensiero: b.azione ? 'Riflettuto' : null });
      if (b.azione) out.push({ cot: null, ms: 0, azione: b.azione });
    }
  });
  return out;
}

/* ——————————————————————————————————————————————————————
   Il blocco di attività.
—————————————————————————————————————————————————————— */
function creaBlocco(host) {
  var blocco = el('div', 'blocco');
  var righe = el('div', 'righe');
  var capo = el('div', 'capo');
  blocco.append(capo, righe);
  host.append(blocco);

  var segmenti = [], apertoIdx = -1, arrotolato = false, vivo = true;
  var rail = null, railPath = null, nodi = [], filiOrizz = [];
  var onda = { fase: 0, amp: 2.4, ampObiettivo: 2.4, vel: 0.06, ultimoNodoY: 0 };

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
    // Il filo corto accanto alla riga viva: stessa onda, in orizzontale.
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
      var riga = nodi[k].seg.el;
      var ny = riga.offsetTop + Math.min(25, riga.offsetHeight) / 2 + 3;
      nodi[k].c.setAttribute('cy', ny);
      if (nodi[k].alone) nodi[k].alone.setAttribute('cy', ny);
      if (k === nodi.length - 1) onda.ultimoNodoY = ny;
    }

    var H = Math.max(18, righe.offsetHeight);
    rail.setAttribute('height', H + 12);
    rail.style.height = (H + 12) + 'px';
    if (!arrotolato) {
      onda.amp += (onda.ampObiettivo - onda.amp) * 0.07;
      if (!opt.calmo) onda.fase += onda.vel;
      var Hd = H + 8, d = '', n = Math.max(10, Math.round(Hd / 4));
      for (var i = 0; i <= n; i++) {
        var y = (i / n) * Hd;
        var giu = Math.max(0, Math.min(1, (y - onda.ultimoNodoY) / 34));
        d += (i ? 'L' : 'M') + (13 + Math.sin(y * 0.16 + onda.fase) * onda.amp * giu).toFixed(2) + ',' + y.toFixed(1);
      }
      railPath.setAttribute('d', d);
    }
    requestAnimationFrame(disegna);
  }

  // Il nodo. Un passo con uno strumento lascia un nodo più grosso, con
  // l'alone; un nodo di solo pensiero è piccolo.
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

  function titoloFatto(az, ms) {
    if (opt.nodo === 'durata') return az.fatto + ' · ' + dur(ms);
    if (opt.nodo === 'dettaglio') return az.fatto + ' · ' + az.dettaglio;
    return az.fatto;
  }

  return {
    blocco: blocco,

    // Apre una riga. Se c'è un pensiero, parte con la sola trama e nessuna
    // scritta: è il filo a dire che sta lavorando.
    apriRiga: function (desc) {
      var wrap = el('div', 'seg vivo');
      var testa = el('div', 'seg-testa');
      var ico = el('span', 'seg-ico');
      var eti = el('span', 'seg-eti');
      testa.append(ico, eti);
      var trama = el('div', 'trama');
      var corpo = el('div', 'seg-corpo');
      var cotEl = el('div', 'seg-cot');
      corpo.append(cotEl);
      wrap.append(testa, trama, corpo);
      righe.append(wrap);

      var idx = segmenti.length;
      testa.addEventListener('click', function () { apri(idx); });
      trama.addEventListener('click', function () { apri(idx); });

      var seg = { el: wrap, testa: testa, ico: ico, eti: eti, trama: trama, corpo: corpo, cotEl: cotEl,
                  desc: desc, acc: '', viste: 0, filo: null };
      segmenti.push(seg);

      var conTrama = desc.cot && opt.ragionamento === 'trama';
      if (desc.cot) {
        onda.ampObiettivo = 3.2; onda.vel = 0.06;
        // Con la trama la riga è la trama: nessun «sta ragionando».
        testa.style.display = conTrama ? 'none' : '';
        if (!conTrama) trama.style.display = 'none';
        if (opt.ragionamento === 'niente') scriviEtichetta(seg, V() + '…');
        if (opt.ragionamento === 'frase' || opt.ragionamento === 'parziale') eti.textContent = V() + '…';
        if (!conTrama) filoVivo(seg);
      } else {
        trama.style.display = 'none';
      }
      return seg;
    },

    // Un pezzo di ragionamento dal modello.
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

    // Il modello chiama uno strumento: il filo si annoda qui, e al posto
    // della trama compare l'azione.
    parteAzione: function (seg) {
      var az = seg.desc.azione;
      seg.el.classList.remove('vivo');
      seg.trama.remove();
      seg.testa.style.display = '';
      spegniFilo(seg);
      seg.ico.textContent = opt.filo === 'verticale' ? '' : az.icona;
      if (opt.filo === 'verticale') seg.ico.style.display = 'none';
      seg.eti.textContent = az.vivo;
      onda.ampObiettivo = 1.7; onda.vel = 0.13;
      piazzaNodo(seg, true, az.fatto + ' · ' + az.dettaglio);
    },

    // L'azione è finita: il nodo prende il suo nome.
    finisceAzione: function (seg, ms) {
      var az = seg.desc.azione;
      scriviEtichetta(seg, titoloFatto(az, ms));
      var riga = el('div', 'att-riga');
      riga.append(el('span', 'att-riga-ico', az.icona), el('span', null, az.esito));
      seg.corpo.append(riga);
      onda.ampObiettivo = 3.2; onda.vel = 0.06;
    },

    // Modalità a nodi separati: anche il solo pensiero si annoda.
    annodaPensiero: function (seg, ms) {
      seg.el.classList.remove('vivo');
      seg.trama.remove();
      seg.testa.style.display = '';
      spegniFilo(seg);
      seg.ico.style.display = 'none';
      var t = 'Riflettuto';
      if (opt.nodo === 'durata') t += ' · ' + dur(ms);
      if (opt.nodo === 'dettaglio') t += ' · ' + seg.desc.spunto;
      seg.eti.textContent = t;
      piazzaNodo(seg, false, t);
    },

    // L'ultimo pensiero non si annoda: sfocia nella risposta.
    lasciaAperto: function (seg) {
      seg.el.classList.remove('vivo');
      seg.trama.remove();
      seg.el.remove();
      var i = segmenti.indexOf(seg);
      if (i >= 0) segmenti.splice(i, 1);
      spegniFilo(seg);
    },

    // Comincia la risposta: il filo si arrotola.
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
        // Finita l'animazione il tetto si toglie: se no, aprire una sezione
        // dopo aver srotolato la taglierebbe a metà.
        if (v) setTimeout(function () { if (!chiuso) righe.style.maxHeight = 'none'; }, 460);
      }
      mostra(false);
      capo.addEventListener('click', function () { mostra(chiuso); });
    },

    ferma: function () { vivo = false; },
  };

  // il filo corto accanto alla riga viva (modalità orizzontale)
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
async function gioca() {
  if (bloccoVivo) bloccoVivo.ferma();
  var mio = corsa = {};
  leggiOpzioni();
  var host = document.getElementById('blocco');
  host.textContent = '';
  var risposta = document.getElementById('risposta');
  risposta.textContent = '';

  var b = creaBlocco(host);
  bloccoVivo = b;
  var righe = costruisciRighe();
  var inizio = Date.now();

  await attendi(700);
  if (corsa !== mio) return;

  for (var i = 0; i < righe.length; i++) {
    var desc = righe[i];
    var seg = b.apriRiga(desc);
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

    if (desc.azione) {
      b.parteAzione(seg);
      var ta = Date.now();
      await attendi(desc.azione.ms);
      if (corsa !== mio) return;
      b.finisceAzione(seg, Date.now() - ta);
    } else if (desc.titoloPensiero) {
      b.annodaPensiero(seg, Date.now() - t);
    } else {
      b.lasciaAperto(seg);
    }
    await attendi(260);
    if (corsa !== mio) return;
  }

  b.chiudi('Ha cercato sul web, letto una pagina e confrontato i prezzi', Date.now() - inizio);
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
  filo:   { filo: 'verticale', nodi: 'unito',  ragionamento: 'trama',    nodo: 'dettaglio', fine: 'arrotola' },
  cinque: { filo: 'rotella',   nodi: 'diviso', ragionamento: 'trama',    nodo: 'due',       fine: 'resta' },
  oggi:   { filo: 'rotella',   nodi: 'diviso', ragionamento: 'parziale', nodo: 'dettaglio', fine: 'resta' },
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
