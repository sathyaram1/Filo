// #2300: un trascinamento interno vale solo col gettone che una pagina di Filo ha dato al main. Qui la pagina che
// trascina, il main vero (handler e registro) e chi riceve, con un DataTransfer finto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const radice = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
require(join(radice, 'src/shared/messages.js'));
const Registro = require(join(radice, 'src/main/services/trasciniInterni.js'));

// Il main come lo monta handlers.js: `origin` è l'indirizzo di chi chiama.
function main() {
  const h = {};
  require(join(radice, 'src/main/services/handlers/trascini.js'))((tipo, fn) => { h[tipo] = fn; });
  return (msg, origin) => h[msg.type](msg, {}, origin);
}

// Una pagina con il modulo, che parla al main da `origin`.
function pagina(chiama, origin) {
  const ctx = { crypto: webcrypto, SN_MSG: globalThis.SN_MSG, chrome: { runtime: { sendMessage: (m) => chiama(m, origin) } } };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(radice, 'src/shared/trascinoInterno.js'), 'utf8'), ctx);
  return ctx.SN_TRASCINO_INTERNO;
}

function dataTransfer(dati = {}) {
  const m = new Map(Object.entries(dati));
  return { get types() { return [...m.keys()]; }, setData: (t, v) => m.set(t, String(v)), getData: (t) => m.get(t) || '' };
}

const RIF = { titolo: 'D-52 Colore del bordo', testo: 'Contesto.' };

test('il riferimento trascinato da una pagina di Filo arriva a un\'altra pagina di Filo, una volta sola', async () => {
  const chiama = main();
  const gestione = pagina(chiama, 'filo://manage/');
  const home = pagina(chiama, 'filo://newtab/');
  const dt = dataTransfer();
  assert.deepEqual(await gestione.parte(dt, 'riferimento', RIF), { ok: true });
  assert.ok(home.porta(dt, 'riferimento'));
  assert.match(dt.getData('application/x-filo-riferimento'), /^[\w-]{36}$/, 'il tipo porta solo il gettone');
  assert.deepEqual(await home.arriva(dt, 'riferimento').dati, RIF);
  assert.equal(await home.arriva(dt, 'riferimento').dati, null, 'lo stesso gettone vale una volta');
});

test('il tipo scritto da una pagina web non porta niente: resta il testo a vista', async () => {
  const chiama = main();
  const home = pagina(chiama, 'filo://newtab/');
  const finto = dataTransfer({ 'application/x-filo-file': '/home/tu/.ssh/id_rsa', 'text/plain': 'foto.jpg' });
  const r = home.arriva(finto, 'file');
  assert.equal(r.aVista, 'foto.jpg');
  assert.equal(await r.dati, null);
  const senzaTesto = home.arriva(dataTransfer({ 'application/x-filo-file': '/home/tu/.ssh/id_rsa' }), 'file');
  assert.equal(senzaTesto.aVista, '/home/tu/.ssh/id_rsa', 'senza testo semplice si vede quello che portava');
  assert.equal(await senzaTesto.dati, null);
  const formaGiusta = home.arriva(dataTransfer({ 'application/x-filo-file': '0f8c2a51-7d3e-4b6a-9c21-5e4d3b2a1f00' }), 'file');
  assert.equal(await formaGiusta.dati, null, 'un gettone mai dato dal main non vale');
});

test('un sito non scrive gettoni e non li prende, nemmeno uno vero', async () => {
  const chiama = main();
  const sito = pagina(chiama, 'https://esempio.it/');
  const home = pagina(chiama, 'filo://newtab/');
  const suo = dataTransfer();
  assert.equal((await sito.parte(suo, 'file', '/etc/passwd')).ok, false);
  assert.equal(await home.arriva(suo, 'file').dati, null);
  const vero = dataTransfer();
  await home.parte(vero, 'file', '/tmp/contratto.pdf');
  assert.equal(await sito.arriva(vero, 'file').dati, null);
  assert.equal(await home.arriva(vero, 'file').dati, '/tmp/contratto.pdf', 'il rifiuto al sito non lo consuma');
});

test('un gettone di un file non vale per un riferimento', async () => {
  const chiama = main();
  const home = pagina(chiama, 'filo://newtab/');
  const dt = dataTransfer();
  await home.parte(dt, 'file', '/tmp/a.pdf');
  const scambiato = dataTransfer({ 'application/x-filo-riferimento': dt.getData('application/x-filo-file') });
  assert.equal(await home.arriva(scambiato, 'riferimento').dati, null);
  assert.equal(await home.arriva(dt, 'file').dati, '/tmp/a.pdf');
});

test('il registro scade, tiene un tetto ampio e dice il numero di quello che rifiuta', () => {
  let t = 0;
  const r = Registro.crea({ adesso: () => t });
  const g = (i) => `gettone-${String(i).padStart(12, '0')}`;
  assert.equal(r.parte(g(1), 'file', '/a').ok, true);
  t += Registro.DURATA_MS - 1;
  assert.equal(r.arriva(g(1), 'file').ok, true, 'un trascinamento lungo vale ancora');
  r.parte(g(2), 'file', '/b');
  t += Registro.DURATA_MS;
  assert.equal(r.arriva(g(2), 'file').ok, false, 'scaduto');
  for (let i = 0; i <= Registro.MASSIMO; i++) r.parte(g(100 + i), 'file', `/f${i}`);
  assert.equal(r.arriva(g(100), 'file').ok, false, 'oltre il tetto se ne va il più vecchio');
  assert.equal(r.arriva(g(100 + Registro.MASSIMO), 'file').ok, true);
  const grosso = r.parte(g(9), 'riferimento', { titolo: 't', testo: 'x'.repeat(Registro.CARATTERI_MAX) });
  assert.equal(grosso.ok, false);
  assert.match(grosso.error, new RegExp(String(Registro.CARATTERI_MAX)));
  assert.equal(r.parte(g(10), 'riferimento', { titolo: 't', testo: 'x'.repeat(30000) }).ok, true, 'il riferimento più grosso di Gestione entra');
  assert.equal(r.parte('corto', 'file', '/a').ok, false);
  assert.equal(r.parte(g(11), 'File!', '/a').ok, false);
});
