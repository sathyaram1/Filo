// #663: un errore dell'AI che nomina dove si rimedia (Crediti, Opzioni) porta il tasto per andarci su ogni superficie.
// Sulle pagine web la frase e il tasto viaggiano insieme da SN_POPUP (scriviErrore, avvisoErrore, showToast con
// `rimedio`): una superficie che scrive la sola frase lascia l'utente senza strada. Il comportamento lo provano gli spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (rel) => readFileSync(join(ROOT, rel), 'utf8');
createRequire(import.meta.url)(join(ROOT, 'src', 'shared', 'chatErrors.js'));

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
  // L'avviso dei crediti finiti che il main manda a ogni scheda, e la porta che lo mostra.
  assert.match(leggi('src/main/services/handlers/wallet.js'), /type: MSG\.SHOW_TOAST, text: text\.charAt[^\n]*rimedio:/);
  assert.match(leggi('src/content/content.js'), /rimedio: msg\.rimedio/);
});

// #1344.1: le strade che dicevano dove si rimedia senza portarci.
test('descrizione delle immagini, «Leggi», titolo e riassunto dell\'Editor e filtro dei mazzi passano la risposta per il tasto', () => {
  assert.match(leggi('src/content/actions.js'), /warnModelConfigOnce\(res\.error, res\)/);
  assert.match(leggi('src/content/actions.js'), /showToast\(message, \{[^}]*rimedio:/);
  // Ogni avviso col perché della voce del modello porta il tasto: anche la chiave rifiutata, non solo i codici.
  const tts = leggi('src/content/tts.js');
  // toastErrore è lo showToast contato dei contatori anonimi (#1461).
  const avvisi = tts.match(/(?:showToast\(I18n\.t\(|toastErrore\()'tts_model_fallback_reason'[^\n]*/g) || [];
  assert.ok(avvisi.length >= 2, 'mancano gli avvisi col perché');
  for (const a of avvisi) assert.match(a, /rimedio \}/, a);
  assert.match(leggi('src/main/services/handlers/ai.js'), /keyRefused \? \{ keyRefused: true/);
  const editor = leggi('src/pages/editor/editor.js');
  assert.doesNotMatch(editor, /catch \([^)]*\) \{\s*if \([^)]*\) showEditorToast\('Non sono riuscito a generare il (titolo|riassunto)\.'\)/);
  assert.match(editor, /avvisoNonGenerato\('il titolo', r\)/);
  assert.match(editor, /avvisoNonGenerato\('il riassunto', r\)/);
  assert.match(leggi('src/main/services/handlers/scryfall.js'), /\.\.\.\(rimedio \? \{ rimedio \} : \{\}\)/);
});

test('il «Parere di Filo» mancato non si richiede da solo, e il main dice perché manca', () => {
  const pagina = leggi('src/pages/decks/decks.js');
  assert.match(pagina, /!opinionsByCard\.has\(id\) && !opinionPending\.has\(id\) && !opinionErrors\.has\(id\)/);
  assert.match(pagina, /if \(!op && !pending && !errore\) requestOpinions/);
  assert.match(leggi('src/main/services/handlers/decks.js'), /mancanti\[id\] = cards\[id\] \? senzaParere\(\) : SENZA_DATI/);
  assert.match(pagina, /erroreDelParere\(mancanti\[id\] \|\| \{\}\)/);
});

// «Modelli predefiniti» è una scheda della Gestione: una frase d'errore che ci manda chi usa Filo lo lascia senza strada.
test('le frasi d’errore mandano a cambiare modello dove l’utente lo può fare, e col codice del tasto', () => {
  const fonti = ['src/shared/chatErrors.js', 'src/main/services/deckOpinions.js', 'src/main/services/handlers/decks.js'];
  for (const f of fonti) {
    const righe = leggi(f).split('\n').filter((r) => !/^\s*\/\//.test(r));
    assert.deepEqual(righe.filter((r) => /in Modelli predefiniti/.test(r)), [], f);
  }
  const CE = globalThis.SN_CHAT_ERRORS;
  assert.equal(CE.DOVE_ALTRO_MODELLO, 'in Opzioni → Modelli per azione');
  for (const code of ['ALTRO_MODELLO', 'MODEL_UNAVAILABLE', 'DATA_POLICY', 'NO_PROVIDER_ALLOWED', 'NO_TOOL_HOST']) {
    assert.equal(CE.rimedioPagina({ code }).url, 'filo://options/options.html', code);
  }
  assert.equal(CE.rimedio({ code: 'NO_TOOL_HOST', maxTokens: 16384 }), 'preferenze');
  for (const code of ['MODEL_UNAVAILABLE', 'DATA_POLICY', 'NO_PROVIDER_ALLOWED', 'NO_TOOL_HOST']) {
    const e = Object.assign(new Error('OpenRouter 404: x'), { code, provider: 'openrouter', status: 404 });
    assert.match(CE.friendly(e), /in Opzioni → Modelli per azione\.$/, code);
  }
  assert.match(leggi('src/main/services/deckOpinions.js'), /DOVE_ALTRO_MODELLO\}\.`,\s*code: 'ALTRO_MODELLO'/);
});
