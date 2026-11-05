// #1606, #1606.1, #1092 — Filo resta acceso senza la finestra principale quando la si chiude con la finestrella di
// accesso aperta: riaprirlo (collegamento, seconda copia vera, Dock su Mac, invito, voci della barra dei menu, #2031)
// rifà la finestra con le sue schede. All'avvio la finestra nasce prima degli init e la prima scheda li trova fatti.
// Logica: tests/unit/secondaApertura.test.mjs, tests/unit/voceSenzaFinestra.test.mjs.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test, expect, aspettaFinestra, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { voceDellaBarra } from './helpers/barraDeiMenu.mjs';

const require = createRequire(import.meta.url);
const ELECTRON = require('electron');
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// La pagina di accesso la serve il server della prova: i parametri OAuth bastano a farne una finestrella di accesso.
function negozioConAccesso(testServer) {
  const accesso = `${testServer.html('<title>Accedi</title><h1>Passkey</h1>')}?client_id=1&redirect_uri=x`;
  const negozio = `<title>Negozio</title><button id="b" style="width:220px;height:60px"
    onclick="window.open(${JSON.stringify(accesso).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi</button>`;
  return { accesso: accesso.split('?')[0], negozio };
}

const stato = (app, accesso = '') => app.evaluate(({ BrowserWindow }, base) => {
  const vive = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const normali = vive.filter((w) => w._filoTabs && !w._filoIncognito);
  const normale = normali[0];
  return {
    normali: normali.length,
    incognito: vive.filter((w) => w._filoIncognito).length,
    // Una finestrella a metà chiusura lancia a chi le chiede l'indirizzo: conta come chiusa.
    accesso: base ? vive.filter((w) => { try { return !w._filoTabs && w.webContents.getURL().startsWith(base); } catch (_) { return false; } }).length : 0,
    normale: normale ? {
      visibile: normale.isVisible(),
      // Una scheda riaperta che aspetta il suo turno non ha ancora un indirizzo caricato: vale quello che aspetta.
      schede: normale._filoTabs.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } }),
    } : null,
    errori: globalThis.__errori1606 || [],
  };
}, accesso);

// Gli errori del main che nessuno gestisce: «Object has been destroyed» era il dialogo della segnalazione.
const sentinella = (app) => app.evaluate(() => {
  globalThis.__errori1606 = [];
  process.on('uncaughtException', (e) => globalThis.__errori1606.push(String((e && e.stack) || e)));
});

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

// Una seconda copia vera di Filo sulla stessa cartella dei dati, come dal collegamento sul desktop.
async function secondaCopia(app, extra = []) {
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  return new Promise((ok) => {
    const p = spawn(ELECTRON, [...argomentiScala, ...extra, '.'], { cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' }, stdio: 'ignore' });
    const tetto = setTimeout(() => { try { p.kill(); } catch (_) {} ok('appesa'); }, 20000);
    p.on('exit', (codice) => { clearTimeout(tetto); ok(codice); });
  });
}

// I passi della segnalazione fino a Filo acceso senza finestra principale: la finestrella di accesso lo tiene in vita.
async function chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer) {
  const { accesso, negozio: html } = negozioConAccesso(testServer);
  await sentinella(app);
  const page = await testServer.openReady(openTab, html);
  const negozio = page.url();
  await page.click('#b');
  await expect.poll(async () => (await stato(app, accesso)).accesso, { message: 'la finestrella di accesso non si è aperta', timeout: 10000 }).toBe(1);
  // Chi aspetta la passkey ci mette più di quanto Filo impiega a scrivere le schede: la prova aspetta lo stesso.
  await expect.poll(() => sessioneSalvata(app), { message: 'le schede aperte non sono state salvate', timeout: 10000 }).toContain(negozio);
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app, accesso)).normale, { message: 'la finestra principale non si è chiusa', timeout: 10000 }).toBeNull();
  expect((await stato(app, accesso)).accesso, 'chiusa la principale, la finestrella resta e tiene acceso Filo').toBe(1);
  return { negozio, accesso };
}

