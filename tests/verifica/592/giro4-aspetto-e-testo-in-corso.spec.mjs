// Verifica #592, giro 4 — i gruppi che il giro 3 aveva nominato senza provare,
// e quello che la nuova rilettura porta via.
//
// Il giro 3 ha chiuso cinque porte (modalità terminale + shell, le due chiavi
// API, voce, rilevamento siti pericolosi, cookie) mandando al salvataggio solo
// le manopole toccate davvero, e facendo rileggere la pagina quando qualcosa
// cambia altrove. Nella stessa critica c'era un elenco di gruppi con la STESSA
// forma che non erano stati provati: «i colori delle schede e i colori, i font
// e le misure dell'aspetto nelle Preferenze, che la pagina rimanda interi a
// ogni ritocco senza nessun confronto; l'archiviazione automatica; le
// notifiche; i modelli per funzione nelle Opzioni».
//
// Qui si provano quelli. E si guarda il prezzo della rilettura nuova: la
// pagina si rilegge anche quando l'annuncio di cambiamento è il suo, e la
// rilettura riscrive i campi — compreso il riquadro dello stile, dove per
// contratto (#592) un testo oltre il tetto DEVE restare sotto gli occhi
// dell'utente perché sia lui ad accorciarlo.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const OPZIONI = 'filo://options/options.html';

const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

const eseguiInChat = (page, action) =>
  page.evaluate(async (a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

async function apriPreferenze(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.AGENT_STYLE_MAX), { timeout: 20_000 });
  await page.waitForSelector('#tokenCode .sn-token-row input', { timeout: 20_000 });
  return page;
}

// Il nome del primo token estetico e di un secondo diverso: l'elenco dipende
// dal tema, quindi si chiede alla pagina invece di scriverlo a mano.
const dueToken = (page) =>
  page.evaluate(() => {
    const nomi = window.SN_THEME_TOKENS.names();
    const size = nomi.filter((n) => window.SN_THEME_TOKENS.get(n).type === 'size');
    return { a: size[0], b: size[1] };
  });

// ── l'aspetto: i colori, i font e le misure ────────────────────────────────

test('un token estetico cambiato in chat non deve tornare indietro quando si tocca un ALTRO token', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  const { a, b } = await dueToken(pagina);
  expect(a && b).toBeTruthy();

  // 1. l'utente mette una misura a mano nella pagina (il primo token).
  await pagina.fill(`#tok-${a}`, '11px');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).themeTokens?.[a]).toBe('11px');

  // 2. poi chiede a Filo un'altra misura, su un token DIVERSO. Filo la applica
  //    subito (è un'azione senza conferma) e la pagina resta aperta.
  await eseguiInChat(pagina, { type: 'IMPOSTA_ESTETICA', token: b, valore: '13px' });
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).themeTokens?.[b]).toBe('13px');

  // 3. torna sulla pagina e ritocca il PRIMO token. Non ha chiesto di disfare
  //    niente: la misura che ha chiesto a voce deve restare.
  await pagina.fill(`#tok-${a}`, '12px');
  await pagina.waitForTimeout(1800);

  const dopo = (await impostazioni(pagina)).themeTokens || {};
  expect(dopo[a]).toBe('12px');
  expect(dopo[b]).toBe('13px');
});

test('un colore delle schede cambiato in chat non deve tornare indietro quando si tocca un altro parametro', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  await pagina.waitForSelector('#tabcol-opacita_tab', { timeout: 20_000 });

  // 1. l'utente ritocca a mano la saturazione delle schede.
  await pagina.fill('#tabcol-saturazione_tab', '0.7');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).tabColor?.saturazione_tab).toBeCloseTo(0.7, 5);

  // 2. poi chiede a Filo «colore delle tab: nessuno», che mette l'opacità a 0.
  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'colore_tab', valore: 'nessuno' });
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).tabColor?.opacita_tab).toBe(0);

  // 3. torna e ritocca la saturazione: l'opacità chiesta a voce deve restare.
  await pagina.fill('#tabcol-saturazione_tab', '0.8');
  await pagina.waitForTimeout(1800);

  const dopo = (await impostazioni(pagina)).tabColor || {};
  expect(dopo.saturazione_tab).toBeCloseTo(0.8, 5);
  expect(dopo.opacita_tab).toBe(0);
});

