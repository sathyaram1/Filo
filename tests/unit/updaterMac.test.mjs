// Unit test: su Mac un aggiornamento che non riesce a installarsi non deve
// restare un segreto.
//
// PERCHÉ ESISTE
//   Il controllo e lo scaricamento degli aggiornamenti funzionano su tutti i
//   sistemi. L'INSTALLAZIONE su Mac la fa un meccanismo di sistema che pretende
//   una firma rilasciata da Apple: finché Filo ne ha solo una locale, quel
//   passo fallisce. Se fallisse in silenzio, chi usa un Mac resterebbe fermo
//   alla versione con cui ha installato Filo — per sempre, e senza saperlo.
//
//   Qui si inchioda il comportamento minimo: quando c'è una versione nuova e
//   l'installazione inciampa, l'utente lo legge fra le notifiche, una volta
//   sola, e sa dove andare a prenderla.
// Pura logica → niente Electron, niente rete.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const { avvisaSeAggiornamentoBloccato } = require(join(ROOT, 'src', 'main', 'updater.js'));

// Memoria finta: le stesse due funzioni che l'avviso usa davvero.
let scritte;
function memoriaFinta() {
  scritte = [];
  globalThis.SN_FILO_MEMORY = {
    listNotifications: async () => scritte.slice(),
    addNotification: async (n) => { scritte.unshift({ ...n, dismissed: false }); return n; },
  };
}

function conPiattaforma(p, fn) {
  const vero = process.platform;
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
  return Promise.resolve(fn()).finally(() => {
    Object.defineProperty(process, 'platform', { value: vero, configurable: true });
  });
}

beforeEach(() => memoriaFinta());

test('su Mac, un aggiornamento che non si installa diventa un avviso leggibile', async () => {
  await conPiattaforma('darwin', () => avvisaSeAggiornamentoBloccato('0.2.215'));
  assert.equal(scritte.length, 1, 'nessun avviso: su un Mac l\'utente resterebbe fermo senza saperlo');
  const n = scritte[0];
  assert.ok(n.text.includes('0.2.215'), 'l\'avviso non dice quale versione');
  assert.ok(n.text.includes('filo.red'), 'l\'avviso non dice dove prenderla');
  // Il marcatore serve a noi, non all'utente: non deve finire nel testo.
  assert.ok(!/aggiornamento-mac/.test(n.text), 'un marcatore interno è finito sotto gli occhi dell\'utente');
});

test('su Windows non si avvisa nessuno: lì l\'aggiornamento si installa da sé', async () => {
  await conPiattaforma('win32', () => avvisaSeAggiornamentoBloccato('0.2.215'));
  assert.deepEqual(scritte, [], 'avviso inutile su Windows');
});

test('un errore senza una versione nuova non allarma nessuno', async () => {
  // Rete assente, feed irraggiungibile: non è l'installazione ad aver
  // fallito, e per l'utente non cambia niente.
  await conPiattaforma('darwin', () => avvisaSeAggiornamentoBloccato(null));
  assert.deepEqual(scritte, [], 'un problema di rete non è un aggiornamento bloccato');
});

test('la stessa versione non riempie la colonna di schede uguali', async () => {
  await conPiattaforma('darwin', async () => {
    await avvisaSeAggiornamentoBloccato('0.2.215');
    await avvisaSeAggiornamentoBloccato('0.2.215');
    await avvisaSeAggiornamentoBloccato('0.2.215');
  });
  assert.equal(scritte.length, 1, 'ogni riavvio aggiungeva una scheda nuova');
});

test('una scheda già scartata non torna, ma una versione ancora più nuova sì', async () => {
  await conPiattaforma('darwin', async () => {
    await avvisaSeAggiornamentoBloccato('0.2.215');
    scritte[0].dismissed = true;        // l'utente l'ha chiusa
    await avvisaSeAggiornamentoBloccato('0.2.215');
    assert.equal(scritte.length, 1, 'un avviso scartato è tornato a farsi vedere');
    await avvisaSeAggiornamentoBloccato('0.2.216');
    assert.equal(scritte.length, 2, 'una versione ancora più nuova non è stata segnalata');
  });
});

test('senza la memoria disponibile non si rompe niente', async () => {
  globalThis.SN_FILO_MEMORY = undefined;
  await conPiattaforma('darwin', () => avvisaSeAggiornamentoBloccato('0.2.215'));
});
