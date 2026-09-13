// #592, giro 10 — cosa può AZIONARE una pagina visitata.
//
// Il canale delle azioni arriva anche dagli script che girano dentro le pagine
// web: è da lì che lavora l'assistente «Aiuto». Finché il registro intero era
// raggiungibile da quel canale, da un indirizzo web si leggeva un documento dal
// disco, si otteneva l'uscita di un comando del terminale, si fissava una
// lezione permanente, si creava una sveglia il cui nome entra in ogni prompt, e
// le azioni che chiedono conferma si confermavano da sé.
//
// Adesso l'elenco è di ciò che è lecito. Questa sentinella tiene le due metà che
// un elenco così può perdere:
//   • dentro non c'è niente che legga il disco, lanci comandi, tocchi la memoria
//     o le impostazioni;
//   • quello che la barra laterale aziona DAVVERO sta nell'elenco, letto dal suo
//     codice e dal prompt che le insegna cosa può chiedere, non da una lista
//     scritta a mano qui che invecchierebbe in silenzio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const radice = join(__dirname, '..', '..');
require(join(radice, 'src', 'shared', 'preferences.js'));
require(join(radice, 'src', 'shared', 'actionLevels.js'));
const { REGISTRY, WEB_ALLOWED_ACTIONS } = globalThis.SN_ACTION_LEVELS;

test('nell\'elenco non c\'è niente che legga il disco, lanci comandi o tocchi la memoria', () => {
  const vietate = [
    'LEGGI_DOCUMENTO', 'LEGGI_FILE', 'APRI_FILE', 'ESEGUI_COMANDO',
    'SALVA_LEZIONE', 'SALVA_APPUNTO', 'CANCELLA_MEMORIA', 'CANCELLA_ARCHIVIO',
    'TIMER', 'SVEGLIA', 'CANCELLA_SVEGLIA', 'MODIFICA_SVEGLIA',
    'IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'PULISCI_TAB', 'ONBOARDING',
    'PROXY_TAB', 'REGOLA_PROXY_DOMINIO', 'RIMUOVI_REGOLA_PROXY',
    'LEGGI_TRASPARENZA', 'CAPACITA_DETTAGLIO', 'CERCA_WEB',
  ];
  for (const tipo of vietate) {
    assert.ok(REGISTRY[tipo], `azione inesistente: la prova non sta provando niente (${tipo})`);
    assert.equal(WEB_ALLOWED_ACTIONS.has(tipo), false, `una pagina visitata può azionarla: ${tipo}`);
  }
});

test('ogni voce dell\'elenco è un\'azione registrata', () => {
  for (const tipo of WEB_ALLOWED_ACTIONS) {
    assert.ok(REGISTRY[tipo], `nell'elenco c'è un'azione che non esiste: ${tipo}`);
  }
});

test('quello che la barra laterale aziona davvero sta nell\'elenco', () => {
  // Le azioni che la sidebar emette da sé (scritte nel suo codice) e quella che
  // il prompt dell'agente di pagina le insegna a chiedere.
  const sidebar = readFileSync(join(radice, 'src', 'content', 'sidebar.js'), 'utf8');
  const costanti = readFileSync(join(radice, 'src', 'shared', 'constants.js'), 'utf8');

  const emesse = new Set();
  for (const m of sidebar.matchAll(/runFiloAction\(\s*\{\s*type:\s*'([A-Z_]+)'/g)) emesse.add(m[1]);
  for (const m of costanti.matchAll(/"filo":\s*\{\s*"type":\s*"([A-Z_]+)"/g)) emesse.add(m[1]);

  assert.ok(emesse.size >= 2, `trovate troppo poche azioni (${emesse.size}): la prova non sta leggendo il codice`);
  for (const tipo of emesse) {
    assert.equal(
      WEB_ALLOWED_ACTIONS.has(tipo), true,
      `la barra laterale aziona ${tipo} e l'elenco non lo ammette: su ogni sito quella cosa `
      + 'smetterebbe di funzionare senza dire niente',
    );
  }
});
