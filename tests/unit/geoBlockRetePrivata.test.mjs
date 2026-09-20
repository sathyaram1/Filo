// #591, quinto giro — il riconoscimento del blocco geografico non deve partire
// sugli indirizzi della rete di casa, e non deve partire nelle finestre in
// incognito.
//
// Il router, il NAS, una stampante, un'applicazione in prova sulla propria
// macchina: nessun paese li blocca, quindi non c'è niente da riconoscere. E
// questo livello, a differenza del giudizio sui siti pericolosi, manda al
// modello il TITOLO e il TESTO della pagina: farlo partire lì dentro vuol dire
// far uscire di casa quello che c'è scritto sul pannello del router, pagandolo
// sulla chiave condivisa. La stessa cosa vale per una finestra in incognito,
// dove Filo si astiene da tutto il resto.
//
// La risposta «questo indirizzo è della rete di casa?» vive in UN posto solo
// (safebrowse/psl.js) e la leggono tutti e due i controlli: è la ragione per
// cui il difetto era rientrato da questa porta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const require_ = createRequire(import.meta.url);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GB = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));
const Engine = require_(join(REPO, 'src/main/services/safebrowse/engine.js'));
const { isHostPrivato } = require_(join(REPO, 'src/main/services/safebrowse/psl.js'));
const { installGeoBlock } = require_(join(REPO, 'src/main/tabs/tabGeoBlock.js'));

const PRIVATI = [
  '192.168.1.1', '192.168.0.254', '10.0.0.5', '172.16.4.2', '172.31.255.1',
  '127.0.0.1', '0.0.0.0', '169.254.10.9', '100.64.3.1',
  'localhost', 'nas', 'mio-nas.local', 'stampante.lan', 'app.internal',
  'wiki.intranet', 'router.home.arpa', '::1', '[fd00::1]', 'fe80::1',
];
const PUBBLICI = [
  'esempio.it', 'www.rai.it', 'sito.pages.dev', '8.8.8.8', '172.32.0.1',
  '192.167.1.1', '100.128.0.1',
];

const PAGINA = {
  title: 'Pannello di amministrazione',
  text: 'Accesso negato. Rete: CasaRossi.',
  statusCode: 403,
};

test('gli indirizzi della rete di casa non arrivano al livello 2', () => {
  for (const host of PRIVATI) {
    assert.equal(
      GB.shouldClassify({ ...PAGINA, host }), false,
      `${host} non deve far partire il riconoscimento del blocco geografico`,
    );
  }
});

test('gli indirizzi pubblici continuano ad arrivarci', () => {
  for (const host of PUBBLICI) {
    assert.equal(
      GB.shouldClassify({ ...PAGINA, host }), true,
      `${host} deve continuare a far partire il riconoscimento`,
    );
  }
});

test('una porta attaccata all\'indirizzo non fa saltare l\'esclusione', () => {
  for (const host of ['127.0.0.1:3000', 'localhost:8080', '192.168.1.1:8443', '[::1]:5173']) {
    assert.equal(GB.shouldClassify({ ...PAGINA, host }), false, host);
  }
});

test('nessuna chiamata al modello, e il testo della pagina resta a casa', async () => {
  const prompt = [];
  const cache = GB.createCache();
  const complete = async ({ messages }) => {
    prompt.push(messages.map((m) => m.content).join('\n'));
    return 'geo_block';
  };
  const r = await GB.classify(
    { ...PAGINA, host: '192.168.1.1', url: 'http://192.168.1.1/admin' },
    { complete, cache },
  );
  assert.equal(r.skipped, true);
  assert.deepEqual(prompt, []);
  assert.equal(r.route.proxy, false, 'e quindi nessuna riapertura attraverso il proxy');
});

test('la risposta su «che indirizzo è» è una sola, per tutti e due i controlli', () => {
  for (const host of PRIVATI) {
    assert.equal(isHostPrivato(host), true, host);
    assert.equal(
      Engine.evaluate(`http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}/`).level,
      'safe',
      `il giudizio sui siti pericolosi deve continuare a lasciar stare ${host}`,
    );
  }
  for (const host of PUBBLICI) assert.equal(isHostPrivato(host), false, host);
});

// ─── Incognito ───────────────────────────────────────────────────────────────

function scheda({ incognito }) {
  class FintoTabManager {
    constructor() {
      this.incognito = incognito;
      this.tabs = [{
        id: 1, title: 'Risultati', _lastStatus: 403,
        view: { webContents: { getURL: () => 'https://esempio-591.com/x', isDestroyed: () => false, send() {} } },
      }];
    }
  }
  installGeoBlock(FintoTabManager);
  return new FintoTabManager();
}

async function chiamateDa(tm) {
  const prompt = [];
  const cache = GB.createCache();
  globalThis.SN_GEO_CLASSIFY = (input) => GB.classify(input, {
    cache,
    complete: async ({ messages }) => { prompt.push(messages.map((m) => m.content).join('\n')); return 'errore_generico'; },
  });
  tm._geoLevel2Check(tm.tabs[0], 'https://esempio-591.com/x', 'Accesso negato. Diagnosi rara.');
  await new Promise((r) => setTimeout(r, 50));
  return prompt;
}

test('in incognito il testo della pagina non esce', async () => {
  const prompt = await chiamateDa(scheda({ incognito: true }));
  assert.deepEqual(prompt, [], 'in incognito nessuna chiamata al modello da questo livello');
});

test('in una finestra normale il riconoscimento continua a funzionare', async () => {
  const prompt = await chiamateDa(scheda({ incognito: false }));
  assert.equal(prompt.length, 1);
});
