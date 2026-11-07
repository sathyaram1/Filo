// #1295 — una chat si toglie anche a parole: «cancella questa chat» la nasconde (si rimette dalla ricerca nel filo o
// chiedendolo), «per sempre» la cancella davvero dopo la parola «conferma». E il tasto destro di una conversazione
// del filo (bolle, schede chiuse, risultati della ricerca) si usa da tastiera: Shift+F10, frecce, Home/Fine, prima
// lettera, Invio, Esc.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState } from './helpers/confirm.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const HOME = 'filo://newtab/';

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Il modello finto: classifica le chat col titolo dato, e alla frase `chiede` risponde con lo strumento `chiamata`.
async function modello(app, { titoli = {}, chiede = null, chiamata = null } = {}) {
  await app.evaluate(async (_e, { titoli, chiede, chiamata }) => {
    const testo = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
    const rispondi = async ({ attempts, messages, onToolCall, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const tutto = messages.map(testo).join('\n');
      if (tutto.includes('Classifichi le conversazioni')) {
        for (const [ago, titolo] of Object.entries(titoli)) {
          if (tutto.includes(ago)) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo }) };
        }
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Senza etichetta' }) };
      }
      const ultimo = messages[messages.length - 1];
      const utente = [...messages].reverse().find((m) => m.role === 'user');
      if (chiede && chiamata && ultimo && ultimo.role !== 'tool' && utente && testo(utente).includes(chiede)) {
        const calls = [{ id: 't1', name: chiamata.name, arguments: JSON.stringify(chiamata.args || {}) }];
        for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
        return { ...base, text: '', toolCalls: calls, finishReason: 'tool_calls' };
      }
      const t = ultimo && ultimo.role === 'tool' ? 'Fatto.' : 'Va bene, ci penso.';
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { titoli, chiede, chiamata });
}

const turno = (app, chatId, userMessage) => app.evaluate(
  (_e, { chatId, userMessage }) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId }),
  { chatId, userMessage },
);
const chiudi = (app, id) => app.evaluate((_e, x) => globalThis.SN_CLOSE_FILO_CHAT(x), id);
const tutte = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list({ nascoste: true }));
const inVista = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());
const cercaComeFilo = (app, query) => app.evaluate((_e, q) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', query: q }), query);

async function chatPronta(app, id, testo) {
  await turno(app, id, testo);
  await chiudi(app, id);
  await expect.poll(async () => ((await tutte(app)).find((c) => c.id === id) || {}).kind || null, { timeout: 30_000 }).toBe('conversazione');
}

test('«cancella questa chat» la nasconde: esce dal filo e da Filo, la ricerca la ritrova e la rimette', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await configura(app);
  await modello(app, { titoli: { Zen: 'Meditazione Zen' }, chiede: 'cancella questa chat', chiamata: { name: 'TOGLI_CHAT' } });

  const dash = await openTab(HOME);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 15_000 });
  await dash.locator('#input').fill('Parliamo di Zen e del respiro');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 30_000 });
  await dash.locator('#input').fill('cancella questa chat');
  await dash.locator('#input').press('Enter');

  // Nascosta, non buttata: c'è ancora tutta, ma non fra quelle che si vedono.
  await expect.poll(async () => (await tutte(app)).filter((c) => c.nascosta).length, { timeout: 30_000 }).toBe(1);
  const nascosta = (await tutte(app)).find((c) => c.nascosta);
  expect(nascosta.messages.map((m) => m.text).join('\n')).toContain('Parliamo di Zen');
  expect((await inVista(app)).map((c) => c.id)).not.toContain(nascosta.id);
  await expect(dash.locator('.dash-bubble-note').last()).toContainText('nascosta', { timeout: 10_000 });

  // Il messaggio dopo apre una conversazione nuova, che non finisce dentro la nascosta.
  await dash.locator('#input').fill('Che tempo fa domani?');
  await dash.locator('#input').press('Enter');
  await expect.poll(async () => (await tutte(app)).some((c) => !c.nascosta && c.messages.some((m) => m.text === 'Che tempo fa domani?')), { timeout: 30_000 }).toBe(true);
  expect((await tutte(app)).find((c) => c.id === nascosta.id).messages.some((m) => m.text === 'Che tempo fa domani?')).toBe(false);
  // Nessuna conversazione fantasma nata dalla riga dell'azione: la nascosta e quella nuova.
  expect((await tutte(app)).length).toBe(2);

  // Filo non la legge più, ma sa che c'è e come si chiama.
  const r = await cercaComeFilo(app, 'Zen');
  expect(((r.output || {}).results || []).map((x) => x.id)).not.toContain(nascosta.id);
  expect(((r.output || {}).nascoste || []).map((x) => x.id)).toContain(nascosta.id);
  const letta = await app.evaluate((_e, id) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', id }), nascosta.id);
  expect(letta.output.nascosta).toBe(true);
  expect(JSON.stringify(letta.output)).not.toContain('del respiro');

  // Una home nuova non la disegna; la ricerca nel filo la trova a parte, e un clic la rimette al suo posto.
  const home = await openTab(HOME);
  await expect(home.locator('#cercaInput')).toBeVisible({ timeout: 15_000 });
  await expect(home.locator(`.dash-bubble[data-chat="${nascosta.id}"]`)).toHaveCount(0);
  await home.locator('#cercaInput').fill('respiro');
  const voce = home.locator('#cercaRisultati .dash-cerca-nascosta');
  await expect(voce).toHaveCount(1, { timeout: 10_000 });
  await expect(home.locator('#cercaRisultati')).toContainText('In una conversazione nascosta');
  await home.screenshot({ path: 'tests/.shots/1295-ricerca-nascosta.png' });
  await voce.click();
  await expect.poll(async () => ((await tutte(app)).find((c) => c.id === nascosta.id) || {}).nascosta || false, { timeout: 10_000 }).toBe(false);
  await expect(home.locator(`.dash-bubble[data-chat="${nascosta.id}"]`).first()).toContainText('Parliamo di Zen', { timeout: 10_000 });
});

