// #589 — verso un sito le impostazioni viaggiano ritagliate su una lista di campi
// AMMESSI (le chiavi dei servizi e le credenziali del proxy restano a casa), sia
// nella spinta SETTINGS_UPDATED sia nelle letture; le pagine filo:// hanno tutto.
// Senza il fix è ROSSO: la spinta mandava l'oggetto intero a ogni frame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
const { DEFAULT_SETTINGS } = globalThis.SN_CONST;
const W = require(join(ROOT, 'src', 'main', 'services', 'impostazioniPerOrigine.js'));

const CHIAVE = 'sk-or-v1-SEGRETO-589';
const PROXY = 'socks5://utente-{country}:parola@gate.provider.example:7000';

function impostazioniConSegreti() {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.apiKeys = { openrouter: CHIAVE, tavily: 'tvly-SEGRETO' };
  s.proxy = { ...s.proxy, datacenter: PROXY, residential: PROXY, bypass: '<local>' };
  s.theme = 'dark';
  s.themeTokens = { accent: '#c0662f' };
  s.blocklist = ['esempio.it'];
  s.featureFlags = { ...s.featureFlags, spellcheck: false };
  s.models = { ...s.models, transcribe_audio: 'whisper' };
  s.modelRegistry = {
    whisper: { provider: 'openrouter', model: 'openai/whisper', label: 'Whisper', inputs: ['audio'], outputs: ['text'], apiKey: 'sk-DENTRO-LA-VOCE', baseUrl: 'https://privato.example' },
  };
  return s;
}

const messaggio = (settings) => ({ type: 'settings_updated', settings });
const testo = (v) => JSON.stringify(v);

test('la spinta verso un sito https non porta chiavi dei servizi né credenziali del proxy; verso filo:// sì', () => {
  const s = impostazioniConSegreti();
  const web = W.messaggioPerDestinazione(messaggio(s), 'https://www.esempio.it/articolo');
  assert.equal(web.type, 'settings_updated');
  assert.ok(!testo(web).includes(CHIAVE), 'chiave OpenRouter arrivata al sito');
  assert.ok(!testo(web).includes('tvly-SEGRETO'), 'chiave Tavily arrivata al sito');
  assert.ok(!testo(web).includes('parola@gate'), 'credenziali del proxy arrivate al sito');
  assert.equal(web.settings.apiKeys, undefined);
  assert.equal(web.settings.proxy, undefined);

  const filo = W.messaggioPerDestinazione(messaggio(s), 'filo://options/options.html');
  assert.equal(filo.settings.apiKeys.openrouter, CHIAVE);
  assert.equal(filo.settings.proxy.datacenter, PROXY);
});

test('verso un sito arriva quello che i content script usano, con i valori veri', () => {
  const s = impostazioniConSegreti();
  const web = W.impostazioniPerOrigine(s, 'https://www.esempio.it/pagina.html');
  assert.equal(web.theme, 'dark');
  assert.deepEqual(web.themeTokens, { accent: '#c0662f' });
  assert.deepEqual(web.blocklist, ['esempio.it']);
  assert.equal(web.featureFlags.spellcheck, false);
  assert.deepEqual(web.tts, { voice: s.tts.voice, rate: s.tts.rate, pitch: s.tts.pitch });
  assert.deepEqual(web.tabColor, s.tabColor);
  assert.equal(web.models.transcribe_audio, 'whisper');
  assert.deepEqual(web.modelRegistry.whisper, {
    provider: 'openrouter', model: 'openai/whisper', label: 'Whisper', inputs: ['audio'], outputs: ['text'],
  }, 'di una voce del registro passano solo i campi del menu della dettatura');
});

test('dei siti esclusi un sito riceve solo la voce che lo riguarda, in ogni strada', () => {
  const s = { ...impostazioniConSegreti(), blocklist: ['esempio.it', 'banca-utente.example', 'lavoro.example'] };
  assert.deepEqual(W.impostazioniPerOrigine(s, 'https://altro.example/').blocklist, []);
  assert.deepEqual(W.impostazioniPerOrigine(s, 'https://www.esempio.it/a').blocklist, ['esempio.it']);
  // Un riquadro di terze parti dentro la pagina esclusa: conta la scheda che lo contiene.
  const riquadro = { frame: { url: 'https://widget.example/embed' }, tab: { url: 'https://conto.banca-utente.example/' } };
  assert.deepEqual(W.impostazioniPerOrigine(s, riquadro.tab.url, W.indirizziDelMittente(riquadro)).blocklist, ['banca-utente.example']);
  const spinta = W.messaggioPerDestinazione(messaggio(s), 'https://widget.example/embed', 'https://conto.banca-utente.example/');
  assert.deepEqual(spinta.settings.blocklist, ['banca-utente.example']);
  assert.deepEqual(W.messaggioPerDestinazione(messaggio(s), 'https://altro.example/').settings.blocklist, []);
  assert.deepEqual(W.storagePerOrigine({ settings: s }, 'https://lavoro.example/').settings.blocklist, ['lavoro.example']);
  for (const url of ['about:blank', '', 'blob:https://esempio.it/1', 'https://esempio.it.altro.example/', 'https://nonesempio.it/']) {
    assert.deepEqual(W.impostazioniPerWeb(s, [url]).blocklist, [], url);
  }
  assert.deepEqual(W.impostazioniPerWeb({ blocklist: 'rotto' }, ['https://esempio.it/']).blocklist, []);
  assert.deepEqual(W.impostazioniPerOrigine(s, 'filo://options/options.html').blocklist, s.blocklist);
});

