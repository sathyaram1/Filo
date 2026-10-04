// #949 — ogni voce delle pagine delle impostazioni si legge e si cambia chiedendola a Filo.
// La sentinella che conta: un controllo nuovo in una pagina senza la sua voce in src/shared/vociImpostazioni.js,
// o una voce senza una chiave della chat che la scriva davvero, fa diventare rosso questo file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
for (const m of ['constants', 'contenutoEsterno', 'timeFormat', 'storage', 'themeTokens', 'tabColor', 'nomiSito',
  'ttsVoices', 'filoMemory', 'preferences', 'cambi', 'actionLevels', 'actionTools', 'capabilities', 'vociImpostazioni']) {
  require(`../../src/shared/${m}.js`);
}
const V = globalThis.SN_VOCI_IMPOSTAZIONI;
const P = globalThis.SN_PREF;
const K = globalThis.SN_CAMBI;
const C = globalThis.SN_CONST;
const T = globalThis.SN_THEME_TOKENS;
const Tools = globalThis.SN_ACTION_TOOLS;
const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const HTML = {
  preferences: 'src/pages/preferences/preferences.html',
  security: 'src/pages/security/security.html',
  options: 'src/pages/options/options.html',
  altro: 'src/pages/options/altro.html',
};
function controlliDi(pagina) {
  const html = fs.readFileSync(path.join(radice, HTML[pagina]), 'utf8');
  return [...html.matchAll(/<(input|select|textarea)\b[^>]*?\bid="([^"]+)"/g)].map((m) => m[2]);
}
function idsDi(pagina) {
  const html = fs.readFileSync(path.join(radice, HTML[pagina]), 'utf8');
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

function foglie(o, base = '', out = []) {
  for (const k of Object.keys(o || {})) {
    const p = base ? `${base}.${k}` : k;
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) foglie(v, p, out);
    else out.push(p);
  }
  return out;
}
const CAMPIONI = ['scuro', 'grande', 'sì', 'no', '12', '0,5', '1', 'privacy', 'automatico', 'off', 'openrouter',
  'sk-or-v1-abcdefgh1234', '20 euro', 'più vivaci', 'delicata', 'media', 'powershell', 'Rispondi breve.', 'automatica',
  'aggiungi esempio.it', 'nessuno'];
function percorsiScrittiDa(setter) {
  const out = new Set();
  for (const v of CAMPIONI) {
    let r = null;
    try { r = setter.build(v); } catch (_) { r = null; }
    if (r && r.partial) for (const p of foglie(r.partial)) out.add(p);
  }
  return out;
}

test('sentinella: ogni controllo delle pagine delle impostazioni ha la sua voce (o dice perché non ce l\'ha)', () => {
  for (const pagina of Object.keys(HTML)) {
    const def = V.PAGINE[pagina];
    assert.ok(def, `la pagina ${pagina} non è fra le voci`);
    const controlli = controlliDi(pagina);
    assert.ok(controlli.length, `${HTML[pagina]}: nessun controllo trovato, la sentinella non sta guardando`);
    for (const id of controlli) {
      assert.ok(def.campi[id] || def.fuori[id],
        `${HTML[pagina]}: il controllo #${id} non ha una voce in src/shared/vociImpostazioni.js — la chat non saprebbe né leggerlo né cambiarlo`);
    }
    for (const [id, motivo] of Object.entries(def.fuori)) {
      assert.ok(String(motivo).trim().length > 20, `${pagina} #${id}: un controllo fuori dalle voci dice perché`);
    }
  }
});

test('nessuna voce punta a un controllo che la pagina non ha più', () => {
  for (const pagina of Object.keys(HTML)) {
    const ids = idsDi(pagina);
    const def = V.PAGINE[pagina];
    for (const id of [...Object.keys(def.campi), ...Object.keys(def.gruppi), ...Object.keys(def.fuori)]) {
      assert.ok(ids.has(id), `${pagina}: la voce #${id} non esiste più in ${HTML[pagina]}`);
    }
  }
});