async function tornaLaFinestra(app, accesso, negozio, perche) {
  await expect.poll(async () => (await stato(app, accesso)).normale?.schede || [], { message: perche, timeout: 15000 }).toContain(negozio);
  const s = await stato(app, accesso);
  expect(s.normale.visibile, 'la finestra rifatta deve vedersi').toBe(true);
  expect(s.accesso, 'la finestrella di accesso non si chiude per questo').toBe(1);
  expect(s.errori, 'errori nel main').toEqual([]);
}

test('riaperto dal collegamento, Filo rifà la finestra con le sue schede e la finestrella resta', async ({ app, shell, openTab, testServer }) => {
  const { negozio, accesso } = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
  // Come arriva su Windows e Linux la seconda apertura dal collegamento: senza indirizzi fra gli argomenti.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', '.'], process.cwd()); });
  await tornaLaFinestra(app, accesso, negozio, 'riaperto Filo, la scheda del negozio non è tornata');

  // Una terza apertura con la finestra già lì la porta davanti e basta: niente doppioni.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', '.'], process.cwd()); });
  expect((await stato(app, accesso)).normali).toBe(1);
});

test('su Mac il clic sul Dock con la finestrella aperta ridà la finestra con le schede', async ({ app, shell, openTab, testServer }) => {
  const { negozio, accesso } = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
  // Su Mac la riapertura di un'app accesa arriva come `activate`, con la finestrella a schermo.
  await app.evaluate(({ app: a }) => { a.emit('activate', {}, true); });
  await tornaLaFinestra(app, accesso, negozio, 'su Mac il clic sull\'icona non ridà la finestra di Filo');
  await app.evaluate(({ app: a }) => { a.emit('activate', {}, true); });
  expect((await stato(app, accesso)).normali, 'un altro clic sull\'icona non fa doppioni').toBe(1);
});

test('una seconda copia vera di Filo esce e la prima ridà la finestra, anche due volte di fila e tre insieme', async ({ app, shell, openTab, testServer }) => {
  const { negozio, accesso } = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
  expect(await secondaCopia(app), 'la seconda copia deve uscire da sola').toBe(0);
  await tornaLaFinestra(app, accesso, negozio, 'dopo la seconda copia la finestra con le schede non è tornata');

  // Chiusa di nuovo e riaperta: il riferimento rinnovato non torna a puntare a una distrutta.
  const barra = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la barra della finestra rifatta non c\'è');
  await barra.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app, accesso)).normale, { timeout: 10000 }).toBeNull();
  expect(await Promise.all([secondaCopia(app), secondaCopia(app), secondaCopia(app)])).toEqual([0, 0, 0]);
  await tornaLaFinestra(app, accesso, negozio, 'la seconda riapertura non ha ridato la finestra');
  expect((await stato(app, accesso)).normali, 'tre aperture insieme fanno una finestra sola').toBe(1);
});

test('rimasta solo una finestra incognito, la seconda copia ridà una finestra normale', async ({ app, shell }) => {
  await sentinella(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(async () => (await stato(app)).incognito, { timeout: 10000 }).toBe(1);
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app)).normali, { timeout: 10000 }).toBe(0);
  expect(await secondaCopia(app)).toBe(0);
  await expect.poll(async () => (await stato(app)).normali, { message: 'chi riapre Filo non trova una finestra normale', timeout: 15000 }).toBe(1);
  const s = await stato(app);
  expect(s.normale.visibile).toBe(true);
  expect(s.incognito, 'l\'incognito resta').toBe(1);
  expect(s.errori).toEqual([]);
});