test('dal tasto destro: «Nascondi la conversazione» lascia la riga che la rimette', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await modello(app, { titoli: { Kant: 'Kant' } });
  await chatPronta(app, 'c-kant', 'Parliamo di Kant e della ragion pura');

  const home = await openTab(HOME);
  const bolla = home.locator('.dash-bubble[data-chat="c-kant"]').first();
  await expect(bolla).toBeVisible({ timeout: 15_000 });
  await bolla.evaluate((el) => {
    const v = (window.SN_VOCI_PAGINA || []).flatMap((f) => f(el) || []).find((x) => x.label === 'Nascondi la conversazione');
    v.onClick();
  });
  const riga = home.locator('.dash-nascosta');
  await expect(riga).toBeVisible({ timeout: 10_000 });
  await expect(home.locator('.dash-bubble[data-chat="c-kant"]')).toHaveCount(0);
  expect((await inVista(app)).map((c) => c.id)).not.toContain('c-kant');
  await home.screenshot({ path: 'tests/.shots/1295-riga-nascosta.png' });

  await riga.locator('button').click();
  await expect(home.locator('.dash-bubble[data-chat="c-kant"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(riga).toHaveCount(0);
  expect((await inVista(app)).map((c) => c.id)).toContain('c-kant');
});

// #1461 — le voci del tasto destro sulle conversazioni del filo sono azioni del catalogo: si misura la loro attesa.
const azioniChat = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  return Object.values(s.ore || {}).reduce((n, o) => n + ((o.azioni && o.azioni['chat-archive'] && o.azioni['chat-archive'].n) || 0), 0);
});
// Una bolla in cima al filo può stare sotto la barra «Cerca nel filo»: il clic destro al suo centro prende la barra.
async function ferma(loc) {
  await expect.poll(() => loc.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), { timeout: 10_000 }).toBe(true);
}

test('nascondere e rimettere una conversazione dal tasto destro contano l’attesa dell’azione', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await modello(app, { titoli: { Hegel: 'Hegel' } });
  await chatPronta(app, 'c-hegel', 'Parliamo di Hegel e della dialettica');

  const home = await openTab(HOME);
  const bolla = home.locator('.dash-bubble[data-chat="c-hegel"]').first();
  await expect(bolla).toBeVisible({ timeout: 15_000 });
  await ferma(bolla);
  await bolla.click({ button: 'right' });
  await menuDi(home).voce('Nascondi la conversazione').first().click();
  const riga = home.locator('.dash-nascosta');
  await expect(riga).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => azioniChat(app), { timeout: 8_000 }).toBe(1);

  await ferma(riga);
  await riga.click({ button: 'right' });
  await menuDi(home).voce('Rimetti la conversazione nel filo').first().click();
  await expect(home.locator('.dash-bubble[data-chat="c-hegel"]').first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => azioniChat(app), { timeout: 8_000 }).toBe(2);
});

