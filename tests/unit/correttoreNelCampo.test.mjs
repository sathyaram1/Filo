// #1446 (e #1097.5) — il correttore in un campo, con un DOM finto e un orologio finto: quando partono i due controlli,
// cosa mandano (mai la parola che si sta scrivendo), e che rientrare, un punto o un annulla non ripagano un giudizio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

function correttore({ sbagliate = [], impostazioni = {} } = {}) {
  let ora = 1_000_000;
  const timers = [];
  let tid = 0;
  const tick = () => new Promise((r) => setImmediate(r));
  function node(tag) {
    const n = {
      tagName: tag, nodeType: 1, children: [], style: new Proxy({ setProperty() {} }, {}), dataset: {}, isConnected: true, className: '',
      setAttribute() {}, appendChild(c) { if (c.isFrag) n.children.push(...c.children); else n.children.push(c); return c; },
      remove() { n.isConnected = false; const fratelli = sb.document.body.children; if (fratelli.includes(n)) fratelli.splice(fratelli.indexOf(n), 1); },
    };
    Object.defineProperty(n, 'innerHTML', { set() { n.children = []; }, get() { return ''; } });
    let testo = '';
    Object.defineProperty(n, 'textContent', { set(v) { testo = String(v); n.children = []; }, get() { return testo; } });
    return n;
  }
  const docListeners = {};
  const richieste = [];
  const dizionario = new Set(sbagliate);
  // Come il dizionario vero (src/preload/dizionario.js): ogni chiamata è un viaggio al processo principale.
  const viaggi = [];
  const sbagliataFinta = (w) => w === 'qzxwvkjh' || dizionario.has(w);
  class FintaData extends Date {
    constructor(...a) { super(...(a.length ? a : [ora])); }
    static now() { return ora; }
  }
  const sb = {
    // La pagina intorno al campo qui non c'è: chi la cerca lo dice, e qui si tace.
    console: { ...console, warn() {} }, Promise, JSON, Math, RegExp, Array, Object, String, Number, Map, Set, WeakMap, WeakSet, Symbol, Error, Intl, Proxy,
    Date: FintaData,
    setTimeout: (fn, ms = 0) => { const t = { id: ++tid, fn, at: ora + ms, done: false }; timers.push(t); return t.id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.done = true; },
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0,
    ResizeObserver: class { observe() {} disconnect() {} },
    location: { protocol: 'https:', hostname: 'chat.example' },
    document: {
      hidden: false, title: 'Chat', body: node('BODY'), documentElement: { dataset: {} },
      addEventListener(t, f) { (docListeners[t] ||= []).push(f); },
      createElement: (t) => node(t.toUpperCase()),
      createDocumentFragment: () => ({ isFrag: true, children: [], appendChild(c) { this.children.push(c); } }),
      createTextNode: (t) => ({ text: t }),
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(m) {
          if (m.type !== 'ai') return Promise.resolve({ ok: false });
          return new Promise((r) => richieste.push({ action: m.action, payload: m.payload, suRichiesta: !!m.suRichiesta, riprova: !!m.riprova, r }));
        },
      },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
    },
    SN_MSG: { MSG: { AI_REQUEST: 'ai' } },
    SN_GESTO: { prendi: () => true, dentro: () => () => true, CHIUDE: 'chiude' },
    SN_DIZIONARIO: {
      sbagliata: (w) => { viaggi.push([w]); return sbagliataFinta(w); },
      sbagliate: (ws) => { viaggi.push(ws.slice()); return ws.map(sbagliataFinta); },
      proposte: () => [],
    },
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  sb.getComputedStyle = () => ({ borderStyle: '', direction: 'ltr', getPropertyValue: () => '' });
  sb.addEventListener = () => {};
  vm.createContext(sb);
  for (const f of ['src/shared/constants.js', 'src/content/coerenza.js', 'src/content/correttoreRegole.js', 'src/content/spellcheck.js']) {
    vm.runInContext(src(f), sb);
  }
  sb.SN_SPELLCHECK.init({ featureFlags: { spellcheck: true, spellcheckContext: true }, ...impostazioni });
  // Il tempo passa, e partono i timer scaduti, in ordine.
  async function passa(ms) {
    const fine = ora + ms;
    for (;;) {
      const prossimo = timers.filter((t) => !t.done && t.at <= fine).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!prossimo) break;
      ora = Math.max(ora, prossimo.at);
      prossimo.done = true;
      // Senza aspettarlo: un controllo resta in viaggio finché la prova non risponde.
      prossimo.fn();
      await tick();
    }
    ora = fine;
    await tick();
  }
  function campo() {
    const ls = {};
    const el = {
      tagName: 'TEXTAREA', nodeType: 1, value: '', selectionStart: 0, selectionEnd: 0, spellcheck: true, isConnected: true,
      parentElement: null, scrollTop: 0, scrollLeft: 0, offsetWidth: 100, clientWidth: 100, offsetHeight: 100, clientHeight: 100,
      getAttribute: () => null, hasAttribute: () => false, closest: () => null, getRootNode: () => sb.document,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      addEventListener(t, f) { (ls[t] ||= []).push(f); }, fire(t, e = {}) { for (const f of ls[t] || []) f(e); },
    };
    return el;
  }
  const testoDi = (n) => (n.text !== undefined ? n.text : (n.children || []).map(testoDi).join(''));
  function segni(classe) {
    const out = [];
    const giro = (n) => {
      if (typeof n.className === 'string' && n.className.split(' ').includes(classe)) out.push({ testo: testoDi(n), dubbio: n.className.includes('sn-dubbio') });
      for (const c of n.children || []) giro(c);
    };
    for (const o of sb.document.body.children) giro(o);
    return JSON.parse(JSON.stringify(out));
  }
  const rapide = () => richieste.filter((r) => r.action === 'spellcheck_semantic');
  const ragionate = () => richieste.filter((r) => r.action === 'spellcheck_context');
  return {
    sb, richieste, rapide, ragionate, passa, campo, segni, tick, viaggi,
    entra: (el) => docListeners.focusin.forEach((f) => f({ target: el })),
    esce: (el) => docListeners.focusout.forEach((f) => f({ target: el })),
    visibile: () => (docListeners.visibilitychange || []).forEach((f) => f()),
    // Scrive come una tastiera: il cursore resta in fondo.
    scrive: (el, v, e = {}) => { el.value = v; el.selectionStart = el.selectionEnd = v.length; el.fire('input', e); },
    risponde: async (r, testo) => { r.r({ ok: true, text: testo }); await tick(); await tick(); },
  };
}

