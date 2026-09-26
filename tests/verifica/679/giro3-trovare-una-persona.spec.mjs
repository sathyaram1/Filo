// Giro 3 di verifica del #679 — l'elenco degli iscritti adesso arriva a pagine
// di cinquanta. Prima usciva tutto in un colpo e una persona la si trovava
// leggendo. La segnalazione dava per scontato che la ricerca per email
// «resta la strada per trovare una persona precisa»: qui si controlla che quella
// strada esista davvero per chi usa Filo, e non solo dentro al comando che
// regala crediti.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

require(join(ROOT, 'src', 'shared', 'messages.js'));
require(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard-comandi.js'));
const MSG = globalThis.SN_MSG.MSG;
const C = globalThis.SN_DASH_COMANDI;

const TUTTI = Array.from({ length: 120 }, (_, i) => ({
  email: `utente${String(i).padStart(3, '0')}@esempio.it`,
  name: '',
  balance: 100 + i,
}));
const CERCATA = TUTTI[87];

test('con centoventi iscritti si può chiedere una persona sola, senza sfogliare le pagine', async () => {
  const righe = [];
  C.init({
    send: async (msg) => {
      if (msg.type !== MSG.OWNER_LIST_USERS) return { ok: true };
      // Il server sa già filtrare per email (filtro + limit 1): se il comando
      // glielo chiede, risponde con quella riga sola.
      const cercata = String(msg.cerca || msg.email || '').trim().toLowerCase();
      if (cercata) {
        const trovata = TUTTI.filter((u) => u.email === cercata);
        return { ok: true, users: trovata, total: trovata.length, next: '' };
      }
      const dopo = String(msg.after || '');
      const pagina = TUTTI.filter((u) => !dopo || u.email > dopo).slice(0, 50);
      return { ok: true, users: pagina, total: TUTTI.length, next: pagina.length >= 50 ? pagina[pagina.length - 1].email : '' };
    },
    bubblesEl: null,
    inputEl: { value: '', classList: { toggle() {} } },
    makeBubble: () => null,
    goHome() {}, goThread() {},
    autoGrowInput() {}, refreshLive() {},
    archiviaRiga: (testo) => { righe.push(String(testo)); },
    chatDellaRiga: () => 'chat-1',
    inChatAperta: () => false,
  });

  C.handleSlashCommand(`/users ${CERCATA.email}`);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  const risposta = righe[righe.length - 1] || '';

  expect(risposta, 'chiedendo una persona per email si riceve la sua riga').toContain(CERCATA.email);
  expect(risposta, 'chiedendo una persona per email si riceve il suo saldo').toContain(String(CERCATA.balance));
  expect(risposta.includes(TUTTI[0].email),
    'chiedendo una persona si riceve invece la prima pagina di tutti gli iscritti').toBe(false);
});