test('anche la riga di una conversazione dell’Editor si nasconde e si rimette', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await modello(app);
  const id = await app.evaluate(async () => {
    const c = await globalThis.SN_CONVERSAZIONI_APP.annota({
      app: 'editor', rif: 'doc-tesi|chat', soggetto: 'tesi',
      messaggi: [{ role: 'user', text: 'Accorcia il capitolo sui licheni' }, { role: 'filo', text: 'Ecco la versione corta.' }],
    });
    return c.id;
  });
  const home = await openTab(HOME);
  const riga = home.locator('.dash-riga-app').first();
  await expect(riga).toBeVisible({ timeout: 15_000 });
  await riga.evaluate((el) => {
    const v = (window.SN_VOCI_PAGINA || []).flatMap((f) => f(el) || []).find((x) => x.label === 'Nascondi la conversazione');
    v.onClick();
  });
  await expect(home.locator('.dash-nascosta')).toBeVisible({ timeout: 10_000 });
  await expect(home.locator('.dash-riga-app')).toHaveCount(0);
  expect((await inVista(app)).map((c) => c.id)).not.toContain(id);
  await home.locator('.dash-nascosta button').click();
  await expect(home.locator('.dash-riga-app').first()).toBeVisible({ timeout: 10_000 });
  await expect(home.locator('.dash-nascosta')).toHaveCount(0);
  expect((await inVista(app)).map((c) => c.id)).toContain(id);
});

test('«cancellala per sempre» vuole la parola «conferma», e poi la chat non c’è più da nessuna parte', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await configura(app);
  await modello(app, { titoli: { soldi: 'I conti di casa' } });
  await chatPronta(app, 'c-soldi', 'Parliamo dei soldi che ho sul conto');
  await modello(app, {
    titoli: { soldi: 'I conti di casa' },
    chiede: 'per sempre',
    chiamata: { name: 'TOGLI_CHAT', args: { id: 'c-soldi', per_sempre: true } },
  });

  const home = await openTab(HOME);
  await expect(home.locator('#input')).toBeVisible({ timeout: 15_000 });
  await home.locator('#input').fill('cancella per sempre la chat sui soldi');
  await home.locator('#input').press('Enter');
  // Una cosa che non si disfa non apre il riquadro da sola: lo apre il clic sul bottone.
  const bottone = home.locator('.dash-action-btn-primary').last();
  await expect(bottone).toBeVisible({ timeout: 20_000 });
  await bottone.click();
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const s = await confirmState(home);
  expect(s.hasInput, 'cancellare per sempre vuole la parola, non un OK').toBe(true);
  expect(s.text).toContain('I conti di casa');
  expect(s.text).toMatch(/per sempre/i);
  // Prima della parola non è successo niente.
  expect((await tutte(app)).map((c) => c.id)).toContain('c-soldi');

  await home.evaluate(() => window.SN_CONFIRM_UI._test.fill('conferma'));
  const premuto = await home.evaluate(() => window.SN_CONFIRM_UI._test.click('danger') || window.SN_CONFIRM_UI._test.click('ok'));
  expect(premuto).toBe(true);
  await expect.poll(async () => (await tutte(app)).map((c) => c.id), { timeout: 20_000 }).not.toContain('c-soldi');
  const r = await cercaComeFilo(app, 'soldi conto');
  expect(JSON.stringify(r.output || {})).not.toContain('c-soldi');
});

test('nascondere a parole parte da sé, senza chiedere: si disfa', async ({ app }) => {
  test.setTimeout(90_000);
  await configura(app);
  await modello(app, { titoli: { orto: 'L’orto' } });
  await chatPronta(app, 'c-orto', 'Come pianto i pomodori nell’orto?');
  const r = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'TOGLI_CHAT', id: 'c-orto' }));
  expect(r.needsConfirm || 0).toBe(0);
  expect(r.executed).toBe(true);
  expect((await inVista(app)).map((c) => c.id)).not.toContain('c-orto');
  // Rimetterla a parole.
  const giu = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'RIMETTI_CHAT', id: 'c-orto' }));
  expect(giu.executed).toBe(true);
  expect((await inVista(app)).map((c) => c.id)).toContain('c-orto');
  // Un id che non c'è non fa niente e lo dice.
  const via = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'TOGLI_CHAT', id: 'non-esiste' }));
  expect(via.executed).toBe(false);
  expect(via.output.trovata).toBe(false);
});