test('il controllo rapido parte dopo mezzo secondo di pausa, e non manda la parola che si sta scrivendo', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'oggi sono andato al ma');
  await c.passa(400);
  assert.equal(c.rapide().length, 0, 'prima della pausa niente');
  await c.passa(200);
  assert.equal(c.rapide().length, 1);
  assert.equal(c.rapide()[0].payload.nuovo.trim(), 'oggi sono andato al');
  // Il campo intero arriva al main solo per cercarci i dati riservati, e lì si toglie (correttoreRiservati.js).
  const { campo, ...parte } = c.rapide()[0].payload;
  assert.equal(campo, 'oggi sono andato al ma');
  assert.ok(!JSON.stringify(parte).includes('al ma'), 'la parola in scrittura non parte');
  assert.equal(c.rapide()[0].payload.luogo, undefined, 'il messaggio del banco non porta il sito');
});

test('mentre si scrive senza pause parte al più ogni 5 secondi; la pausa lunga giudica anche l\'ultima parola', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  let t = '';
  for (let i = 0; i < 42; i++) { t += 'ab'[i % 2]; if (i % 5 === 4) t += ' '; c.scrive(el, t); await c.passa(300); }
  assert.equal(c.rapide().length, 2, `in 12,6 secondi di battute ${c.rapide().length} controlli`);
  await c.risponde(c.rapide()[0], '[][][][nessuno]');
  await c.risponde(c.rapide()[1], '[][][][nessuno]');
  await c.passa(600);
  assert.equal(c.rapide().length, 3, 'la pausa breve giudica il resto, tranne la parola a metà');
  assert.ok(!c.rapide()[2].payload.nuovo.endsWith('ab'));
  await c.risponde(c.rapide()[2], '[][][][nessuno]');
  await c.passa(3500);
  assert.equal(c.rapide().length, 4, 'la pausa lunga giudica la parola lasciata a metà');
  assert.equal(c.rapide()[3].payload.nuovo, 'ab');
});

test('una parola fuori dizionario appena chiusa fa partire il controllo subito, coi candidati', async () => {
  const c = correttore({ sbagliate: ['quseta'] });
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'ciao quseta');
  await c.passa(100);
  assert.equal(c.rapide().length, 0, 'mentre la si scrive non è un candidato');
  assert.deepEqual(c.segni('sn-errore'), []);
  c.scrive(el, 'ciao quseta ');
  await c.passa(1);
  assert.equal(c.rapide().length, 1, 'il candidato nuovo non aspetta la pausa');
  assert.deepEqual(JSON.parse(JSON.stringify(c.rapide()[0].payload.candidati.map((x) => x.pezzo))), ['quseta']);
  assert.deepEqual(c.segni('sn-errore'), [{ testo: 'quseta', dubbio: true }], 'sbiadito finché non è giudicato');
  await c.risponde(c.rapide()[0], '[quseta][questa][refuso][errore]');
  assert.deepEqual(c.segni('sn-errore'), [{ testo: 'quseta', dubbio: false }], 'confermato si riempie');
});

