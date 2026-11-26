// I campi segreti (#810.7): `crea` gira anche dentro i riquadri incorporati, mandata come testo dal main, quindi
// non deve usare niente fuori da sé; e un numero di carta si riconosce anche quando il sito non chiama il campo «carta».

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/campiSegreti.js');
const G = globalThis.SN_GUARDIANO_STATICO;
const S = globalThis.SN_CAMPI_SEGRETI;

function campo(attr = {}, valore = '') {
  return {
    nodeType: 1, tagName: 'INPUT', value: valore, type: attr.type || 'text', labels: [],
    getAttribute: (a) => (a in attr ? attr[a] : null),
  };
}

// Lo stesso testo che il main manda nei riquadri, valutato in un contesto vuoto: niente SN_*, niente globali di Filo.
function creaIsolata() {
  const finestra = { document: { querySelectorAll: () => [], getElementById: () => null }, getComputedStyle: () => ({}) };
  const codice = `(function () { const luhn = ${G.luhn}; const cartaValida = ${G.cartaValida};
    return (${S.crea})(finestra, cartaValida, { etichette: ${JSON.stringify(S.etichette())} }); })()`;
  return vm.runInNewContext(codice, { finestra });
}

test('crea gira da sola, come nel riquadro di un altro sito', () => {
  const s = creaIsolata();
  assert.equal(s.campoSegreto(campo({ type: 'password' })), true);
  assert.equal(s.campiInVista().length, 0);
  const { codiceMisura } = require('../../src/main/services/campiNeiRiquadri.js');
  const carta = { ...campo({ name: 'number' }, '4111 1111 1111 1111'),
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 210, bottom: 50, width: 200, height: 30 }) };
  const window = { innerWidth: 800, innerHeight: 600, getComputedStyle: () => ({ backgroundColor: 'rgb(1, 2, 3)', color: 'red', fontSize: '16px' }),
    document: { querySelectorAll: () => [carta], getElementById: () => null } };
  const misurati = vm.runInNewContext(codiceMisura(), { window });
  assert.equal(misurati.length, 1, 'il riquadro deve riconoscere il numero di carta da solo');
  assert.equal(misurati[0].sfondo, 'rgb(1, 2, 3)');
});

test('il numero di carta si riconosce dal valore, qualunque nome abbia il campo', () => {
  const s = creaIsolata();
  assert.equal(s.campoSegreto(campo({ name: 'number' }, '4111 1111 1111 1111')), true);
  assert.equal(s.campoSegreto(campo({ id: 'n' }, '5500-0000-0000-0004')), true);
  assert.equal(s.campoSegreto(campo({ id: 'n' }, '4111 1111 1111 1112')), true, 'con una cifra sbagliata resta una carta');
  assert.equal(s.campoSegreto(campo({ id: 'n' }, '333 123 4567')), false, 'un telefono non è una carta');
  assert.equal(s.campoSegreto(campo({ id: 'n' }, '8001234567890')), false, 'un codice a barre non è una carta');
  assert.equal(s.campoSegreto(campo({ id: 'n' }, '0039 333 1234567')), false);
  assert.equal(s.campoSegreto(campo({ id: 'n' }, 'via Roma 4111 1111 1111 1111')), false, 'un indirizzo non è un campo della carta');
  assert.equal(s.campoSegreto(campo({ id: 'q' }, 'biciclette rosse')), false);
});

// #1403.19: le etichette della password che il filtro del testo conosce valgono anche per i campi, nelle stesse lingue,
// comprese la chiave del wifi di un router e le scritture fuori dall'alfabeto latino.
const ETICHETTE_STRANIERE = ['Пароль', 'Пароль Wi-Fi', 'Hasło', 'HASŁO', 'Wachtwoord', 'Wifi-wachtwoord', '密码', '无线密码',
  'WiFi密码', 'パスワード', '비밀번호', 'Chiave di rete', 'Chiave WPA2', 'WPA key', 'WPA2-PSK key', 'Network key', 'Passphrase'];

test('un campo con l’etichetta della password in un’altra lingua è segreto, da qualunque parte arrivi il nome', () => {
  const s = creaIsolata();
  for (const etichetta of ETICHETTE_STRANIERE) {
    for (const attr of ['aria-label', 'placeholder', 'title']) {
      assert.equal(s.campoSegreto(campo({ [attr]: etichetta }, 'Gatto.Rosso.77')), true, `${attr}="${etichetta}"`);
    }
    const legato = { ...campo({}, 'Gatto.Rosso.77'), labels: [{ childNodes: [{ nodeType: 3, nodeValue: `${etichetta}:` }] }] };
    assert.equal(s.campoSegreto(legato), true, `<label>${etichetta}</label>`);
  }
  for (const nome of ['haslo', 'user_haslo', 'wachtwoord', 'wachtwoordVeld', 'loginPassphrase']) {
    assert.equal(s.campoSegreto(campo({ name: nome })), true, nome);
  }
});

