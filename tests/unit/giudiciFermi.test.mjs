// #906: i giudici senza credito (o con la chiave rifiutata) si dicono all'owner una volta per episodio nella barra, e con
// una carta nella home che resta finché il server non azzera lo stato. Il server lo scrive in config/automation.giudiciFermi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../../src/main/services/giudiciFermi.js');

const EP1 = { causa: 'credit', da: '2026-09-28T20:00:00.000Z', ultimoErrore: '2026-09-28T21:00:00.000Z', inAttesa: 3 };

function finti({ owner = true, letture = [] } = {}) {
  const note = [];
  let disco = { giudiciFermiDetto: '' };
  const barre = [];
  const ritirate = [];
  let broadcast = 0;
  let id = 0;
  const mem = {
    listNotifications: async (o) => (o && o.includeDismissed ? note.slice() : note.filter((n) => !n.dismissed)),
    addNotification: async (n) => { const e = { id: `n${++id}`, ...n, dismissed: false }; note.unshift(e); return e; },
    setNotificationText: async (nid, t) => { const n = note.find((x) => x.id === nid); if (!n || n.text === t) return false; n.text = t; return true; },
    dismissNotification: async (nid) => { const n = note.find((x) => x.id === nid); if (n) n.dismissed = true; },
  };
  const stato = { owner };
  const g = G.start({
    timers: false,
    isAdmin: () => stato.owner,
    leggi: async () => { const l = letture.shift(); if (l instanceof Error) throw l; return l; },
    mem: () => mem,
    storage: () => ({ getRaw: async (k, d) => (k in disco ? disco[k] : d), setRaw: async (k, v) => { disco[k] = v; } }),
    avvisa: (testo, opts) => { barre.push({ testo, opts }); opts.detto?.(); },
    ritira: (k) => ritirate.push(k),
    broadcast: () => { broadcast++; },
  });
  return { g, note, barre, ritirate, stato, letture, disco: () => disco, broadcast: () => broadcast, vive: () => note.filter((n) => !n.dismissed) };
}

test('il primo 402 dei giudici: barra con la cosa da fare e il tasto per Ri-valuta, carta nella home', async () => {
  const f = finti({ letture: [{ risposto: true, raw: EP1 }] });
  await f.g.colpo('avvio');
  assert.equal(f.barre.length, 1);
  assert.match(f.barre[0].testo, /senza credito/);
  assert.match(f.barre[0].testo, /Ricarica il credito della chiave dei giudici, poi in Gestione premi «Ri-valuta i non filtrati»/);
  assert.deepEqual(f.barre[0].opts.azioni, [{ label: 'Apri Ri-valuta', apriFilo: 'filo://manage/manage.html#rivaluta' }]);
  assert.equal(f.barre[0].opts.durataSec, undefined, 'la barra resta finché l\'owner non la chiude');
  assert.equal(f.barre[0].opts.chiave, 'giudici-fermi');
  assert.equal(f.vive().length, 1);
  const carta = f.vive()[0];
  assert.equal(carta.kind, 'alert');
  assert.equal(carta.action.tipo, 'giudici-fermi');
  assert.equal(carta.action.titolo, 'I giudici sono senza credito');
  assert.equal(carta.action.apri, 'filo://manage/manage.html#rivaluta');
  assert.match(carta.text, /3 segnalazioni aspettano il giudizio/);
  assert.equal(f.broadcast(), 1);
});

test('una volta sola per episodio: le letture dopo, e un riavvio, non ridicono la barra; la carta si aggiorna', async () => {
  const f = finti({ letture: [{ risposto: true, raw: EP1 }, { risposto: true, raw: { ...EP1, inAttesa: 9 } }, { risposto: true, raw: { ...EP1, inAttesa: 9 } }] });
  await f.g.colpo('avvio');
  await f.g.colpo('orologio');
  await f.g.colpo('orologio');
  assert.equal(f.barre.length, 1);
  assert.equal(f.vive().length, 1);
  assert.match(f.vive()[0].text, /9 segnalazioni/);
  assert.equal(f.disco().giudiciFermiDetto, EP1.da);
});

test('il credito torna: la carta se ne va, la barra ancora aperta si ritira, e il prossimo episodio si ridice', async () => {
  const EP2 = { ...EP1, da: '2026-10-05T08:00:00.000Z', inAttesa: 1 };
  const f = finti({ letture: [{ risposto: true, raw: EP1 }, { risposto: true, raw: null }, { risposto: true, raw: EP2 }] });
  await f.g.colpo('avvio');
  await f.g.colpo('orologio');
  assert.equal(f.vive().length, 0);
  assert.deepEqual(f.ritirate, ['giudici-fermi']);
  await f.g.colpo('orologio');
  assert.equal(f.barre.length, 2);
  assert.match(f.vive()[0].text, /una segnalazione aspetta/);
});

test('una lettura non riuscita non toglie e non dice niente', async () => {
  const f = finti({ letture: [{ risposto: true, raw: EP1 }, { risposto: false, raw: null }, new Error('rete giù')] });
  await f.g.colpo('avvio');
  await f.g.colpo('orologio');
  await f.g.colpo('orologio');
  assert.equal(f.vive().length, 1);
  assert.equal(f.barre.length, 1);
  assert.deepEqual(f.ritirate, []);
});

test('chiave rifiutata: la cosa da fare è reimpostarla, e il tasto apre Automazioni', async () => {
  const f = finti({ letture: [{ risposto: true, raw: { ...EP1, causa: 'auth' } }] });
  await f.g.colpo('avvio');
  assert.match(f.barre[0].testo, /Reimposta la chiave in Automazioni, fra i Modelli di supporto/);
  assert.deepEqual(f.barre[0].opts.azioni, [{ label: 'Apri Automazioni', apriFilo: 'filo://manage/manage.html#automation' }]);
  assert.equal(f.vive()[0].action.titolo, 'La chiave dei giudici viene rifiutata');
});

test('solo l\'owner: chi non lo è non legge niente, e una carta rimasta da un owner uscito se ne va', async () => {
  const f = finti({ letture: [{ risposto: true, raw: EP1 }] });
  await f.g.colpo('avvio');
  f.stato.owner = false;
  await f.g.colpo('accesso');
  assert.equal(f.vive().length, 0);
  assert.equal(f.letture.length, 0, 'nessuna lettura in più');
});

test('una carta tolta dall\'owner (per esempio dalla chat) non torna nello stesso episodio', async () => {
  const f = finti({ letture: [{ risposto: true, raw: EP1 }, { risposto: true, raw: { ...EP1, inAttesa: 5 } }] });
  await f.g.colpo('avvio');
  f.note[0].dismissed = true;
  await f.g.colpo('orologio');
  assert.equal(f.vive().length, 0);
});

test('normalizza scarta uno stato storto invece di mostrarlo', () => {
  assert.equal(G.normalizza(null), null);
  assert.equal(G.normalizza({ causa: 'timeout', da: EP1.da }), null);
  assert.equal(G.normalizza({ causa: 'credit', da: 'ieri' }), null);
  assert.equal(G.normalizza({ causa: 'credit', da: EP1.da, inAttesa: '<b>' }).inAttesa, 0);
});

test('nella carta l\'ora d\'inizio e il conto delle segnalazioni non si leggono come un numero solo', () => {
  const t = G.testi({ ...EP1, inAttesa: 118 });
  assert.match(t.testo, /118 segnalazioni aspettano/);
  assert.doesNotMatch(t.testo, /\d{2}:\d{2} \d+ segnalazioni/);
});