// ── Il menu del tasto destro da tastiera ─────────────────────────────────────

// Chi ha il fuoco: una voce del menu (col suo nome), una bolla del filo o un altro elemento della pagina.
const fuocoNelMenu = (page) => menuDi(page).valuta(() => {
  const a = document.activeElement;
  if (!a || !a.closest || !a.closest('.sn-menu')) return '';
  return `menu:${(a.getAttribute('aria-label') || a.title || (a.querySelector('.sn-menu-label') || a).textContent || '').trim()}`;
});
const fuoco = async (page) => (await fuocoNelMenu(page)) || page.evaluate(() => {
  const a = document.activeElement;
  if (!a) return '';
  if (a.matches('.dash-bubble[data-chat]')) return `bolla:${a.dataset.chat}`;
  return `${a.tagName.toLowerCase()}.${a.className}`;
});
// Le voci che la tastiera raggiunge, in ordine: il nome e la scritta che si vede (un'icona non ne ha).
const vociDelMenu = (page) => menuDi(page).valuta(() => [...document.querySelectorAll('.sn-menu button')]
  .filter((b) => !b.disabled && !b.classList.contains('sn-disabled') && b.getClientRects().length > 0)
  .map((b) => ({
    id: `menu:${(b.getAttribute('aria-label') || b.title || (b.querySelector('.sn-menu-label') || b).textContent || '').trim()}`,
    scritta: ((b.querySelector('.sn-menu-label') || b).textContent || '').trim(),
  })));
const normale = (t) => t.replace(/^menu:/, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Il giro completo del menu da tastiera, partendo dalla voce attesa.
async function provaMenu(page, prima, tornaA) {
  await expect.poll(() => fuoco(page), { message: 'da tastiera il fuoco parte dalla prima voce che riguarda l’elemento' }).toBe(`menu:${prima}`);
  const elenco = await vociDelMenu(page);
  const voci = elenco.map((v) => v.id);
  const scritte = elenco.map((v) => v.scritta);
  const i = voci.indexOf(`menu:${prima}`);
  expect(i).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('ArrowDown');
  expect(await fuoco(page)).toBe(voci[(i + 1) % voci.length]);
  await page.keyboard.press('ArrowUp');
  expect(await fuoco(page)).toBe(voci[i]);
  await page.keyboard.press('End');
  expect(await fuoco(page)).toBe(voci[voci.length - 1]);
  await page.keyboard.press('ArrowDown');
  expect(await fuoco(page), 'le frecce girano in tondo').toBe(voci[0]);
  await page.keyboard.press('Home');
  expect(await fuoco(page)).toBe(voci[0]);
  await page.keyboard.press('Tab');
  expect(await fuoco(page), 'il Tab resta nel menu').toBe(voci[1]);
  await page.keyboard.press('Shift+Tab');
  expect(await fuoco(page)).toBe(voci[0]);
  // La prima lettera porta alla prossima voce la cui scritta comincia così (un'icona senza scritta non conta).
  const lettera = normale(prima)[0];
  const attesa = voci.find((v, j) => j > 0 && normale(scritte[j]).startsWith(lettera));
  await page.keyboard.press(lettera);
  expect(await fuoco(page)).toBe(attesa);
  await page.keyboard.press('Escape');
  await expect(menuDi(page).pannelli).toHaveCount(0);
  expect(await fuoco(page), 'Esc riporta il fuoco dov’era').toBe(tornaA);
}

test('il menu di una conversazione del filo si apre con Shift+F10 e si usa tutto da tastiera', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await configura(app);
  await modello(app, { titoli: { Epicuro: 'Epicuro', Spinoza: 'Spinoza' } });
  await chatPronta(app, 'c-epicuro', 'Parliamo di Epicuro e del piacere');
  await chatPronta(app, 'c-spinoza', 'Parliamo di Spinoza e della sostanza');

  const home = await openTab(HOME);
  await expect(home.locator('.dash-bubble[data-chat="c-spinoza"]').first()).toBeVisible({ timeout: 15_000 });
  // Il filo è una fermata sola del Tab: una bolla sola si raggiunge col Tab, le altre con le frecce.
  expect(await home.locator('.dash-bubble[data-chat][tabindex="0"]').count()).toBe(1);
  await home.locator('.dash-bubble[data-chat][tabindex="0"]').focus();
  const partenza = await fuoco(home);
  await home.keyboard.press('Home');
  expect(await fuoco(home)).toBe('bolla:c-epicuro');
  await home.keyboard.press('End');
  expect(await fuoco(home)).toBe(partenza);
  await home.keyboard.press('Home');
  const quale = () => home.evaluate(() => [...document.querySelectorAll('.dash-bubble[data-chat]')].indexOf(document.activeElement));
  expect(await quale()).toBe(0);
  await home.keyboard.press('ArrowDown');
  expect(await quale(), 'le frecce passano da una bolla all’altra').toBe(1);
  await home.keyboard.press('ArrowUp');
  expect(await quale()).toBe(0);
  expect(await home.locator('.dash-bubble[data-chat][tabindex="0"]').count(), 'una sola resta nel giro del Tab').toBe(1);

  await home.keyboard.press('Shift+F10');
  await expect(menuDi(home).pannelli).toBeVisible({ timeout: 5_000 });
  await home.screenshot({ path: 'tests/.shots/1295-menu-tastiera.png' });
  await provaMenu(home, 'Nascondi la conversazione', 'bolla:c-epicuro');

  // Invio sceglie: la conversazione si nasconde e il fuoco passa a «Rimetti».
  await home.keyboard.press('Shift+F10');
  await expect.poll(() => fuoco(home)).toBe('menu:Nascondi la conversazione');
  await home.keyboard.press('Enter');
  await expect(home.locator('.dash-nascosta')).toBeVisible({ timeout: 10_000 });
  expect((await inVista(app)).map((c) => c.id)).not.toContain('c-epicuro');
  await expect.poll(() => fuoco(home)).toMatch(/^button\.dash-nascosta-rimetti/);
  await home.keyboard.press('Enter');
  await expect(home.locator('.dash-bubble[data-chat="c-epicuro"]').first()).toBeVisible({ timeout: 10_000 });
  expect((await inVista(app)).map((c) => c.id)).toContain('c-epicuro');
});