test('un link d\'invito aperto da fuori con Filo senza finestra apre Crediti, da tutte e due le strade', async ({ app, shell, openTab, testServer }) => {
  const { accesso } = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
  // Windows e Linux: il link arriva fra gli argomenti della seconda apertura. Il codice storto non chiede niente al
  // server, e la pagina dice perché: basta a vedere che Crediti si è aperta in una finestra viva.
  await app.evaluate(({ app: a }) => { a.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  await expect.poll(async () => (await stato(app, accesso)).normale?.schede || [], { message: 'l\'invito non ha aperto Crediti', timeout: 15000 })
    .toContainEqual(expect.stringMatching(/^filo:\/\/credits\//));
  const crediti = await aspettaFinestra(app, (w) => w.url().startsWith('filo://credits/'), 'la pagina Crediti non è nata');
  await expect(crediti.locator('#walletNote')).toContainText('otto caratteri', { timeout: 15000 });

  // Mac: chiusa la finestra Filo resta acceso, e il link arriva con open-url: stessa strada, stesso esito.
  const barra = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la barra della finestra rifatta non c\'è');
  await barra.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app, accesso)).normale, { timeout: 10000 }).toBeNull();
  await app.evaluate(({ app: a }) => { a.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD'); });
  await expect.poll(async () => (await stato(app, accesso)).normale?.schede || [], { message: 'su Mac l\'invito non ha aperto Crediti', timeout: 15000 })
    .toContainEqual(expect.stringMatching(/^filo:\/\/credits\//));
  expect((await stato(app, accesso)).errori).toEqual([]);
});

// #2031 — Su Mac Cmd+T, Cmd+Shift+T, Cmd+L e le pagine del menu Filo passano dalla barra dei menu: senza finestra
// principale la ridanno.
async function richiudi(app, accesso, negozio) {
  // Come chi chiude dopo un po': le schede della finestra rifatta sono già scritte.
  await expect.poll(() => sessioneSalvata(app), { message: 'le schede della finestra rifatta non sono state salvate', timeout: 10000 }).toContain(negozio);
  const barra = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la barra della finestra rifatta non c\'è');
  await barra.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await stato(app, accesso)).normale, { timeout: 10000 }).toBeNull();
}

const attiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  const t = w && w._filoTabs.tabs.find((s) => s.id === w._filoTabs.activeId);
  return (t && t.url) || '';
});

const nuove = (schede) => schede.filter((u) => u.startsWith('filo://newtab/')).length;

