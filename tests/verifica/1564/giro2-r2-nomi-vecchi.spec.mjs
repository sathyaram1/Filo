// Verifica #1564 giro 1, rilievo 2: testi che il modello legge nominano ancora strumenti che la richiesta non porta più.
import { test, expect } from '../../fixtures/electron.mjs';
import fs from 'node:fs';
import path from 'node:path';

test('r2 l\'intervista di benvenuto dice di leggere il documento sui modelli con lo strumento che esiste', async ({ app }) => {
  const testo = await app.evaluate(() => JSON.stringify(globalThis.SN_ONBOARDING));
  const nomi = await app.evaluate(() => globalThis.SN_ACTION_TOOLS.NOMI_STRUMENTI);
  expect(nomi).not.toContain('LEGGI_TRASPARENZA');
  expect(testo).not.toMatch(/LEGGI_TRASPARENZA/);
  expect(testo).toMatch(/filo_su_di_se\(documento\)/);
});

test('r2 la ricerca nel filo che trova conversazioni nascoste dice di rimetterle con filo(rimetti_chat)', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/main/services/handlers.js'), 'utf8');
  const riga = src.split('\n').find((l) => l.includes('che l\'utente ha nascosto e che combaciano'));
  expect(riga, 'il testo per il modello sulle conversazioni nascoste').toBeTruthy();
  expect(riga).not.toMatch(/RIMETTI_CHAT/);
  expect(riga).toMatch(/rimetti_chat/);
});
