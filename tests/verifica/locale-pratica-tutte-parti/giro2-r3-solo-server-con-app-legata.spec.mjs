// Verifica locale #915, giro 2, rilievo 3: con --solo-server e un ramo dell'app legato alla pratica, il consiglio che
// server:fondi dà («rilancia senza --solo-server») deve potersi seguire. Firestore e git finti; non apre Filo.
import { test, expect } from '@playwright/test';
import { preparaPratiche } from './_pratica-finta.mjs';

test('--solo-server con un ramo dell’app legato alla pratica: il rilancio consigliato funziona', async () => {
  const { nuova, fondi } = await preparaPratiche();
  nuova('p');
  const primo = await fondi(['claude/parte-server', '--feedback', 'p', '--solo-server'], { ramiAperti: ['claude/parte-app'] });
  expect(primo.testo).toMatch(/rilancia senza --solo-server/);
  const rilancio = await fondi(['claude/parte-server', '--feedback', 'p'], { ramiAperti: ['claude/parte-app'] });
  expect(rilancio.k, rilancio.testo).toBe(0);
});
