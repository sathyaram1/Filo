// Script usa-e-getta per il refactoring: rimuove da content.js i blocchi
// spostati in actions.js / menuIcons.js. Si auto-verifica con i marker.
import fs from 'node:fs';

const FILE = new URL('../src/content/content.js', import.meta.url);
let lines = fs.readFileSync(FILE, 'utf8').split('\n');

function findIdx(pred, from = 0) {
  const i = lines.findIndex((l, k) => k >= from && pred(l));
  if (i < 0) throw new Error('marker non trovato: ' + pred.toString());
  return i;
}

// Blocco 1: registro icone + pickColor/QR + layout icone (→ actions.js/menuIcons.js)
{
  const start = findIdx((l) => l.startsWith('  // Registro delle icone globali, con ID stabili'));
  const end = findIdx((l) => l === '  function buildHelpItem() {');
  lines.splice(start, end - start);
}

// Blocco 2: sezione "Azioni" fino a toggleFullscreen incluso (→ actions.js)
{
  const azioni = findIdx((l) => l === '  // Azioni');
  const start = azioni - 1; // riga di trattini sopra
  const end = findIdx((l) => l.startsWith('  // La traduzione di pagina (e il suo stato) vive in'));
  lines.splice(start, end - start, ...[
    '  // Le azioni (clipboard/incolla, screenshot pieno e a regione, trascrizione',
    '  // OCR, salva/condividi/cerca, color picker, QR code, spiegazioni inline e',
    '  // prefetch "Spiega") vivono in src/content/actions.js (SN_ACTIONS),',
    '  // caricato prima di questo file. content.js gli inietta le dipendenze con',
    '  // Actions.init() in testa al file.',
    '',
  ]);
}

// Blocco 3: "Nuove azioni globali / contestuali" (→ actions.js)
{
  const header = findIdx((l) => l.startsWith('  // Nuove azioni globali / contestuali'));
  const start = header - 1; // riga di trattini sopra
  const end = findIdx((l) => l.startsWith('  // La lettura ad alta voce e la dettatura'));
  lines.splice(start, end - start);
}

// Blocco 4: commento overflow + buildInlineExplainImage/Link + analyzeLinkSuspicious
// + levenshteinSmall (→ actions.js)
{
  const start = findIdx((l) => l.startsWith('  // Overflow panel: ora vive come griglia'));
  const end = findIdx((l) => l.startsWith('  // Il box "Modifica"'));
  lines.splice(start, end - start);
}

// Il commento TTS diceva "più sotto": l'init ora è in testa al file.
lines = lines.map((l) => l.replace(
  "// content.js gli inietta le dipendenze con TTS.init() più sotto.",
  '// content.js gli inietta le dipendenze con TTS.init() in testa al file.',
));

fs.writeFileSync(FILE, lines.join('\n'));
console.log('content.js ora ha', lines.length, 'righe');
