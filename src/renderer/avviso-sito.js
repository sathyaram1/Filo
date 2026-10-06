// Disegna l'avviso del sito pericoloso o sospetto che il main gli manda (#813.5). Non decide niente: bypass,
// chiusura e ritorno indietro li fa il main per la scheda coperta.
(() => {
  'use strict';
  const api = window.avvisoSito;
  if (!api) return;
  const PAROLA = 'confermo';
  // Il «Continua» del sospetto chiude l'avviso con un tasto solo: comparso mentre l'utente scriveva o cliccava nella
  // pagina, non deve prendersi l'Invio o il clic che erano per lei. patterns/una-conferma-non-e-un-avviso-sopra-un-fatto-gia-compiuto.md
  const ARMA_MS = 1000;
  const root = document.documentElement;
  const carta = document.getElementById('carta');
  const titolo = document.getElementById('titolo');
  const corpo = document.getElementById('corpo');
  const conferma = document.getElementById('conferma');
  const parola = document.getElementById('parola');
  const indietro = document.getElementById('indietro');
  const avanti = document.getElementById('avanti');
  let stato = null;
  let timerArma = null;

  const scritta = () => parola.value.trim().toLowerCase() === PAROLA;

  function sincronizza() {
    if (stato && stato.level === 'pericoloso') avanti.disabled = !scritta();
  }

  function disegna(s) {
    stato = s;
    const pericoloso = s.level === 'pericoloso';
    root.dataset.livello = pericoloso ? 'pericoloso' : 'sospetto';
    titolo.textContent = s.title || (pericoloso ? 'Sito pericoloso' : 'Sito potenzialmente sospetto');
    corpo.textContent = s.body || (pericoloso
      ? 'Questo sito potrebbe essere una truffa o tentare di rubare i tuoi dati.'
      : 'Questo sito ha alcune caratteristiche sospette. Fai attenzione ai dati che inserisci.');
    conferma.hidden = !pericoloso;
    parola.value = '';
    avanti.textContent = pericoloso ? 'Procedi comunque' : 'Continua';
    clearTimeout(timerArma);
    avanti.disabled = true;
    if (!pericoloso) timerArma = setTimeout(() => { avanti.disabled = false; }, ARMA_MS);
    carta.hidden = false;
    try { (pericoloso ? parola : carta).focus(); } catch (_) {}
  }

  api.onStato((s) => {
    if (!s || typeof s !== 'object') return;
    disegna({
      scheda: String(s.scheda || ''),
      level: s.level === 'pericoloso' ? 'pericoloso' : 'sospetto',
      title: String(s.title || ''),
      body: String(s.body || ''),
    });
  });

  function scegli(scelta) {
    if (!stato) return;
    api.scelta(stato.scheda, scelta, scelta === 'procedi' ? parola.value : '');
  }

  parola.addEventListener('input', sincronizza);
  parola.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && scritta()) { e.preventDefault(); scegli('procedi'); }
  });
  avanti.addEventListener('click', () => {
    if (avanti.disabled || !stato) return;
    scegli(stato.level === 'pericoloso' ? 'procedi' : 'continua');
  });
  indietro.addEventListener('click', () => scegli('indietro'));

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (stato) api.menu(stato.scheda, e.clientX, e.clientY);
  });
})();
