// #967 — «Continua» sull'avviso sospetto vale per sempre: il sito entra fra quelli di cui l'utente si fida, che tacciono
// il sospetto in ogni scheda e mai il pericoloso. La chat aggiunge con la parola «conferma» e toglie subito.
// Regole: src/main/tabs/tabSafebrowse.js, src/main/services/sitiFidati.js, src/shared/preferences.js.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');
const { installSafebrowse } = require('../../src/main/tabs/tabSafebrowse.js');
const Fidati = require('../../src/main/services/sitiFidati.js');
for (const f of ['constants.js', 'nomiSito.js', 'cambi.js', 'preferences.js', 'autonomia.js', 'actionLevels.js']) {
  require(`../../src/shared/${f}`);
}
const P = globalThis.SN_PREF;
const A = globalThis.SN_AUTONOMIA;
const Levels = globalThis.SN_ACTION_LEVELS;

// Il disco finto delle impostazioni: quello che sitiFidati scrive, la prossima lettura lo vede.
let disco;
beforeEach(() => {
  SB.setProviders({ gsb: null, gsbPeek: null, rdap: null, ct: null, llm: null, sandbox: null });
  SB.impostaFidati([]);
  disco = { security: { safeBrowse: { trustedSites: [] } } };
  globalThis.SN_STORAGE = { getSettings: async () => JSON.parse(JSON.stringify(disco)) };
  Fidati._usaScrittura(async (partial) => {
    disco.security.safeBrowse.trustedSites = partial.security.safeBrowse.trustedSites;
    SB.impostaFidati(disco.security.safeBrowse.trustedSites);
  });
});

function finestra({ incognito = false } = {}) {
  class Schede {}
  installSafebrowse(Schede);
  const schede = new Schede();
  schede.incognito = incognito;
  schede.activeId = 1;
  schede.layout = () => {};
  schede.tabs = [];
  schede.win = null;
  schede.apri = (url) => {
    const pagina = { url };
    const wc = { getURL: () => pagina.url, isDestroyed: () => false };
    const tab = { id: schede.tabs.length + 1, view: { webContents: wc }, pagina };
    schede.tabs.push(tab);
    schede._sbOnNavigate(tab, url);
    return tab;
  };
  return schede;
}
const livello = (tab) => (tab.sbAvviso ? tab.sbAvviso.level : 'safe');
const finito = () => new Promise((r) => setTimeout(r, 0));

test('la voce di un sito è quella del «Continua»: il sito, o la pagina su una piattaforma dove chiunque pubblica', () => {
  assert.equal(SB.voceFidata('team.com'), 'team.com');
  assert.equal(SB.voceFidata('https://login.Team.com/accesso'), 'team.com');
  assert.equal(SB.voceFidata('https://docs.google.com/forms/d/e/MODULO-A/viewform'), 'docs.google.com/forms/d/e/MODULO-A/viewform');
  assert.equal(SB.voceFidata('   '), null);
});

test('«Continua» su team.com: il sito entra nell\'elenco, e una scheda nuova sullo stesso sito non mostra più il sospetto', async () => {
  const w = finestra();
  const prima = w.apri('https://team.com/');
  assert.equal(livello(prima), 'sospetto', 'team.com somiglia a Steam: parte dall\'avviso sospetto');
  w._sbScelta(prima, 'continua');
  assert.equal(livello(prima), 'safe');
  await finito();
  assert.deepEqual(disco.security.safeBrowse.trustedSites, ['team.com']);
  const nuova = w.apri('https://www.team.com/altra-pagina');
  assert.equal(livello(nuova), 'safe', 'in un\'altra scheda l\'avviso non torna');
  // Un'altra finestra (un riavvio legge lo stesso elenco) vale uguale.
  assert.equal(livello(finestra().apri('https://team.com/')), 'safe');
});

test('il sospetto aperto in un\'altra scheda sullo stesso sito se ne va col «Continua»; tolto il sito, torna', async () => {
  const w = finestra();
  const a = w.apri('https://team.com/uno');
  const b = w.apri('https://team.com/due');
  assert.equal(livello(b), 'sospetto');
  w._sbScelta(a, 'continua');
  await finito();
  w._sbFidatiCambiati({ aggiunti: ['team.com'], tolti: [] });
  assert.equal(livello(b), 'safe', 'la scheda accanto perde l\'avviso senza ricaricare');

  SB.impostaFidati([]);
  w._sbFidatiCambiati({ aggiunti: [], tolti: ['team.com'] });
  assert.equal(livello(a), 'sospetto', 'tolto dall\'elenco, l\'avviso torna anche dove era stato chiuso');
  assert.equal(livello(b), 'sospetto');
  assert.equal(livello(w.apri('https://team.com/')), 'sospetto', 'e in una scheda nuova');
});

