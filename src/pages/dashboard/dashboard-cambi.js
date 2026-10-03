// Il segno sulla bolla dell'utente quando il suo messaggio ha cambiato lo stato di Filo (#867): al
// passaggio del mouse dice in parole cosa è cambiato e offre «annulla». Lo stato vero dei cambi lo
// tiene il main (src/main/services/registroCambi.js): qui solo il disegno. Non tocca il DOM al caricamento.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;
  let send = async () => null;
  const segni = new Set();

  function bollaUtenteDi(el) {
    for (let n = el; n; n = n.previousElementSibling) {
      if (n.classList && n.classList.contains('dash-bubble-user')) return n;
    }
    return null;
  }

  function icona(nome, size = 11) {
    const I = global.SN_ICONS;
    return I && typeof I[nome] === 'function' ? I[nome](size) : '';
  }

  // Sopra la bolla, o sotto quando sopra non c'è posto nell'area che scorre.
  function posiziona(s) {
    const area = s.bolla.parentElement;
    if (!area) return;
    const spazio = s.bolla.getBoundingClientRect().top - area.getBoundingClientRect().top;
    s.bolla.classList.toggle('dash-cambi-sotto', spazio < s.pop.offsetHeight + 16);
  }

  function crea(bolla) {
    bolla.dataset.cambiTesto = bolla.textContent;
    bolla.classList.add('dash-bubble-cambi');
    const segno = document.createElement('button');
    segno.type = 'button';
    segno.className = 'dash-cambi-segno';
    segno.innerHTML = icona('check');
    const pop = document.createElement('div');
    pop.className = 'dash-cambi-pop';
    bolla.append(segno, pop);
    const s = { bolla, segno, pop, ids: [], viste: new Map() };
    bolla.addEventListener('mouseenter', () => posiziona(s));
    segno.addEventListener('focus', () => posiziona(s));
    // Al tocco e da tastiera il segno apre e chiude: il passaggio del mouse lì non c'è.
    segno.addEventListener('click', (e) => {
      e.stopPropagation();
      posiziona(s);
      bolla.classList.toggle('dash-cambi-aperto');
    });
    segni.add(s);
    return s;
  }

  function riga(s, v) {
    const r = document.createElement('div');
    r.className = 'dash-cambi-riga';
    r.dataset.id = v.id;
    const testo = document.createElement('span');
    testo.className = 'dash-cambi-frase';
    const frase = (v.frasi && v.frasi.length) ? v.frasi.join('; ') : 'era già così';
    testo.textContent = v.annulla ? `rimesso com'era · ${frase}` : frase;
    r.appendChild(testo);
    if (v.annullatoDa) {
      r.classList.add('dash-cambi-annullato');
      const stato = document.createElement('span');
      stato.className = 'dash-cambi-stato';
      stato.textContent = 'annullato';
      r.appendChild(stato);
      r.appendChild(bottone(s, 'rifai', 'Rimetti questo cambio', v.annullatoDa));
    } else if (v.annullabile) {
      r.appendChild(bottone(s, 'annulla', 'Rimetti com\'era prima', v.id));
    } else if (!v.annulla) {
      const stato = document.createElement('span');
      stato.className = 'dash-cambi-stato';
      stato.textContent = 'non si annulla';
      stato.title = 'Il valore di prima è un segreto: Filo non lo conserva';
      r.appendChild(stato);
    }
    return r;
  }

  function bottone(s, testo, titolo, id) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dash-cambi-annulla';
    b.textContent = testo;
    b.title = titolo;
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      b.classList.add('dash-cambi-in-corso');
      const r = await send({ type: MSG.CAMBI_ANNULLA, id });
      if (!r || !r.ok) {
        b.disabled = false;
        b.classList.remove('dash-cambi-in-corso');
        b.textContent = 'non riuscito';
        b.title = (r && r.error) ? `Non riuscito: ${r.error}` : 'Non riuscito';
        setTimeout(() => { if (b.isConnected) { b.textContent = testo; b.title = titolo; } }, 2500);
        return;
      }
      await aggiorna([s]);
    });
    return b;
  }

  function disegna(s) {
    const viste = s.ids.map((id) => s.viste.get(id)).filter(Boolean);
    s.pop.replaceChildren(...viste.map((v) => riga(s, v)));
    // Il segno dice a colpo d'occhio se i cambi sono ancora in piedi.
    const tutti = viste.length > 0 && viste.every((v) => v.annullatoDa);
    s.segno.classList.toggle('dash-cambi-tutti-annullati', tutti);
    s.segno.innerHTML = icona(tutti ? 'undo' : 'check');
    const detto = viste.map((v) => (v.frasi || []).join('; ')).filter(Boolean).join('; ');
    s.segno.setAttribute('aria-label', `${tutti ? 'Cambi annullati' : 'Cambi fatti'}${detto ? `: ${detto}` : ''}`);
    s.bolla.classList.toggle('dash-cambi-vuoto', !viste.length);
  }

  async function aggiorna(lista = [...segni]) {
    const vivi = lista.filter((s) => s.bolla.isConnected);
    for (const s of lista) if (!s.bolla.isConnected) segni.delete(s);
    const ids = [...new Set(vivi.flatMap((s) => s.ids))];
    if (!ids.length) return;
    const r = await send({ type: MSG.CAMBI_LEGGI, ids });
    const per = new Map(((r && r.ok && r.eventi) || []).map((v) => [v.id, v]));
    for (const s of vivi) {
      for (const id of s.ids) if (per.has(id)) s.viste.set(id, per.get(id));
      disegna(s);
    }
  }

  // `daQui`: la bolla dell'utente, o un elemento che le sta sotto (il blocco di attività del turno).
  // `cambi`: gli id, o le voci { id, frase } che il main manda con l'azione.
  function segna(daQui, cambi) {
    const bolla = bollaUtenteDi(daQui);
    const voci = (Array.isArray(cambi) ? cambi : []).map((c) => (typeof c === 'string' ? { id: c } : c)).filter((c) => c && c.id);
    if (!bolla || !voci.length) return;
    let s = null;
    for (const x of segni) if (x.bolla === bolla) s = x;
    if (!s) s = crea(bolla);
    for (const c of voci) {
      if (s.ids.includes(c.id)) continue;
      s.ids.push(c.id);
      // Subito la frase arrivata con l'azione; lo stato preciso arriva dal main un attimo dopo.
      if (c.frase && !s.viste.has(c.id)) s.viste.set(c.id, { id: c.id, frasi: [c.frase], annullabile: true });
    }
    disegna(s);
    aggiorna([s]).catch(() => {});
  }

  // Una conversazione ridisegnata da capo (l'intervista di benvenuto si riallinea a ogni turno) rifà
  // le bolle: i segni si riprendono dalla bolla con lo stesso testo, contata nello stesso ordine.
  function bolleUtente(area) {
    return [...area.querySelectorAll('.dash-bubble-user')];
  }
  function testoDi(bolla) {
    return bolla.dataset.cambiTesto != null ? bolla.dataset.cambiTesto : bolla.textContent;
  }
  function fotografa(area) {
    const bolle = bolleUtente(area);
    return [...segni].filter((s) => area.contains(s.bolla)).map((s) => {
      const testo = testoDi(s.bolla);
      const n = bolle.filter((b) => testoDi(b) === testo).indexOf(s.bolla);
      return { testo, n, ids: s.ids.slice() };
    });
  }
  function rimetti(area, foto) {
    const bolle = bolleUtente(area);
    for (const f of Array.isArray(foto) ? foto : []) {
      const b = bolle.filter((x) => testoDi(x) === f.testo)[f.n];
      if (b) segna(b, f.ids);
    }
  }

  let attesa = null;
  function init(deps) {
    if (deps && deps.send) send = deps.send;
    try {
      global.chrome.runtime.onMessage.addListener((m) => {
        if (!m || m.type !== MSG.CAMBI_AGGIORNATI || !segni.size) return;
        clearTimeout(attesa);
        attesa = setTimeout(() => { aggiorna().catch(() => {}); }, 80);
      });
    } catch (_) {}
    // Fuori dalla bolla il segno aperto col tocco si richiude.
    document.addEventListener('click', (e) => {
      for (const s of segni) {
        if (!s.bolla.contains(e.target)) s.bolla.classList.remove('dash-cambi-aperto');
      }
    });
  }

  global.SN_DASH_CAMBI = { init, segna, aggiorna, fotografa, rimetti };
})(typeof globalThis !== 'undefined' ? globalThis : window);
