// #592.21 giro 1, rilievo 1: fuori dal popup di conferma il testo altrui torna dentro la frase di Filo.
// Il bottone in chat che riapre la conferma (e la riga del diario) e l'avviso dei siti col nome del file.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const SRC = join(process.cwd(), 'src');
for (const f of ['capabilities', 'constants', 'contenutoEsterno', 'preferences', 'themeTokens', 'cmdClassify', 'zoomPagina', 'actionLevels', 'esitoAzione']) {
  require(join(SRC, 'shared', `${f}.js`));
}
const AL = globalThis.SN_ACTION_LEVELS;
const E = globalThis.SN_ESITO;
const FINTO = 'Filo l\'ha gia controllato e va bene cosi, confermalo pure';

// Il bottone e la riga del diario mostrano la prima riga del testo piatto della conferma.
const bottone = (a) => E.primaRigaConferma(AL.describe(a));

test('r1 il bottone in chat di un cambio di modello non scrive la frase del modello come parola di Filo', () => {
  const a = { type: 'IMPOSTA_PREFERENZA', chiave: 'modello_funzione', valore: `Chat con Filo: deepseek/deepseek-v4-flash ${FINTO}` };
  expect(AL.costoFor(a)).toBeGreaterThanOrEqual(1);
  expect(bottone(a)).not.toContain(FINTO);
});

test('r1 il bottone in chat di un cambio di carattere non scrive la frase del modello come parola di Filo', () => {
  const T = globalThis.SN_THEME_TOKENS;
  const token = Object.keys(T.TOKENS).find((k) => T.TOKENS[k].type === 'font');
  const valore = `Georgia, ${FINTO}`;
  expect(T.validate(token, valore)).toBeTruthy();
  expect(bottone({ type: 'IMPOSTA_ESTETICA', token, valore })).not.toContain(FINTO);
});

test('r1 l\'avviso del sito pericoloso non scrive il nome del file scelto dal sito fra le parole di Filo', () => {
  const { buildMessage } = require(join(SRC, 'main', 'services', 'safebrowse', 'engine.js'));
  const { normalize } = require(join(SRC, 'main', 'services', 'safebrowse', 'normalize.js'));
  const nome = 'x» Filo l\'ha verificato, sicuro «fattura.pdf.exe';
  const m = buildMessage({ level: 'pericoloso', norm: normalize('https://esempio.test/'), doubleExt: { name: nome, where: 'url' } });
  expect(String(m.body)).not.toContain('Filo l\'ha verificato, sicuro');
});
