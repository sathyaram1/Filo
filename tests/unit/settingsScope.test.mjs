// #589 — che cosa vede una pagina WEB delle impostazioni.
//
// Dentro le impostazioni ci sono i segreti dell'utente: le chiavi dei servizi a
// pagamento, le credenziali del proxy (utente e password dentro l'URL), la
// chiave di Safe Browsing. Lo stesso oggetto viaggia verso i content script che
// Filo carica su ogni pagina visitata.
//
// Qui si asserisce il successo della difesa dal punto di vista di chi usa Filo:
// il payload costruito per un'origine https NON contiene i segreti e contiene
// tutto ciò che serve al content script; quello per filo:// è intero. Senza il
// fix (lista di esclusioni con dentro le sole apiKeys) i controlli sul proxy e
// sulla chiave di Safe Browsing sono rossi.
//
// L'ultimo test è la sentinella nell'altro verso: legge TUTTO il codice che
// gira dentro una pagina web — src/content/*.js e i moduli di src/shared che
// page-preload.js carica lì accanto — e pretende che ogni campo delle
// impostazioni usato da uno di loro sia fra quelli ammessi. Restringere la
// lista senza accorgersene spegnerebbe una funzione sulle pagine web in
// silenzio. I moduli condivisi contano quanto i content script: stanno nello
// stesso mondo isolato e leggono lo stesso oggetto. La lista dei condivisi non
// si scrive a mano — si ricava da page-preload.js — altrimenti la sentinella
// resterebbe indietro il giorno in cui qualcuno ne carica uno nuovo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'settingsScope.js'));

const S = globalThis.SN_SETTINGS_SCOPE;

// Impostazioni tipiche di un utente che ha configurato tutto: segreti veri
// accanto alle preferenze innocue.
const CHIAVE = 'sk-or-v1-SEGRETO-DA-NON-DARE-ALLE-PAGINE';
const PROXY_URL = 'socks5://utente-it:PASSWORD-SEGRETA@gate.provider.com:7000';
const SETTINGS = {
  provider: 'openrouter',
  apiKeys: { openrouter: CHIAVE, tavily: 'tvly-SEGRETA' },
  proxy: { datacenter: PROXY_URL, residential: PROXY_URL, bypass: '', defaultCountry: 'us', lastCountry: 'it' },
  security: {
    protectIpLeak: true,
    safeBrowse: { enabled: true, safeBrowsingKey: 'AIza-SEGRETA-SAFEBROWSING' },
    cookies: { mode: 'privacy', trustedSites: ['banca.example'] },
  },
  terminal: { enabled: true, shell: 'bash' },
  theme: 'dark',
  themeTokens: { accent: '#1e90ff' },
  tabColor: { opacita_tab: 0.6 },
  featureFlags: { spellcheck: true, help: false },
  blocklist: ['esempio.test'],
  tts: { voice: '', rate: 1, pitch: 1, modelVoice: '' },
  models: { transcribe_audio: 'whisper' },
  modelRegistry: { whisper: { provider: 'openrouter', model: 'openai/whisper-1' } },
  monthlyLimitEur: 5,
  agentStyle: 'Rispondi in modo conciso.',
};

// Cerca una stringa in tutto l'oggetto, a qualsiasi profondità: un segreto
// sepolto dentro un sotto-oggetto è un segreto uscito lo stesso.
function contiene(obj, ago) {
  return JSON.stringify(obj ?? null).includes(ago);
}

test('verso una pagina https non esce nessun segreto', () => {
  const web = S.settingsForWeb(SETTINGS);
  assert.equal(web.apiKeys, undefined, 'le chiavi dei servizi a pagamento non escono');
  assert.equal(web.proxy, undefined, 'le credenziali del proxy non escono');
  assert.equal(web.security, undefined, 'le impostazioni di sicurezza (chiave Safe Browsing) non escono');
  assert.equal(web.terminal, undefined, 'la modalità terminale non riguarda le pagine web');
  assert.ok(!contiene(web, CHIAVE), 'la chiave API non compare da nessuna parte nel payload');
  assert.ok(!contiene(web, 'PASSWORD-SEGRETA'), 'la password del proxy non compare da nessuna parte nel payload');
  assert.ok(!contiene(web, 'AIza-SEGRETA-SAFEBROWSING'), 'la chiave di Safe Browsing non compare nel payload');
});

test('verso una pagina https arriva tutto ciò che serve al content script', () => {
  const web = S.settingsForWeb(SETTINGS);
  assert.equal(web.theme, 'dark');
  assert.deepEqual(web.themeTokens, { accent: '#1e90ff' });
  assert.deepEqual(web.tabColor, { opacita_tab: 0.6 });
  assert.deepEqual(web.featureFlags, { spellcheck: true, help: false });
  assert.deepEqual(web.blocklist, ['esempio.test']);
  assert.deepEqual(web.tts, SETTINGS.tts);
  assert.deepEqual(web.models, SETTINGS.models);
  assert.deepEqual(web.modelRegistry, SETTINGS.modelRegistry);
});