test('le etichette dei campi sono le stesse del filtro del testo: ognuna nasconde il valore in tutti e due', () => {
  const P = require('../../src/shared/pavimento.js');
  const s = creaIsolata();
  for (const etichetta of ETICHETTE_STRANIERE) {
    assert.ok(!P.oscura(`${etichetta}: Gatto.Rosso.77`).includes('Gatto.Rosso.77'), `testo «${etichetta}:»`);
    assert.equal(s.campoSegreto(campo({ 'aria-label': etichetta })), true, `campo «${etichetta}»`);
  }
});

// #1403.19 giro 1: la chiave del wifi come la chiamano i router, e le forme declinate o staccate della parola.
const CHIAVI_E_FORME = ['Ключ сети', 'Ключ безопасности сети', 'Ключ WPA', 'Сетевой ключ', 'Klucz sieci', 'Klucz WPA',
  'Potwierdzenie hasła', 'Zmiana hasła', 'Netwerksleutel', 'WPA-sleutel', 'Beveiligingssleutel', '无线网络密钥', 'WPA密钥',
  '暗号化キー', 'セキュリティキー', 'ネットワークキー', '事前共有キー', 'パスフレーズ', '暗証番号', '네트워크 보안 키', '보안 키',
  'WPA 키', '비밀 번호', '패스워드', 'Lösenord', 'Heslo'];

test('la chiave del wifi e le forme della parola nelle altre lingue: il campo è segreto e il testo non porta il valore', () => {
  const P = require('../../src/shared/pavimento.js');
  const s = creaIsolata();
  for (const etichetta of CHIAVI_E_FORME) {
    assert.equal(s.campoSegreto(campo({ 'aria-label': etichetta }, 'Gatto.Rosso.77')), true, `campo «${etichetta}»`);
    assert.ok(!P.oscura(`${etichetta}: Gatto.Rosso.77`).includes('Gatto.Rosso.77'), `testo «${etichetta}:»`);
  }
});

test('ogni strada che crea i campi segreti riceve le etichette del pavimento', () => {
  const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
  for (const p of ['content/extractContext.js', 'content/testoDeiCampi.js', 'main/services/campiNeiRiquadri.js', 'main/services/fotoDellaPagina.js']) {
    const chiamate = src(p).match(/\bcrea\}?\)?\((?:window|d\.win)[^;]*/g) || [];
    assert.ok(chiamate.length > 0, `${p}: nessuna chiamata trovata`);
    for (const c of chiamate) assert.match(c, /etichette/, `${p}: ${c}`);
  }
  const { codiceMisura } = require('../../src/main/services/campiNeiRiquadri.js');
  const chiave = { ...campo({ 'aria-label': '暗号化キー' }, 'Gatto.Rosso.77'),
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 210, bottom: 50, width: 200, height: 30 }) };
  const window = { innerWidth: 800, innerHeight: 600, getComputedStyle: () => ({ backgroundColor: 'rgb(1, 2, 3)', color: 'red', fontSize: '16px' }),
    document: { querySelectorAll: () => [chiave], getElementById: () => null } };
  assert.equal(vm.runInNewContext(codiceMisura(), { window }).length, 1, 'nel riquadro la chiave del wifi va coperta');
});

test('i campi qualunque in quelle lingue restano leggibili', () => {
  const s = creaIsolata();
  for (const etichetta of ['Имя пользователя', 'Nazwa użytkownika', 'Gebruikersnaam', '用户名', 'ユーザー名', '사용자 이름',
    'Nome della rete', 'Network name (SSID)', 'Keyword', '密码学课程', '암호화 방식', 'Resenha', 'Escreva sua resenha', 'Desenhar']) {
    assert.equal(s.campoSegreto(campo({ 'aria-label': etichetta }, 'mario')), false, etichetta);
  }
});

test('i nomi della carta che i moduli usano davvero', () => {
  const s = creaIsolata();
  for (const nome of ['cc-number', 'ccnumber', 'cc_number', 'ccNum', 'payment[cc_number]', 'cc-csc']) {
    assert.equal(s.campoSegreto(campo({ name: nome })), true, nome);
  }
  for (const nome of ['account_no', 'acc-number', 'success']) {
    assert.equal(s.campoSegreto(campo({ name: nome })), false, nome);
  }
});

