// Verifica #591 — giro 5. Nelle finestre in incognito il riconoscimento del
// blocco geografico manda lo stesso titolo e testo della pagina al fornitore.
//
// In incognito Filo si astiene da tutto il resto: non salva la sessione, non
// archivia le schede, non fa il riordino automatico, non tiene cronologia. Il
// riconoscimento del blocco geografico invece parte identico, e quello che
// manda non è un'identità ma il CONTENUTO della pagina che si sta guardando.
// Chi apre una finestra in incognito sta dicendo «di questa pagina non deve
// restare niente».
//
// La scheda è finta, la chiamata al modello è finta.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const GB = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));
const { installGeoBlock } = require_(join(REPO, 'src/main/tabs/tabGeoBlock.js'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

const URL_PRIVATA = 'https://esempio-privato-591-g5.com/ricerca';
const TESTO = 'Accesso negato. Risultati per: diagnosi rara di Mario.';

// Una finestra in incognito, ferma su quella pagina, coi metodi veri installati.
function finestraInIncognito() {
  class FintoTabManager {
    constructor() {
      this.incognito = true;
      this.tabs = [{
        id: 1, title: 'Risultati', _lastStatus: 403,
        view: { webContents: { getURL: () => URL_PRIVATA, isDestroyed: () => false, send() {} } },
      }];
    }
  }
  installGeoBlock(FintoTabManager);
  return new FintoTabManager();
}

test('in incognito il testo della pagina non deve arrivare al fornitore', async () => {
  const prompt = [];
  const cache = GB.createCache();
  globalThis.SN_GEO_CLASSIFY = (input) => GB.classify(input, {
    cache,
    complete: async ({ messages }) => { prompt.push(messages.map((m) => m.content).join('\n')); return 'errore_generico'; },
  });

  const tm = finestraInIncognito();
  tm._geoLevel2Check(tm.tabs[0], URL_PRIVATA, TESTO);
  await attendi(200);

  expect(prompt.join('\n').includes('diagnosi rara'),
    'in incognito il contenuto della pagina non deve uscire verso il fornitore').toBe(false);
});

test('caso di riscontro: la funzione gemella manda solo l\'identità del sito, mai il testo', async () => {
  for (const c of Object.values(SB._caches)) { try { c.clear(); } catch (_) {} }
  for (const s of Object.values(SB._inFlight)) s.clear();
  const meta = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null, sandbox: null,
    llm: async (m) => { meta.push(JSON.stringify(m)); return null; },
  });
  // Un nome che imita un marchio: è il caso in cui il giudizio parte davvero.
  SB.analyze('https://paypa1-sicurezza-591g5.com/login', { hasPassword: true }, () => {});
  await attendi(300);
  expect(meta.length, 'il giudizio sui siti pericolosi deve essere partito').toBeGreaterThan(0);
  expect(meta.join('\n').includes('diagnosi rara'),
    'la funzione gemella non manda mai il contenuto della pagina').toBe(false);
});