test('il menu di un risultato della ricerca nel filo si apre da tastiera, e il pannello resta', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await modello(app, { titoli: { Epicuro: 'Epicuro' } });
  await chatPronta(app, 'c-epicuro', 'Parliamo di Epicuro e del piacere');
  const home = await openTab(HOME);
  await home.locator('#cercaInput').fill('Epicuro');
  await expect(home.locator('#cercaRisultati .dash-cerca-msg').first()).toBeVisible({ timeout: 10_000 });
  await home.locator('#cercaInput').press('ArrowDown');
  await home.keyboard.press('Shift+F10');
  await expect(menuDi(home).pannelli).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => fuoco(home)).toBe('menu:Vai a questo punto del filo');
  expect(await menuDi(home).voci.count(), 'il menu del risultato, non quello del campo').toBe(2);
  await home.keyboard.press('ArrowDown');
  expect(await fuoco(home)).toBe('menu:Copia il testo');
  await home.keyboard.press('Escape');
  await expect(menuDi(home).pannelli).toHaveCount(0);
  await expect.poll(() => home.evaluate(() => document.activeElement && document.activeElement.id)).toBe('cercaInput');
  await expect(home.locator('#cercaRisultati')).toBeVisible();
  await home.keyboard.press('Shift+F10');
  await expect.poll(() => fuoco(home)).toBe('menu:Vai a questo punto del filo');
  await home.keyboard.press('Enter');
  await expect(home.locator('.dash-bubble[data-chat="c-epicuro"].dash-trovato').first()).toBeVisible({ timeout: 10_000 });
});

