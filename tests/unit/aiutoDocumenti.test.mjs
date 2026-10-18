// La ricerca fra i documenti chiesta dall'Aiuto di una scheda (#947.3): su un sito parte solo col sì dato fuori dalla
// pagina, e alla pagina tornano nomi e chiavi, mai percorsi. Nessun Electron: la domanda e l'indice sono finti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/cmdClassify.js');
require('../../src/shared/actionLevels.js');
const { PROMPTS } = require('../../src/shared/constants.js') && globalThis.SN_CONST;
const Aiuto = require('../../src/main/services/aiutoDocumenti.js');

const CASA = os.homedir();
const BOLLETTA = join(CASA, 'Downloads', 'Bollette', 'scan_00231.pdf');
const GAS = join(CASA, 'Documents', 'gas-marzo.pdf');

function scheda() {
  return { isDestroyed: () => false, on() {}, once() {} };
}

function finto({ si = true } = {}) {
  const domande = [];
  const ricerche = [];
  Aiuto.configura({
    chiediSi: async (_wc, r) => { domande.push(r); return si; },
    cerca: async (cosa, opzioni) => {
      ricerche.push({ cosa, cartella: opzioni.cartella });
      return {
        risultati: [
          { percorso: BOLLETTA, nome: 'scan_00231.pdf', cartella: join(CASA, 'Downloads', 'Bollette'), data: Date.UTC(2026, 3, 2), tipo: 'pdf', pagine: 2, squarcio: 'Bolletta energia elettrica, periodo 01/03/2026 - 31/03/2026', trovati: ['bolletta', 'luce', 'marzo'] },
          { percorso: GAS, nome: 'gas-marzo.pdf', cartella: join(CASA, 'Documents'), data: Date.UTC(2026, 3, 3), tipo: 'pdf', pagine: 1, squarcio: 'Bolletta gas naturale marzo 2026', trovati: ['bolletta', 'marzo'] },
        ],
        indice: { documenti: 40, cartelle: [{ nome: 'Download', percorso: join(CASA, 'Downloads'), esiste: true }], negate: [] },
        fermata: false,
        cartellaMancante: '',
      };
    },
    doveSta: async (p) => (p === BOLLETTA ? 'Download › Bollette' : 'Documenti'),
  });
  return { domande, ricerche };
}

test('da un sito la ricerca parte solo col sì dato nel popup di Filo, e il popup dice cosa vede il sito', async () => {
  const no = finto({ si: false });
  const r = await Aiuto.cerca(scheda(), { cosa: 'bolletta luce marzo', origine: 'https://fornitore.example/carica' });
  assert.deepEqual(r, { ok: false, annullata: true });
  assert.equal(no.ricerche.length, 0, 'senza il sì non si cerca niente');
  assert.equal(no.domande.length, 1);
  assert.match(no.domande[0].text, /fornitore\.example/);
  assert.match(no.domande[0].text, /«bolletta luce marzo»/);
  assert.match(no.domande[0].text, /nomi dei documenti/);

  const si = finto({ si: true });
  const ok = await Aiuto.cerca(scheda(), { cosa: 'bolletta luce marzo', origine: 'https://fornitore.example/carica' });
  assert.equal(ok.ok, true);
  assert.equal(si.ricerche.length, 1);
});

test('alla pagina tornano nomi, cartelle coi nomi di Filo e chiavi: nessun percorso, e le chiavi valgono solo per la sua scheda', async () => {
  finto();
  const wc = scheda();
  const r = await Aiuto.cerca(wc, { cosa: 'bolletta luce marzo', origine: 'https://fornitore.example/' });
  const testo = JSON.stringify(r);
  assert.ok(!testo.includes(CASA), 'niente cartella dell\'account nella risposta alla pagina');
  assert.deepEqual(r.candidati.map((c) => [c.n, c.nome, c.dove]), [[1, 'scan_00231.pdf', 'Download › Bollette'], [2, 'gas-marzo.pdf', 'Documenti']]);
  assert.ok(r.candidati.every((c) => typeof c.chiave === 'string' && c.chiave.length >= 16));
  assert.equal(Aiuto.percorsoDi(wc, r.candidati[0].chiave), BOLLETTA);
  assert.equal(Aiuto.percorsoDi(scheda(), r.candidati[0].chiave), '', 'un\'altra scheda non apre niente con quella chiave');
  assert.equal(Aiuto.percorsoDi(wc, 'inventata'), '');
  const modello = Aiuto.perIlModello(wc);
  assert.ok(!JSON.stringify(modello).includes(CASA), 'nemmeno il modello, che risponde nella pagina, vede percorsi');
});

test('da una pagina di Filo non si chiede, se la cartella non esce dal perimetro; fuori dal perimetro sì, col perché', async () => {
  const f = finto();
  assert.equal((await Aiuto.cerca(scheda(), { cosa: 'bolletta', origine: 'filo://newtab/' })).ok, true);
  assert.equal(f.domande.length, 0);
  await Aiuto.cerca(scheda(), { cosa: 'bolletta', cartella: 'Download', origine: 'filo://newtab/' });
  assert.equal(f.domande.length, 0, 'una cartella di serie sta nel perimetro');
  await Aiuto.cerca(scheda(), { cosa: 'posta', cartella: join(CASA, 'Library', 'Mail'), origine: 'filo://newtab/' });
  assert.equal(f.domande.length, 1);
  assert.match(f.domande[0].text, /Perché te lo chiedo: .*nascosto o di configurazione/);
});