test('la fiducia non tace mai il pericoloso: né il sosia stretto né la lista nera di Google', () => {
  SB.impostaFidati(['paypa1.com', 'team.com']);
  assert.equal(livello(finestra().apri('https://paypa1.com/login')), 'pericoloso');
  SB.setProviders({ gsbPeek: () => ({ listed: true, category: 'phishing' }) });
  assert.equal(livello(finestra().apri('https://team.com/')), 'pericoloso', 'un sito fidato finito nella lista nera di Google avvisa');
});

test('«confermo» sul pericoloso resta della scheda e non entra nell\'elenco', async () => {
  const w = finestra();
  const tab = w.apri('https://paypa1.com/login');
  w._sbScelta(tab, 'procedi', { testo: 'confermo' });
  assert.equal(livello(tab), 'safe');
  await finito();
  assert.deepEqual(disco.security.safeBrowse.trustedSites, []);
  assert.equal(livello(w.apri('https://paypa1.com/login')), 'pericoloso', 'in una scheda nuova l\'avviso torna');
});

test('in incognito «Continua» vale per la scheda e non lascia traccia', async () => {
  const w = finestra({ incognito: true });
  const tab = w.apri('https://team.com/');
  w._sbScelta(tab, 'continua');
  assert.equal(livello(tab), 'safe');
  await finito();
  assert.deepEqual(disco.security.safeBrowse.trustedSites, []);
  assert.equal(livello(w.apri('https://team.com/')), 'sospetto');
});

test('due «Continua» di fila entrano tutti e due: le scritture sono in fila', async () => {
  await Promise.all([Fidati.cambia({ aggiungi: ['team.com'] }), Fidati.cambia({ aggiungi: ['area-riservata.it'] })]);
  assert.deepEqual(disco.security.safeBrowse.trustedSites, ['team.com', 'area-riservata.it']);
  const r = await Fidati.cambia({ togli: ['team.com'] });
  assert.deepEqual(r.usciti, ['team.com']);
  assert.deepEqual(disco.security.safeBrowse.trustedSites, ['area-riservata.it']);
});

test('dalla chat: aggiungere costa 3 e vuole la parola «conferma» a ogni livello, togliere costa 1 e parte subito', () => {
  const azione = (valore) => ({ type: 'IMPOSTA_PREFERENZA', chiave: 'siti_di_cui_ti_fidi', valore });
  const add = P.buildPreferencePartial('siti di cui ti fidi', 'aggiungi https://login.team.com/x');
  assert.equal(add.costo, 3);
  assert.equal(add.allenta, true);
  assert.deepEqual(add.elenco.voci, ['team.com'], 'la voce è il sito, come quella del «Continua»');
  assert.deepEqual(add.partial, { security: { safeBrowse: { trustedSites: ['team.com'] } } });
  assert.ok(add.risk, 'il riquadro dice cosa si perde');
  const via = P.buildPreferencePartial('siti_di_cui_ti_fidi', 'togli team.com');
  assert.equal(via.costo, 1);
  assert.equal(via.allenta, false);
  assert.equal(Levels.costoFor(azione('aggiungi team.com')), 3);
  assert.equal(Levels.costoFor(azione('togli team.com')), 1);

  for (const lv of ['conservativo', 'default', 'automatico']) {
    for (const stato of ['pulito', 'contaminato']) {
      const d = A.decideDettaglio({ livello: lv, stato, costo: 3, difesa: true });
      assert.ok(d.risposta === 'no' || (d.risposta === 'conferma' && d.digita), `${lv}/${stato}: aggiungere senza la parola scritta (${d.risposta})`);
    }
  }
  assert.equal(A.decideDettaglio({ livello: 'default', stato: 'pulito', costo: 1, difesa: false }).risposta, 'si');

  // Una pagina ospitata si toglie con la sua voce intera.
  SB.impostaFidati([]);
  const pagina = P.buildPreferencePartial('siti_di_cui_ti_fidi', 'togli docs.google.com/forms/d/e/MODULO-A/viewform');
  assert.deepEqual(pagina.elenco.voci, ['docs.google.com/forms/d/e/MODULO-A/viewform']);
  const tolto = P.applicaElenco(pagina.elenco, { security: { safeBrowse: { trustedSites: ['team.com', 'docs.google.com/forms/d/e/MODULO-A/viewform'] } } });
  assert.deepEqual(tolto.lista, ['team.com']);
  assert.match(P.buildPreferencePartial('siti_di_cui_ti_fidi', 'aggiungi facebook').rifiuto, /non è un dominio/);
  // Un sito senza nome (http://1.2.3.4 con la password) entra col suo indirizzo, e così si toglie.
  assert.deepEqual(P.buildPreferencePartial('siti_di_cui_ti_fidi', 'togli http://1.2.3.4:8080/accesso').elenco.voci, ['1.2.3.4']);
});