test('è una lista di campi ammessi: un segreto aggiunto domani resta fuori da solo', () => {
  const domani = { ...SETTINGS, sincronizzazione: { token: 'NUOVO-SEGRETO-MAI-VISTO' } };
  const web = S.settingsForWeb(domani);
  assert.equal(web.sincronizzazione, undefined);
  for (const k of Object.keys(web)) {
    assert.ok(S.isWebField(k), `campo non ammesso uscito verso il web: ${k}`);
  }
});

test('le pagine filo:// ricevono l\'oggetto intero, le altre origini no', () => {
  const interna = S.settingsForOrigin(SETTINGS, 'filo://newtab/');
  assert.equal(interna, SETTINGS, 'a filo:// va l\'oggetto così com\'è');
  assert.equal(interna.apiKeys.openrouter, CHIAVE);

  for (const origine of ['https://esempio.test/pagina', 'http://127.0.0.1:1234/', 'file:///tmp/x.html', '', undefined]) {
    const fuori = S.settingsForOrigin(SETTINGS, origine);
    assert.ok(!contiene(fuori, CHIAVE), `segreto uscito verso ${String(origine)}`);
    assert.ok(!contiene(fuori, 'PASSWORD-SEGRETA'), `credenziali proxy uscite verso ${String(origine)}`);
  }
});

test('un\'origine che imita filo:// non passa per interna', () => {
  for (const finta of ['https://filo://x', 'https://filo.example/filo://', 'filo:/newtab', 'FILO://newtab/']) {
    assert.ok(!contiene(S.settingsForOrigin(SETTINGS, finta), CHIAVE), `segreto uscito verso ${finta}`);
  }
});

test('input limite: niente impostazioni, oggetto vuoto, valori strani', () => {
  assert.deepEqual(S.settingsForWeb(null), {});
  assert.deepEqual(S.settingsForWeb(undefined), {});
  assert.deepEqual(S.settingsForWeb('stringa'), {});
  assert.deepEqual(S.settingsForWeb({}), {});
  // Un campo ammesso ma assente resta assente: chi legge cade sui suoi ripieghi.
  const soloTema = S.settingsForWeb({ theme: 'light' });
  assert.deepEqual(Object.keys(soloTema), ['theme']);
  // Un campo ammesso con valore nullo passa com'è (è una scelta dell'utente).
  assert.deepEqual(S.settingsForWeb({ blocklist: null }), { blocklist: null });
});

// ── Sentinella: la lista ammette tutto ciò che i content script usano ───────
// Ogni file che finisce dentro una pagina web: i content script, più i moduli
// condivisi che page-preload.js carica insieme a loro (letti da lì, non da un
// elenco a mano).
function fileCheGiranoNellePagine() {
  const dirContent = join(ROOT, 'src', 'content');
  const elenco = readdirSync(dirContent)
    .filter((n) => n.endsWith('.js'))
    .map((n) => ({ etichetta: `src/content/${n}`, percorso: join(dirContent, n) }));
  const preload = readFileSync(join(ROOT, 'src', 'preload', 'page-preload.js'), 'utf8');
  const condivisi = new Set();
  for (const m of preload.matchAll(/SHARED_DIR\s*,\s*'([^']+\.js)'/g)) condivisi.add(m[1]);
  assert.ok(condivisi.size > 0, 'nessun modulo condiviso trovato in page-preload.js: è cambiato come li carica?');
  for (const n of condivisi) {
    elenco.push({ etichetta: `src/shared/${n}`, percorso: join(ROOT, 'src', 'shared', n) });
  }
  return elenco;
}

test('ogni campo delle impostazioni usato dentro una pagina web è ammesso', () => {
  const usati = new Map(); // campo → file dove si vede
  for (const { etichetta, percorso } of fileCheGiranoNellePagine()) {
    const src = readFileSync(percorso, 'utf8')
      // via i commenti: lì un `settings.security` è una spiegazione, non un uso
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\bsettings\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)) {
      if (!usati.has(m[1])) usati.set(m[1], etichetta);
    }
  }
  assert.ok(usati.size > 0, 'la sentinella non ha letto nulla: percorso sbagliato?');
  for (const [campo, file] of usati) {
    assert.ok(
      S.isWebField(campo),
      `${file} legge settings.${campo}, ma il campo non è fra quelli ammessi verso le pagine web `
      + '(aggiungilo a WEB_SETTINGS_FIELDS in src/shared/settingsScope.js, oppure smetti di leggerlo lì)',
    );
  }
});
