// #504 — «traducimi la pagina» si chiede anche a Filo: lo strumento c'è, il registro gli dà un costo, la riga del diario
// dice com'è andata. La traduzione vera la prova tests/traduci-pagina-chat.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
require('../../src/shared/traduzioneDellaPagina.js');
require('../../src/shared/constants.js');
require('../../src/shared/sistema.js');
require('../../src/shared/esitoAzione.js');
require('../../src/shared/actionLevels.js');
require('../../src/shared/actionTools.js');
require('../../src/shared/autonomia.js');
require('../../src/shared/righeAttivita.js');
require('../../src/shared/capabilities.js');
const Tools = globalThis.SN_ACTION_TOOLS;
const L = globalThis.SN_ACTION_LEVELS;
const A = globalThis.SN_AUTONOMIA;
const R = globalThis.SN_RIGHE_ATTIVITA;

test('scheda(traduci) arriva a TRADUCI_PAGINA, anche per tornare all\'originale', () => {
  assert.equal(Tools.AZIONI.scheda.traduci, 'TRADUCI_PAGINA');
  const [traduci, originale] = Tools.toolCallsToActions([
    { name: 'scheda', arguments: JSON.stringify({ azione: 'traduci' }) },
    { name: 'scheda', arguments: JSON.stringify({ azione: 'traduci', originale: true }) },
  ]);
  assert.equal(traduci.type, 'TRADUCI_PAGINA');
  assert.equal(L.alOriginale(traduci), false);
  assert.equal(originale.type, 'TRADUCI_PAGINA');
  assert.equal(L.alOriginale(originale), true);
  // Un modello che scrive il booleano come testo vuole la stessa cosa.
  assert.equal(L.alOriginale({ originale: ' TRUE ' }), true);
  assert.equal(L.alOriginale({ originale: 'false' }), false);
  const def = Tools.definitions().find((d) => d.function.name === 'scheda');
  assert.ok(def.function.parameters.properties.azione.enum.includes('traduci'));
  assert.equal(def.function.parameters.properties.originale.type, 'boolean');
});

test('la capacità «Traduci l\'intera pagina» dice alla chat lo strumento, non «solo a mano»', () => {
  assert.match(globalThis.SN_CAPABILITIES.renderDetailForPrompt(['translate-page']), /Dalla chat: scheda\(traduci\)\./);
});

test('si disfa come il clic: parte da sola, e dopo un testo altrui chiede solo al livello Conservativo', () => {
  assert.equal(L.costoFor({ type: 'TRADUCI_PAGINA' }), 1);
  assert.equal(L.costoFor({ type: 'TRADUCI_PAGINA', originale: true }), 1);
  assert.equal(A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo: 1 }).risposta, 'si');
  assert.equal(A.decideDettaglio({ livello: 'conservativo', stato: 'contaminato', costo: 1 }).risposta, 'chiede');
  assert.equal(L.describe({ type: 'TRADUCI_PAGINA' }), 'Tradurre la pagina in italiano');
  assert.equal(L.describe({ type: 'TRADUCI_PAGINA', originale: true }), 'Rimettere la pagina nella sua lingua originale');
});

test('il turno si chiude da solo solo quando la pagina ha fatto quello che si era chiesto', () => {
  const esito = (traduzione, executed = true) => ({ executed, output: { traduzione } });
  for (const s of ['partita', 'originale', 'fermata']) assert.equal(L.parlaDaSe('TRADUCI_PAGINA', esito(s)), true, s);
  for (const s of ['gia_tradotta', 'in_corso', 'niente']) assert.equal(L.parlaDaSe('TRADUCI_PAGINA', esito(s)), false, s);
  assert.equal(L.parlaDaSe('TRADUCI_PAGINA', esito('muto', false)), false);
  // Su una scheda che non è davanti l'utente non vede cambiare niente: il modello gli dice dove.
  assert.equal(L.parlaDaSe('TRADUCI_PAGINA', { executed: true, output: { traduzione: 'partita', dietro: true } }), false);
});

test('la riga del diario dice com\'è andata, non un «tradotta» generico', () => {
  const riga = (output, executed = true) => R.riga({ type: 'TRADUCI_PAGINA', _executed: executed, _output: output }).text;
  assert.equal(riga({ traduzione: 'partita', come: 'pagina' }), 'Traduzione della pagina avviata');
  assert.equal(riga({ traduzione: 'partita', come: 'ripresa', mancanti: 3, di: 10 }), 'Traduzione della pagina ripresa');
  assert.equal(riga({ traduzione: 'partita', come: 'nuovo' }), 'Traduzione del testo nuovo avviata');
  assert.equal(riga({ traduzione: 'gia_tradotta' }), 'Pagina già tradotta');
  assert.equal(riga({ traduzione: 'originale', originale: true }), 'Pagina rimessa nella lingua originale');
  assert.equal(riga({ traduzione: 'niente', originale: true }), 'Pagina già nella lingua originale');
  assert.equal(riga({ traduzione: 'no-page' }, false), 'Traduzione non cambiata · nessuna pagina web aperta');
  assert.equal(riga({ traduzione: 'spento' }, false), 'Traduzione non cambiata · Filo è spento su questo sito');
});

