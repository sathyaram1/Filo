// Verifica #2199.5 giro 3, r1: quando il cancello del server non porta l'app in attesa (main di Filo mosso dopo la prova
// del finish, ramo dell'app mosso, app con fonti del bake fuori dall'attesa), il perché e il passo da fare arrivano
// all'owner per intero: tagliati, il comando da lanciare dopo si perde.
import { test, expect } from '@playwright/test';
import { appDopoIlServer, fusioneDalCancello } from '../../../scripts/server-fondi-pratica.mjs';
import { classifyServerMerge } from '../../../scripts/lib/owner-merge.mjs';

const RAMO = 'claude/fonti-bake-col-server';
const SHA = 'a'.repeat(40);
const CODA = `e dopo rilancia npm run server:fondi -- ${RAMO} --feedback 42.`;
// Un rifiuto del cancello come arriva al PC: errore 400 col dettaglio nel messaggio.
const PERCHE = `main di Filo si è mosso dopo la prova degli unit del finish su ${RAMO}: main del server resta dov'era. `
  + `Rifai npm run finish sul ramo dell'app, che ripete la prova e rimette l'app in attesa, ${CODA}`;
const rifiuto = () => classifyServerMerge(400, { error: { message: PERCHE } });

test('r1 il rifiuto del cancello alla fusione dal PC arriva all’owner intero, col passo da fare', async () => {
  const errori = [];
  const k = await fusioneDalCancello({ cartella: '/x/functions', ramo: RAMO, sha: SHA, feedbackId: 'p' }, {
    chiedi: async () => rifiuto(), allinea: () => {}, log: () => {}, err: (s) => errori.push(String(s)),
  });
  expect(k).not.toBe(0);
  expect(errori.join('\n')).toContain(CODA);
});

test('r1 il rifiuto del cancello all’app in attesa dopo il server arriva all’owner intero, col passo da fare', async () => {
  const errori = [];
  const fatto = await appDopoIlServer({ ramo: RAMO, sha: SHA, feedbackId: 'p' }, {
    chiedi: async () => rifiuto(), log: () => {}, err: (s) => errori.push(String(s)),
  });
  expect(fatto).toBe(false);
  expect(errori.join('\n')).toContain(CODA);
});