test('su Mac, senza la finestra principale, «Nuova scheda» la ridà con le schede e una nuova davanti, senza doppioni', async ({ app, shell, openTab, testServer }) => {
  const { negozio, accesso } = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
  const prima = nuove(await sessioneSalvata(app));
  // Due Cmd+T di fila mentre la finestra rinasce: una finestra sola, due schede nuove.
  await voceDellaBarra(app, 'Nuova scheda');
  await voceDellaBarra(app, 'Nuova scheda');
  await tornaLaFinestra(app, accesso, negozio, '«Nuova scheda» senza finestra non ha ridato Filo con le sue schede');
  await expect.poll(async () => nuove((await stato(app, accesso)).normale.schede), { message: 'le schede nuove chieste non ci sono', timeout: 10000 }).toBe(prima + 2);
  expect(await attiva(app), 'davanti va la scheda nuova, non una di quelle riaperte').toMatch(/^filo:\/\/newtab\//);
  expect((await stato(app, accesso)).normali).toBe(1);

  // Senza schede salvate la finestra nasce con la sua scheda nuova: è quella chiesta, non se ne aggiunge un'altra.
  await richiudi(app, accesso, negozio);
  // La finestra chiusa scrive ancora le sue schede per un attimo: la sessione si svuota dopo.
  await new Promise((r) => setTimeout(r, 2000));
  await app.evaluate(() => globalThis.SN_STORAGE.setRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, { tabs: [], activeIndex: 0 }));
  await new Promise((r) => setTimeout(r, 600));
  expect(await sessioneSalvata(app), 'qualcuno ha riscritto le schede dopo la chiusura').toEqual([]);
  await voceDellaBarra(app, 'Nuova scheda');
  await expect.poll(async () => (await stato(app, accesso)).normale?.schede || [], { message: 'la finestra non è tornata', timeout: 15000 })
    .toEqual([expect.stringMatching(/^filo:\/\/newtab\//)]);
  await new Promise((r) => setTimeout(r, 800));
  expect((await stato(app, accesso)).normale.schede, 'una scheda nuova in più, vuota e doppia').toHaveLength(1);
  expect((await stato(app, accesso)).errori).toEqual([]);
});

test('su Mac, senza la finestra principale, «Riapri scheda chiusa» la ridà com\'era, senza riaprire una scheda in più', async ({ app, shell, openTab, testServer }) => {
  // Una scheda chiusa prima: la finestra rinata con le sue schede è già quello che si riapre, la scheda non torna doppia.
  const chiusa = await testServer.openReady(openTab, '<title>Chiusa</title><h1>chiusa</h1>');
  const indirizzoChiusa = chiusa.url();
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    tm.closeTab(tm.tabs.find((t) => t.url === u).id);
  }, indirizzoChiusa);
  const { negozio, accesso } = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
  const salvate = await sessioneSalvata(app);
  await voceDellaBarra(app, 'Riapri scheda chiusa');
  await tornaLaFinestra(app, accesso, negozio, '«Riapri scheda chiusa» senza finestra non ha ridato Filo con le sue schede');
  await new Promise((r) => setTimeout(r, 800));
  const dopo = (await stato(app, accesso)).normale.schede;
  expect(dopo, 'la finestra torna com\'era').toHaveLength(salvate.length);
  expect(dopo).not.toContain(indirizzoChiusa);
  expect((await stato(app, accesso)).normali).toBe(1);
});

// La barra laterale e l'Aiuto sono della finestra, non della pagina: anche con la finestrella davanti la ridanno.
for (const [voce, davanti] of [['Cronologia AI', /^filo:\/\/history\//], ['Barra laterale', null], ['Assistente laterale', null]]) {
  test(`su Mac, senza la finestra principale, «${voce}» la ridà con le sue schede`, async ({ app, shell, openTab, testServer }) => {
    const { negozio, accesso } = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
    await voceDellaBarra(app, voce);
    await tornaLaFinestra(app, accesso, negozio, `«${voce}» senza finestra non ha ridato Filo con le sue schede`);
    if (davanti) await expect.poll(() => attiva(app), { message: `quello che apre «${voce}» non è davanti`, timeout: 10000 }).toMatch(davanti);
    expect((await stato(app, accesso)).normali).toBe(1);
  });
}

const fuocoDavanti = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  const t = w && w._filoTabs.tabs.find((s) => s.id === w._filoTabs.activeId);
  try { return await t.view.webContents.executeJavaScript('document.activeElement && document.activeElement.id', false); } catch (_) { return ''; }
});

test('su Mac, senza la finestra principale, «Vai a un indirizzo» la ridà e apre accanto la home col cursore nel campo', async ({ app, shell, openTab, testServer }) => {
  const { negozio, accesso } = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
  await voceDellaBarra(app, 'Vai a un indirizzo');
  await tornaLaFinestra(app, accesso, negozio, '«Vai a un indirizzo» senza finestra non ha ridato Filo con le sue schede');
  await expect.poll(() => attiva(app), { message: 'davanti non c\'è la home dove si scrive l\'indirizzo', timeout: 10000 }).toMatch(/^filo:\/\/newtab\//);
  await expect.poll(() => fuocoDavanti(app), { message: 'il cursore non è nel campo dove si scrive', timeout: 10000 }).toBe('input');
  expect((await stato(app, accesso)).normale.schede, 'la scheda riaperta non deve sparire sotto la home').toContain(negozio);
});

// Chiusa anche la finestrella, le voci della scheda non hanno niente su cui agire: ridanno la finestra.
for (const voce of ['Ricarica', 'Schermo intero', 'Indietro']) {
  test(`su Mac, senza nessuna finestra, «${voce}» ridà Filo con le sue schede`, async ({ app, shell, openTab, testServer }) => {
    const { negozio, accesso } = await chiudiLaPrincipaleConLAccessoAperto(app, shell, openTab, testServer);
    // Come su Mac, dove chiusa l'ultima finestra Filo resta acceso.
    await app.evaluate(({ app: a, BrowserWindow }) => {
      a.removeAllListeners('window-all-closed');
      a.on('window-all-closed', () => {});
      for (const w of BrowserWindow.getAllWindows()) if (!w._filoTabs) w.close();
    });
    // Una finestrella a metà chiusura lancia a chi le chiede l'indirizzo: qui si contano solo le vive.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .filter((w) => { try { return !w.isDestroyed() && !w._filoTabs; } catch (_) { return false; } }).length), { timeout: 10000 }).toBe(0);
    await voceDellaBarra(app, voce);
    await expect.poll(async () => (await stato(app, accesso)).normale?.schede || [],
      { message: `«${voce}» senza finestre non ha ridato Filo con le sue schede`, timeout: 15000 }).toContain(negozio);
    expect((await stato(app, accesso)).errori).toEqual([]);
  });
}

// Con la finestrella di accesso davanti le voci della scheda agiscono su di lei: il sito dietro aspetta l'accesso.
test('su Mac, con la finestrella di accesso davanti, «Chiudi scheda» chiude lei e non il sito che aspetta', async ({ app, openTab, testServer }) => {
  const { accesso, negozio: html } = negozioConAccesso(testServer);
  await sentinella(app);
  const page = await testServer.openReady(openTab, html);
  const negozio = page.url();
  await page.click('#b');
  await expect.poll(async () => (await stato(app, accesso)).accesso, { timeout: 10000 }).toBe(1);
  const davanti = (a) => app.evaluate(({ BrowserWindow }, b) => {
    const f = BrowserWindow.getAllWindows().find((w) => !w._filoTabs && w.webContents.getURL().startsWith(b));
    f.show(); f.focus();
    return BrowserWindow.getFocusedWindow() === f;
  }, a);
  await expect.poll(() => davanti(accesso), { message: 'la finestrella non è andata davanti', timeout: 5000 }).toBe(true);
  for (const voce of ['Ricarica', 'Indietro', 'Annulla']) await voceDellaBarra(app, voce);
  await new Promise((r) => setTimeout(r, 800));
  expect((await stato(app, accesso)).normale.schede, 'una voce ha toccato il sito dietro la finestrella').toContain(negozio);
  await voceDellaBarra(app, 'Chiudi scheda');
  await expect.poll(async () => (await stato(app, accesso)).accesso, { message: 'Cmd+W non ha chiuso la finestrella davanti', timeout: 10000 }).toBe(0);
  expect((await stato(app, accesso)).normale.schede, 'Cmd+W ha chiuso il sito dietro la finestrella').toContain(negozio);
  expect((await stato(app, accesso)).errori).toEqual([]);
});

// La finestra ora c'è mentre gli init lavorano: chi la chiude subito non deve trovare la sessione svuotata.
test('chiuso appena compare la finestra, prima che le schede tornino, Filo non perde le schede salvate', async () => {
  const userData = cartellaTemporanea('filo-avvio-');
  // Una porta chiusa del loopback: se la riapertura arrivasse prima dell'uscita, niente rete.
  const salvate = ['http://127.0.0.1:9/a', 'http://127.0.0.1:9/b'];
  const storage = join(userData, 'storage.json');
  writeFileSync(storage, JSON.stringify({ sn_open_tabs: { tabs: salvate, activeIndex: 1 } }));
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test', FILO_TEST_ACCOLTO: '1' },
  });
  try {
    const chiusa = app.waitForEvent('close', { timeout: 20000 });
    const schedeAllUscita = await app.evaluate(async ({ app: a, BrowserWindow }) => {
      for (let i = 0; i < 5000; i++) {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        if (w) { const n = w._filoTabs.tabs.length; a.quit(); return n; }
        await new Promise((r) => setTimeout(r, 2));
      }
      return -1;
    });
    expect(schedeAllUscita, 'la prova doveva uscire con la finestra nata e le schede non ancora riaperte').toBe(0);
    await chiusa;
    expect(JSON.parse(readFileSync(storage, 'utf8')).sn_open_tabs, 'uscendo all\'avvio Filo ha cancellato le schede salvate')
      .toMatchObject({ tabs: salvate, activeIndex: 1 });
  } finally {
    await chiudiApp(app);
    togliCartella(userData);
  }
});