// #504.2 — le risposte nascono in un posto e si leggono in quattro: una nuova scritta solo dove nasce farebbe dire
// «non fatto» su una pagina che si sta traducendo.
const S = globalThis.SN_TRADUZIONE_PAGINA;
const sorgente = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const scritti = (testo, campo) => {
  const re = new RegExp(`${campo}:\\s*(?:[\\w.()!&| ]+\\?\\s*)?'([\\w-]+)'(?:\\s*:\\s*'([\\w-]+)')?`, 'g');
  return [...testo.matchAll(re)].flatMap((m) => [m[1], m[2]].filter(Boolean));
};

test('ogni risposta che la pagina o il main scrivono sta nell\'elenco unico, con i suoi testi', () => {
  const daChat = sorgente('src/content/translatePage.js').split('function daChat(')[1].split('function dalTasto(')[0];
  const preload = sorgente('src/preload/page-preload.js').split("ipcRenderer.on('filo:traduci-pagina'")[1].split('\n});')[0];
  const naviga = sorgente('src/main/services/azioni/naviga.js').split('async function azioneTraduciPagina(')[1].split('\n}')[0];
  const tutti = [...scritti(daChat, 'stato'), ...scritti(preload, 'stato'), ...scritti(naviga, 'traduzione')];
  for (const s of ['partita', 'in_corso', 'gia_tradotta', 'originale', 'fermata', 'niente', 'muto', 'spento', 'no-page', 'coperta']) {
    assert.ok(tutti.includes(s), `la lettura dei sorgenti non trova più «${s}»: va aggiornata`);
  }
  for (const s of tutti) assert.ok(Object.hasOwn(S.STATI, s), `«${s}» manca in src/shared/traduzioneDellaPagina.js`);
  for (const [s, v] of Object.entries(S.STATI)) {
    assert.equal(typeof v.fatta, 'boolean', s);
    assert.equal(typeof v.cambiata, 'boolean', s);
    assert.ok(!v.cambiata || v.fatta, `${s}: cambiata senza essere fatta`);
    for (const o of [{}, { come: 'ripresa', mancanti: 2, di: 5 }, { come: 'nuovo' }]) {
      assert.ok(String(v.aiuto(o)).trim(), `${s}: riga dell'Aiuto vuota`);
      assert.ok(String(v.modello(o)).trim(), `${s}: testo per il modello vuoto`);
    }
  }
  // Una risposta sconosciuta non è mai un «fatto».
  assert.equal(S.stato('nuova_risposta'), 'muto');
  assert.equal(S.stato(undefined), 'muto');
});

test('chat e diario leggono lo stesso elenco: chiude il turno solo chi ha cambiato la pagina, e ogni esito ha la sua riga', () => {
  for (const [s, v] of Object.entries(S.STATI)) {
    assert.equal(L.traduzioneFatta(s), v.cambiata, s);
    assert.equal(L.parlaDaSe('TRADUCI_PAGINA', { executed: v.fatta, output: { traduzione: s } }), v.cambiata, s);
  }
  const riga = (s, executed) => R.riga({ type: 'TRADUCI_PAGINA', _executed: executed, _output: { traduzione: s } }).text;
  const avviata = riga('partita', true);
  for (const [s, v] of Object.entries(S.STATI)) {
    if (v.fatta && s !== 'partita') assert.notEqual(riga(s, true), avviata, `${s}: il diario della chat lo direbbe «avviata»`);
    if (!v.fatta) assert.match(riga(s, false), /^Traduzione non cambiata · \S/, `${s}: il diario della chat non dice perché`);
  }
});

test('«torna all\'originale» si legge in un posto solo, per la chat e per l\'Aiuto', () => {
  for (const v of [true, 'true', ' TRUE ']) {
    assert.equal(S.alOriginale(v), true, String(v));
    assert.equal(L.alOriginale({ originale: v }), true, String(v));
  }
  for (const v of [false, 'false', undefined, null, 1, 'sì']) {
    assert.equal(S.alOriginale(v), false, String(v));
    assert.equal(L.alOriginale({ originale: v }), false, String(v));
  }
  for (const p of ['src/content/aiutoPagina.js', 'src/shared/actionLevels.js', 'src/main/services/azioni/naviga.js']) {
    assert.doesNotMatch(sorgente(p), /originale[^\n]*toLowerCase\(\)[^\n]*'true'/, `${p} rilegge il campo da sé`);
  }
  assert.match(sorgente('src/content/aiutoPagina.js'), /SN_TRADUZIONE_PAGINA[\s\S]*alOriginale\(page\.originale\)/);
});

test('il modulo delle risposte arriva prima dell\'Aiuto in ogni preload che lo carica', () => {
  for (const p of ['src/preload/page-preload.js', 'src/preload/riquadri-preload.js', 'src/preload/internal-preload.js']) {
    const s = sorgente(p);
    const i = s.indexOf('traduzioneDellaPagina.js');
    assert.ok(i > 0 && i < s.indexOf("'aiutoPagina.js'"), p);
  }
  const loader = sorgente('src/main/services/loader.js');
  assert.ok(loader.indexOf('traduzioneDellaPagina.js') > 0 && loader.indexOf('traduzioneDellaPagina.js') < loader.indexOf("'actionLevels.js'"));
});
