// VERIFICA #398 (verifier, black-box dal sintomo utente).
// L'utente: "da quando la barra indirizzi non c'è più, /localhost:3000,
// /127.0.0.1:8080 e /192.168.1.1 diventano rossi e all'invio finiscono in chat".
// Qui verifichiamo il SUCCESSO (la scheda si apre davvero) + stress test.

import { test, expect } from './fixtures/electron.mjs';

async function openDash(openTab) {
  const dash = await openTab('filo://newtab/');
  const input = dash.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  return { dash, input };
}

async function findWindow(app, pred, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => { try { return pred(x.url()); } catch (_) { return false; } });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// (1) Il caso letterale del feedback: server locale vero su 127.0.0.1:PORT.
test('#398 /127.0.0.1:porta apre la pagina locale e non finisce in chat', async ({ app, openTab, testServer }) => {
  const full = testServer.html('<!doctype html><title>t</title><h1 id="m">pagina locale</h1>');
  const typed = full.replace(/^https?:\/\//, '');
  const { dash, input } = await openDash(openTab);

  await input.fill('/' + typed);
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
  // Traccia visiva della colorazione (arancione = riconosciuto).
  await dash.screenshot({ path: 'tests/.shots/verify398-input-locale.png' }).catch(() => {});
  await input.press('Enter');

  const page = await findWindow(app, (u) => u === `http://${typed}`);
  expect(page, 'deve aprirsi la scheda sull’indirizzo locale').toBeTruthy();
  await expect(page.locator('#m')).toHaveText('pagina locale', { timeout: 8000 });
  await expect(input).toHaveValue('');

  // Nessuna bolla di chat con l'indirizzo (= nessuna richiesta LLM sprecata).
  const inChat = await dash.evaluate((a) => {
    const root = document.querySelector('#chat, #messages, main') || document.body;
    return (root.textContent || '').includes(a);
  }, typed);
  expect(inChat, 'l’indirizzo non deve comparire come messaggio in chat').toBe(false);
});

// (2) localhost:PORT — stesso server, host "localhost" (nome, non IP).
test('#398 /localhost:porta è riconosciuto e apre su schema http', async ({ app, openTab, testServer }) => {
  const port = new URL(testServer.origin).port;
  const { input } = await openDash(openTab);
  await input.fill(`/localhost:${port}/`);
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
  await input.press('Enter');
  const page = await findWindow(app, (u) => u.startsWith(`http://localhost:${port}`));
  expect(page, 'scheda su http://localhost:PORT attesa (http, non https)').toBeTruthy();
});

// (3) IP privato senza porta (router di casa): riconoscimento + la scheda parte
//     su http://192.168.1.1 (schema giusto) e nulla va in chat.
//
//     192.168.1.1 È il router di casa di qualcuno: dove risponde davvero, la
//     pagina rimbalza (spesso su https, o su un nome tipo `fritz.box`) e la
//     scheda non si chiama più come l'indirizzo digitato — rosso che parla
//     della rete di chi lancia il test, non di Filo. La fixture manda
//     quell'indirizzo su una porta chiusa del loopback (vedi
//     tests/fixtures/electron.mjs): la scheda resta ferma sull'indirizzo
//     chiesto, che è ciò che questo caso vuole leggere, e l'esito è lo stesso
//     in casa, in ufficio e nel cloud.
test('#398 /192.168.1.1 è riconosciuto e apre una scheda http (non va in chat)', async ({ app, openTab }) => {
  const { dash, input } = await openDash(openTab);
  await input.fill('/192.168.1.1');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
  await input.press('Enter');
  const page = await findWindow(app, (u) => u.startsWith('http://192.168.1.1'));
  expect(page, 'scheda su http://192.168.1.1 attesa').toBeTruthy();
  await expect(input).toHaveValue('');
  const inChat = await dash.evaluate(() => {
    const root = document.querySelector('#chat, #messages, main') || document.body;
    return (root.textContent || '').includes('192.168.1.1');
  });
  expect(inChat).toBe(false);
});

// (4) Stress / robustezza del riconoscitore, valutato dal vivo nella pagina
//     (stessa funzione che colora l'input e decide la navigazione).
test('#398 stress: comandi, path, porte assurde, XSS non diventano indirizzi', async ({ openTab }) => {
  const { dash, input } = await openDash(openTab);
  const check = (raw) => dash.evaluate((r) => window.SN_URL_NAV.looksLikeAddress(r), raw);

  // Indirizzi (devono essere riconosciuti)
  for (const ok of ['localhost:3000', '127.0.0.1:8080', '192.168.1.1', '127.0.0.1',
                    'localhost', 'dev.localhost', '[::1]:8080', 'example.com',
                    'example.com:8443/admin', 'http://localhost:3000',
                    '10.0.0.5:9000', '172.16.0.1']) {
    expect(await check(ok), `${ok} deve essere un indirizzo`).toBe(true);
  }
  // NON indirizzi (comandi shell, path, testo)
  for (const no of ['', '   ', 'git log v1.2', 'python3.11', 'git', './script.sh',
                    '~/note.txt', '/usr/bin/ls', 'ciao come stai',
                    'example.com:99999', 'javascript://alert(1)',
                    '<script>alert(1)</script>', '😀', 'a'.repeat(10000)]) {
    expect(await check(no), `"${no.slice(0, 20)}" NON deve essere un indirizzo`).toBe(false);
  }

  // Lo schema scelto: http per locali/privati, https per i pubblici.
  const norm = (raw) => dash.evaluate((r) => window.SN_URL_NAV.normalizeUrl(r), raw);
  expect(await norm('localhost:3000')).toBe('http://localhost:3000');
  expect(await norm('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  expect(await norm('192.168.1.1')).toBe('http://192.168.1.1');
  expect(await norm('example.com')).toBe('https://example.com');
  expect(await norm('http://localhost:3000')).toBe('http://localhost:3000');

  // Un token pericoloso che PASSA il riconoscitore ("javascript:12345" ha una
  // porta valida) non deve mai produrre un URL con schema javascript:.
  expect(await norm('javascript:12345')).toBe('http://javascript:12345');

  // Input estremi non devono rompere il campo (nessuna eccezione, resta usabile).
  await input.fill('/' + 'a'.repeat(10000));
  await expect(input).toHaveClass(/is-cmd-unknown/);
  await input.fill('/😀');
  await input.fill('/<script>alert(1)</script>');
  await input.fill('/');
  await input.fill('/127.0.0.1:8080');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await dash.screenshot({ path: 'tests/.shots/verify398-input-stress.png' }).catch(() => {});
});

// (5) Doppio invio rapido sullo stesso indirizzo: non deve rompere nulla
//     (il campo si svuota, niente chat).
test('#398 invii rapidi ripetuti non mandano l’indirizzo in chat', async ({ openTab, testServer }) => {
  const full = testServer.html('<!doctype html><title>t</title><h1 id="m">ok</h1>');
  const typed = full.replace(/^https?:\/\//, '');
  const { dash, input } = await openDash(openTab);
  for (let i = 0; i < 3; i++) {
    await input.fill('/' + typed);
    await input.press('Enter');
  }
  await expect(input).toHaveValue('');
  const inChat = await dash.evaluate((a) => {
    const root = document.querySelector('#chat, #messages, main') || document.body;
    return (root.textContent || '').includes(a);
  }, typed);
  expect(inChat).toBe(false);
});