test('sentinella: ogni voce delle pagine si cambia dalla chat, e la chiave la scrive davvero', () => {
  const estetica = Tools.definitions({ sistema: 'win32' }).find((d) => d.function.name === 'IMPOSTA_ESTETICA').function.description;
  let contate = 0;
  for (const def of Object.values(V.PAGINE)) {
    for (const percorso of [...Object.values(def.campi), ...Object.values(def.gruppi)].flatMap(V.espandi)) {
      contate += 1;
      if (percorso.startsWith('themeTokens.')) {
        const nome = percorso.slice(12);
        assert.ok(T.get(nome), `${percorso}: token sconosciuto`);
        assert.ok(estetica.includes(`• ${nome} (`), `il token ${nome} della pagina non è nella descrizione di IMPOSTA_ESTETICA`);
        continue;
      }
      const s = P.setterDi(percorso);
      assert.ok(s, `${percorso}: nessuna chiave di IMPOSTA_PREFERENZA dichiara di scriverlo (campo \`scrive\` in src/shared/preferences.js)`);
      assert.ok(percorsiScrittiDa(s).has(percorso), `${percorso}: la chiave ${s.keys[0]} dice di scriverlo ma non lo scrive`);
    }
  }
  assert.ok(contate > 60, `troppe poche voci (${contate}): la sentinella non sta guardando`);
});

test('ogni chiave scrive quello che dichiara, ha la sua riga nella descrizione e lo stesso livello dell\'annullo', () => {
  const descr = Tools.definitions({ sistema: 'darwin' }).find((d) => d.function.name === 'IMPOSTA_PREFERENZA').function.description;
  for (const s of P.PREF_SETTERS) {
    assert.ok(s.aiuto, `${s.keys[0]}: manca \`aiuto\`, la riga che la chat legge`);
    assert.ok(descr.includes(`• ${s.keys[0]}: `), `${s.keys[0]}: non compare nella descrizione di IMPOSTA_PREFERENZA`);
    const scritti = percorsiScrittiDa(s);
    for (const p of s.scrive || []) {
      assert.ok(scritti.has(p), `${s.keys[0]} dichiara ${p} ma non lo scrive`);
      const voce = K.voce(p);
      assert.ok(voce, `${p}: nessuna frase per il suo evento in src/shared/cambi.js`);
      if (!voce.segreto) assert.equal(voce.livello, s.level || 1, `${p}: l'annullo chiede un livello diverso dal cambio (${voce.livello} contro ${s.level || 1})`);
    }
  }
  assert.ok(descr.includes('LEGGI_IMPOSTAZIONI'), 'la descrizione dice come leggere il valore di adesso');
});

test('lettura: «com\'è impostato il blocco della pubblicità?» ha la risposta vera, e cambia col valore', () => {
  const S = JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS));
  let r = V.righePerModello(S, { cerca: 'blocco della pubblicità' });
  assert.ok(r.trovate >= 1);
  const riga = () => r.righe.find((x) => x.startsWith('- blocco di pubblicità e tracker:'));
  assert.match(riga(), /: attivo \[chiave blocco_pubblicita, chiede conferma\]/);
  S.security.adblock.enabled = false;
  r = V.righePerModello(S, { cerca: 'blocchi la pubblicità?' });
  assert.match(riga(), /: spento \[/);
});

test('lettura: ogni voce delle pagine ha la sua riga, i segreti non escono, una ricerca a vuoto torna tutto', () => {
  const S = JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS));
  S.apiKeys = { openrouter: 'sk-or-v1-SEGRETISSIMA0001', tavily: 'tvly-SEGRETA0002' };
  S.security.siteBlock.blacklist = ['facebook.com', 'tiktok.com'];
  const { righe, totale } = V.righePerModello(S, { sistema: 'win32' });
  const testo = righe.join('\n');
  assert.ok(!testo.includes('SEGRETISSIMA') && !testo.includes('SEGRETA0002'), 'una chiave API è uscita');
  assert.match(testo, /chiave OpenRouter: inserita/);
  assert.match(testo, /domini in blacklist: 2 voci: facebook\.com, tiktok\.com/);
  assert.equal(righe.filter((x) => x.startsWith('- ')).length, totale);
  for (const titolo of ['Preferenze (pagina)', 'Sicurezza (pagina)', 'Modelli (pagina)', 'Altro (pagina)']) assert.ok(righe.includes(titolo), titolo);
  assert.ok(!/undefined|\[object/.test(testo), 'una riga mostra un valore da programmatore');
  const vuota = V.righePerModello(S, { cerca: 'qwertyuiop' });
  assert.equal(vuota.trovate, 0);
  assert.equal(vuota.righe.filter((x) => x.startsWith('- ')).length, totale);
});