// #1092 — Un profilo usato: una cache dell'ad-blocker grande e una scheda salvata che chiede una pubblicità.
test('avvio con una cache dell\'ad-blocker grande: la finestra non aspetta gli init, la prima scheda è già filtrata', async () => {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push(`${String(req.headers.host).split(':')[0]}${req.url}`);
    res.writeHead(200, { 'content-type': req.url.endsWith('.gif') ? 'image/gif' : 'text/html; charset=utf-8' });
    res.end(req.url.endsWith('.gif') ? '' : `<title>Articolo</title><h1>Articolo</h1><img src="http://pubblicita.test:${server.address().port}/ad.gif">`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const articolo = `http://127.0.0.1:${server.address().port}/articolo`;

  const userData = cartellaTemporanea('filo-avvio-');
  mkdirSync(join(userData, 'adblock'), { recursive: true });
  const domini = Array.from({ length: 400000 }, (_, i) => `ad${i.toString(36)}.pubblicita-finta.test`);
  domini.push('pubblicita.test');
  writeFileSync(join(userData, 'adblock', 'lists.json'), JSON.stringify({ domains: domini, pagine: domini }));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ sn_open_tabs: { tabs: [articolo], activeIndex: 0 } }));

  const app = await electron.launch({
    args: [...argomentiScala, '--host-resolver-rules=MAP pubblicita.test 127.0.0.1', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test', FILO_TEST_ACCOLTO: '1' },
  });
  try {
    await sentinella(app);
    // Una seconda apertura mentre l'avvio è a metà: esce, e la finestra arriva lo stesso.
    expect(await secondaCopia(app), 'la seconda copia durante l\'avvio deve uscire da sola').toBe(0);
    await primaFinestra(app);
    const scheda = await aspettaFinestra(app, (w) => w.url() === articolo, 'la scheda salvata non si è riaperta');
    await scheda.waitForLoadState('load');

    const tempi = await app.evaluate(() => globalThis.__filoAvvio);
    expect(tempi.pronti, 'gli init dell\'avvio non sono finiti').toBeGreaterThan(0);
    expect(tempi.finestra, 'la finestra ha aspettato gli init').toBeLessThan(tempi.pronti);
    const partita = await scheda.evaluate(() => performance.timing.navigationStart);
    expect(partita, 'la prima scheda è partita prima che ad-blocker, impronta e permessi fossero pronti').toBeGreaterThanOrEqual(tempi.pronti);

    expect(richieste, 'la scheda riaperta non ha chiesto la sua pagina').toContain('127.0.0.1/articolo');
    expect(richieste.filter((r) => r.startsWith('pubblicita.test')), 'la prima scheda è partita senza ad-blocker').toEqual([]);
    const s = await stato(app);
    expect(s.normali).toBe(1);
    expect(s.normale.visibile).toBe(true);
    expect(s.errori).toEqual([]);
  } finally {
    await chiudiApp(app);
    server.close();
    togliCartella(userData);
  }
});
