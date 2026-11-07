// #2085 — la forma delle schede lasciate in una chat: cosa viaggia fra pagina e main, il gettone nel testo, le schede
// che restano col messaggio, cosa entra nell'archivio, e che il modello le riceva con la cornice di LEGGI_PAGINA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const G = require('../../src/shared/schedeInChat.js');
require('../../src/shared/rispostaA.js');
require('../../src/shared/chatArchive.js');

const SCHEDA = { id: 't7', titolo: 'Articolo sulla Tesla che è volata nello spazio', url: 'https://esempio.it/tesla', icona: 'data:image/png;base64,AAAA' };

test('normalizza: solo indirizzi web, icone immagine, titoli ripuliti dai segni del gettone', () => {
  assert.deepEqual(G.normalizza(SCHEDA), SCHEDA);
  assert.equal(G.normalizza({ ...SCHEDA, url: 'filo://newtab/' }), null);
  assert.equal(G.normalizza({ ...SCHEDA, url: 'javascript:alert(1)' }), null);
  assert.equal(G.normalizza({ ...SCHEDA, icona: 'http://x/i.png' }).icona, '');
  // Un'icona da un indirizzo farebbe contattare il sito a chi guarda il gettone: passa solo la copia del main.
  assert.equal(G.normalizza({ ...SCHEDA, icona: 'https://x/i.png' }).icona, '');
  assert.equal(G.normalizza({ ...SCHEDA, icona: 'data:text/html;base64,AA' }).icona, '');
  assert.equal(G.normalizza({ ...SCHEDA, titolo: 'a⟧b\nc' }).titolo, 'a b c');
  assert.equal(G.normalizza({ ...SCHEDA, titolo: '' }).titolo, 'esempio.it');
  assert.equal(G.normalizza({ ...SCHEDA, id: '<img>' }).id, '');
});

test('il gettone sta nel testo e porta un titolo corto', () => {
  const g = G.gettone(SCHEDA);
  assert.match(g, /^⟦ .+…⟧$/);
  assert.ok(g.length <= 31);
  const t = `come ha fatto a volare? ${g} e ${G.gettone({ ...SCHEDA, id: 't8', titolo: 'Falcon', url: 'https://b.it/' })}`;
  const p = G.pezzi(t);
  assert.equal(p.filter((x) => x.gettone).length, 2);
  assert.equal(p[0].testo, 'come ha fatto a volare? ');
});

test('allinea: valgono solo le schede il cui gettone è ancora nel testo, nell\'ordine del testo', () => {
  const b = { id: 't8', titolo: 'Falcon', url: 'https://b.it/' };
  const t = `${G.gettone(b)} poi ${G.gettone(SCHEDA)}`;
  assert.deepEqual(G.allinea(t, [SCHEDA, b]).map((s) => s.id), ['t8', 't7']);
  // Cancellato a metà o scritto a mano: il gettone non ha più una scheda.
  assert.deepEqual(G.allinea('solo testo', [SCHEDA]), []);
  assert.deepEqual(G.allinea(`⟦ Falso⟧ ${G.gettone(SCHEDA)}`, [SCHEDA]).map((s) => s && s.id), [null, 't7']);
});

test('l\'archivio tiene le schede del messaggio, ripulite, e lascia le icone grosse', () => {
  const C = globalThis.SN_CHAT_ARCHIVE;
  const grossa = `data:image/png;base64,${'A'.repeat(20000)}`;
  const m = C.toStoredMessage({ role: 'user', text: G.gettone(SCHEDA), schede: [SCHEDA, { ...SCHEDA, id: 'x', icona: grossa }, { url: 'filo://x' }] });
  assert.equal(m.schede.length, 2);
  assert.equal(m.schede[0].url, SCHEDA.url);
  assert.equal(m.schede[1].icona, '');
  assert.equal(C.toStoredMessage({ role: 'filo', text: 'x', schede: [SCHEDA] }).schede, undefined);
});

// Il modello riceve ogni scheda come una LEGGI_PAGINA già fatta: stessa lettura, stessa cornice, e le uscite la contano.
test('main: le schede del messaggio arrivano al modello come letture di pagina, home e Aiuto', () => {
  const src = fs.readFileSync(new URL('../../src/main/services/handlers.js', import.meta.url), 'utf8');
  const lettura = src.slice(src.indexOf('async function lettureDeiGettoni'), src.indexOf('function notaDeiGettoni'));
  assert.match(lettura, /type: 'LEGGI_PAGINA'/);
  assert.match(lettura, /leggiPaginaDa\(s\.url, 0, sender\)/);
  const nota = src.slice(src.indexOf('function notaDeiGettoni'), src.indexOf('function pageReadsForPrompt'));
  assert.match(nota, /pageReadsForPrompt\(letture\)/);
  // La stessa lettura di LEGGI_PAGINA.
  assert.match(src, /case 'LEGGI_PAGINA': \{[\s\S]{0,2000}leggiPaginaDa\(url, da, sender\)/);
  const turno = src.slice(src.indexOf('async function turnoFiloChat'), src.indexOf('async function turnoFiloChat') + 30000);
  assert.match(turno, /azioniViste\.push\(\.\.\.lettureGettoni\)/);
  assert.match(turno, /renderedActions = \[\.\.\.lettureGettoni\]/);
  assert.match(turno, /notaDeiGettoni\(lettureGettoni\)/);
  const aiuto = src.slice(src.indexOf('if (action === ACTIONS.HELP)'), src.indexOf('if (action === ACTIONS.CATEGORIZE)'));
  assert.match(aiuto, /notaDeiGettoni\(await lettureDeiGettoni\(/);
  // Nell'Aiuto le stesse letture si segnano fra le fonti della sua conversazione: alzano la guardia sulle azioni come
  // una lettura chiesta da lui, anche su una pagina di Filo dove l'Aiuto non conta già un sito.
  assert.match(aiuto, /lettureDeiGettoni\([^;]*\{ assistente: true \}\)/);
  assert.match(lettura, /if \(assistente\) for \(const l of letture\) segnaLetturaAiuto\(sender, l\)/);
});

// Il filo riletto dal disco porta le schede del messaggio, e la ricerca le legge col titolo, senza i segni.
test('filo: un messaggio con le schede le porta nella coda, e la ricerca lo trova senza i segni', async () => {
  await import('../../src/shared/filoCoda.js');
  const C = globalThis.SN_FILO_CODA;
  const S = globalThis.SN_SCHEDE_IN_CHAT;
  const testo = `di cosa parla ${S.gettone(SCHEDA)} `;
  const chats = [{ id: 'c1', createdAt: '2026-11-07T10:00:00Z', messages: [{ role: 'user', text: testo, ts: '2026-11-07T10:00:00Z', schede: [SCHEDA] }] }];
  const msg = C.elementi({ chats }).find((v) => v.k === 'msg');
  assert.deepEqual(msg.schede, [SCHEDA]);
  const r = C.cerca({ chats }, 'parla');
  assert.equal(r.messaggi.length, 1);
  assert.ok(!r.messaggi[0].testo.includes('⟦'), r.messaggi[0].testo);
});
