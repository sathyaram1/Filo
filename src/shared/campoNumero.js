// Una manopola numerica: il campo, il controllo sul numero, il salvataggio e
// il «rimetti com'era». Nato per le sette manopole dei crediti nella pagina
// dell'owner (#652), dove riscriverle sette volte sarebbe stato sette volte lo
// stesso bug.
//
// Due metà, separate apposta:
//   - `leggi` e `frase` sono logica pura (nessun DOM): dicono se un numero va
//     bene e, se no, lo spiegano con parole di Filo. Gli unit test caricano
//     solo queste;
//   - `collega` cuce insieme campo, pulsanti e riga d'esito.
//
// Due regole che vengono da bug veri, altrove nel repo:
//   - i limiti li passa chi collega, non li scrive l'HTML: scritti in due
//     posti divergono e vince quello sbagliato;
//   - dopo un salvataggio il campo si riscrive con quello che il server
//     RISPONDE, non con quello che l'utente aveva digitato: se il server
//     arrotonda o rifiuta in parte, la pagina non deve mentire.

(function (global) {
  'use strict';

  // Perché un numero non va bene. Sono codici, non frasi: la frase la compone
  // `frase`, che sa anche l'etichetta e i limiti.
  const MOTIVI = Object.freeze({
    VUOTO: 'vuoto',
    NON_NUMERO: 'nonNumero',
    NON_INTERO: 'nonIntero',
    SOTTO: 'sotto',
    SOPRA: 'sopra',
  });

  /**
   * Il numero scritto in un campo, o il motivo per cui non è un numero buono.
   * `regole`: { min, max, intero } — `min`/`max` inclusi, `intero` vero di
   * default (i crediti non hanno decimali).
   * @returns {{ok:true, valore:number}|{ok:false, motivo:string}}
   */
  function leggi(raw, regole) {
    const r = regole && typeof regole === 'object' ? regole : {};
    const intero = r.intero !== false;
    const min = r.min == null ? null : Number(r.min);
    const max = r.max == null ? null : Number(r.max);
    const testo = String(raw == null ? '' : raw).trim();
    if (!testo) return { ok: false, motivo: MOTIVI.VUOTO };
    // La virgola è come si scrivono i decimali in italiano: si legge come un
    // punto invece di buttarla via (1,5 non è 15). Un decimale dove serve un
    // intero viene rifiutato dopo, con la frase giusta.
    const n = Number(testo.replace(',', '.'));
    if (!Number.isFinite(n)) return { ok: false, motivo: MOTIVI.NON_NUMERO };
    if (intero && !Number.isInteger(n)) return { ok: false, motivo: MOTIVI.NON_INTERO };
    if (min != null && n < min) return { ok: false, motivo: MOTIVI.SOTTO };
    if (max != null && n > max) return { ok: false, motivo: MOTIVI.SOPRA };
    return { ok: true, valore: n };
  }

  function numeroLeggibile(n) {
    try { return new Intl.NumberFormat('it-IT').format(n); } catch (_) { return String(n); }
  }

  /**
   * La frase da mostrare per un motivo di rifiuto. `regole` può portare
   * `etichetta` (come si chiama la manopola nella pagina), `min`, `max`,
   * `intero`.
   */
  function frase(motivo, regole) {
    const r = regole && typeof regole === 'object' ? regole : {};
    const nome = String(r.etichetta || '').trim();
    const capo = nome ? `${nome}: ` : '';
    const min = r.min == null ? null : Number(r.min);
    const max = r.max == null ? null : Number(r.max);
    switch (motivo) {
      case MOTIVI.VUOTO:
        return `${capo}scrivi un numero.`;
      case MOTIVI.NON_NUMERO:
        return `${capo}ci vuole un numero.`;
      case MOTIVI.NON_INTERO:
        return `${capo}un numero intero, senza virgola.`;
      case MOTIVI.SOTTO:
        if (min === 0) return `${capo}non può essere negativo.`;
        return `${capo}almeno ${numeroLeggibile(min)}.`;
      case MOTIVI.SOPRA:
        return `${capo}al massimo ${numeroLeggibile(max)}.`;
      default:
        return `${capo}questo numero non va bene.`;
    }
  }

  /**
   * Legge e, se il numero non va, dà già la frase pronta.
   * @returns {{ok:true, valore:number}|{ok:false, motivo:string, testo:string}}
   */
  function controlla(raw, regole) {
    const esito = leggi(raw, regole);
    if (esito.ok) return esito;
    return { ok: false, motivo: esito.motivo, testo: frase(esito.motivo, regole) };
  }

  /**
   * Come `controlla`, ma su un campo `<input type="number">`. Ci vuole una
   * funzione a parte perché un campo numerico che contiene qualcosa che numero
   * non è («ciao», «1..2») risponde `value === ''`: letto com'è sembrerebbe un
   * campo VUOTO, e la frase sarebbe quella sbagliata. Il browser lo dice in
   * `validity.badInput`.
   */
  function controllaCampo(input, regole) {
    if (input && input.validity && input.validity.badInput) {
      return { ok: false, motivo: MOTIVI.NON_NUMERO, testo: frase(MOTIVI.NON_NUMERO, regole) };
    }
    return controlla(input ? input.value : '', regole);
  }

  // ── La parte con il DOM ────────────────────────────────────────────────────

  /**
   * Cuce campo, pulsante «Salva», pulsante «Rimetti com'era» e riga d'esito.
   *
   * `salva(valore)` deve tornare `{ ok, valore?, errore? }`: `valore` è quello
   * che il server ha davvero adesso (si riscrive nel campo), `errore` la
   * spiegazione da mostrare.
   *
   * «Rimetti com'era» torna sempre allo stato precedente all'ULTIMA modifica:
   * se hai solo digitato, rimette il valore del server; se hai già salvato,
   * risalva il valore di prima. Compare solo quando c'è qualcosa da disfare.
   */
  function collega(opzioni) {
    const o = opzioni || {};
    const { input, salva, rimetti, msg, regole, onSalva } = o;
    if (!input) throw new Error('campoNumero: serve il campo');
    const reg = regole && typeof regole === 'object' ? regole : {};

    // Il valore che il server ha adesso (come testo, così «0» non diventa '').
    let attuale = '';
    // Il valore di prima dell'ultima modifica salvata, o null se non c'è
    // niente da disfare.
    let precedente = null;
    let inCorso = false;

    // I limiti li sa solo chi collega: scriverli anche nell'HTML li fa
    // divergere. Servono al passo delle frecce e ai lettori di schermo, non
    // alla validazione (quella la fa `leggi`).
    if (reg.min != null) input.min = String(reg.min);
    if (reg.max != null) input.max = String(reg.max);
    if (reg.intero !== false) input.step = '1';

    function dillo(testo, classe) {
      if (!msg) return;
      msg.textContent = testo || '';
      msg.hidden = !testo;
      msg.classList.remove('is-ok', 'is-error');
      if (testo && classe) msg.classList.add(classe);
    }

    // Il campo mostra qualcosa di diverso da quello che il server ha: finché
    // dura, si vede. Un numero che sembra in vigore e non lo è è peggio di un
    // numero sbagliato.
    function aggiornaSporco() {
      const sporco = String(input.value) !== attuale;
      const scatola = input.closest ? input.closest('.sn-manopola') : null;
      if (scatola) scatola.classList.toggle('is-sporco', sporco);
      return sporco;
    }

    // «Rimetti com'era» disfa un SALVATAGGIO. Mentre si digita non c'è ancora
    // niente da disfare, e mostrarlo lì prometteva di riportare indietro una
    // cosa che non era successa.
    function aggiornaRimetti() {
      aggiornaSporco();
      if (!rimetti) return;
      rimetti.hidden = precedente == null;
      rimetti.title = 'Rimetti il valore di prima del salvataggio';
    }

    // Scrive nel campo il valore che il server ha adesso. `daCapo` azzera
    // anche la memoria del «rimetti com'era»: è il caso della prima lettura.
    function mostra(valore, { daCapo = false } = {}) {
      attuale = valore == null || valore === '' ? '' : String(valore);
      input.value = attuale;
      if (daCapo) precedente = null;
      aggiornaRimetti();
    }

    async function scrivi(valore, { comeRipristino = false } = {}) {
      if (inCorso) return;
      inCorso = true;
      const prima = attuale;
      if (o.salvaBtn) o.salvaBtn.disabled = true;
      if (rimetti) rimetti.disabled = true;
      dillo('Salvo…', null);
      let r = null;
      try {
        r = await salva(valore);
      } catch (e) {
        r = { ok: false, errore: (e && e.message) || String(e) };
      }
      inCorso = false;
      if (o.salvaBtn) o.salvaBtn.disabled = false;
      if (rimetti) rimetti.disabled = false;
      if (!r || !r.ok) {
        dillo(`Non salvato: ${(r && r.errore) || 'il server non ha risposto'}.`, 'is-error');
        aggiornaRimetti();
        return;
      }
      // Il campo mostra quello che il server ha, non quello che era stato
      // digitato.
      mostra(r.valore == null ? valore : r.valore);
      // Se prima non c'era niente sul server, non c'è un «com'era» a cui
      // tornare: rimetterlo vorrebbe dire scrivere uno zero che nessuno ha mai
      // messo.
      precedente = (comeRipristino || prima === '') ? null : prima;
      aggiornaRimetti();
      dillo(comeRipristino ? 'Rimesso com’era.' : 'Salvato.', 'is-ok');
      if (typeof onSalva === 'function') { try { onSalva(); } catch (_) {} }
    }

    async function salvaOra() {
      const esito = controllaCampo(input, reg);
      if (!esito.ok) {
        dillo(esito.testo, 'is-error');
        try { input.focus(); input.select(); } catch (_) {}
        return;
      }
      if (String(esito.valore) === attuale) {
        dillo('È già così.', 'is-ok');
        return;
      }
      await scrivi(esito.valore);
    }

    function rimettiOra() {
      if (String(input.value) !== attuale) {
        // Solo digitato: basta rimettere il campo com'è sul server.
        input.value = attuale;
        aggiornaRimetti();
        dillo('Rimesso com’era.', 'is-ok');
        try { input.focus(); } catch (_) {}
        return Promise.resolve();
      }
      if (precedente == null) return Promise.resolve();
      return scrivi(Number(precedente), { comeRipristino: true });
    }

    input.addEventListener('input', () => {
      dillo('', null);
      aggiornaRimetti();
    });
    // Invio dentro il campo salva: è quello che fa chiunque dopo aver scritto
    // un numero, e senza sarebbe l'unica strada che non funziona.
    input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      salvaOra().catch(() => {});
    });
    if (o.salvaBtn) o.salvaBtn.addEventListener('click', () => { salvaOra().catch(() => {}); });
    if (rimetti) {
      rimetti.hidden = true;
      rimetti.addEventListener('click', () => { rimettiOra().catch(() => {}); });
    }

    // `pulito`: il campo mostra quello che c'è sul server. `disfabile`: c'è un
    // salvataggio da poter rimettere com'era. Chi rilegge i valori dal server
    // li guarda prima di riscrivere un campo sotto le dita di chi lo sta usando.
    function stato() {
      return { pulito: String(input.value) === attuale, disfabile: precedente != null };
    }

    return { mostra, salvaOra, rimettiOra, dillo, stato };
  }

  global.SN_CAMPO_NUMERO = { MOTIVI, leggi, frase, controlla, controllaCampo, collega };
})(typeof globalThis !== 'undefined' ? globalThis : this);