// ── l'archiviazione automatica e le notifiche ──────────────────────────────

test('le ore di inattività toccate non devono riaccendere l\'archiviazione spenta altrove', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  await pagina.check('#autoArchiveEnabled');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).autoArchive?.enabled).toBe(true);

  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'archiviazione_automatica', valore: 'no' });
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).autoArchive?.enabled).toBe(false);

  await pagina.fill('#autoArchiveIdleHours', '9');
  await pagina.locator('#autoArchiveIdleHours').blur();
  await pagina.waitForTimeout(1800);

  const dopo = (await impostazioni(pagina)).autoArchive || {};
  expect(Number(dopo.idleHours)).toBe(9);
  expect(dopo.enabled).toBe(false);
});

// ── i modelli per funzione nelle Opzioni ───────────────────────────────────

test('un modello per funzione toccato non deve rimettere i modelli predefiniti spenti altrove', async ({ openTab }) => {
  const opzioni = await openTab(OPZIONI);
  await opzioni.waitForSelector('#useDefaultModels', { timeout: 20_000 });

  // 1. l'utente accende «usa i modelli predefiniti» dalla pagina.
  await opzioni.check('#useDefaultModels');
  await opzioni.waitForTimeout(1200);
  expect((await impostazioni(opzioni)).useDefaultModels).toBe(true);

  // 2. ci ripensa e li spegne parlando con Filo.
  await eseguiInChat(opzioni, { type: 'IMPOSTA_PREFERENZA', chiave: 'modelli_predefiniti', valore: 'no' });
  await opzioni.waitForTimeout(1500);
  expect((await impostazioni(opzioni)).useDefaultModels).toBe(false);

  // 3. torna sulla pagina e tocca il limite di spesa, che è un campo suo.
  await opzioni.fill('#monthlyLimit', '7');
  await opzioni.locator('#monthlyLimit').blur();
  await opzioni.waitForTimeout(1800);

  const dopo = await impostazioni(opzioni);
  expect(Number(dopo.monthlyLimitEur)).toBe(7);
  expect(dopo.useDefaultModels).toBe(false);
});

// ── il prezzo della rilettura: quello che l'utente stava scrivendo ─────────

test('lo stile oltre il tetto deve restare nel riquadro: è l\'utente che lo accorcia', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  const { a } = await dueToken(pagina);

  const lungo = 'Parla come un capitano di mare. '.repeat(30); // ben oltre 600
  await pagina.fill('#agentStyleText', lungo);
  await pagina.waitForTimeout(1200);

  // Il rifiuto è spiegato e in memoria non c'è nessuno stile: giusto.
  await expect(pagina.locator('#agentStyleError')).toBeVisible();
  expect((await impostazioni(pagina)).agentStyle || '').toBe('');
  // E il testo resta sotto gli occhi dell'utente, che è l'unico che può
  // decidere cosa tenere.
  expect(await pagina.inputValue('#agentStyleText')).toBe(lungo);

  // Adesso l'utente scende nell'aspetto e ritocca una misura, come farebbe
  // chiunque stia sistemando le preferenze. Lo stile che deve ancora accorciare
  // non c'entra niente con quel ritocco.
  await pagina.fill(`#tok-${a}`, '10px');
  await pagina.waitForTimeout(2000);

  expect(await pagina.inputValue('#agentStyleText')).toBe(lungo);
  await expect(pagina.locator('#agentStyleError')).toBeVisible();
});

test('quello che si scrive in un campo dell\'aspetto arriva in memoria per intero', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  const { a } = await dueToken(pagina);

  // Si scrive una misura a mano, un carattere per volta e senza fretta: è così
  // che si scrive in un campo di testo. Il salvataggio automatico parte dopo
  // 400 ms, quindi cade in mezzo alla digitazione — e non deve mangiare quello
  // che viene dopo.
  await pagina.click(`#tok-${a}`);
  await pagina.fill(`#tok-${a}`, '');
  for (const ch of '1.25rem') {
    await pagina.type(`#tok-${a}`, ch);
    await pagina.waitForTimeout(180);
  }
  await pagina.waitForTimeout(2000);

  expect(await pagina.inputValue(`#tok-${a}`)).toBe('1.25rem');
  expect((await impostazioni(pagina)).themeTokens?.[a]).toBe('1.25rem');
});
