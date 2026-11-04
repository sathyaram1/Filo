// Gestione → Automazioni e Routine → Log: gli strumenti dell'owner che vivevano solo da terminale col token admin
// (#1926): parole d'ordine, domanda di fine sessione, ordine del manutentore, storico dei giri. Solo owner, attraverso
// il main; regole in src/shared (routineChiavi, routineChiusura, manutentoreOrdine, storicoGiri). Testo del server
// solo come textContent. Prove: tests/manage-strumenti.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const T = {
    chiavi: MSG.ROUTINE_CHIAVI_ELENCO || 'routine_chiavi_elenco',
    crea: MSG.ROUTINE_CHIAVE_CREA || 'routine_chiave_crea',
    revoca: MSG.ROUTINE_CHIAVE_REVOCA || 'routine_chiave_revoca',
    imposta: MSG.ROUTINE_CHIAVE_IMPOSTA || 'routine_chiave_imposta',
    chiusura: MSG.ROUTINE_CHIUSURA_GET || 'routine_chiusura_get',
    chiusuraSet: MSG.ROUTINE_CHIUSURA_SET || 'routine_chiusura_set',
    ordine: MSG.MANUTENTORE_ORDINE_SET || 'manutentore_ordine_set',
    recap: MSG.MANUTENTORE_RECAP_GET || 'manutentore_recap_get',
    giri: MSG.STORICO_GIRI_GET || 'storico_giri_get',
  };
  const CH = window.SN_ROUTINE_CHIAVI;
  const CU = window.SN_ROUTINE_CHIUSURA;
  const OR = window.SN_MANUTENTORE_ORDINE;
  const SG = window.SN_STORICO_GIRI;
  const $ = (id) => document.getElementById(id);
  const radice = $('mgAccessi');
  const giriRadice = $('mgGiri');
  if (!radice || !CH || !CU || !OR) return;

  let owner = false;
  let chiavi = [];
  let revocaInAttesa = '';
  let revocaTimer = null;
  let tick = 0;

  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }
  async function chiedi(m) {
    try { return (await send(m)) || { ok: false, error: 'nessuna risposta' }; } catch (e) { return { ok: false, error: (e && e.message) || 'canale giù' }; }
  }
  function el(tag, cls, testo) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (testo !== undefined) n.textContent = testo;
    return n;
  }
  function esito(nodo, testo, tipo) {
    if (!nodo) return;
    nodo.textContent = testo || '';
    nodo.classList.toggle('is-ok', tipo === 'ok');
    nodo.classList.toggle('is-error', tipo === 'err');
  }
  const FMT = new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  function quando(v) {
    const ms = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(ms) ? FMT.format(new Date(ms)) : '';
  }
  function copia(testo, nodo, fatto) {
    const p = navigator.clipboard ? navigator.clipboard.writeText(testo) : Promise.reject(new Error('appunti'));
    p.then(() => esito(nodo, fatto, 'ok'), () => esito(nodo, 'Non riesco a copiare: selezionala e copiala a mano.', 'err'));
  }
  function menu(e, voci) {
    const m = window.SN_MANAGE_MENU;
    if (!m || !voci.length) return;
    e.preventDefault();
    m.apri(e.clientX, e.clientY, voci);
  }

  // ── Parole d'ordine ────────────────────────────────────────────────────────────────────────────────────────────
  const lista = $('mgChiaviLista');
  const stato = $('mgChiaviStato');
  const form = $('mgChiaveNuova');
  const nome = $('mgChiaveNome');
  const potere = $('mgChiavePotere');
  const descr = $('mgChiaveDescr');
  const crea = $('mgChiaveCrea');
  const creaMsg = $('mgChiaveMsg');
  const nata = $('mgChiaveNata');

  for (const p of CH.POTERI) {
    const o = el('option', '', CH.NOMI[p] || p);
    o.value = p;
    potere.appendChild(o);
  }

  function rigaChiave(k) {
    const li = el('li', 'mg-ac-riga');
    li.dataset.slug = k.slug;
    li.dataset.revocata = k.revoked ? 'true' : 'false';
    li.appendChild(el('span', 'mg-ac-nome', k.slug));
    const info = [CH.NOMI[k.scope] || k.scope || 'potere sconosciuto'];
    if (k.revoked) info.push('revocata');
    else if (k.lastUsedAt) info.push(`ultimo uso ${quando(k.lastUsedAt)}`);
    else info.push('mai usata');
    if (k.label) info.push(k.label);
    li.appendChild(el('span', 'mg-ac-info', info.join(' · ')));
    if (k.revoked) return li;
    const azioni = el('span', 'mg-ac-azioni');
    if (k.scope === 'routine') {
      for (const op of Object.keys(CH.IMPOSTAZIONI)) {
        const regola = CH.IMPOSTAZIONI[op];
        const sel = el('select', 'mg-ac-imposta');
        sel.dataset.op = op;
        sel.title = regola.etichetta;
        sel.setAttribute('aria-label', `${regola.etichetta} di ${k.slug}`);
        const attuale = CH.valoreDi(k, op);
        if (!attuale) {
          const o = el('option', '', `${regola.etichetta}: nessuno`);
          o.value = '';
          o.disabled = true;
          sel.appendChild(o);
        }
        for (const v of regola.valori) {
          const o = el('option', '', `${regola.etichetta}: ${v}`);
          o.value = v;
          sel.appendChild(o);
        }
        sel.value = attuale;
        azioni.appendChild(sel);
      }
    }
    const b = el('button', 'sn-btn sn-btn-secondary mg-ac-revoca', revocaInAttesa === k.slug ? 'Confermi?' : 'Revoca');
    b.type = 'button';
    b.title = revocaInAttesa === k.slug ? 'Clicca di nuovo: da adesso non apre più niente' : 'Spegnila: chi la usa non apre più niente';
    azioni.appendChild(b);
    li.appendChild(azioni);
    return li;
  }

  function disegnaChiavi() {
    lista.textContent = '';
    for (const k of chiavi) lista.appendChild(rigaChiave(k));
  }

  async function caricaChiavi() {
    const nato = ++tick;
    esito(stato, 'Leggo le parole d’ordine…');
    const r = await chiedi({ type: T.chiavi });
    if (nato !== tick) return;
    if (!r.ok) { esito(stato, `Non ho potuto leggere le parole d’ordine: ${r.error}`, 'err'); return; }
    chiavi = Array.isArray(r.keys) ? r.keys : [];
    esito(stato, chiavi.length ? '' : 'Nessuna parola d’ordine: creane una qui sotto.');
    disegnaChiavi();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = CH.validaNuova({ slug: nome.value, scope: potere.value, label: descr.value });
    if (!v.ok) { esito(creaMsg, v.testo, 'err'); nome.focus(); return; }
    if (chiavi.some((k) => k.slug === v.dati.slug && !k.revoked)) {
      esito(creaMsg, `«${v.dati.slug}» c’è già: revocala prima, o scegli un altro nome.`, 'err');
      return;
    }
    crea.disabled = true;
    esito(creaMsg, 'Creo…');
    const r = await chiedi(Object.assign({ type: T.crea }, v.dati));
    crea.disabled = false;
    if (!r.ok) { esito(creaMsg, `Non riuscito: ${r.error}`, 'err'); return; }
    esito(creaMsg, '');
    nome.value = '';
    descr.value = '';
    $('mgChiaveNataTitolo').textContent = `La parola d’ordine di «${r.slug}». Copiala adesso: non si potrà più rileggere.`;
    $('mgChiaveParola').textContent = r.passphrase;
    // Le frasi sono scritte anche per il terminale: qui gli a capo li decide la larghezza.
    $('mgChiaveDove').textContent = (CH.DOVE_VA[r.scope] || '').replace(/\n/g, ' ');
    nata.hidden = false;
    caricaChiavi();
  });
  $('mgChiaveCopia').addEventListener('click', () => {
    const p = $('mgChiaveParola').textContent;
    if (p) copia(p, creaMsg, 'Copiata.');
  });
  // Nascosta, la parola non resta nel documento: non la rilegge nessuno, nemmeno chi apre gli strumenti della pagina.
  $('mgChiaveFatto').addEventListener('click', () => {
    $('mgChiaveParola').textContent = '';
    nata.hidden = true;
    esito(creaMsg, '');
  });

  function annullaRevoca() {
    if (revocaTimer) clearTimeout(revocaTimer);
    revocaTimer = null;
    revocaInAttesa = '';
  }
  async function revoca(slug) {
    if (revocaInAttesa !== slug) {
      annullaRevoca();
      revocaInAttesa = slug;
      revocaTimer = setTimeout(() => { annullaRevoca(); disegnaChiavi(); }, 6000);
      disegnaChiavi();
      return;
    }
    annullaRevoca();
    esito(stato, `Revoco «${slug}»…`);
    const r = await chiedi({ type: T.revoca, slug });
    if (!r.ok) { esito(stato, `Non revocata: ${r.error}`, 'err'); disegnaChiavi(); return; }
    await caricaChiavi();
    esito(stato, `«${slug}» revocata: da adesso non apre più niente.`, 'ok');
  }

  lista.addEventListener('click', (e) => {
    const b = e.target.closest('.mg-ac-revoca');
    if (!b) return;
    const li = b.closest('.mg-ac-riga');
    if (li) revoca(li.dataset.slug);
  });
  lista.addEventListener('change', async (e) => {
    const sel = e.target.closest('.mg-ac-imposta');
    if (!sel) return;
    const slug = sel.closest('.mg-ac-riga').dataset.slug;
    const op = sel.dataset.op;
    sel.disabled = true;
    const r = await chiedi({ type: T.imposta, op, slug, valore: sel.value });
    sel.disabled = false;
    if (!r.ok) { esito(stato, `«${slug}»: ${r.error}`, 'err'); disegnaChiavi(); return; }
    const k = chiavi.find((x) => x.slug === slug);
    if (k) k[op] = sel.value;
    esito(stato, `«${slug}»: ${CH.IMPOSTAZIONI[op].etichetta.toLowerCase()} ${sel.value}.`, 'ok');
  });
  lista.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('.mg-ac-riga');
    if (!li) return;
    const k = chiavi.find((x) => x.slug === li.dataset.slug);
    if (!k) return;
    const voci = [{ testo: 'Copia il nome', azione: () => copia(k.slug, stato, `Copiato: ${k.slug}`) }];
    if (!k.revoked) voci.push({ testo: revocaInAttesa === k.slug ? 'Conferma la revoca' : 'Revoca…', azione: () => revoca(k.slug) });
    voci.push({ testo: 'Rileggi dal server', azione: () => caricaChiavi() });
    menu(e, voci);
  });

  // ── Domanda di fine sessione ───────────────────────────────────────────────────────────────────────────────────
  const slotLista = $('mgChiusuraSlot');
  const ripiego = $('mgChiusuraRipiego');
  const chForm = $('mgChiusuraNuova');
  const chSlot = $('mgChiusuraSlotNuovo');
  const chTesto = $('mgChiusuraTesto');
  const chSalva = $('mgChiusuraSalva');
  const chMsg = $('mgChiusuraMsg');
  const risposte = $('mgChiusuraRisposte');
  const chStato = $('mgChiusuraStato');
  let slots = [];
  let voci = [];
  for (const s of CU.SLOT) { const o = el('option'); o.value = s; $('mgChiusuraSlotNomi').appendChild(o); }

  function disegnaChiusura(r) {
    slots = r.slots || [];
    slotLista.textContent = '';
    for (const s of slots) {
      const li = el('li', 'mg-ac-riga');
      li.dataset.slot = s.slot;
      li.appendChild(el('span', 'mg-ac-nome', CU.visibile(s.slot)));
      const az = el('span', 'mg-ac-azioni');
      for (const [testo, fai] of [['Modifica', 'modifica'], ['Togli', 'togli']]) {
        const b = el('button', 'sn-btn sn-btn-secondary', testo);
        b.type = 'button';
        b.dataset.fai = fai;
        az.appendChild(b);
      }
      li.appendChild(az);
      li.appendChild(el('p', 'mg-ac-domanda', CU.visibile(s.testo)));
      slotLista.appendChild(li);
    }
    ripiego.textContent = r.ripiego
      ? `${slots.length ? 'Chi non ha uno slot suo' : 'Nessuna domanda impostata: vale per tutti'} il ripiego: «${CU.visibile(r.ripiego)}»`
      : (slots.length ? '' : 'Nessuna domanda impostata.');
    voci = Array.isArray(r.risposte) ? r.risposte : [];
    risposte.textContent = '';
    for (const v of voci) {
      const li = el('li', 'mg-ac-riga');
      li.appendChild(el('span', 'mg-ac-nome', v.chi));
      li.appendChild(el('span', 'mg-ac-info', [quando(v.t), v.durata].filter(Boolean).join(' · ')));
      li.appendChild(el('p', 'mg-ac-domanda', v.domanda));
      li.appendChild(el('p', 'mg-ac-risposta', v.answered ? (v.risposta || '(vuota)') : '(nessuna risposta)'));
      risposte.appendChild(li);
    }
    esito(chStato, r.erroreRisposte ? `Non ho potuto leggere le risposte: ${r.erroreRisposte}` : (voci.length ? '' : 'Nessuna risposta ancora.'), r.erroreRisposte ? 'err' : '');
  }

  async function caricaChiusura() {
    const r = await chiedi({ type: T.chiusura });
    if (!r.ok) { esito(chStato, `Non ho potuto leggere la domanda di fine sessione: ${r.error}`, 'err'); return; }
    disegnaChiusura(r);
  }

  async function impostaSlot(slot, testo) {
    if (!CU.slotValido(slot)) { esito(chMsg, `«${slot || 'vuoto'}» non è uno slot: ${CU.SLOT.join(', ')} o compito:<ricorrente>.`, 'err'); chSlot.focus(); return false; }
    chSalva.disabled = true;
    esito(chMsg, testo ? 'Imposto…' : 'Tolgo…');
    const r = await chiedi({ type: T.chiusuraSet, slot, testo });
    chSalva.disabled = false;
    if (!r.ok) { esito(chMsg, `Non riuscito: ${r.error}`, 'err'); return false; }
    esito(chMsg, testo ? `Impostata per ${slot}.` : `Tolta per ${slot}: vale il ripiego.`, 'ok');
    await caricaChiusura();
    return true;
  }

  chForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const testo = chTesto.value.trim();
    if (!testo) { esito(chMsg, 'Scrivi la domanda. Per toglierla usa «Togli» sullo slot.', 'err'); chTesto.focus(); return; }
    if (await impostaSlot(chSlot.value.trim(), testo)) chTesto.value = '';
  });
  function modifica(slot) {
    const s = slots.find((x) => x.slot === slot);
    chSlot.value = slot;
    chTesto.value = s ? s.testo : '';
    chTesto.focus();
  }
  slotLista.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fai]');
    if (!b) return;
    const slot = b.closest('.mg-ac-riga').dataset.slot;
    if (b.dataset.fai === 'modifica') modifica(slot); else impostaSlot(slot, '');
  });
  slotLista.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('.mg-ac-riga');
    if (!li) return;
    const s = slots.find((x) => x.slot === li.dataset.slot);
    if (!s) return;
    menu(e, [
      { testo: 'Modifica', azione: () => modifica(s.slot) },
      { testo: 'Copia la domanda', azione: () => copia(s.testo, chMsg, 'Domanda copiata.') },
      { testo: 'Togli', azione: () => impostaSlot(s.slot, '') },
    ]);
  });
  risposte.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('.mg-ac-riga');
    if (!li) return;
    const v = voci[[...risposte.children].indexOf(li)];
    if (!v) return;
    menu(e, [
      { testo: 'Copia la risposta', azione: () => copia(v.risposta, chStato, 'Risposta copiata.') },
      { testo: 'Copia domanda e risposta', azione: () => copia(`${v.chi}\nD: ${v.domanda}\nR: ${v.risposta}`, chStato, 'Copiate.') },
      { testo: 'Rileggi dal server', azione: () => caricaChiusura() },
    ]);
  });

  // ── Ordine del manutentore ─────────────────────────────────────────────────────────────────────────────────────
  const ordForm = $('mgOrdineForm');
  const ordNumeri = $('mgOrdineNumeri');
  const ordSalva = $('mgOrdineSalva');
  const ordMsg = $('mgOrdineMsg');

  async function caricaOrdine() {
    const r = await chiedi({ type: T.recap });
    const o = r.ok && r.stato && Array.isArray(r.stato.ordine) ? r.stato.ordine : null;
    // Un ordine che il server non manda non si inventa: il campo resta com'è, vuoto è «per priorità» solo se letto.
    if (o && document.activeElement !== ordNumeri) ordNumeri.value = o.join(', ');
    ordNumeri.placeholder = o && !o.length ? 'nessun ordine: per priorità' : '812, 815, 815.2';
  }
  ordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const testo = ordNumeri.value.trim();
    let numeri = [];
    if (testo) {
      const v = OR.leggiOrdine(testo);
      if (!v.ok) { esito(ordMsg, v.motivo.charAt(0).toUpperCase() + v.motivo.slice(1), 'err'); ordNumeri.focus(); return; }
      numeri = v.numeri;
    }
    ordSalva.disabled = true;
    esito(ordMsg, 'Salvo…');
    const r = await chiedi({ type: T.ordine, ordine: numeri });
    ordSalva.disabled = false;
    if (!r.ok) { esito(ordMsg, `Non riuscito: ${r.error}`, 'err'); return; }
    const o = Array.isArray(r.ordine) ? r.ordine : numeri;
    ordNumeri.value = o.join(', ');
    esito(ordMsg, o.length ? `Salvato: ${o.length === 1 ? 'si accende prima' : `si accendono prima, in quest’ordine,`} ${o.map((n) => `#${n}`).join(', ')}.` : 'Svuotato: si accende per priorità.', 'ok');
  });

  // ── Storico dei giri ───────────────────────────────────────────────────────────────────────────────────────────
  const giriForm = $('mgGiriForm');
  const giriDa = $('mgGiriDa');
  const giriA = $('mgGiriA');
  const giriMsg = $('mgGiriMsg');
  const giriTot = $('mgGiriTotali');
  const giriLavori = $('mgGiriLavori');
  let giriLetti = false;
  const giornoIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (giriDa && giriA && SG) {
    const oggi = new Date();
    giriA.value = giornoIso(oggi);
    giriDa.value = giornoIso(new Date(oggi.getTime() - SG.FINESTRA_PREDEFINITA));
  }
  function disegnaGiri(r) {
    const lavori = Array.isArray(r.lavori) ? r.lavori : [];
    const t = SG.totali(lavori);
    giriTot.textContent = '';
    const testa = `${t.lavori} ${t.lavori === 1 ? 'lavoro chiuso' : 'lavori chiusi'}, ${t.giri} ${t.giri === 1 ? 'giro' : 'giri'}`
      + (t.nonRegistrati ? ` (più ${t.nonRegistrati} vecchi non registrati)` : '');
    giriTot.appendChild(el('p', 'mg-gi-testa', testa));
    if (r.troncato) giriTot.appendChild(el('p', 'mg-gi-avviso', `Ce ne sono altri oltre questi ${lavori.length}: stringi la finestra per vederli tutti.`));
    if (t.giri) {
      const tab = el('table', 'mg-gi-tabella');
      const th = el('tr');
      for (const c of ['livello', 'trovati', 'esterni', 'corretti', 'giri pagati']) th.appendChild(el('th', '', c));
      tab.appendChild(th);
      for (const n of SG.LIVELLI) {
        const tr = el('tr');
        const p = t.perLivello[n];
        for (const c of [String(n), p.trovati, p.esterni, p.corretti, p.pagati]) tr.appendChild(el('td', '', String(c)));
        tab.appendChild(tr);
      }
      giriTot.appendChild(tab);
      giriTot.appendChild(el('p', 'mg-gi-esiti', `esiti: ${SG.ESITI.map((e) => `${e} ${t.perEsito[e]}`).join(' · ')}${t.senzaEsito ? ` · senza esito ${t.senzaEsito}` : ''}`));
    }
    giriLavori.textContent = '';
    for (const l of lavori) {
      const giri = Array.isArray(l.rounds) ? l.rounds : [];
      const persi = Math.max(0, Number(l.roundsDropped) || 0);
      const li = el('li', 'mg-ac-riga');
      li.appendChild(el('span', 'mg-ac-nome', SG.numeroDi(l)));
      li.appendChild(el('span', 'mg-ac-info', `chiuso ${quando(Number(l.chiusoMs))} · ${giri.length} ${giri.length === 1 ? 'giro' : 'giri'}${persi ? ` (più ${persi} vecchi)` : ''}`));
      giri.forEach((g, i) => {
        li.appendChild(el('p', 'mg-gi-giro', `giro ${persi + i + 1} · ${quando(g.at)} · trovati ${SG.elenco(g.found)} · esterni ${SG.elenco(g.external)}`
          + ` · corretti ${SG.elenco(g.fixed)} · bilancio ${SG.bilancio(g.consumed)} · ${SG.ESITI.includes(g.outcome) ? g.outcome : '?'}`));
      });
      giriLavori.appendChild(li);
    }
  }
  async function caricaGiri() {
    if (!giriForm || !SG) return;
    const da = SG.giornoLocale(giriDa.value);
    const fine = SG.giornoLocale(giriA.value);
    if (!Number.isFinite(da) || !Number.isFinite(fine)) { esito(giriMsg, 'Scegli le due date.', 'err'); return; }
    const a = SG.fineDelGiorno(fine);
    if (a <= da) { esito(giriMsg, 'La fine deve venire dopo l’inizio.', 'err'); return; }
    esito(giriMsg, 'Leggo…');
    $('mgGiriLeggi').disabled = true;
    const r = await chiedi({ type: T.giri, da, a });
    $('mgGiriLeggi').disabled = false;
    if (!r.ok) { esito(giriMsg, `Non ho potuto leggere i giri: ${r.error}`, 'err'); return; }
    giriLetti = true;
    esito(giriMsg, (r.lavori || []).length ? '' : 'Nessun lavoro chiuso in questa finestra.');
    disegnaGiri(r);
  }
  if (giriForm) giriForm.addEventListener('submit', (e) => { e.preventDefault(); caricaGiri(); });

  // ── Accesso e apertura ─────────────────────────────────────────────────────────────────────────────────────────
  async function soloOwner() {
    const a = await chiedi({ type: 'auth_status' });
    owner = !!(a && a.isAdmin);
    radice.hidden = !owner;
    if (giriRadice) giriRadice.hidden = !owner;
    return owner;
  }
  async function apriAutomazioni() {
    if (!(await soloOwner())) return;
    await Promise.all([caricaChiavi(), caricaChiusura(), caricaOrdine()]);
  }
  async function apriLog() {
    if (!(await soloOwner())) return;
    if (!giriLetti) await caricaGiri();
  }

  document.addEventListener('mg-scheda', (e) => {
    const tab = e.detail && e.detail.tab;
    if (tab === 'automation') { apriAutomazioni(); return; }
    // Una parola nata e lasciata a schermo si toglie uscendo: si vede una volta, non a ogni ritorno.
    $('mgChiaveFatto').click();
    if (tab === 'log') apriLog();
  });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => {
      if (!m || m.type !== (MSG.AUTH_CHANGED || 'auth_changed')) return;
      if (document.querySelector('.mg-tab[data-tab="automation"].mg-tab--active')) apriAutomazioni();
      else soloOwner();
    });
  }

  window.__mgStrumenti = { apriAutomazioni, apriLog, caricaGiri };
  if (document.querySelector('.mg-tab[data-tab="automation"].mg-tab--active')) apriAutomazioni();
  else if (document.querySelector('.mg-tab[data-tab="log"].mg-tab--active')) apriLog();
})();