test('le parole di un campo si chiedono al dizionario tutte in un viaggio, e una parola già chiesta non riparte', async () => {
  const c = correttore({ sbagliate: ['quseta'] });
  const el = c.campo();
  c.entra(el);
  const parole = Array.from({ length: 300 }, (_, i) => `parola${'abcdefghij'[i % 10]}${'abcdefghij'[Math.floor(i / 10) % 10]}${'abc'[Math.floor(i / 100)]}`);
  c.scrive(el, `${parole.join(' ')} quseta `);
  await c.passa(1);
  const conLeParole = c.viaggi.filter((v) => v.some((w) => w !== 'qzxwvkjh'));
  assert.equal(conLeParole.length, 1, `${conLeParole.length} viaggi per un campo solo`);
  assert.equal(conLeParole[0].length, 301);
  assert.deepEqual(c.segni('sn-errore').map((s) => s.testo), ['quseta']);
  const prima = c.viaggi.length;
  c.scrive(el, `${parole.join(' ')} quseta nuova `);
  await c.passa(1);
  assert.deepEqual(JSON.parse(JSON.stringify(c.viaggi.slice(prima).filter((v) => v.some((w) => w !== 'qzxwvkjh')))), [['nuova']]);
});

test('un candidato giudicato giusto sparisce, e la stessa parola più avanti non è più un candidato', async () => {
  const c = correttore({ sbagliate: ['Zanzottera'] });
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'ho visto Zanzottera ');
  await c.passa(1);
  await c.risponde(c.rapide()[0], '[Zanzottera][][cognome][giusto]');
  await c.passa(400);
  assert.deepEqual(c.segni('sn-errore'), []);
  c.scrive(el, 'ho visto Zanzottera e ancora Zanzottera ');
  await c.passa(10);
  assert.deepEqual(c.segni('sn-errore'), []);
});

test('un candidato su cui il controllo rapido tace sparisce; una risposta illeggibile non lo scarta', async () => {
  const c = correttore({ sbagliate: ['quseta', 'xqzz'] });
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'ciao quseta ');
  await c.passa(1);
  assert.deepEqual(c.segni('sn-errore').map((s) => s.testo), ['quseta'], 'sbiadito subito');
  await c.risponde(c.rapide()[0], 'NIENTE');
  await c.passa(400);
  assert.deepEqual(c.segni('sn-errore'), []);
  c.scrive(el, 'ciao quseta e xqzz ');
  await c.passa(10);
  const ultima = c.rapide()[c.rapide().length - 1];
  await c.risponde(ultima, 'non so');
  await c.passa(10);
  const ripetuta = c.rapide()[c.rapide().length - 1];
  assert.notEqual(ripetuta, ultima, 'la risposta illeggibile si chiede ancora');
  await c.risponde(ripetuta, 'boh');
  await c.passa(400);
  assert.deepEqual(c.segni('sn-errore').map((s) => s.testo), ['xqzz'], 'senza una risposta vera il dubbio resta');
});

test('il controllo rapido manda come testo prima il paragrafo in corso e quello prima', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  const testo = 'Primo paragrafo lontano.\nSecondo paragrafo.\n\nTerzo, in corso: oggi sono andato ';
  c.scrive(el, testo);
  await c.passa(600);
  await c.risponde(c.rapide()[0], 'NIENTE');
  c.scrive(el, `${testo}al mare con Marco `);
  await c.passa(600);
  const { prima, nuovo } = c.rapide()[c.rapide().length - 1].payload;
  assert.ok(prima.startsWith('Secondo paragrafo.\n\nTerzo, in corso:'), prima);
  assert.ok(nuovo.includes('al mare con Marco'), nuovo);
});