test('lettura: la segnalazione automatica mai scritta vale attiva, come la mostra la pagina', () => {
  assert.equal(V.leggi({}, 'security.autoFeedback'), true);
  assert.equal(V.leggi({ security: { autoFeedback: false } }, 'security.autoFeedback'), false);
  assert.equal(V.leggi({}, 'security.adblock.enabled'), true);
});

test('la pagina Preferenze salva esattamente le voci della fonte unica', () => {
  const src = fs.readFileSync(path.join(radice, 'src/pages/preferences/preferences.js'), 'utf8');
  assert.ok(src.includes("SN_VOCI_IMPOSTAZIONI.campi('preferences')"), 'la pagina non prende più i suoi campi dalla fonte unica');
  const corpo = src.slice(src.indexOf('function valoreDelCampo'), src.indexOf('function valoreSalvato'));
  const salvati = new Set([...corpo.matchAll(/case '([a-zA-Z.]+)': return /g)].map((m) => m[1]));
  const voci = new Set(Object.values(V.campi('preferences')));
  assert.deepEqual([...voci].filter((p) => !salvati.has(p)), [], 'voci che la pagina non sa salvare');
  assert.deepEqual([...salvati].filter((p) => !voci.has(p)), [], 'campi della pagina senza voce');
});

test('elenchi di siti: aggiungi, togli, solo, svuota; un nome senza estensione è un rifiuto col suo nome', () => {
  const b = (v) => P.buildPreferencePartial('siti_bloccati', v);
  const a = b('aggiungi facebook.com e https://www.YouTube.com/watch?v=1');
  assert.deepEqual(a.elenco.voci, ['facebook.com', 'youtube.com']);
  assert.equal(a.level, 2);
  assert.match(a.risk, /Apri comunque/);
  assert.equal(b('togli tiktok.com').elenco.op, 'togli');
  assert.equal(b('solo a.it, b.it').elenco.op, 'sostituisci');
  assert.deepEqual(b('svuota').elenco, { percorso: 'security.siteBlock.blacklist', op: 'sostituisci', voci: [], nome: 'Siti bloccati' });
  assert.match(b('blocca facebook').rifiuto, /«facebook» non è un dominio/);
  // Un nome accentato entra come dalla pagina Sicurezza, nella forma ASCII con cui il sito si confronta.
  assert.deepEqual(b('aggiungi münchen.de').elenco.voci, ['xn--mnchen-3ya.de']);
  assert.deepEqual(P.buildPreferencePartial('siti_fidati_cookie', 'https://www.Bücher.de/x').elenco.voci, ['xn--bcher-kva.de']);
  assert.ok(b('aggiungi <script>x</script>.com').rifiuto);
  const correnti = { security: { siteBlock: { blacklist: ['a.it'] } } };
  assert.deepEqual(P.applicaElenco(b('aggiungi b.it').elenco, correnti).partial.security.siteBlock.blacklist, ['a.it', 'b.it']);
  assert.match(P.applicaElenco(b('aggiungi a.it').elenco, correnti).invariato, /a\.it c'è già/);
  assert.match(P.applicaElenco(b('togli c.it').elenco, correnti).invariato, /c\.it non c'è.*contiene: a\.it/);
});

test('lettura: cercando un sito torna l\'elenco che lo contiene, anche oltre il tetto delle cento voci', () => {
  const S = JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS));
  const riga = (r) => r.righe.find((x) => x.startsWith('- domini in blacklist:')) || '';
  S.security.siteBlock.blacklist = ['tiktok.com', 'facebook.com'];
  assert.match(riga(V.righePerModello(S, { cerca: 'facebook.com' })), /facebook\.com/);
  assert.match(riga(V.righePerModello(S, { cerca: 'facebook' })), /facebook\.com/);
  // Un sito che non c'è: gli elenchi tornano lo stesso, così Filo può dire che non è bloccato.
  assert.match(riga(V.righePerModello(S, { cerca: 'youtube.com' })), /2 voci: tiktok\.com, facebook\.com/);
  S.security.siteBlock.blacklist = Array.from({ length: 150 }, (_, i) => `sito${i}.it`).concat('facebook.com');
  assert.match(riga(V.righePerModello(S, { cerca: 'siti bloccati' })), /e altri 51 \(chiedi con una parola del sito/);
  assert.match(riga(V.righePerModello(S, { cerca: 'facebook' })), /151 voci, con la ricerca: facebook\.com; elenco: facebook\.com, sito0\.it/);
});

test('un sito accentato si mostra come lo legge una persona: conferma, «c\'è già», lettura e segno del cambio', () => {
  const b = (v) => P.buildPreferencePartial('siti_bloccati', v);
  assert.equal(b('aggiungi münchen.de').label, 'Siti bloccati → aggiungi münchen.de');
  const correnti = { security: { siteBlock: { blacklist: ['xn--mnchen-3ya.de'] } } };
  assert.match(P.applicaElenco(b('aggiungi münchen.de').elenco, correnti).invariato, /münchen\.de c'è già \(adesso contiene: münchen\.de\)/);
  const S = JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS));
  S.security.siteBlock.blacklist = ['xn--mnchen-3ya.de'];
  const r = V.righePerModello(S, { cerca: 'münchen.de' });
  assert.match(r.righe.find((x) => x.startsWith('- domini in blacklist:')), /münchen\.de/);
  assert.ok(!r.righe.join('\n').includes('xn--'));
  assert.match(K.frase({ cambi: [{ chiave: 'security.siteBlock.blacklist', prima: [], dopo: ['xn--mnchen-3ya.de'] }] }), /aggiunto münchen\.de/);
});

