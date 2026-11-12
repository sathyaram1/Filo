// Sentinella della regola sui trade-off di costo (#1920): costo contro velocità o qualità lo decide chi lavora, con la
// stima dai prezzi del momento e le alternative come impostazione; all'owner si chiede solo ciò che non si misura.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');
const piatto = (t) => t.replace(/\r/g, '').replace(/\s+/g, ' ');
const leggi = (f) => piatto(readFileSync(join(ROOT, f), 'utf8'));

const sezione = (t, inizio, fine) => {
  const i = t.indexOf(inizio);
  assert.ok(i >= 0, `manca «${inizio}»`);
  const j = t.indexOf(fine, i + inizio.length);
  return t.slice(i, j < 0 ? undefined : j);
};

// La velocità contro il costo era nell'elenco di ciò che si chiede: una frase così rimanda le domande all'owner.
const CHIEDE_IL_COSTO = /(velocità (contro|vs) costo|costo (contro|vs) velocità)[^.]{0,80}(decide l'owner|segnala all'owner|NON decidere tu)/i;

test('CLAUDE.md: il trade-off di costo lo decide chi lavora, quello vero resta all\'owner senza il costo misurabile', () => {
  const ini = sezione(leggi('CLAUDE.md'), '## Iniziativa', '## Verifica');
  assert.match(ini, /\*\*Trade-off di costo\*\* \(costo contro velocità, costo contro qualità\): lo decidi tu/);
  assert.match(ini, /filo_design\.txt` § GESTIONE DEI MODELLI/, 'il metodo sta nel documento di design');
  assert.match(ini, /Nel report all'owner una riga: la scelta di partenza e dove stanno le alternative/);
  const vero = sezione(ini, '**Trade-off VERO**', 'Nel report:');
  assert.ok(!/velocità/i.test(vero), `il trade-off vero non elenca più la velocità: ${vero}`);
  assert.match(vero, /un costo che non si stima perché manca il dato/);
  assert.match(vero, /segnala all'owner/);
});

test('filo_design: i prezzi si leggono da OpenRouter e le alternative stanno accanto all\'impostazione con la stima', () => {
  const mod = sezione(leggi('filo_design.txt'), 'GESTIONE DEI MODELLI', 'PERSONALIZZAZIONE');
  assert.match(mod, /i prezzi si leggono su OpenRouter al momento del lavoro/);
  assert.match(mod, /ogni alternativa confrontata \([^)]*\) diventa un'impostazione, non un commento nel codice/);
  assert.match(mod, /ogni opzione porta accanto a sé la sua stima, costo mensile all'uso stimato e tempo di risposta/);
  assert.match(mod, /nessuna soglia di costo fa scattare una domanda/);
  // Un prezzo di modello scritto a mano: una cifra in dollari nella frase che parla di milioni di token.
  const prezzi = mod.split(/(?<=\.)\s/).filter((f) => /milion/i.test(f) && /\d\s*\$|\$\s*\d/.test(f));
  assert.deepEqual(prezzi, [], 'nessun prezzo per milione di token scritto nel documento');
});

test('i ruoli che chiedono o verificano ricevono la regola, e nessuno manda a chiedere velocità contro costo', () => {
  const ruoli = [['new-work', {}], ['fixer', {}], ['fixer', { caso: 'ripresa' }], ['fixer', { caso: 'riallineamento' }],
    ['verifier', { scope: 'pieno' }], ['verifier', { scope: 'chiusura' }], ['verifier', { scope: 'riallineamento' }]];
  for (const [ruolo, opts] of ruoli) {
    const t = piatto(readRoleInstructions(ruolo, opts));
    const chi = `${ruolo} ${JSON.stringify(opts)}`;
    assert.ok(!CHIEDE_IL_COSTO.test(t), `${chi}: manda ancora all'owner la velocità contro il costo`);
    if (/## Un trade-off/.test(t)) {
      const chiedi = sezione(t, '## Un trade-off che non si misura non lo decidi tu: lo chiedi', 'Scrivi la domanda');
      assert.match(chiedi, /Un trade-off di costo \(contro velocità o qualità\) lo decidi tu, coi numeri/, chi);
      assert.match(chiedi, /i dati dell'utente; - il gusto; - la direzione di prodotto/, `${chi}: l'elenco di cosa si chiede`);
      assert.match(chiedi, /un costo che non si stima perché manca il dato/, chi);
    }
  }
  const nw = piatto(readRoleInstructions('new-work', {}));
  assert.match(nw, /## Un trade-off che non si misura non lo decidi tu: lo chiedi/, 'chi lavora sa cosa chiedere');
  assert.match(nw, /un trade-off che non si misura o una domanda di design \(CLAUDE\.md § Iniziativa: non lo decidi tu\)/,
    'il contratto dei worker è allineato');
});

test('chi verifica: un trade-off di costo con stima e opzioni non è un rilievo, uno senza è un rilievo senza «?»', () => {
  for (const scope of ['pieno', 'chiusura', 'riallineamento']) {
    const t = piatto(readRoleInstructions('verifier', { scope }));
    if (!/8\. \*\*Miglioramenti\.\*\*/.test(t)) continue;
    const otto = sezione(t, '8. **Miglioramenti.**', '9. **');
    assert.match(otto, /con la stima e le opzioni esposte non è un rilievo/, scope);
    assert.match(otto, /senza `\?`, se manca la stima \(costo al mese e tempo di risposta\) o non sta accanto all'opzione, se le opzioni non si cambiano senza codice o se quella di partenza non regge i numeri/, scope);
    assert.match(otto, /Uno che non si misura lo decide l'owner/, scope);
  }
  const v = piatto(readRoleInstructions('verifier', { scope: 'pieno' }));
  assert.match(v, /8\. \*\*Miglioramenti\.\*\*/, 'la verifica piena porta i criteri');
  assert.match(v, /Un miglioramento con un trade-off che non si misura si scrive col segno `\?`/);
  assert.match(v, /un trade-off di costo lo giudica il criterio 8, senza `\?`/);
  const segno = sezione(v, '**Il segno `?`**', '| segnalazione e rilievo |');
  assert.match(segno, /Non copre un trade-off di costo/, 'il «?» non copre più il costo con stima e opzioni');
});