test('rientrare nel campo, aggiungere un punto o tornare con un annulla a un testo giudicato non ripagano', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'Marco e Luca è andato al mare ieri ');
  await c.passa(600);
  assert.equal(c.rapide().length, 1);
  await c.risponde(c.rapide()[0], '[è andato][sono andati][soggetto plurale][errore]');
  assert.deepEqual(c.segni('sn-errore').map((s) => s.testo), ['è andato']);
  c.esce(el); await c.passa(300);
  c.entra(el); await c.passa(600);
  c.scrive(el, 'Marco e Luca è andato al mare ieri. ');
  await c.passa(600);
  assert.equal(c.rapide().length, 1, 'rientrare e un punto non ripagano');
  c.scrive(el, 'Marco è andato al mare ieri. ');
  await c.passa(600);
  assert.equal(c.rapide().length, 2, 'una parola tolta si rigiudica');
  await c.risponde(c.rapide()[1], '[][][][nessuno]');
  c.scrive(el, 'Marco e Luca è andato al mare ieri. ');
  await c.passa(600);
  assert.equal(c.rapide().length, 2, 'l\'annulla torna a un testo già giudicato');
  assert.deepEqual(c.segni('sn-errore').map((s) => s.testo), ['è andato'], 'coi suoi segni');
});

test('un apostrofo aggiunto cambia la parola e si rigiudica', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'ho visto un amico ieri sera ');
  await c.passa(600);
  await c.risponde(c.rapide()[0], '[][][][nessuno]');
  c.scrive(el, "ho visto un'amico ieri sera ");
  await c.passa(600);
  assert.equal(c.rapide().length, 2);
  assert.ok(c.rapide()[1].payload.nuovo.includes("un'amico"));
});

test('la risposta arrivata dopo un cambio si posa sul pezzo giusto, o cade se il pezzo non c\'è più', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'oggi sonno andato al mare ');
  await c.passa(600);
  c.scrive(el, 'Ciao! oggi sonno andato al mare ');
  await c.risponde(c.rapide()[0], '[oggi sonno andato][oggi sono andato][verbo essere][errore]');
  assert.deepEqual(c.segni('sn-errore').map((s) => s.testo), ['sonno']);
  const d = correttore();
  const e2 = d.campo();
  d.entra(e2);
  d.scrive(e2, 'oggi sonno andato al mare ');
  await d.passa(600);
  d.scrive(e2, 'oggi sono andato al mare ');
  await d.risponde(d.rapide()[0], '[oggi sonno andato][oggi sono andato][verbo essere][errore]');
  assert.deepEqual(d.segni('sn-errore'), []);
});

test('«il il» è un errore sicuro del codice, «quasi quasi» no; spenta la parte del modello resta pieno e non si paga', async () => {
  const c = correttore({ impostazioni: { correttore: { modelloErrori: false } } });
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'quasi quasi vado con il il cane ');
  await c.passa(5000);
  assert.deepEqual(c.segni('sn-errore'), [{ testo: 'il', dubbio: false }]);
  assert.equal(c.rapide().length, 0);
});

// #1580, D5: errori fissi, ripetizioni e date impossibili non aspettano il modello e non gli si chiedono.
test('«qual\'è», «il il» e una data impossibile hanno il segno pieno subito, e non partono come candidati', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, "qual'è il il giorno, lunedì 21 ottobre 2026? ");
  await c.passa(1);
  assert.deepEqual(c.segni('sn-errore'), [{ testo: "qual'è", dubbio: false }, { testo: 'il', dubbio: false }]);
  assert.deepEqual(c.segni('sn-suggerimento'), [{ testo: 'lunedì 21 ottobre 2026', dubbio: false }]);
  assert.equal(c.rapide().length, 0, 'un errore sicuro non fa partire il controllo prima della pausa');
  await c.passa(600);
  assert.equal(c.rapide().length, 1);
  assert.equal(c.rapide()[0].payload.candidati.length, 0);
  await c.risponde(c.rapide()[0], "[qual'è][][forma accettata][giusto]");
  assert.deepEqual(c.segni('sn-errore').map((x) => x.testo), ["qual'è", 'il'], 'un «giusto» del modello non toglie un errore sicuro');
});

// #1580, D6: il segno sbiadito subito solo sulle parole minuscole in alfabeto latino.
test('«Roma» fuori dizionario non ha segno finché il modello non risponde; «quseta» è sbiadito subito', async () => {
  const c = correttore({ sbagliate: ['Roma', 'quseta', 'Pariggi'] });
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'vado a Roma e Pariggi con quseta ');
  await c.passa(1);
  assert.deepEqual(c.segni('sn-errore'), [{ testo: 'quseta', dubbio: true }]);
  assert.equal(c.rapide().length, 1, 'le parole in attesa partono subito verso il modello');
  assert.deepEqual(JSON.parse(JSON.stringify(c.rapide()[0].payload.candidati.map((x) => x.pezzo))), ['Roma', 'Pariggi', 'quseta']);
  await c.risponde(c.rapide()[0], '[Roma][][città][giusto]\n[Pariggi][Parigi][refuso][errore]\n[quseta][questa][refuso][errore]');
  await c.passa(400);
  assert.deepEqual(c.segni('sn-errore'), [{ testo: 'Pariggi', dubbio: false }, { testo: 'quseta', dubbio: false }]);
});

