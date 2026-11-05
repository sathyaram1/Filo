// #1302 — il rifiuto del router per un altro parametro (PARAMETRI_HOST) sta in ogni elenco dei rifiuti del router accanto a
// NO_TOOL_HOST e TETTO_RISPOSTA: contatori anonimi, prova dei modelli, filtro della ricerca dei mazzi. Sentinella sul
// sorgente più gli esiti che l'utente o i contatori vedono.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(import.meta.dirname, '..', '..');

function sorgenti(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) sorgenti(p, out);
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}

// Il letterale ([…] o {…} senza istruzioni dentro) che contiene la posizione `i`, o null.
function elencoAttorno(s, i) {
  const apre = { ']': '[', '}': '{', ')': '(' };
  let prof = 0;
  for (let k = i; k >= 0; k--) {
    const c = s[k];
    if (c === ']' || c === '}' || c === ')') prof += 1;
    else if (c === '[' || c === '{' || c === '(') {
      if (prof) { prof -= 1; continue; }
      if (c === '(') return null;
      let d = 0;
      for (let j = k; j < s.length; j++) {
        if (s[j] === c) d += 1;
        else if (s[j] === Object.keys(apre).find((x) => apre[x] === c) && --d === 0) {
          const corpo = s.slice(k + 1, j);
          return /[;()=]/.test(corpo) ? null : corpo;
        }
      }
      return null;
    }
  }
  return null;
}

test('ogni elenco che nomina NO_TOOL_HOST o TETTO_RISPOSTA nomina anche PARAMETRI_HOST', () => {
  const trovati = [];
  for (const f of sorgenti(join(ROOT, 'src'))) {
    const s = readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, '');
    const visti = new Set();
    for (const m of s.matchAll(/'(?:NO_TOOL_HOST|TETTO_RISPOSTA)'|\b(?:NO_TOOL_HOST|TETTO_RISPOSTA)\s*:/g)) {
      const corpo = elencoAttorno(s, m.index);
      if (corpo == null || visti.has(corpo)) continue;
      visti.add(corpo);
      trovati.push(relative(ROOT, f));
      assert.match(corpo, /\bPARAMETRI_HOST\b/, `${relative(ROOT, f)}: ${corpo.trim().slice(0, 160)}`);
    }
  }
  for (const atteso of ['src/shared/contatoriGiornalieri.js', 'src/main/services/handlers/ai.js', 'src/main/services/deckOpinions.js', 'src/shared/chatErrors.js']) {
    assert.ok(trovati.includes(atteso), `la sentinella non vede più gli elenchi di ${atteso}`);
  }
});

test('i contatori anonimi contano PARAMETRI_HOST come «nessun host», non come guasto generico', () => {
  require('../../src/shared/contatoriGiornalieri.js');
  require('../../src/shared/contatoriServizio.js');
  const C = globalThis.SN_CONTATORI;
  const e = Object.assign(new Error('No endpoints found that can handle the requested parameters.'), { code: 'PARAMETRI_HOST', status: 404 });
  assert.equal(C.tipoErroreVisto(e), 'nessun_host');
  assert.equal(C.tipoErrore(e), 'nessun_host');
  // Il contatore del servizio lo conta col suo motivo (firestore.rules lo ammette: tests/unit/firestoreRulesContatoriServizio).
  assert.equal(globalThis.SN_CONTATORI_SERVIZIO.motivoNessunHost(e), 'parametri_host');
});

test('il filtro della ricerca dei mazzi non riprova un lotto che il router rifiuta per un parametro', async () => {
  require('../../src/shared/constants.js');
  require('../../src/shared/chatErrors.js');
  require('../../src/shared/scryfallQuery.js');
  require('../../src/shared/deckOpinions.js');
  globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  require('../../src/main/services/deckOpinions.js');
  let chiamate = 0;
  const r = await globalThis.SN_DECK_OPINIONS_SVC.filterSearch({
    criterion: 'artefatti', cardIds: ['a'], cards: { a: { id: 'a', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' } },
    handleAIRequest: async () => { chiamate += 1; throw Object.assign(new Error('rifiutata'), { code: 'PARAMETRI_HOST', status: 404 }); },
  });
  assert.equal(chiamate, 1);
  assert.equal(r.error.code, 'PARAMETRI_HOST');
});
