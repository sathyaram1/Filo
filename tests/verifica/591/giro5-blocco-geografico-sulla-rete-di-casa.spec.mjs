// Verifica #591 — giro 5. Il riconoscimento del blocco geografico parte anche
// sugli indirizzi della rete di casa.
//
// La segnalazione mette in fila due funzioni che Filo fa partire DA SOLO
// mentre si naviga: il giudizio sui siti pericolosi e il riconoscimento del
// blocco geografico. Al giro 2 la prima ha ricevuto l'esclusione degli
// indirizzi della rete locale — il router, il NAS, una stampante, un server di
// prova sulla propria macchina: là non ci arriva nessuno da una mail, quindi
// non c'è niente da controllare e non vale la pena pagarci una chiamata.
// La seconda quell'esclusione non ce l'ha.
//
// E qui pesa di più, perché quello che parte non sono metadati: il giudizio
// sui siti pericolosi manda al modello solo l'identità del sito (nome,
// certificato, età), mentre il riconoscimento del blocco geografico manda il
// TITOLO e il TESTO della pagina. Su un indirizzo della rete di casa quel
// testo è il pannello del router, il NAS, l'applicazione in sviluppo: esce
// dalla rete privata e arriva al fornitore, pagato sulla chiave condivisa.
//
// Logica pura: la chiamata al modello è finta.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const GB = require_(join(REPO, 'src/main/services/geoBlockClassifier.js'));
const Rules = require_(join(REPO, 'src/main/services/geoBlockRules.js'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

// Gli stessi indirizzi con cui il giro 2 ha chiuso la porta sull'altra metà.
const PRIVATI = [
  { host: '192.168.1.1', url: 'http://192.168.1.1/admin' },
  { host: '10.0.0.5', url: 'http://10.0.0.5/setup' },
  { host: '172.16.4.2', url: 'http://172.16.4.2/status' },
  { host: '127.0.0.1', url: 'http://127.0.0.1:3000/' },
  { host: 'localhost', url: 'http://localhost:8080/' },
  { host: 'mio-nas.local', url: 'http://mio-nas.local/files' },
  { host: 'stampante.lan', url: 'http://stampante.lan/' },
];

// Quello che c'è scritto sulla pagina del router: non deve uscire di casa.
const PAGINA = {
  title: 'Pannello di amministrazione — rete di casa',
  text: 'Accesso negato. Rete: CasaRossi. Dispositivi collegati: 7.',
};

function banco() {
  const prompt = [];
  const cache = GB.createCache();
  const complete = async ({ messages }) => {
    prompt.push(messages.map((m) => m.content).join('\n'));
    return 'geo_block';
  };
  return { prompt, cache, complete };
}

test('gli indirizzi della rete di casa non fanno partire il riconoscimento del blocco geografico', async () => {
  const { prompt, cache, complete } = banco();
  for (const p of PRIVATI) {
    await GB.classify(
      { ...PAGINA, statusCode: 403, host: p.host, url: p.url },
      { complete, cache },
    );
  }
  expect(prompt.length,
    'nessuna chiamata al modello per un indirizzo della rete di casa').toBe(0);
});

test('il testo della pagina di casa non deve finire nel prompt', async () => {
  const { prompt, cache, complete } = banco();
  await GB.classify(
    { ...PAGINA, statusCode: 403, host: '192.168.1.1', url: 'http://192.168.1.1/admin' },
    { complete, cache },
  );
  const tutto = prompt.join('\n');
  expect(tutto.includes('CasaRossi'),
    'il contenuto di una pagina della rete privata non deve uscire verso il fornitore').toBe(false);
});

test('caso di riscontro: su un indirizzo pubblico il riconoscimento parte', async () => {
  const { prompt, cache, complete } = banco();
  const r = await GB.classify(
    { title: 'Non disponibile', text: 'Access denied', statusCode: 403, host: 'esempio-tv-591-g5.it', url: 'https://esempio-tv-591-g5.it/diretta' },
    { complete, cache },
  );
  expect(prompt.length).toBe(1);
  expect(r.class).toBe('geo_block');
});

test('caso di riscontro: il giudizio sui siti pericolosi quell\'esclusione ce l\'ha', async () => {
  for (const c of Object.values(SB._caches)) { try { c.clear(); } catch (_) {} }
  for (const s of Object.values(SB._inFlight)) s.clear();
  const giudizi = [];
  const finestre = [];
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async (meta) => { giudizi.push(meta && meta.host); return null; },
    sandbox: async (url) => { finestre.push(url); return null; },
  });
  for (const p of PRIVATI) SB.analyze(p.url, {}, () => {});
  await attendi(300);
  expect(giudizi, 'la funzione gemella non parte sulla rete di casa').toEqual([]);
  expect(finestre).toEqual([]);
});

test('con un proxy configurato la pagina di casa verrebbe riaperta da un altro paese', async () => {
  // Il modello risponde «bloccato per paese» (è quello che risponde a una
  // pagina che dice «accesso negato»): da lì la scheda riapre l'indirizzo
  // attraverso il proxy, cioè manda la richiesta verso la rete privata
  // dell'utente fuori da casa sua.
  const { cache, complete } = banco();
  const r = await GB.classify(
    { ...PAGINA, statusCode: 403, host: '192.168.1.1', url: 'http://192.168.1.1/admin' },
    { complete, cache },
  );
  const decisione = Rules.decideGeoAction({
    flaggedDangerous: false, hasLoginCookies: false, proxyConfigured: true, stage: Rules.STAGES.INITIAL,
  });
  const riapre = Boolean(r.route && r.route.proxy) && decisione.action === Rules.ACTIONS.SILENT_RETRY;
  expect(riapre,
    'una pagina della rete di casa non deve essere riaperta attraverso un proxy').toBe(false);
});
