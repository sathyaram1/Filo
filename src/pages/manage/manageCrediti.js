// Scheda Routine → Crediti di Gestione (#1356, SPEC-DOMANDE.md §8.2): riserva di A, tetto di B, taratura e rinnovi,
// letti e scritti attraverso il main (ownerCrediti), solo da owner. Regole: src/shared/routineCrediti.js.
// Prove: tests/manage-crediti.spec.mjs.

(function () {
  'use strict';

  const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
  const GET = MSG.ROUTINE_CREDITI_GET || 'routine_crediti_get';
  const SET = MSG.ROUTINE_CREDITI_SET || 'routine_crediti_set';
  const RC = window.SN_ROUTINE_CREDITI;
  const $ = (id) => document.getElementById(id);
  const root = $('mgCrRoot');
  if (!root || !RC) return;

  const ID = { riservaA: 'mgCrRiservaA', tettoB: 'mgCrTettoB', usdPer100: 'mgCrTaratura', rinnovoA: 'mgCrRinnovoA', rinnovoB: 'mgCrRinnovoB' };
  const TOLTO = {
    riservaA: 'Tolta: nessuna riserva su A.',
    tettoB: 'Tolto: nessun tetto su B.',
    usdPer100: 'Tolta: vale quella predefinita, 2.150 $.',
    rinnovoA: 'Tolto: vale martedì alle 19.',
    rinnovoB: 'Tolto: vale mercoledì alle 9.',
  };
  const NON_LETTO = 'Non ho potuto leggere dal server: quello che vedi qui non viene da lì.';
  const SENZA_FRENI = 'Senza riserva di A né tetto di B i crediti non frenano le routine: niente riserva, niente passo del giorno, priorità basse sempre aperte.';

  const campi = {};
  for (const [k, id] of Object.entries(ID)) {
    campi[k] = { input: $(id), salva: $(`${id}Save`), msg: $(`${id}Msg`), inScrittura: false, esito: { testo: '', tipo: null } };
  }
  const righe = { A: $('mgCrRigaA'), B: $('mgCrRigaB') };
  const avviso = $('mgCrAvviso');

  let owner = false;
  // null = non letti: i campi restano vuoti e lo dicono, invece di mostrare un valore inventato.
  let numeri = null;
  let accounts = null;
  let freni = '';
  // Una risposta vale solo se è partita dopo l'ultima accolta: una lettura lenta non riscrive una scrittura più nuova.
  let tick = 0;
  let accolto = 0;
  let fila = Promise.resolve();

  // Chiamato a ogni invio: le prove sostituiscono window.filo.message dopo il caricamento.
  function send(m) {
    if (window.filo && window.filo.message) return window.filo.message(m);
    if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) return chrome.runtime.sendMessage(m);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  function valoreDi(k) {
    const v = numeri ? numeri[k] : null;
    if (v === null || v === undefined) return '';
    return RC.RINNOVI.includes(k) ? RC.aOraLocale(v) : String(v).replace('.', ',');
  }

  // Un campo mai letto lo dice sempre, anche accanto a un fallimento; tace solo davanti a un esito riuscito o in corso.
  function mostraEsito(k) {
    const c = campi[k];
    if (!c.msg) return;
    const avvisa = owner && numeri === null && (!c.esito.testo || c.esito.tipo === 'err');
    c.msg.textContent = avvisa ? [c.esito.testo, NON_LETTO].filter(Boolean).join(' ') : c.esito.testo;
    c.msg.classList.toggle('mg-ok', !avvisa && c.esito.tipo === 'ok');
    c.msg.classList.toggle('mg-err', avvisa || c.esito.tipo === 'err');
  }

  function esito(k, testo, tipo) {
    campi[k].esito = { testo: testo || '', tipo: tipo || null };
    mostraEsito(k);
  }

  function rifletti() {
    for (const [k, c] of Object.entries(campi)) {
      if (!c.input) continue;
      c.input.disabled = !owner;
      if (c.salva) c.salva.disabled = !owner;
      if (!c.inScrittura) c.input.value = valoreDi(k);
      mostraEsito(k);
    }
    for (const [a, el] of Object.entries(righe)) {
      if (!el) continue;
      if (!owner) el.textContent = a === 'A' ? 'Solo l’owner vede e cambia i crediti delle routine.' : '';
      else el.textContent = accounts && accounts[a] ? RC.rigaAccount(a, accounts[a]) : '–';
    }
    if (avviso) {
      avviso.hidden = !(owner && freni === 'numeri_assenti');
      avviso.textContent = avviso.hidden ? '' : SENZA_FRENI;
      avviso.classList.toggle('mg-err', !avviso.hidden);
    }
  }

  function accogli(r, nato) {
    if (nato < accolto) return false;
    accolto = nato;
    numeri = RC.leggiNumeri(r.numeri);
    if (r.accounts && typeof r.accounts === 'object') accounts = r.accounts;
    if (typeof r.freni === 'string') freni = r.freni;
    return true;
  }

  async function carica() {
    try {
      const a = await send({ type: 'auth_status' });
      owner = !!(a && a.isAdmin);
    } catch (_) { owner = false; }
    if (!owner) {
      numeri = null; accounts = null; freni = '';
      rifletti();
      return;
    }
    const nato = ++tick;
    let r = null;
    try { r = await send({ type: GET }); } catch (_) { /* come una lettura fallita */ }
    if (nato < accolto) return;
    if (!r || !r.ok) {
      accolto = nato;
      numeri = null; accounts = null; freni = '';
      if (r && r.error) console.error('[manage] crediti delle routine non letti:', r.error);
    } else {
      accogli(r, nato);
    }
    rifletti();
  }

  // Si salva solo il campo toccato. Vuoto = togli il numero (torna il predefinito).
  function salva(k) {
    const c = campi[k];
    if (!owner || !c.input) return Promise.resolve(false);
    // Un campo data lasciato a metà risponde `value === ''`: senza `badInput` si toglierebbe il numero.
    const grezzo = c.input.validity && c.input.validity.badInput ? 'non valido' : c.input.value;
    const v = RC.valida({ [k]: grezzo });
    if (!v.ok) { esito(k, v.testo, 'err'); return Promise.resolve(false); }
    c.inScrittura = false;
    const inviato = c.input.value;
    esito(k, 'Salvo…', null);
    const corsa = fila.then(async () => {
      const nato = ++tick;
      let r = null;
      try { r = await send(Object.assign({ type: SET }, v.valori)); } catch (err) { r = { ok: false, error: String((err && err.message) || err) }; }
      if (!r || !r.ok) {
        // Non scritto = non cambiato: il campo torna a quello che c'è sul server.
        rifletti();
        esito(k, `Salvataggio non riuscito: il numero NON è cambiato.${r && r.error ? ` ${r.error}` : ''}`, 'err');
        return false;
      }
      accogli(r, nato);
      rifletti();
      // «Salvato.» parla del valore che si vede: non accanto a un numero riscritto dopo Salva.
      if (!c.inScrittura || c.input.value === inviato) esito(k, v.valori[k] === null ? TOLTO[k] : 'Salvato.', 'ok');
      return true;
    });
    fila = corsa.catch(() => false);
    return corsa;
  }

  for (const [k, c] of Object.entries(campi)) {
    if (!c.input) continue;
    if (c.salva) c.salva.addEventListener('click', () => { salva(k); });
    c.input.addEventListener('input', () => {
      c.inScrittura = true;
      esito(k, '', null);
    });
    c.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || c.input.disabled) return;
      e.preventDefault();
      salva(k);
    });
    // Tasto destro: togliere il numero e rileggere, le stesse cose della pagina.
    const blocco = c.input.closest('.mg-cr-campo');
    if (blocco) {
      blocco.addEventListener('contextmenu', (e) => {
        const menu = window.SN_MANAGE_MENU;
        if (!menu || !owner) return;
        e.preventDefault();
        const voci = [];
        if (numeri && numeri[k] !== null) {
          voci.push({ testo: 'Togli il numero', titolo: 'Torna al valore predefinito', azione: () => { c.input.value = ''; salva(k); } });
        }
        if (c.inScrittura) voci.push({ testo: 'Rimetti com’era', azione: () => { c.inScrittura = false; esito(k, '', null); rifletti(); } });
        voci.push({ testo: 'Rileggi dal server', titolo: 'Se l’hai cambiato da un’altra installazione', azione: () => { carica(); } });
        menu.apri(e.clientX, e.clientY, voci);
      });
    }
  }
  for (const el of Object.values(righe)) {
    if (!el) continue;
    el.addEventListener('contextmenu', (e) => {
      const menu = window.SN_MANAGE_MENU;
      if (!menu || !owner) return;
      e.preventDefault();
      menu.apri(e.clientX, e.clientY, [{ testo: 'Rileggi dal server', azione: () => { carica(); } }]);
    });
  }

  // Si rilegge a ogni apertura della scheda (i numeri cambiano a ogni battito), e quando chi guarda entra o esce.
  document.addEventListener('mg-scheda', (e) => { if (e.detail && e.detail.tab === 'crediti') carica(); });
  if (window.filo && window.filo.onBroadcast) {
    window.filo.onBroadcast((m) => { if (m && m.type === (MSG.AUTH_CHANGED || 'auth_changed')) carica(); });
  }

  window.__mgCrediti = { carica, salva };
  rifletti();
  // Aperta direttamente sui Crediti (scheda ricordata), la scheda può essersi mostrata prima di questo file.
  if (document.querySelector('.mg-tab[data-tab="crediti"].mg-tab--active')) carica();
})();