test('spenta la parte del modello non c\'è niente da aspettare: «Roma» fuori dizionario si vede sbiadito', async () => {
  const c = correttore({ sbagliate: ['Roma'], impostazioni: { correttore: { modelloErrori: false } } });
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'vado a Roma domani ');
  await c.passa(1000);
  assert.deepEqual(c.segni('sn-errore'), [{ testo: 'Roma', dubbio: true }]);
});

// #1580, D8: una risposta senza righe e senza «nessuno» si chiede ancora, una volta sola, senza cache.
test('una risposta vuota del controllo rapido si ripete una volta, e la seconda vale', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'oggi sonno andato al mare ');
  await c.passa(600);
  assert.equal(c.rapide().length, 1);
  await c.risponde(c.rapide()[0], '');
  assert.equal(c.rapide().length, 2, 'ripetuta');
  assert.equal(c.rapide()[1].riprova, true, 'senza rileggere la cache');
  assert.equal(JSON.stringify(c.rapide()[1].payload), JSON.stringify(c.rapide()[0].payload));
  await c.risponde(c.rapide()[1], '[oggi sonno andato][oggi sono andato][verbo essere]');
  assert.deepEqual(c.segni('sn-errore').map((x) => x.testo), ['sonno']);
  const d = correttore();
  const e2 = d.campo();
  d.entra(e2);
  d.scrive(e2, 'tutto a posto qui ');
  await d.passa(600);
  await d.risponde(d.rapide()[0], 'non so');
  await d.risponde(d.rapide()[1], 'ancora non so');
  await d.passa(600);
  assert.equal(d.rapide().length, 2, 'una ripetizione sola');
  await d.risponde(d.rapide()[0], '');
});

test('«nessuno» o una riga valida non si ripetono', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'tutto a posto qui ');
  await c.passa(600);
  await c.risponde(c.rapide()[0], 'Nessun errore.');
  c.scrive(el, 'tutto a posto qui e là ');
  await c.passa(600);
  await c.risponde(c.rapide()[1], '[][][][nessuno]');
  assert.equal(c.rapide().length, 2);
});

test('il controllo ragionato rilegge il campo intero: a fine frase le frasi chiuse, dopo la pausa lunga anche il resto', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'Ci vediamo mercoledì alle 18.');
  await c.passa(10);
  assert.equal(c.ragionate().length, 1, 'la frase chiusa parte subito');
  assert.equal(c.ragionate()[0].payload.nuovo, 'Ci vediamo mercoledì alle 18.');
  await c.risponde(c.ragionate()[0], '[][][][nessuno]');
  c.scrive(el, 'Ci vediamo mercoledì alle 18. Porto io i biglietti');
  await c.passa(3000);
  assert.equal(c.ragionate().length, 1);
  await c.passa(600);
  assert.equal(c.ragionate().length, 2);
  assert.equal(c.ragionate()[1].payload.nuovo, 'Ci vediamo mercoledì alle 18. Porto io i biglietti', 'il campo intero, non la sola frase nuova');
  assert.equal(c.ragionate()[1].payload.prima, '');
  assert.equal(c.ragionate()[1].payload.dopo, '');
  await c.risponde(c.ragionate()[1], '');
  assert.equal(c.ragionate().length, 3, 'anche il ragionato ripete una risposta vuota');
  assert.equal(c.ragionate()[2].riprova, true);
  await c.risponde(c.ragionate()[2], '[Porto io i biglietti][][Chi porta cosa?]');
  assert.deepEqual(c.segni('sn-suggerimento'), [{ testo: 'Porto io i biglietti', dubbio: false }], 'una riga senza tipo nel ragionato è un suggerimento');
  assert.deepEqual(c.segni('sn-errore'), []);
});

test('a scheda nascosta i controlli aspettano, e partono al ritorno', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.sb.document.hidden = true;
  c.scrive(el, 'ciao a tutti quanti ');
  await c.passa(4000);
  assert.equal(c.rapide().length, 0);
  c.sb.document.hidden = false;
  c.visibile();
  await c.passa(10);
  assert.equal(c.rapide().length, 1, 'tornata davanti, il controllo chiesto parte');
});
