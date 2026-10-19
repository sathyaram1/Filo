// Verifica #1360 giro 2, rilievo 1: la copia si riconosce dai valori solo nelle righe senza nomi e col solo user agent dei browser.
import { test, expect } from '../../fixtures/electron.mjs';
import { motivoContenuto } from '../../../scripts/lib/copie-di-dati.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Filo/1.4.2 Chrome/130.0.6723.191 Electron/33.4.0 Safari/537.36';
const UA_CHAT = 'Filo desktop 1.4.2';
const testi = ['il pulsante salva non funziona quando chiudo la scheda', 'quando apro il menu col tasto destro sparisce tutto', 'la chat non risponde se scrivo una emoji'];
const hash = (i) => `${'0123456789abcdef'.repeat(4).slice(i, 64)}${'a'.repeat(i)}`;
const elenco = (ua) => testi.map((text, i) => ({ id: `AbCdEfGhIjKlMnOpQr0${i}`, text, userAgent: ua, clientIdHash: hash(i), seq: 1300 + i }));
const copia = (f, t) => motivoContenuto(f, Buffer.from(t));

test('r1 un JSON con le chiavi rinominate in italiano è una copia, come lo stesso CSV con l\'intestazione rinominata', () => {
  const t = JSON.stringify(elenco(UA).map((x) => ({ testo: x.text, ua: x.userAgent, utente: x.clientIdHash })), null, 2);
  expect(copia('scripts/fb.json', t)).not.toBe('');
});

test('r1 jq -r con un valore per riga (testo, user agent, identificativo) è una copia', () => {
  const t = elenco(UA).map((x) => [x.text, x.userAgent, x.clientIdHash].join('\n')).join('\n');
  expect(copia('scripts/fb.txt', t)).not.toBe('');
});

test('r1 una stampa a righe di log (numero, identificativo, user agent, testo separati da spazi) è una copia', () => {
  const t = elenco(UA).map((x) => `#${x.seq} da ${x.clientIdHash} (${x.userAgent}): ${x.text}`).join('\n');
  expect(copia('scripts/fb-log.txt', t)).not.toBe('');
});

test('r1 un CSV senza intestazione di feedback mandati dalla chat (user agent «Filo desktop») è una copia', () => {
  const t = elenco(UA_CHAT).map((x) => [x.id, x.text, x.userAgent, x.clientIdHash, x.seq].map((c) => `"${c}"`).join(',')).join('\n');
  expect(copia('scripts/fb.csv', t)).not.toBe('');
});