// Caselle corte sotto lo stesso contenitore, come le scrive un modulo che divide il numero in pezzi.
function caselle(valori, max, primo = {}) {
  const cont = { querySelectorAll: () => figli, parentElement: null };
  const figli = valori.map((v, i) => ({ ...campo(i === 0 ? primo : {}, v), maxLength: max, parentElement: cont }));
  return figli;
}

test('la carta e il codice divisi in caselle sono segreti in ogni casella', () => {
  const s = creaIsolata();
  const conEtichetta = caselle(['5500', '0000', '0000', '0004'], 4, { autocomplete: 'cc-number' });
  assert.deepEqual(conEtichetta.map((c) => s.campoSegreto(c)), [true, true, true, true]);
  const senzaNome = caselle(['4111', '1111', '1111', '1111'], 4);
  assert.deepEqual(senzaNome.map((c) => s.campoSegreto(c)), [true, true, true, true], 'il numero si ricompone');
  const codice = caselle(['7', '3', '9', '1', '4', '6'], 1);
  assert.deepEqual(codice.map((c) => s.campoSegreto(c)), [true, true, true, true, true, true]);
  const data = caselle(['12', '05', '1990'], 4);
  assert.deepEqual(data.map((c) => s.campoSegreto(c)), [false, false, false], 'una data divisa in tre resta leggibile');
});


// I componenti chiusi li raggiunge solo il protocollo d'ispezione: ognuno porta la catena dei riquadri dello stesso
// processo che lo contengono, e ogni riquadro la sua, perché il main ritrovi dove stanno nella pagina.
test('le radici chiuse si trovano anche dentro i riquadri e i componenti aperti, con la loro catena', () => {
  const { radiciChiuse, componi } = require('../../src/main/services/campiNeiRiquadri.js');
  const chiusa = (id, figli = []) => ({ backendNodeId: id, nodeType: 11, shadowRootType: 'closed', children: figli });
  const albero = { nodeType: 9, backendNodeId: 1, frameId: 'pagina', children: [
    { nodeType: 1, backendNodeId: 2, shadowRoots: [{ nodeType: 11, backendNodeId: 3, shadowRootType: 'open', children: [
      { nodeType: 1, backendNodeId: 4, shadowRoots: [chiusa(5)] }] }] },
    { nodeType: 1, backendNodeId: 6, shadowRoots: [{ nodeType: 11, backendNodeId: 7, shadowRootType: 'user-agent' }] },
    { nodeType: 1, backendNodeId: 8, frameId: 'stesso', contentDocument: { nodeType: 9, backendNodeId: 9, frameId: 'stesso', children: [
      { nodeType: 1, backendNodeId: 10, shadowRoots: [chiusa(11, [{ nodeType: 1, backendNodeId: 12, frameId: 'altro' }])] }] } },
  ] };
  const { chiuse, riquadri } = radiciChiuse(albero);
  assert.deepEqual(chiuse.map((c) => [c.id, c.catena]).sort((a, b) => a[0] - b[0]), [[5, []], [11, [8]]]);
  assert.deepEqual(Object.fromEntries(riquadri), { stesso: [8], altro: [8, 12] }, 'il documento non è un riquadro');
  const posa = componi([{ left: 10, top: 20, width: 100, height: 50 }, { left: 5, top: 5, width: 300, height: 30 }]);
  assert.deepEqual(posa, { dx: 15, dy: 25, sx: 1, sy: 1, vista: { left: 15, top: 25, width: 100, height: 10 } });
  assert.equal(componi([{ left: 0, top: 50, width: 10, height: 10 }, { left: 0, top: 0, width: 10, height: 40 }]), null);
});

// #1721 giro 3: un riquadro che la pagina disegna più grande (transform) porta in scala anche le misure di dentro.
test('dentro un riquadro ingrandito le coordinate si scalano, livello per livello', () => {
  const { componi } = require('../../src/main/services/campiNeiRiquadri.js');
  // Interno: a (10, 20) nel riquadro di mezzo, 100×50, scala 1. Di mezzo: a (5, 5) nella pagina, scala 2, 400×200.
  const posa = componi([{ left: 10, top: 20, width: 100, height: 50, sx: 1, sy: 1 },
    { left: 5, top: 5, width: 400, height: 200, sx: 2, sy: 2 }]);
  assert.deepEqual(posa, { dx: 25, dy: 45, sx: 2, sy: 2, vista: { left: 25, top: 45, width: 200, height: 100 } });
  // Un campo a (0, 0) di 30×10 nell'interno sta a (25, 45) di 60×20 nella pagina.
  assert.deepEqual([posa.dx + 0 * posa.sx, posa.dy + 0 * posa.sy, 30 * posa.sx, 10 * posa.sy], [25, 45, 60, 20]);
});

