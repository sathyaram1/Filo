// #663: un errore dell'AI che nomina dove si rimedia (Crediti, Opzioni) porta il tasto per andarci su ogni superficie.
// Sulle pagine web la frase e il tasto viaggiano insieme da SN_POPUP (scriviErrore, avvisoErrore, showToast con
// `rimedio`): una superficie che scrive la sola frase lascia l'utente senza strada. Il comportamento lo provano gli spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('fuori da popup.js nessun content script scrive la frase d\'errore senza il suo tasto', () => {
  const dir = join(ROOT, 'src', 'content');
  const colpevoli = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'popup.js')) {
    if (/frasePerLUtente\s*\(/.test(readFileSync(join(dir, f), 'utf8'))) colpevoli.push(f);
  }
  assert.deepEqual(colpevoli, [], 'usa SN_POPUP.scriviErrore (riquadri, menu) o avvisoErrore (avvisi): portano anche il tasto');
});

test('scriviErrore e avvisoErrore portano il tasto, e un avviso col tasto lo offre anche dal tasto destro', () => {
  const s = leggi('src/content/popup.js');
  const corpo = (nome) => {
    const i = s.indexOf(`function ${nome}(`);
    assert.ok(i >= 0, `manca ${nome}`);
    return s.slice(i, s.indexOf('\n  }\n', i));
  };
  assert.match(corpo('scriviErrore'), /mostraRimedio\(/);
  assert.match(corpo('avvisoErrore'), /rimedio:\s*res/);
  const toast = corpo('showToast');
  assert.match(toast, /mostraRimedio\(t,/);
  assert.match(toast, /chiudibile\(t, close, azioni\)/);
});

test('gli avvisi che compongono la frase da sé passano la risposta d\'errore per il tasto', () => {
  const tp = leggi('src/content/translatePage.js');
  assert.match(tp, /toast_page_translate_failed[^\n]*rimedio:\s*result\.errore/);
  assert.match(tp, /toast_page_translate_stopped[\s\S]{0,200}rimedio:\s*result\.errore/);
  assert.match(leggi('src/shared/ascolto.js'), /avvisa\(fraseTrascrizione\(res\),\s*res\)/);
  // L'avviso dei crediti finiti sta nella barra di Filo (#1509), col tasto della stessa pagina; la porta degli avvisi
  // che il main manda alla pagina porta ancora il rimedio.
  assert.match(leggi('src/main/services/handlers/wallet.js'), /rimedioPagina\?\.\(\{ keyRefused: true \}\)[\s\S]{0,200}avvisoDiFilo\(text\.charAt[\s\S]{0,120}openUrl: pagina\.url/);
  assert.match(leggi('src/content/content.js'), /rimedio: msg\.rimedio/);
});