test('i sei valori del colore delle tab: dentro il range si scrivono, fuori è un rifiuto col range', () => {
  for (const k of P.PARAMETRI_COLORE_TAB) assert.ok(globalThis.SN_TAB_COLOR.IDENTITY_PARAM_META.some((m) => m.key === k), k);
  assert.equal(P.PARAMETRI_COLORE_TAB.length, globalThis.SN_TAB_COLOR.IDENTITY_PARAM_META.length);
  assert.deepEqual(P.buildPreferencePartial('saturazione_tab', '0,8').partial, { tabColor: { saturazione_tab: 0.8 } });
  assert.match(P.buildPreferencePartial('bucket_tinta', '100').rifiuto, /da 2 a 48/);
});

test('«spegni» e «accendi» sono un sì e un no', () => {
  assert.equal(P.parsePrefBool('spegni'), false);
  assert.equal(P.parsePrefBool('accendi'), true);
  assert.deepEqual(P.buildPreferencePartial('blocco_pubblicita', 'spento').partial, { security: { adblock: { enabled: false } } });
});

test('le ore di inattività con la virgola restano quelle: «1,5» non diventa 15', () => {
  const ore = (v) => { const r = P.buildPreferencePartial('ore_inattivita', v); return r && r.partial ? r.partial.autoArchive.idleHours : r; };
  assert.equal(ore('1,5'), 2);
  assert.equal(ore('1.5'), 2);
  assert.equal(ore(2.5), 3);
  assert.equal(ore('12 ore'), 12);
  assert.equal(ore('1.000'), 168);
  assert.match(ore('-5').rifiuto, /da 1 a 168/);
  assert.match(ore('0').rifiuto, /da 1 a 168/);
});

test('LEGGI_IMPOSTAZIONI è uno strumento di sola lettura, e non lo chiede un sito', () => {
  const L = globalThis.SN_ACTION_LEVELS;
  assert.equal(L.levelFor({ type: 'LEGGI_IMPOSTAZIONI', cerca: 'tema' }), 1);
  assert.ok(Tools.haRisultato('LEGGI_IMPOSTAZIONI'));
  const { azioneAmmessaDa } = require('../../src/main/services/impostazioniPerOrigine.js');
  assert.equal(azioneAmmessaDa({ type: 'LEGGI_IMPOSTAZIONI' }, 'https://esempio.it/'), false);
});

test('il blocco della pubblicità è nel manifesto delle capacità, e si dice che si chiede a Filo', () => {
  const Caps = globalThis.SN_CAPABILITIES;
  const ad = Caps.get('ad-block');
  assert.ok(ad, 'manca la voce ad-block');
  assert.match(ad.invoke, /chiedendolo a Filo/);
  assert.ok(Caps.get('settings-by-chat'));
});