// #810.16 — il testo che ripete il valore di un campo segreto (l'anteprima della carta) si copre come il campo.
// Un testo per riga, o tutti sulla stessa riga uno accanto all'altro.
function paginaFinta(testi, { inRiga = false, passo = 45 } = {}) {
  const pieni = (i) => testi.slice(0, i).filter((t) => t.trim()).length;
  const rect = (i) => (inRiga ? { left: 10 + pieni(i) * passo, top: 20, width: 45, height: 20 } : { left: 10, top: 20 + i * 30, width: 100, height: 20 });
  const corpo = { nodeType: 1, tagName: 'BODY', childNodes: [], contains: () => false, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const doc = {
    createRange: () => { let n = null; return { selectNodeContents: (x) => { n = x; }, getBoundingClientRect: () => n._rect }; },
  };
  testi.forEach((t, i) => {
    const span = { nodeType: 1, tagName: 'SPAN', childNodes: [], parentElement: corpo, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    const nodo = { nodeType: 3, nodeValue: t, parentElement: span, ownerDocument: doc, _rect: rect(i) };
    span.childNodes.push(nodo);
    span.contains = (x) => x === nodo;
    corpo.childNodes.push(span);
  });
  return { win: { document: doc, innerWidth: 800, innerHeight: 600 }, corpo };
}

test('il testo che ripete il numero della carta si trova con spazi, trattini e da sei cifre; senza valore niente', () => {
  const { win, corpo } = paginaFinta(['Totale 12,00 €', '4111 1111 1111 1111', '4111-1111-1111-1111', '4111 11', '•••• 1111', 'ordine 411']);
  const r = (valori) => S.rettangoliRipetuti(win, valori, corpo).map((x) => x.top);
  assert.deepEqual(r(['4111 1111 1111 1111']), [50, 80, 110], 'intero con spazi, con trattini, e le prime sei cifre');
  assert.deepEqual(r(['4111111111111111']), [50, 80, 110]);
  assert.deepEqual(r([]), [], 'nessun campo, nessun rettangolo');
  assert.deepEqual(r(['5500 0000 0000 0004']), [], 'un valore che la pagina non ripete non copre niente');
  assert.deepEqual(r(['']), []);
  assert.deepEqual(r(['411']), [170], 'un codice corto si copre solo dove compare intero');
  assert.deepEqual(r(['41']), [], 'due cifre non dicono niente');
});

test('le cifre divise in più pezzi di testo si ritrovano insieme', () => {
  const { win, corpo } = paginaFinta(['4111', ' ', '1111', '1111', '1111'], { inRiga: true });
  const tops = S.rettangoliRipetuti(win, ['4111 1111 1111 1111'], corpo);
  assert.equal(tops.length, 1);
  assert.deepEqual(tops[0], { left: 10, top: 20, width: 180, height: 20 }, 'il rettangolo tiene tutti i pezzi');
  const carta = paginaFinta(['4111', '1111', '1111', '1111'], { inRiga: true, passo: 95 });
  assert.deepEqual(S.rettangoliRipetuti(carta.win, ['4111 1111 1111 1111'], carta.corpo), [{ left: 10, top: 20, width: 330, height: 20 }],
    'i gruppi sparsi sulla larghezza della carta disegnata sono un numero solo');
  const sparsi = paginaFinta(['41', '1111', '9'], { inRiga: false });
  assert.deepEqual(S.rettangoliRipetuti(sparsi.win, ['4111 1111 1111 1111'], sparsi.corpo), [],
    'cifre su righe diverse non fanno un numero solo');
});

test('crea dà i valori dei campi segreti compilati, anche fuori vista', () => {
  const carta = { ...campo({ name: 'number' }, '4111 1111 1111 1111'), getBoundingClientRect: () => ({ left: 0, top: -500, right: 10, bottom: -480, width: 10, height: 20 }) };
  const nome = campo({ name: 'nome' }, 'Mario');
  const finestra = { innerWidth: 800, innerHeight: 600, getComputedStyle: () => ({}), document: { querySelectorAll: (q) => (q === '*' ? [] : [carta, nome]), getElementById: () => null } };
  const s = S.crea(finestra, G.cartaValida);
  assert.deepEqual(s.valoriSegreti(), ['4111 1111 1111 1111']);
});
