// Verifica #679.3 giro 1: l'owner guarda una persona sola scrivendone l'indirizzo dopo /users.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function finteRisposte(page) {
  await page.evaluate(() => {
    const tutti = Array.from({ length: 120 }, (_, i) => ({
      email: `utente${String(i).padStart(3, '0')}@esempio.it`, name: i === 99 ? 'Mario Rossi' : '', balance: 100 + i,
    }));
    window.__richieste = [];
    const vero = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === 'owner_list_users') {
        window.__richieste.push(msg);
        // Come il main vero: minuscolo e senza spazi ai lati.
        const cerca = String(msg.cerca || '').trim().toLowerCase();
        const dopo = String(msg.after || '');
        const trovati = tutti.filter((u) => u.email.startsWith(cerca));
        const pagina = trovati.filter((u) => !dopo || u.email > dopo).slice(0, 50);
        const r = { ok: true, users: pagina, total: trovati.length, next: pagina.length >= 50 ? pagina[pagina.length - 1].email : '' };
        return new Promise((res) => setTimeout(() => { if (cb) cb(r); res(r); }, 150));
      }
      return vero(msg, cb);
    };
  });
}

async function scrivi(page, testo) {
  await page.fill('#input', testo);
  await page.press('#input', 'Enter');
}

test('l’indirizzo scritto in maiuscolo o con spazi trova la persona', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await finteRisposte(page);
  const ultima = () => page.locator('#bubbles .dash-bubble-filo').last();

  await scrivi(page, '/users   Utente099@Esempio.IT  ');
  await expect(ultima()).toContainText('Trovato:', { timeout: 8000 });
  await expect(ultima()).toContainText('utente099@esempio.it (Mario Rossi) — 199 crediti');
  await page.screenshot({ path: 'tests/.shots/679-3-v-maiuscolo.png' });

  // Inizio dell'indirizzo con più di una pagina di risultati, poi "altri".
  await scrivi(page, '/users utente');
  await expect(ultima()).toContainText('1-50 di 120', { timeout: 8000 });
  await scrivi(page, '/users altri');
  await expect(ultima()).toContainText('51-100 di 120', { timeout: 8000 });

  // Inizio con pochi risultati: nessun invito ad "altri".
  await scrivi(page, '/users utente11');
  await expect(ultima()).toContainText('1-10 di 10', { timeout: 8000 });
  await expect(ultima()).not.toContainText('/users altri');
  await scrivi(page, '/users altri');
  await expect(ultima()).toContainText('Non ho altri utenti', { timeout: 8000 });

  // HTML nell'indirizzo: resta testo.
  await scrivi(page, '/users <b>x</b>');
  await expect(ultima()).toContainText('«<b>x</b>»', { timeout: 8000 });
  await page.screenshot({ path: 'tests/.shots/679-3-v-html.png' });
});

test('in fretta: una ricerca data mentre l’elenco completo viaggia vince', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await finteRisposte(page);
  await scrivi(page, '/users');
  await scrivi(page, '/users utente042@esempio.it');
  const ultima = page.locator('#bubbles .dash-bubble-filo').last();
  await expect(ultima).toContainText('Trovato:', { timeout: 8000 });
  await page.waitForTimeout(600);
  await expect(page.locator('#bubbles')).not.toContainText('Utenti registrati 1-50');
});

test('l’indirizzo copiato con il nome davanti trova lo stesso la persona', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForSelector('#input');
  await finteRisposte(page);
  await scrivi(page, '/users Mario Rossi <utente099@esempio.it>');
  const ultima = page.locator('#bubbles .dash-bubble-filo').last();
  await expect(ultima).toContainText('utente099@esempio.it (Mario Rossi) — 199 crediti', { timeout: 8000 });
});
