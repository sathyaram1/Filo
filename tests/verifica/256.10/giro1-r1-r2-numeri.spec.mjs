// #256.10 giro 1: i numeri che l'utente legge in Preferenze e in Gestione, col punto delle migliaia e la virgola dei decimali.
// Le funzioni vere della pagina si eseguono con un DOM finto: il testo asserito è quello che la pagina scriverebbe.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function funzione(file, nome) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const da = src.indexOf(`function ${nome}(`);
  if (da < 0) throw new Error(`${nome} non trovata in ${file}`);
  let livello = 0;
  for (let i = src.indexOf('{', da); i < src.length; i++) {
    if (src[i] === '{') livello++;
    else if (src[i] === '}' && --livello === 0) return src.slice(da, i + 1);
  }
  throw new Error('parentesi non chiuse');
}

test('r1 Preferenze: lo stato dei documenti scrive tutti i suoi numeri col punto delle migliaia', () => {
  const el = { textContent: '' };
  const corpo = funzione('src/pages/preferences/preferences.js', 'scriviStatoDocumenti');
  const scrivi = new Function('$', 'statoDocumenti', 'cartelleSalvate', `${corpo}; scriviStatoDocumenti();`);
  scrivi(() => el, { documenti: 5000, scansioni: 1200, inCorso: { fatti: 1233, totali: 5000 } }, ['Documenti']);
  expect(el.textContent).toBe('5.000 documenti, di cui 1.200 scansioni senza testo · ne sto leggendo 1.234 di 5.000');
});

test('r1 Gestione: le istruzioni per le correzioni troppo lunghe dicono lunghezza e tetto col punto delle migliaia', async () => {
  const msg = [];
  const corpo = funzione('src/pages/manage/manage.js', 'saveFixInstructions');
  const salva = new Function('mgFixInstructions', 'AUTOMATION', 'setCapMsg', 'sendToMain', 'CAPS_SET',
    `async ${corpo}; return saveFixInstructions();`);
  await salva({ value: 'a'.repeat(8123) }, { FIX_INSTRUCTIONS_MAX: 8000 }, (_c, t) => msg.push(t), async () => ({ ok: true }), 'x');
  expect(msg[0]).toBe('Troppo lungo: 8.123 caratteri, il massimo è 8.000. Non salvato.');
});

test('r2 velocità e tono della lettura: la virgola dei decimali, in chat come nell\'elenco dei cambi', () => {
  const require = createRequire(import.meta.url);
  globalThis.self = globalThis;
  for (const m of ['constants', 'contenutoEsterno', 'timeFormat', 'storage', 'themeTokens', 'tabColor', 'ttsVoices', 'filoMemory', 'preferences', 'cambi']) {
    require(join(ROOT, 'src', 'shared', `${m}.js`));
  }
  const P = globalThis.SN_PREF;
  const K = globalThis.SN_CAMBI;
  expect(K.fraseCambio({ chiave: 'tts.rate', prima: 1, dopo: 1.5 })).toBe('velocità di lettura: 1× → 1,5×');
  expect(P.buildPreferencePartial('velocita_lettura', '1,5').label).toBe('Velocità lettura → 1,5×');
  expect(P.buildPreferencePartial('tono_lettura', '1,3').label).toBe('Tono lettura → 1,3');
});

test('r2 Preferenze: accanto ai cursori di velocità e tono il valore ha la virgola', () => {
  const src = readFileSync(join(ROOT, 'src/pages/preferences/preferences.js'), 'utf8');
  const scritture = [...src.matchAll(/\$\('tts(?:Rate|Pitch)Val'\)\.textContent\s*=\s*([^;]+);/g)].map((m) => m[1]);
  expect(scritture.length).toBeGreaterThan(0);
  for (const espr of scritture) {
    const valore = new Function('rate', 'pitch', '$', `return ${espr};`)(1.5, 1.5, () => ({ value: '1.5' }));
    expect(valore, espr).toMatch(/^1,5×?$/);
  }
});
