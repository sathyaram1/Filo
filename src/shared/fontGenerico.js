// Il carattere scelto dall'utente tradotto nella famiglia generica più vicina, per i riquadri di Filo sui siti (#1342).
// Esce solo una parola chiave CSS senza virgolette: un @font-face del sito non la può ridichiarare.
// Prove: tests/unit/fontGenerico.test.mjs; chi la usa è SN_FILO_UI.fogliChiusi.

(function (global) {
  'use strict';

  // Il carattere di sistema resta quello di oggi: chi non ha scelto niente non vede cambiare i riquadri.
  const SISTEMA = 'system-ui, sans-serif';
  const PAROLE = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'cursive']);

  // Per nome di famiglia, minuscolo: i caratteri che Filo propone (aestheticRefiner FONT_CHOICES, l'editor) e i comuni.
  const TABELLA = {
    '-apple-system': SISTEMA, blinkmacsystemfont: SISTEMA, 'segoe ui': SISTEMA, roboto: SISTEMA,
    'system-ui': SISTEMA, 'ui-sans-serif': SISTEMA, 'ui-rounded': SISTEMA,
    georgia: 'serif', 'times new roman': 'serif', times: 'serif', cambria: 'serif', constantia: 'serif',
    'palatino linotype': 'serif', palatino: 'serif', 'book antiqua': 'serif', garamond: 'serif',
    baskerville: 'serif', 'ui-serif': 'serif', serif: 'serif',
    verdana: 'sans-serif', geneva: 'sans-serif', arial: 'sans-serif', helvetica: 'sans-serif',
    'helvetica neue': 'sans-serif', tahoma: 'sans-serif', 'trebuchet ms': 'sans-serif', calibri: 'sans-serif',
    candara: 'sans-serif', 'gill sans': 'sans-serif', 'lucida sans': 'sans-serif', 'open sans': 'sans-serif',
    impact: 'sans-serif', 'sans-serif': 'sans-serif',
    'courier new': 'monospace', courier: 'monospace', consolas: 'monospace', menlo: 'monospace', monaco: 'monospace',
    'lucida console': 'monospace', 'cascadia code': 'monospace', 'cascadia mono': 'monospace',
    'sfmono-regular': 'monospace', 'sf mono': 'monospace', 'fira code': 'monospace', 'ui-monospace': 'monospace',
    monospace: 'monospace',
    'comic sans ms': 'cursive', 'brush script mt': 'cursive', 'segoe print': 'cursive', 'segoe script': 'cursive',
    cursive: 'cursive',
  };

  const GENERICHE = new Set(['system-ui', 'ui-sans-serif', 'ui-rounded', 'ui-serif', 'serif', 'sans-serif',
    'ui-monospace', 'monospace', 'cursive']);
  const conosciuto = (nome) => Object.prototype.hasOwnProperty.call(TABELLA, nome);

  // Decide la prima famiglia della pila, quella che l'utente vede disegnata; se non la conosciamo, la generica che la
  // pila stessa dichiara («Rockwell, serif» è un carattere con grazie).
  function generica(valore) {
    if (typeof valore !== 'string' || !valore.trim()) return SISTEMA;
    const nomi = valore.split(',').map((p) => p.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase()).filter(Boolean);
    if (nomi.length && conosciuto(nomi[0])) return TABELLA[nomi[0]];
    const dichiarata = nomi.find((n) => GENERICHE.has(n));
    return dichiarata ? TABELLA[dichiarata] : 'sans-serif';
  }

  global.SN_FONT_GENERICO = { generica, TABELLA, PAROLE, SISTEMA };
})(typeof globalThis !== 'undefined' ? globalThis : self);