test('il menu di una scheda chiusa nel filo si usa da tastiera', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await modello(app, { titoli: { Orche: 'Orche' } });
  await app.evaluate(() => globalThis.SN_IL_FILO.registraVisita({ url: 'https://example.com/orche', titolo: 'Le orche del Mediterraneo' }));
  await chatPronta(app, 'c-orche', 'Parliamo delle orche');

  const home = await openTab(HOME);
  const testa = home.locator('.dash-pagine .dash-pagine-testa').first();
  await expect(testa).toBeVisible({ timeout: 15_000 });
  await testa.focus();
  await home.keyboard.press('Shift+F10');
  await expect(menuDi(home).pannelli).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => fuoco(home)).toBe('menu:Mostra le pagine');
  await home.keyboard.press('Enter');
  await expect(home.locator('.dash-pagine-aperte')).toHaveCount(1, { timeout: 5_000 });
  const pagina = home.locator('.dash-pagina').first();
  await expect(pagina).toBeVisible();
  await pagina.focus();
  const qui = await fuoco(home);
  await home.keyboard.press('Shift+F10');
  await expect(menuDi(home).pannelli).toBeVisible({ timeout: 5_000 });
  await provaMenu(home, 'Riapri la pagina', qui);
  // Invio su «Copia l’indirizzo» la copia davvero.
  await home.keyboard.press('Shift+F10');
  await expect.poll(() => fuoco(home)).toBe('menu:Riapri la pagina');
  await home.keyboard.press('ArrowDown');
  expect(await fuoco(home)).toBe('menu:Copia l’indirizzo');
  await home.keyboard.press('Enter');
  await expect(menuDi(home).pannelli).toHaveCount(0);
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://example.com/orche');
});

// ── Le nascoste si rimettono da dove si sono tolte, e si vedono tutte ────────

test('nascosta a parole, al suo posto resta «Rimetti» come col tasto destro', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await configura(app);
  await modello(app, { titoli: { Zen: 'Meditazione Zen' }, chiede: 'cancella questa chat', chiamata: { name: 'TOGLI_CHAT' } });
  const dash = await openTab(HOME);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 15_000 });
  await dash.locator('#input').fill('Parliamo di Zen e del respiro');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 30_000 });
  await dash.locator('#input').fill('cancella questa chat');
  await dash.locator('#input').press('Enter');
  await expect.poll(async () => (await tutte(app)).filter((c) => c.nascosta).length, { timeout: 30_000 }).toBe(1);
  const id = (await tutte(app)).find((c) => c.nascosta).id;
  const riga = dash.locator('.dash-nascosta');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await expect(dash.locator('.dash-bubble-note').last()).toContainText('Rimetti');
  await dash.screenshot({ path: 'tests/.shots/1295-rimetti-a-parole.png' });
  await riga.locator('button').click();
  await expect.poll(async () => ((await tutte(app)).find((c) => c.id === id) || {}).nascosta || false, { timeout: 10_000 }).toBe(false);
  await expect(dash.locator(`.dash-bubble[data-chat="${id}"]`).first()).toContainText('Parliamo di Zen', { timeout: 10_000 });
  await expect(riga).toHaveCount(0);
});

test('nascosta da un’altra scheda, nella home aperta resta una riga sola che la rimette', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await modello(app, { titoli: { Kant: 'Kant' } });
  await chatPronta(app, 'c-kant', 'Parliamo di Kant e della ragion pura');
  const home = await openTab(HOME);
  await expect(home.locator('.dash-bubble[data-chat="c-kant"]').first()).toBeVisible({ timeout: 15_000 });
  const r = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'TOGLI_CHAT', id: 'c-kant' }));
  expect(r.executed).toBe(true);
  await expect(home.locator('.dash-bubble[data-chat="c-kant"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(home.locator('.dash-nascosta')).toHaveCount(1);
  await home.locator('.dash-nascosta button').click();
  await expect(home.locator('.dash-bubble[data-chat="c-kant"]').first()).toBeVisible({ timeout: 10_000 });
});

