import { test, expect } from './fixtures/electron.mjs';

// Feedback alpha gRrZZ: il suggerimento di correzione deve comparire in cima al
// menu come nella vecchia estensione. Una delle cause di "non appare nulla" era
// che il correttore NATIVO di Electron non aveva i dizionari attivi: senza
// configurazione esplicita usa solo la lingua di sistema, quindi su parole
// italiane i `dictionarySuggestions` (che il main inoltra al menu via
// `_spell:native`) restavano vuoti. configureSpellchecker() in main.js ora
// abilita esplicitamente locale di sistema + italiano + inglese.
//
// Questo test verifica che la configurazione sia stata applicata: se i dizionari
// Hunspell sono disponibili nell'ambiente, l'italiano DEVE risultare attivo.

test('il correttore nativo ha i dizionari (incluso italiano) configurati', async ({ app }) => {
  const info = await app.evaluate(async ({ session }) => {
    const ses = session.defaultSession;
    return {
      available: ses.availableSpellCheckerLanguages || [],
      configured: ses.getSpellCheckerLanguages ? ses.getSpellCheckerLanguages() : [],
    };
  });

  // Su macOS (NSSpellChecker) la lista Hunspell è vuota e la configurazione è
  // un no-op: in quel caso non asseriamo nulla sui codici.
  if (!info.available.length) {
    test.info().annotations.push({ type: 'skip', description: 'nessun dizionario Hunspell (macOS)' });
    return;
  }

  // Configurazione applicata: almeno una lingua attiva.
  expect(info.configured.length).toBeGreaterThan(0);

  // Se l'italiano è disponibile nell'ambiente, DEVE essere tra le lingue attive
  // (è il fix specifico per le parole italiane del feedback).
  const italianAvailable = info.available.some((l) => l.toLowerCase().startsWith('it'));
  if (italianAvailable) {
    const italianConfigured = info.configured.some((l) => l.toLowerCase().startsWith('it'));
    expect(italianConfigured).toBe(true);
  }
});
