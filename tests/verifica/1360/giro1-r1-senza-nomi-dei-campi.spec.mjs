// #1360 giro 1 — una copia dei feedback senza i nomi esatti dei campi (CSV senza intestazione, coda di un file,
// colonne chiamate user_agent o «User Agent») porta gli stessi testi, user agent e identificativi: si ferma uguale.
import { test, expect } from '@playwright/test';
import { motivoContenuto } from '../../../scripts/lib/copie-di-dati.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Filo/0.9.3 Chrome/130.0 Electron/33.0 Safari/537.36';
const FB = Array.from({ length: 30 }, (_, i) => ({
  id: `fbId${i}abcdefghijklmn`, text: `il tasto ${i} non risponde quando apro la scheda`, userAgent: UA, clientIdHash: String(i).padStart(32, 'a'),
}));
const fs = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { stringValue: v }]));
const copia = (testo) => motivoContenuto('scripts/fb.csv', Buffer.from(testo));
const csv = (righe) => righe.map((f) => Object.values(f).map((v) => `"${v}"`).join(',')).join('\n') + '\n';

test('r1 un CSV senza la riga di intestazione (jq @csv) è una copia', () => {
  expect(copia(csv(FB))).not.toBe('');
});

test('r1 le ultime righe di un CSV, senza intestazione, sono una copia come il CSV intero', () => {
  const intero = `id,text,userAgent,clientIdHash\n${csv(FB)}`;
  expect(copia(intero)).not.toBe('');
  expect(copia(intero.split('\n').slice(-20).join('\n'))).not.toBe('');
});

test('r1 colonne con un altro nome per gli stessi campi sono una copia', () => {
  for (const intestazione of ['id,text,user_agent,client_id_hash', 'id,text,User Agent,clientIdHash', 'id,text,useragent,clientIdHash']) {
    expect(copia(`${intestazione}\n${csv(FB.slice(0, 3))}`), intestazione).not.toBe('');
  }
  expect(copia(JSON.stringify(FB.slice(0, 3).map((f) => ({ id: f.id, text: f.text, user_agent: f.userAgent }))))).not.toBe('');
});

test('r1 la coda di un elenco nel formato del server, più corta di un feedback, è una copia', () => {
  const righe = JSON.stringify(FB.map(fs), null, 2).split('\n');
  expect(copia(righe.slice(-12).join('\n'))).not.toBe('');
});
