// Che forma prende un avviso secondo dove sta l'utente (#2390): la regola sola, che la shell chiede per ogni avviso.
// Non disegna niente. Sentinella: tests/unit/formaAvviso.test.mjs.

(function (global) {
  'use strict';
  if (global.SN_FORMA_AVVISO) return;

  // Fuori da Filo l'unica strada è la notifica del sistema; davanti a una pagina l'angolo in basso a destra; nella
  // home la carta che già racconta la stessa cosa si fa notare lei, e senza carta l'avviso finisce nella colonna
  // delle carte (subito, se il sistema chiede meno movimento: il volo è proprio il movimento).
  // `scadenzaAttesa`: un avviso a tempo la cui uscita fa partire qualcosa (la segnalazione automatica che «Annulla»
  // trattiene, #2570): nella colonna non scadrebbe mai, quindi resta nell'angolo e alla scadenza se ne va.
  function forma({ davanti = true, home = false, haCarta = false, riduciMovimento = false, scadenzaAttesa = false } = {}) {
    if (!davanti) return 'sistema';
    if (!home) return 'angolo';
    if (haCarta) return 'carta';
    return riduciMovimento && !scadenzaAttesa ? 'colonna' : 'angolo';
  }

  // Finito il tempo di lettura: nella home l'avviso vola nella colonna e resta lì, altrove (o se la sua scadenza è
  // attesa) se ne va.
  function allaScadenza({ home = false, scadenzaAttesa = false } = {}) {
    return home && !scadenzaAttesa ? 'vola' : 'chiudi';
  }

  // Un avviso che resta finché lo si chiude (durata 0): nella home sta nell'angolo solo il tempo di leggerlo.
  function tempoNellAngolo(durataMs, { home = false, letturaMs = 5000 } = {}) {
    const d = Number(durataMs) || 0;
    if (!home) return d;
    return d > 0 ? d : Math.max(1, Number(letturaMs) || 5000);
  }

  // L'icona di un avviso: quella che chiede chi lo manda, se no dalla cosa che racconta.
  const ICONE = ['bell', 'warning', 'timer', 'alarm', 'download', 'globe', 'reload', 'blocked', 'check', 'sparkles'];
  function icona({ icona: chiesta = '', carta = '', errore = false } = {}) {
    if (ICONE.includes(chiesta)) return chiesta;
    if (errore) return 'warning';
    const tipo = String(carta || '').split(':')[0];
    if (tipo === 'download') return 'download';
    if (tipo === 'timer') return 'timer';
    return 'bell';
  }

  // Il tasto destro di un avviso, uguale nell'angolo e nella colonna della home: chi lo disegna traduce solo `azione`
  // ('0'…'N' i pulsanti, 'apri' il sito da cui è nato, 'chiudi', 'chiudi-tutti' quelli lì accanto); null è il separatore.
  function sitoDi(indirizzo) {
    const u = String(indirizzo || '');
    if (!/^https?:\/\//i.test(u)) return '';
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }
  function menu({ azioni = [], indirizzo = '', quante = 1 } = {}) {
    const voci = [];
    (Array.isArray(azioni) ? azioni : []).forEach((etichetta, i) => { if (etichetta) voci.push({ etichetta: String(etichetta), azione: String(i) }); });
    const sito = sitoDi(indirizzo);
    if (sito) voci.push({ etichetta: `Apri ${sito}`, azione: 'apri' });
    if (voci.length) voci.push(null);
    voci.push({ etichetta: 'Chiudi', azione: 'chiudi', icona: 'close' });
    if (Number(quante) > 1) voci.push({ etichetta: 'Chiudi tutti', azione: 'chiudi-tutti' });
    return voci;
  }

  global.SN_FORMA_AVVISO = { forma, allaScadenza, tempoNellAngolo, icona, menu, sitoDi, ICONE };
})(typeof globalThis !== 'undefined' ? globalThis : self);
