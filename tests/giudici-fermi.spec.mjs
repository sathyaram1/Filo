// #906: quando il server dice che i giudici sono senza credito, l'owner lo vede subito nella barra sopra la scheda, una
// volta per episodio, col tasto che porta a «Ri-valuta i non filtrati»; nella home resta una carta finché il credito
// non torna. Il server è finto: si sostituisce la lettura di config/automation.giudiciFermi.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const EPISODIO = { causa: 'credit', da: '2026-09-28T20:00:00.000Z', ultimoErrore: '2026-09-28T21:00:00.000Z', inAttesa: 118 };

async function owner(app, stato) {
  await app.evaluate(async (_e, stato) => {
    const M = process.getBuiltinModule('module');
    const mod = (re) => M._cache[Object.keys(M._cache).find((x) => re.test(x))].exports;
    const ga = mod(/auth[\\/]google-auth\.js$/);
    ga.isAdmin = () => true;
    ga.isSignedIn = () => true;
    ga.accessoOwnerCaduto = () => false;
    ga.getIdToken = async () => 'token-finto-dell-owner';
    globalThis.__giudici = stato;
    globalThis.__letture = 0;
    mod(/services[\\/]defaultsStore\.js$/).getGiudiciFermi = async (token) => {
      globalThis.__letture++;
      if (token !== 'token-finto-dell-owner') return { risposto: false, raw: null };
      return { risposto: true, raw: globalThis.__giudici };
    };
  }, stato);
}
const rileggi = (app) => app.evaluate(() => globalThis.SN_GIUDICI_FERMI.colpo('prova'));

async function home(app) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

test('giudici senza credito: barra una volta, tasto verso Ri-valuta, carta in home finché il credito non torna', async ({ app, shell, avvisi }) => {
  test.setTimeout(90_000);
  await shell.waitForLoadState('domcontentloaded');
  await owner(app, EPISODIO);
  await rileggi(app);

  const vista = await avvisi();
  const barra = vista.locator('.shell-notif.show', { hasText: 'I giudici sono senza credito' });
  await expect(barra).toHaveCount(1, { timeout: 10_000 });
  await expect(barra).toContainText('Ricarica il credito della chiave dei giudici, poi in Gestione premi «Ri-valuta i non filtrati»');
  const tasto = barra.getByRole('button', { name: 'Apri Ri-valuta' });
  await expect(tasto).toBeVisible();

  const pagina = await home(app);
  const carta = pagina.locator('.dash-carta[data-tipo="avviso"]', { hasText: 'I giudici sono senza credito' });
  await expect(carta).toHaveCount(1, { timeout: 10_000 });
  await expect(carta).toContainText('118 segnalazioni aspettano il giudizio');
  await expect(carta.locator('.dash-carta-togli'), 'la carta resta finché il server non azzera lo stato').toHaveCount(0);
  await expect(carta.getByRole('button', { name: 'Apri Ri-valuta' })).toBeVisible();

  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await pagina.evaluate((t) => new Promise((ok) => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: t } }, ok)), tema);
    await expect(pagina.locator('html')).toHaveAttribute('data-sn-theme', tema);
    await pagina.waitForTimeout(300);
    await vista.screenshot({ path: join(SHOTS, `giudici-fermi-barra-${tema}.png`) });
    await pagina.screenshot({ path: join(SHOTS, `giudici-fermi-home-${tema}.png`) });
  }

  // Una volta sola: l'owner la chiude, e le letture dopo non la ridicono finché l'episodio è quello.
  await barra.locator('.shell-notif-close').click();
  await expect(barra).toHaveCount(0);
  await rileggi(app);
  await rileggi(app);
  await expect(vista.locator('.shell-notif.show', { hasText: 'I giudici sono senza credito' })).toHaveCount(0);
  await expect(carta).toHaveCount(1);

  // Il tasto della carta porta in Gestione, sui Ricevuti.
  await carta.getByRole('button', { name: 'Apri Ri-valuta' }).click();
  const scadenza = Date.now() + 15_000;
  let gestione = null;
  while (!gestione && Date.now() < scadenza) {
    gestione = app.windows().find((x) => { try { return x.url().startsWith('filo://manage/'); } catch (_) { return false; } }) || null;
    if (!gestione) await new Promise((r) => setTimeout(r, 100));
  }
  expect(gestione, 'Gestione si apre').not.toBeNull();
  await expect(gestione.locator('.mg-tab--active[data-tab="inbox"]')).toHaveCount(1, { timeout: 15_000 });

  // Il credito torna: il server azzera lo stato e la carta se ne va.
  await app.evaluate(() => { globalThis.__giudici = null; });
  await rileggi(app);
  await expect(carta).toHaveCount(0, { timeout: 10_000 });
});

test('un episodio nuovo si ridice, e la barra ancora aperta se ne va quando il credito torna', async ({ app, shell, avvisi }) => {
  test.setTimeout(60_000);
  await shell.waitForLoadState('domcontentloaded');
  await owner(app, EPISODIO);
  await rileggi(app);
  const vista = await avvisi();
  const barra = vista.locator('.shell-notif.show', { hasText: 'I giudici sono senza credito' });
  await expect(barra).toHaveCount(1, { timeout: 10_000 });
  await app.evaluate(() => { globalThis.__giudici = null; });
  await rileggi(app);
  await expect(barra, 'uno stato che non c\'è più non resta a dirlo').toHaveCount(0, { timeout: 10_000 });
  await app.evaluate((_e, ep) => { globalThis.__giudici = { ...ep, da: '2026-10-05T08:00:00.000Z', causa: 'auth', inAttesa: 1 }; }, EPISODIO);
  await rileggi(app);
  const auth = vista.locator('.shell-notif.show', { hasText: 'La chiave dei giudici viene rifiutata' });
  await expect(auth).toHaveCount(1, { timeout: 10_000 });
  // Il tasto della barra apre Gestione dove si reimposta la chiave.
  await auth.getByRole('button', { name: 'Apri Automazioni' }).click();
  await expect.poll(() => app.windows().some((x) => { try { return x.url().startsWith('filo://manage/'); } catch (_) { return false; } }), { timeout: 15_000 }).toBe(true);
  const gestione = app.windows().find((x) => x.url().startsWith('filo://manage/'));
  await expect(gestione.locator('.mg-tab--active[data-tab="automation"]')).toHaveCount(1, { timeout: 15_000 });
});