test('le nascoste si vedono tutte: Filo le elenca senza una loro parola, la home dal tasto destro sul campo di ricerca', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await configura(app);
  await modello(app, { titoli: { orto: 'L’orto', Kant: 'Kant' } });
  await chatPronta(app, 'c-orto', 'Come pianto i pomodori nell’orto?');
  await chatPronta(app, 'c-kant', 'Parliamo di Kant e della ragion pura');
  for (const id of ['c-orto', 'c-kant']) {
    expect((await app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'TOGLI_CHAT', id: x }), id)).executed).toBe(true);
  }
  for (const query of ['', 'quali chat ho nascosto?', 'la conversazione che avevo tolto']) {
    const r = await cercaComeFilo(app, query);
    expect(((r.output || {}).nascoste || []).map((x) => x.id).sort(), `«${query}»`).toEqual(['c-kant', 'c-orto']);
  }
  // Con una parola che ne indica una, solo quella.
  expect(((await cercaComeFilo(app, 'la chat sull’orto che avevo nascosto')).output.nascoste || []).map((x) => x.id)).toEqual(['c-orto']);

  const home = await openTab(HOME);
  const campo = home.locator('#cercaInput');
  await expect(campo).toBeVisible({ timeout: 15_000 });
  await campo.evaluate((el) => {
    const v = (window.SN_VOCI_PAGINA || []).flatMap((f) => f(el) || []).find((x) => x.label === 'Mostra le conversazioni nascoste');
    v.onClick();
  });
  const voci = home.locator('#cercaRisultati .dash-cerca-nascosta');
  await expect(voci).toHaveCount(2, { timeout: 10_000 });
  await expect(home.locator('#cercaRisultati')).toContainText('2 conversazioni nascoste');
  await home.screenshot({ path: 'tests/.shots/1295-nascoste-tutte.png' });
  await voci.filter({ hasText: 'Kant' }).click();
  await expect.poll(async () => ((await tutte(app)).find((c) => c.id === 'c-kant') || {}).nascosta || false, { timeout: 10_000 }).toBe(false);
  await expect(home.locator('.dash-bubble[data-chat="c-kant"]').first()).toBeVisible({ timeout: 10_000 });
});

// La scheda non si porta dietro la chat di adesso cancellata per sempre a parole: al turno dopo il suo testo non torna
// al modello né, con lui, nel registro delle richieste sul disco. Col tasto destro era già così.
test('cancellata per sempre a parole la chat di adesso, il messaggio dopo non la riporta al modello né sul disco', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await configura(app);
  await modello(app, { titoli: { soldi: 'I conti' }, chiede: 'per sempre', chiamata: { name: 'TOGLI_CHAT', args: { per_sempre: true } } });
  await app.evaluate(() => {
    globalThis.__visti = [];
    const P = globalThis.SN_PROVIDERS;
    const vero = P.streamCompleteWithFallback;
    const spia = (o) => { globalThis.__visti.push(o.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')); return vero(o); };
    P.streamCompleteWithFallback = spia;
    P.completeWithFallback = spia;
  });
  const dash = await openTab(HOME);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 15_000 });
  await dash.locator('#input').fill('Parliamo dei soldi segretissimi sul conto');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 30_000 });
  await dash.locator('#input').fill('cancella per sempre questa chat');
  await dash.locator('#input').press('Enter');
  const bottone = dash.locator('.dash-action-btn-primary').last();
  await expect(bottone).toBeVisible({ timeout: 20_000 });
  await bottone.click();
  await expect(dash.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await dash.evaluate(() => window.SN_CONFIRM_UI._test.fill('conferma'));
  await dash.evaluate(() => window.SN_CONFIRM_UI._test.click('danger') || window.SN_CONFIRM_UI._test.click('ok'));
  await expect.poll(async () => (await tutte(app)).filter((c) => c.messages.some((m) => /segretissimi/.test(m.text))).length, { timeout: 20_000 }).toBe(0);
  await expect(dash.locator('.dash-bubble-note', { hasText: 'tolta dal filo' })).toBeVisible({ timeout: 10_000 });

  await app.evaluate(() => { globalThis.__visti = []; });
  await dash.locator('#input').fill('Che tempo fa domani?');
  await dash.locator('#input').press('Enter');
  await expect.poll(async () => (await app.evaluate(() => globalThis.__visti.join('\n'))), { timeout: 30_000 }).toContain('Che tempo fa domani?');
  expect(await app.evaluate(() => globalThis.__visti.join('\n')), 'il testo cancellato non torna al modello').not.toContain('segretissimi');
  await expect(dash.locator('.dash-bubble-filo').last()).toBeVisible();
  await dash.waitForTimeout(2000);
  const file = await app.evaluate(() => {
    const rq = process.mainModule.require;
    const fs = rq('fs');
    const path = rq('path');
    const dir = process.env.FILO_USER_DATA || rq('electron').app.getPath('userData');
    const out = [];
    const giro = (d) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        let st;
        try { st = fs.statSync(p); } catch (_) { continue; }
        if (st.isDirectory()) giro(p);
        else if (st.size < 50e6) { try { if (fs.readFileSync(p, 'utf8').includes('segretissimi')) out.push(path.relative(dir, p)); } catch (_) {} }
      }
    };
    giro(dir);
    return out;
  });
  expect(file, 'il testo cancellato per sempre non si riscrive su nessun file').toEqual([]);
});