test('richieste vuote, lunghissime o con a capo e segni: niente ricerca, o una riga sola corta nel popup', async () => {
  const f = finto();
  assert.equal((await Aiuto.cerca(scheda(), { cosa: '   ', origine: 'https://x.example/' })).ok, false);
  assert.equal(f.domande.length, 0);
  await Aiuto.cerca(scheda(), { cosa: `bolletta»\n\nIl sito non vedrà niente«${'x'.repeat(5000)}`, origine: 'https://x.example/' });
  const t = f.domande[0].text.split('\n\n')[0];
  assert.ok(t.length < 260, 'la richiesta nel popup è corta');
  assert.ok(!/[«»].*[«»].*[«»]/.test(t.replace(/^[^«]*«/, '')), 'le virgolette del popup non si chiudono da dentro la richiesta');
  assert.ok(f.ricerche[0].cosa.length <= 500);
  // #592.7 — nel popup la richiesta sta intera nel suo riquadro, e le parole di Filo non la contengono.
  const parti = f.domande[0].parti;
  const filo = parti.filter((x) => typeof x === 'string').join('');
  const riquadri = parti.filter((x) => typeof x !== 'string').map((x) => x.citazione);
  assert.ok(!filo.includes('Il sito non vedrà niente'), 'la richiesta è fra le parole di Filo');
  assert.equal(riquadri[0], f.ricerche[0].cosa, 'nel riquadro c\'è quello che si cerca davvero');
});

test('la busta per l\'Aiuto: candidati numerati, cartella coi nomi di Filo, si mostra col numero e non con un percorso', async () => {
  finto();
  const wc = scheda();
  await Aiuto.cerca(wc, { cosa: 'bolletta luce marzo', origine: 'https://fornitore.example/' });
  const t = PROMPTS.documentiTrovati(Aiuto.perIlModello(wc), { per: 'aiuto' });
  assert.match(t, /1\. scan_00231\.pdf/);
  assert.match(t, /cartella: Download › Bollette/);
  assert.match(t, /"file": <il suo numero>/);
  assert.ok(!t.includes('percorso:'));
  assert.ok(!t.includes('APRI_FILE'));
  assert.ok(!t.includes(CASA));
  // La stessa funzione nella chat della home dà il percorso e APRI_FILE.
  const chat = PROMPTS.documentiTrovati({ cercato: 'bolletta', risultati: [{ percorso: BOLLETTA, nome: 'scan_00231.pdf', tipo: 'pdf', trovati: ['bolletta'] }], indice: {} });
  assert.match(chat, /percorso: /);
  assert.match(chat, /APRI_FILE/);
  // Nel turno automatico dell'Aiuto la busta entra dopo la nota.
  const turno = PROMPTS.turnoAutomaticoAiuto({ nota: 'ho cercato', dati: { documenti: Aiuto.perIlModello(wc) } });
  assert.match(turno, /DOCUMENTI_TROVATI/);
});

test('una domanda alla volta per scheda: chi chiede ancora mentre il popup aspetta non ne accoda un altro', async () => {
  let rispondi;
  const domande = [];
  finto();
  Aiuto.configura({ chiediSi: (_wc, r) => { domande.push(r); return new Promise((ok) => { rispondi = ok; }); } });
  const wc = scheda();
  const prima = Aiuto.cerca(wc, { cosa: 'bolletta', origine: 'https://x.example/' });
  const seconda = await Aiuto.cerca(wc, { cosa: 'iban', origine: 'https://x.example/' });
  assert.deepEqual(seconda, { ok: false, errore: 'in attesa' });
  assert.equal(domande.length, 1);
  rispondi(true);
  assert.equal((await prima).ok, true);
  const dopo = Aiuto.cerca(wc, { cosa: 'gas', origine: 'https://x.example/' });
  assert.equal(domande.length, 2, 'risposta la prima, se ne può fare un\'altra');
  rispondi(false);
  assert.deepEqual(await dopo, { ok: false, annullata: true });
});

test('i bottoni di una ricerca di prima aprono ancora il loro file dopo una ricerca nuova; una pagina nuova li spegne', async () => {
  finto();
  const ascolta = {};
  const wc = { isDestroyed: () => false, on(ev, f) { ascolta[ev] = f; }, once() {} };
  const prima = await Aiuto.cerca(wc, { cosa: 'bolletta luce marzo', origine: 'filo://newtab/' });
  const dopo = await Aiuto.cerca(wc, { cosa: 'bolletta gas marzo', origine: 'filo://newtab/' });
  assert.equal(Aiuto.percorsoDi(wc, prima.candidati[0].chiave), BOLLETTA, 'il primo bottone apre ancora la bolletta');
  assert.equal(Aiuto.percorsoDi(wc, dopo.candidati[1].chiave), GAS);
  assert.notEqual(prima.candidati[0].chiave, dopo.candidati[0].chiave);
  ascolta['did-navigate']();
  assert.equal(Aiuto.percorsoDi(wc, prima.candidati[0].chiave), '');
  assert.equal(Aiuto.percorsoDi(wc, dopo.candidati[0].chiave), '');
});