test('un riquadro filo:// dentro la scheda di un sito vale come sito', () => {
  const s = impostazioniConSegreti();
  for (const pagina of ['https://sito.example/', '', 'about:blank']) {
    const m = W.messaggioPerDestinazione(messaggio(s), 'filo://newtab/', pagina);
    assert.equal(m.settings.apiKeys, undefined, `pagina ${pagina || '(vuota)'}`);
    assert.equal(m.settings.proxy, undefined, `pagina ${pagina || '(vuota)'}`);
    assert.equal(W.messaggioPerDestinazione({ type: 'filo_dashboard_updated', message: 'x' }, 'filo://newtab/', pagina), null);
  }
  assert.equal(W.messaggioPerDestinazione(messaggio(s), 'filo://newtab/', 'filo://options/options.html').settings.apiKeys.openrouter, CHIAVE);
  assert.equal(W.messaggioPerDestinazione(messaggio(s), 'filo://shell/shell.html').settings.apiKeys.openrouter, CHIAVE);
});

test('da un sito si chiedono solo le azioni della barra d\'aiuto, confermate o no', () => {
  const web = 'https://sito.example/';
  assert.equal(W.azioneAmmessaDa({ type: 'INVIA_FEEDBACK', testo: 'x' }, web), true);
  assert.equal(W.azioneAmmessaDa({ type: 'invia_feedback' }, web), true);
  for (const type of ['IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'SALVA_LEZIONE', 'CANCELLA_MEMORIA', 'ESEGUI_COMANDO', '', undefined]) {
    assert.equal(W.azioneAmmessaDa({ type }, web), false, String(type));
    assert.equal(W.azioneAmmessaDa({ type }, 'filo://newtab/'), true, String(type));
  }
  // «Apri il link» della barra: indirizzi web sì, pagine di Filo e altri schemi no.
  for (const url of ['https://altro.example/articolo', 'http://127.0.0.1:8080/x', 'altro.example']) {
    assert.equal(W.azioneAmmessaDa({ type: 'NAVIGA', url }, web), true, url);
  }
  assert.equal(W.azioneAmmessaDa({ type: 'naviga', href: 'https://altro.example/' }, web), true);
  for (const url of ['filo://options/', ' FILO://newtab/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', '', undefined]) {
    assert.equal(W.azioneAmmessaDa({ type: 'NAVIGA', url }, web), false, String(url));
  }
  assert.equal(W.azioneAmmessaDa({ type: 'NAVIGA', url: 'filo://options/' }, 'filo://newtab/'), true);
  for (const url of ['', 'about:blank', 'blob:https://sito.example/1']) {
    assert.equal(W.azioneAmmessaDa({ type: 'ESEGUI_COMANDO' }, url), false, url || '(vuoto)');
  }
  assert.equal(W.azioneAmmessaDa(null, web), false);
});

// La barra d'aiuto dei siti emette le azioni che il suo prompt le descrive e quelle
// che manda da sé (apri il link): una che manca dalla lista si spegne solo sui siti.
test('sentinella: ogni azione di Filo che la barra d\'aiuto chiede è fra quelle ammesse dai siti', () => {
  require(join(ROOT, 'src', 'shared', 'preferences.js'));
  require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
  const src = readFileSync(join(ROOT, 'src', 'shared', 'constants.js'), 'utf8');
  const descritte = [...src.matchAll(/"action":\s*"filo",\s*"filo":\s*\{\s*"type":\s*"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(descritte.includes('INVIA_FEEDBACK'), 'la sentinella non vede più le azioni del prompt della barra d\'aiuto');
  const siti = scriptDeiSiti().map((x) => x.src).join('\n');
  const mandate = [...siti.matchAll(/runFiloAction\(\s*\{\s*type:\s*['"]([A-Za-z_]+)['"]/g)].map((m) => m[1].toUpperCase());
  assert.ok(mandate.includes('NAVIGA'), 'la sentinella non vede più le azioni che la barra manda da sé');
  assert.deepEqual([...descritte, ...mandate].filter((t) => !W.AZIONI_WEB.has(t)), [], 'azioni della barra d\'aiuto non ammesse dai siti');
  for (const t of W.AZIONI_WEB) assert.ok(globalThis.SN_ACTION_LEVELS.levelFor({ type: t }), `azione ammessa inesistente: ${t}`);
});

test('un campo nuovo non elencato non raggiunge i siti (lista di ammessi, non di esclusi)', () => {
  const s = { ...impostazioniConSegreti(), nuovoServizio: { token: 'tok-NUOVO' }, terminal: { enabled: true, shell: 'bash' } };
  const web = W.impostazioniPerOrigine(s, 'https://sito.example');
  assert.equal(web.nuovoServizio, undefined);
  assert.equal(web.terminal, undefined);
  assert.ok(!testo(web).includes('tok-NUOVO'));
});

test('dentro una sezione ammessa passa solo il campo dichiarato', () => {
  const s = impostazioniConSegreti();
  s.tts = { ...s.tts, rate: 1.3, chiaveServizioVoce: 'tok-VOCE' };
  s.featureFlags = { ...s.featureFlags, nuovaFunzione: 'tok-FLAG' };
  s.tabColor = { ...s.tabColor, segreto: 'tok-COLORE' };
  s.models = { ...s.models, explain: 'claude', segreto: 'tok-MODELLI' };
  for (const web of [
    W.impostazioniPerOrigine(s, 'https://sito.example/'),
    W.messaggioPerDestinazione(messaggio(s), 'https://sito.example/').settings,
    W.storagePerOrigine({ settings: s }, 'https://sito.example/').settings,
  ]) {
    for (const t of ['tok-VOCE', 'tok-FLAG', 'tok-COLORE', 'tok-MODELLI']) assert.ok(!testo(web).includes(t), `${t} arrivato al sito`);
    assert.equal(web.tts.rate, 1.3);
    assert.deepEqual(Object.keys(web.models), ['transcribe_audio']);
  }
  assert.equal(W.impostazioniPerOrigine(s, 'filo://options/options.html').tts.chiaveServizioVoce, 'tok-VOCE');
});

test('ogni destinazione che non è filo:// vale come sito, anche vuota o somigliante', () => {
  const s = impostazioniConSegreti();
  for (const url of ['', undefined, null, 'about:blank', 'data:text/html,x', 'file:///C:/x.html', 'https://filo.example/', 'http://x/?u=filo://options']) {
    const m = W.messaggioPerDestinazione(messaggio(s), url);
    assert.equal(m.settings.apiKeys, undefined, String(url));
  }
});

test('verso un sito la spinta porta solo i tipi che il suo content script ascolta; verso filo:// tutto', () => {
  const tts = { type: 'tts_stop' };
  assert.equal(W.messaggioPerDestinazione(tts, 'https://sito.example'), tts);
  assert.equal(W.messaggioPerDestinazione(null, 'https://sito.example'), null);
  const intervista = { type: 'filo_onboarding_updated', onboarding: { thread: [{ role: 'user', text: 'mi chiamo Anna' }] } };
  const home = { type: 'filo_dashboard_updated', message: 'Anna, domani la visita', suggestions: [] };
  for (const m of [intervista, home, { type: 'tipo_nuovo_di_domani', dato: 'x' }]) {
    for (const url of ['https://sito.example', 'about:blank', 'blob:http://sito.example/1', '']) {
      assert.equal(W.messaggioPerDestinazione(m, url), null, `${m.type} arrivato a ${url || '(vuoto)'}`);
    }
    assert.equal(W.messaggioPerDestinazione(m, 'filo://dashboard/dashboard.html'), m);
  }
});

test('un avviso da mostrare arriva a un sito solo nel frame principale della scheda in primo piano', () => {
  const avviso = { type: 'show_toast', text: 'Feedback inviato, ma non sono riuscito a caricare: estratto-conto.pdf' };
  assert.equal(W.messaggioPerDestinazione(avviso, 'https://sito.example/', undefined, { inVista: true }), avviso);
  assert.equal(W.messaggioPerDestinazione(avviso, 'https://sito.example/'), null, 'scheda sullo sfondo');
  assert.equal(W.messaggioPerDestinazione(avviso, 'https://sito.example/', undefined, { inVista: false }), null);
  assert.equal(W.messaggioPerDestinazione(avviso, 'https://widget.example/', 'https://sito.example/', { inVista: true, riquadro: true }), null, 'riquadro');
  assert.equal(W.messaggioPerDestinazione(avviso, 'filo://newtab/'), avviso, 'le pagine di Filo lo ricevono comunque');

  const inviati = [];
  const scheda = (pagina) => {
    const principale = { url: pagina, parent: null, detached: false, send: (_c, m) => inviati.push({ url: pagina, m }) };
    const riquadro = { url: 'https://widget.example/', parent: principale, detached: false, send: (_c, m) => inviati.push({ url: 'riquadro', m }) };
    return { isDestroyed: () => false, getURL: () => pagina, mainFrame: { framesInSubtree: [principale, riquadro] } };
  };
  W.spingiAllaScheda(scheda('https://in-vista.example/'), avviso, { inVista: true });
  W.spingiAllaScheda(scheda('https://sfondo.example/'), avviso, { inVista: false });
  W.spingiAllaScheda(scheda('https://senza-dire.example/'), avviso);
  assert.deepEqual(inviati.map((x) => x.url), ['https://in-vista.example/']);

  const finestre = [];
  const finestra = (focus) => ({ isFocused: () => focus, webContents: { isDestroyed: () => false, getURL: () => 'https://accounts.example/login', send: (_c, m) => finestre.push({ focus, m }) } });
  W.spingiAllaFinestra(finestra(true), avviso);
  W.spingiAllaFinestra(finestra(false), avviso);
  assert.deepEqual(finestre.map((x) => x.focus), [true]);
});

test('le letture dello storage grezzo seguono la stessa regola; le altre chiavi restano', () => {
  const s = impostazioniConSegreti();
  const valore = { settings: s, sn_personal_dict: ['ciao'] };
  const web = W.storagePerOrigine(valore, 'https://sito.example');
  assert.equal(web.settings.apiKeys, undefined);
  assert.equal(web.settings.proxy, undefined);
  assert.equal(web.settings.theme, 'dark');
  assert.deepEqual(web.sn_personal_dict, ['ciao']);
  assert.equal(W.storagePerOrigine(valore, 'filo://dashboard/dashboard.html').settings.apiKeys.openrouter, CHIAVE);
  assert.deepEqual(W.storagePerOrigine({ sn_personal_dict: [] }, 'https://sito.example'), { sn_personal_dict: [] });
});

test('un sito chiede al magazzino solo gli scomparti dei content script, in ogni forma di richiesta', () => {
  const web = 'https://sito.example';
  assert.deepEqual(W.chiaviStoragePerOrigine(null, web), [...W.CHIAVI_STORAGE_WEB]);
  assert.deepEqual(W.chiaviStoragePerOrigine('filo_memory', web), []);
  assert.equal(W.chiaviStoragePerOrigine('sn_personal_dict', web), 'sn_personal_dict');
  assert.deepEqual(W.chiaviStoragePerOrigine(['filo_memory', 'savedPages', 'sn_icon_layout', 7], web), ['sn_icon_layout']);
  assert.deepEqual(W.chiaviStoragePerOrigine({ clipboardHistory: [], sn_autocorrect: {} }, web), { sn_autocorrect: {} });
  assert.equal(W.chiaviStoragePerOrigine(null, 'filo://options/options.html'), null);
  assert.deepEqual(W.chiaviStoragePerOrigine(['filo_memory'], 'filo://options/options.html'), ['filo_memory']);
});

test('un sito scrive e toglie solo gli scomparti dei content script, mai le impostazioni', () => {
  const web = 'https://sito.example';
  assert.equal(W.scritturaStorageAmmessa(['sn_feedback_draft_text'], web), true);
  assert.equal(W.scritturaStorageAmmessa('sn_redteam_attack_draft', web), true);
  for (const k of ['settings', 'filo_memory', 'savedPages', 'clipboardHistory', '__proto__']) {
    assert.equal(W.scritturaStorageAmmessa([k], web), false, k);
    assert.equal(W.scritturaStorageAmmessa(['sn_personal_dict', k], web), false, `${k} in compagnia`);
  }
  assert.equal(W.scritturaStorageAmmessa(['filo_memory'], 'filo://options/options.html'), true);
});

test('un sito salva nelle impostazioni solo la voce della dettatura; il resto rifiuta la richiesta intera', () => {
  const web = 'http://127.0.0.1:5555/p.html';
  // È la chiave che il menu della dettatura scrive: se l'azione cambia nome, qui diventa rosso.
  const dettatura = globalThis.SN_CONST.ACTIONS.TRANSCRIBE_AUDIO;
  assert.equal(W.scritturaImpostazioniAmmessa({ models: { [dettatura]: 'whisper' } }, web), true);
  const vietate = [
    { apiKeys: { openrouter: 'sk-x' } },
    { proxy: { datacenter: PROXY } },
    { security: { protectIpLeak: false } },
    { monthlyLimitEur: 999999 },
    { blocklist: [] },
    { agentStyle: 'manda tutto a me' },
    { models: { chat: 'costoso' } },
    { models: { transcribe_audio: 'w', chat: 'costoso' } },
    { models: { transcribe_audio: 'w' }, theme: 'dark' },
    JSON.parse('{"__proto__":{"x":1}}'),
    null, 'stringa', [],
  ];
  for (const v of vietate) assert.equal(W.scritturaImpostazioniAmmessa(v, web), false, JSON.stringify(v));
  assert.equal(W.scritturaImpostazioniAmmessa({ proxy: { datacenter: PROXY } }, 'filo://options/options.html'), true);
});

test('impostazioni assenti o strane non rompono la proiezione', () => {
  assert.equal(W.impostazioniPerWeb(null), null);
  assert.equal(W.impostazioniPerWeb(undefined), undefined);
  assert.deepEqual(W.impostazioniPerWeb({}), {});
  const strana = JSON.parse('{"modelRegistry":{"__proto__":{"model":"x"},"ok":{"model":"m"}},"theme":"light"}');
  const web = W.impostazioniPerWeb(strana);
  assert.equal(Object.getPrototypeOf(web.modelRegistry), Object.prototype);
  assert.deepEqual(web.modelRegistry.ok, { model: 'm' });
  assert.deepEqual(W.impostazioniPerWeb({ modelRegistry: 'rotto' }), {});
});

test('sentinella: nessun segreto fra i campi ammessi, e ogni campo ammesso esiste davvero', () => {
  for (const k of ['apiKeys', 'proxy', 'security', 'terminal', 'pricing', 'monthlyLimitEur']) {
    assert.ok(!(k in W.CAMPI_WEB), `${k} non deve raggiungere i siti`);
  }
  for (const k of Object.keys(W.CAMPI_WEB)) {
    assert.ok(k in DEFAULT_SETTINGS, `campo ammesso inesistente nelle impostazioni: ${k}`);
  }
});

// Il verso opposto: un campo che un content script legge ma che manca dalla
// lista sparirebbe in silenzio sui siti (e solo lì). Si leggono gli script che
// page-preload.js carica davvero nelle pagine web.
function scriptDeiSiti() {
  const preload = readFileSync(join(ROOT, 'src', 'preload', 'page-preload.js'), 'utf8');
  const file = ['src/preload/page-preload.js'];
  for (const m of preload.matchAll(/require\(path\.join\((CONTENT_DIR|SHARED_DIR), '([\w.-]+\.js)'\)\)/g)) {
    file.push(`src/${m[1] === 'CONTENT_DIR' ? 'content' : 'shared'}/${m[2]}`);
  }
  assert.ok(file.some((f) => f.endsWith('content/content.js')) && file.length > 20, 'elenco degli script dei siti non trovato');
  return file.map((f) => ({ f, src: readFileSync(join(ROOT, f), 'utf8').replace(/^\s*\/\/.*$/gm, '') }));
}

// I campi delle impostazioni che un sorgente legge, in tutte le forme in cui si
// arriva all'oggetto: la variabile `settings`, un suo alias, una funzione che lo
// restituisce, il campo `.settings` di una risposta; col punto, con le quadre,
// o scomponendolo.
function campiLetti(src) {
  const radici = ['settings', '[\\w$.]*getSettings\\(\\)', '[\\w$]+\\??\\.settings'];
  const alias = /(?:\b(?:const|let|var)\s+|[,;{}\n]\s*)([A-Za-z_$][\w$]*)\s*=(?!=)\s*(?:await\s+)?(?:settings|[\w$.]*getSettings\(\)|[\w$]+\??\.settings)\s*(?:[;,)\n]|\|\||\?\?)/g;
  for (const m of src.matchAll(alias)) radici.push(m[1].replace(/\$/g, '\\$'));
  const campi = new Set();
  for (const r of radici) {
    const punto = new RegExp(`(?:^|[^\\w$.])(?:${r})\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)`, 'g');
    const quadre = new RegExp(`(?:^|[^\\w$.])(?:${r})\\s*(?:\\?\\.)?\\[\\s*['"]([\\w$]+)['"]\\s*\\]`, 'g');
    const scomposto = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*(?:await\\s+)?(?:${r})(?![\\w$])`, 'g');
    for (const m of src.matchAll(punto)) campi.add(m[1]);
    for (const m of src.matchAll(quadre)) campi.add(m[1]);
    for (const m of src.matchAll(scomposto)) {
      for (const pezzo of m[1].split(',')) {
        const k = pezzo.trim().split(/[:=\s]/)[0];
        if (k) campi.add(k);
      }
    }
  }
  return campi;
}

test('la sentinella dei campi letti riconosce tutte le forme di lettura', () => {
  const casi = {
    'x = settings.theme': 'theme',
    'x = settings?.tts?.voice': 'tts',
    "x = settings['tabColor']": 'tabColor',
    'x = deps.getSettings().models[k]': 'models',
    'x = Content.getSettings()?.featureFlags': 'featureFlags',
    'const { blocklist, themeTokens: t } = settings;': 'blocklist',
    'const { security } = deps.getSettings();': 'security',
    'x = res.settings.proxy': 'proxy',
    'x = msg?.settings?.pricing': 'pricing',
    'const cfg = deps.getSettings();\n y = cfg.terminal': 'terminal',
    'const s = await load(), cfg = res.settings;\n y = cfg.agentStyle': 'agentStyle',
  };
  for (const [src, campo] of Object.entries(casi)) {
    assert.ok(campiLetti(src).has(campo), `non vista la lettura di ${campo} in: ${src}`);
  }
  assert.ok(!campiLetti('x = mySettings.proxy; y = tts.voice').has('proxy'), 'lettura inventata da un nome che contiene settings');
});

test('sentinella: ogni impostazione letta dai content script dei siti è fra i campi ammessi', () => {
  const letture = new Set();
  for (const { f, src } of scriptDeiSiti()) {
    for (const k of campiLetti(src)) if (k in DEFAULT_SETTINGS) letture.add(`${k} (${f})`);
  }
  assert.ok([...letture].some((l) => l.startsWith('theme ')), 'la sentinella non vede più le letture di content.js');
  const mancanti = [...letture].filter((l) => !(l.split(' ')[0] in W.CAMPI_WEB));
  assert.deepEqual(mancanti, [], 'impostazioni lette sui siti ma non ammesse in impostazioniPerOrigine.js');
});

// Dentro le sezioni elencate campo per campo: ogni campo che il codice dei siti
// legge è ammesso, e ogni campo nuovo di una sezione si decide quando nasce.
const SEZIONI_A_CAMPI = Object.keys(W.CAMPI_WEB).filter((k) => W.CAMPI_WEB[k] !== true && !('*' in W.CAMPI_WEB[k]));

test('sentinella: ogni campo letto dai siti dentro una sezione elencata campo per campo è ammesso', () => {
  const { ACTIONS } = globalThis.SN_CONST;
  const letti = new Set();
  for (const { f, src } of scriptDeiSiti()) {
    for (const S of SEZIONI_A_CAMPI) {
      const punto = new RegExp(`(?<![\\w$'"\`])${S}\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)`, 'g');
      const quadre = new RegExp(`(?<![\\w$'"\`])${S}\\s*(?:\\?\\.)?\\[\\s*(?:(?:[\\w$]+\\.)*ACTIONS\\.([A-Z_]+)|['"]([\\w$]+)['"])\\s*\\]`, 'g');
      for (const m of src.matchAll(punto)) letti.add(`${S}.${m[1]} (${f})`);
      for (const m of src.matchAll(quadre)) letti.add(`${S}.${m[1] ? ACTIONS[m[1]] : m[2]} (${f})`);
    }
  }
  for (const atteso of ['tts.rate', 'featureFlags.spellcheck', 'models.transcribe_audio']) {
    assert.ok([...letti].some((l) => l.startsWith(`${atteso} `)), `la sentinella non vede più la lettura di ${atteso}`);
  }
  const mancanti = [...letti].filter((l) => {
    const [S, campo] = l.split(' ')[0].split('.');
    return !(campo in W.CAMPI_WEB[S]);
  });
  assert.deepEqual(mancanti, [], 'campi letti sui siti ma non ammessi in impostazioniPerOrigine.js');
});

// Un campo nuovo in una di queste sezioni non arriva ai siti finché qualcuno non
// sceglie: nella lista se il codice dei siti lo usa, qui se resta a casa. I modelli
// per funzione restano fuori: se ne aggiungono spesso e ai siti ne serve uno solo.
const RESTANO_A_CASA = { tts: ['modelVoice'], featureFlags: ['help', 'categorize'], tabColor: [], notifications: ['soundEnabled', 'sound'], dictation: [] };
test('sentinella: ogni campo delle sezioni elencate campo per campo è stato deciso', () => {
  for (const S of SEZIONI_A_CAMPI.filter((k) => k !== 'models')) {
    assert.ok(S in RESTANO_A_CASA, `sezione ${S} elencata campo per campo senza la sua decisione qui`);
    const indecisi = Object.keys(DEFAULT_SETTINGS[S] || {}).filter((c) => !(c in W.CAMPI_WEB[S]) && !RESTANO_A_CASA[S].includes(c));
    assert.deepEqual(indecisi, [], `campi nuovi di ${S}: ammetterli in impostazioniPerOrigine.js o dire qui che restano a casa`);
  }
});

// Gli scomparti del magazzino che i content script toccano con chrome.storage:
// uno che manca dalla lista spegnerebbe la funzione solo sui siti.
test('sentinella: ogni scomparto del magazzino usato dai content script è fra quelli ammessi', () => {
  const { STORAGE_KEYS } = globalThis.SN_CONST;
  const usati = new Set();
  for (const { f, src } of scriptDeiSiti()) {
    const costanti = new Map([...src.matchAll(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/g)].map((m) => [m[1], m[2]]));
    for (const m of src.matchAll(/chrome\.storage\.local\.(?:get|set|remove)\(/g)) {
      // Solo il primo argomento: il secondo può essere una funzione con dentro di tutto.
      let i = m.index + m[0].length; let prof = 0; const da = i;
      while (i < src.length) {
        const c = src[i];
        if ('([{'.includes(c)) prof++;
        else if (')]}'.includes(c)) { if (prof === 0) break; prof--; } else if (c === ',' && prof === 0) break;
        i++;
      }
      const arg = src.slice(da, i);
      for (const k of arg.matchAll(/STORAGE_KEYS\.([A-Z_]+)/g)) usati.add(`${STORAGE_KEYS[k[1]]} (${f})`);
      for (const k of arg.matchAll(/['"]([\w-]+)['"]/g)) usati.add(`${k[1]} (${f})`);
      for (const k of arg.matchAll(/\b([A-Z_][A-Z0-9_]*)\b/g)) if (costanti.has(k[1])) usati.add(`${costanti.get(k[1])} (${f})`);
      for (const k of arg.matchAll(/[{,]\s*([a-z_][\w]*)\s*:/g)) usati.add(`${k[1]} (${f})`);
    }
  }
  assert.ok([...usati].some((u) => u.startsWith('sn_personal_dict ')), 'la sentinella non vede più il dizionario del correttore');
  const mancanti = [...usati].filter((u) => !W.CHIAVI_STORAGE_WEB.includes(u.split(' ')[0]));
  assert.deepEqual(mancanti, [], 'scomparti usati sui siti ma non ammessi in impostazioniPerOrigine.js');
});

// I tipi che il main spinge a tutte le schede e che un content script ascolta
// devono essere fra quelli ammessi: altrimenti la funzione si spegne sui siti.
test('sentinella: ogni spinta a tutte le schede che un content script ascolta è fra quelle ammesse', () => {
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  const { MSG } = globalThis.SN_MSG;
  const principali = [];
  const cammina = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) cammina(rel); else if (e.name.endsWith('.js')) principali.push(rel);
    }
  };
  cammina('src/main');
  const spinti = new Set();
  for (const f of principali) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/broadcastToTabs\(\s*\{\s*type:\s*MSG\.([A-Z_]+)/g)) spinti.add(m[1]);
  }
  assert.ok(spinti.has('SETTINGS_UPDATED') && spinti.size > 5, 'la sentinella non vede più le spinte del main');
  // messages.js definisce i nomi di tutti i messaggi: non è un ascoltatore.
  const siti = scriptDeiSiti().filter((x) => !x.f.endsWith('/messages.js')).map((x) => x.src).join('\n');
  const ascoltati = [...spinti].filter((k) => new RegExp(`MSG\\.${k}\\b|['"]${MSG[k]}['"]`).test(siti));
  assert.ok(ascoltati.includes('SETTINGS_UPDATED'), 'la sentinella non vede più chi ascolta le impostazioni');
  const mancanti = ascoltati.filter((k) => !W.SPINTE_WEB.has(MSG[k]));
  assert.deepEqual(mancanti, [], 'spinte ascoltate sui siti ma non ammesse in impostazioniPerOrigine.js');
  for (const t of W.SPINTE_WEB) assert.ok(Object.values(MSG).includes(t), `tipo ammesso inesistente: ${t}`);
});

// Una spinta che gira su tutte le schede o tutte le finestre passa dalla regola del
// confine (spingiAlla…) o si limita alle superfici di Filo: una strada parallela
// porterebbe ai siti il primo dato che qualcuno ci mette dentro.
const INIZIO_FUNZIONE = /^(?:async\s+)?function\s|^\s{2}(?:async\s+)?[_A-Za-z]\w*\([^)]*\)\s*\{\s*$|^\s*(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{\s*$/;
const GIRO_SU_TUTTE = /getAllWindows\(\)|windowsOf\(|for\s*\(\s*const\s+\w+\s+of\s+[\w.?]*\btabs\b/;
const SOLO_FILO = /isFilo\(|startsWith\('filo:\/\/'\)|_filoTabs\)\s*continue|filter\(\(?\w+\)?\s*=>\s*\w+\._filoTabs\)|spingiAlla/;
function spinteSenzaRegola(sorgente, nome) {
  const righe = sorgente.split('\n');
  const fuori = [];
  righe.forEach((r, i) => {
    if (!/\.send\(\s*'(?:filo:broadcast|shell:[\w-]+|tabs:[\w-]+)'/.test(r)) return;
    let s = i;
    while (s > 0 && i - s < 60 && !INIZIO_FUNZIONE.test(righe[s])) s--;
    const zona = righe.slice(s, i + 1).join('\n');
    if (GIRO_SU_TUTTE.test(zona) && !SOLO_FILO.test(zona)) fuori.push(`${nome}:${i + 1}`);
  });
  return fuori;
}

test('sentinella: ogni spinta a tutte le schede o finestre passa dalla regola del confine', () => {
  const vecchia = [
    'function broadcastLiveUpdate() {',
    '  for (const win of BrowserWindow.getAllWindows()) {',
    "    try { win.webContents.send('filo:broadcast', msg); } catch (_) {}",
    '    for (const t of win._filoTabs.tabs) {',
    "      try { t.view.webContents.send('filo:broadcast', msg); } catch (_) {}",
    '    }',
    '  }',
    '}',
  ].join('\n');
  assert.equal(spinteSenzaRegola(vecchia, 'esempio').length, 2, 'la sentinella non riconosce più una spinta senza regola');
  const principali = [];
  const cammina = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) cammina(rel); else if (e.name.endsWith('.js')) principali.push(rel);
    }
  };
  cammina('src/main');
  const fuori = principali.flatMap((f) => spinteSenzaRegola(readFileSync(join(ROOT, f), 'utf8'), f));
  assert.deepEqual(fuori, [], 'spinte a tutte le schede che non passano da impostazioniPerOrigine.js');
});

test('sentinella: ogni spinta a più schede dice quale scheda è in primo piano', () => {
  const fuori = [];
  const cammina = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { cammina(rel); continue; }
      if (!e.name.endsWith('.js') || rel.endsWith('impostazioniPerOrigine.js')) continue;
      readFileSync(join(ROOT, rel), 'utf8').split('\n').forEach((r, i) => {
        if (/\bspingiAllaScheda\(/.test(r) && !/\binVista\b/.test(r) && !/require\(|\{[^}]*spingiAllaScheda[^}]*\}\s*=/.test(r)) fuori.push(`${rel}:${i + 1}`);
      });
    }
  };
  cammina('src/main');
  assert.deepEqual(fuori, [], 'senza inVista gli avvisi non arrivano più alla scheda in primo piano di un sito');
});

test('la spinta frame per frame ritaglia su ogni indirizzo, e una finestra di un sito vale come sito', () => {
  const inviati = [];
  const frame = (url) => ({ url, detached: false, send: (_c, m) => inviati.push({ url, m }) });
  const scheda = (pagina, riquadri) => ({
    isDestroyed: () => false,
    getURL: () => pagina,
    mainFrame: { framesInSubtree: [frame(pagina), ...riquadri.map(frame)] },
    send: () => { throw new Error('frame per frame, non al solo principale'); },
  });
  const settings = impostazioniConSegreti();
  W.spingiAllaScheda(scheda('https://sito.example/', ['filo://newtab/', 'https://altro.example/']), messaggio(settings));
  W.spingiAllaScheda(scheda('filo://newtab/', []), messaggio(settings));
  W.spingiAllaScheda(scheda('https://sito.example/', []), { type: 'filo_live_updated' });
  assert.equal(inviati.length, 4);
  for (const { url, m } of inviati.slice(0, 3)) assert.ok(!testo(m).includes(CHIAVE), `chiave arrivata a ${url} dentro un sito`);
  assert.ok(testo(inviati[3].m).includes(CHIAVE), 'la pagina filo:// riceve le impostazioni intere');

  const finestre = [];
  const finestra = (url) => ({ webContents: { isDestroyed: () => false, getURL: () => url, send: (_c, m) => finestre.push({ url, m }) } });
  W.spingiAllaFinestra(finestra('https://accounts.example/login'), messaggio(settings));
  W.spingiAllaFinestra(finestra('https://accounts.example/login'), { type: 'filo_live_updated' });
  W.spingiAllaFinestra(finestra('filo://shell/shell.html'), messaggio(settings));
  assert.equal(finestre.length, 2);
  assert.ok(!testo(finestre[0].m).includes(CHIAVE));
  assert.ok(testo(finestre[1].m).includes(CHIAVE));
});
