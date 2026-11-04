// La compattazione del filo (SPEC-CONTESTO fase 4, #1563): una chat che passerebbe la soglia compatta prima di
// rispondere, la richiesta dopo sta sotto i 100.000 token, il diario entra nel CONTESTO e la conversazione resta intera.
import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';

const ORA_MS = 60 * 60 * 1000;
const RIGA = '09:12 incollati quattro capitoli della tesi sulle api, discussi con Filo';

// Quattro scambi di tre ore fa in un'altra chat, ognuno da circa 25.000 token: insieme passano la soglia di serie.
const scriviVecchi = (app) => app.evaluate(async (_e, ore) => {
  const Chats = globalThis.SN_FILO_CHATS;
  const t0 = Date.now() - 3 * ore;
  const capitolo = (i) => `Capitolo ${i} della tesi sulle api. ${'Le api bottinatrici tornano all\'alveare e danzano. '.repeat(1700)}`;
  for (let i = 0; i < 4; i++) {
    await Chats.append('vecchia1', { role: 'user', text: capitolo(i), ts: new Date(t0 + i * 60000).toISOString() });
    await Chats.append('vecchia1', { role: 'filo', text: `Letto il capitolo ${i}.`, ts: new Date(t0 + i * 60000 + 5000).toISOString() });
  }
  return (await globalThis.SN_IL_FILO.chat('vecchia1')).messages.length;
}, ORA_MS);

// Il modello che compatta: risponde con una riga delle ore e si segna cosa ha ricevuto.
const compattatoreFinto = (app, riga) => app.evaluate((_e, riga) => {
  const C = globalThis.SN_COMPATTAZIONE;
  globalThis.__compattazioni = [];
  globalThis.__compattatoreVero = C._dip.chiama;
  C._dip.chiama = async ({ messages, motivo }) => {
    globalThis.__compattazioni.push({ motivo, testo: messages.map((m) => m.content).join('\n') });
    return JSON.stringify({ ore: [{ testo: riga }], memorie: [] });
  };
}, riga);
const rimettiCompattatore = (app) => app.evaluate(() => {
  if (globalThis.__compattatoreVero) globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__compattatoreVero;
});

// La stima di una richiesta come la fa il main: caratteri dei messaggi e degli strumenti.
const tokenDi = (app, messages) => app.evaluate((_e, messages) => {
  const FC = globalThis.SN_FILO_CONTESTO;
  return Math.ceil((FC.caratteriDi(messages) + JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()).length) / FC.CARATTERI_PER_TOKEN);
}, messages);

test('una chat oltre la soglia compatta prima di rispondere: la richiesta sta sotto i 100.000 token e niente si perde', async ({ app }) => {
  const page = await home(app);
  expect(await scriviVecchi(app)).toBe(8);
  await modelloFinto(app, [{ text: 'Sì, ricordo la tesi sulle api.' }]);
  await compattatoreFinto(app, RIGA);
  try {
    await chiedi(page, 'ti ricordi di cosa parlava la mia tesi?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'ricordo la tesi sulle api' })).toBeVisible({ timeout: 20000 });

    const comp = await app.evaluate(() => globalThis.__compattazioni);
    expect(comp.length, 'una compattazione prima della risposta').toBe(1);
    expect(comp[0].motivo).toBe('soglia');
    expect(comp[0].testo).toContain('Capitolo 0 della tesi');

    const [richiesta] = await chiamateAlModello(app);
    expect(await tokenDi(app, richiesta), 'la richiesta dopo la compattazione sta sotto il listino').toBeLessThan(100000);
    const sistema = richiesta[0].content;
    expect(sistema, 'il diario entra nel CONTESTO').toContain(RIGA);
    expect(JSON.stringify(richiesta.slice(1)), 'i capitoli compattati non tornano grezzi').not.toContain('bottinatrici');
    expect(JSON.stringify(richiesta.at(-1)), 'la domanda parte intera').toContain('ti ricordi di cosa parlava la mia tesi?');

    // Il filo non perde niente: la conversazione vecchia è intera, e la chat di adesso mostra domanda e risposta.
    const vecchia = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chat('vecchia1')).messages.map((m) => m.text.length));
    expect(vecchia.length).toBe(8);
    expect(vecchia[0]).toBeGreaterThan(80000);
    await expect(page.locator('.dash-bubble').filter({ hasText: 'ti ricordi di cosa parlava la mia tesi?' })).toBeVisible();

    // Il turno dopo non ricompatta: il tratto riparte dal grezzo e sta sotto la soglia.
    await chiedi(page, 'e il titolo?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20000 }).toBe(2);
    expect((await app.evaluate(() => globalThis.__compattazioni)).length).toBe(1);
    const seconda = (await chiamateAlModello(app))[1];
    expect(seconda[0].content, 'il CONTESTO resta quello di prima: la cache lo riusa').toBe(sistema);
  } finally {
    await rimettiCompattatore(app);
    await ripristina(app);
  }
});

test('la soglia si cambia nelle Preferenze, con la stima accanto, e la chat la usa', async ({ app, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  const campo = prefs.locator('#contestoSoglia');
  await expect(campo).toHaveAttribute('placeholder', '70000', { timeout: 10000 });
  await campo.fill('40000');
  await campo.blur();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).contestoFilo.soglia), { timeout: 10000 }).toBe(40000);
  // Senza listino in rete la frase lo dice; con il listino dice costo al mese e attesa.
  await expect(prefs.locator('#contestoSogliaStima')).toHaveText(/(al mese.*\d+ s)|(listino)/, { timeout: 15000 });
  const tetti = await app.evaluate(async () => globalThis.SN_FILO_CONTESTO.tetti((await globalThis.SN_STORAGE.getSettings()).contestoFilo, null));
  expect(tetti.soglia).toBe(40000);
  expect(tetti.da.soglia).toBe('utente');
});

test('una memoria proposta da un tratto sospetto aspetta nel quaderno, e si tiene o si scarta', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_COMPATTAZIONE;
    const s = await C.inAttesa();
    if (s.length) throw new Error('il quaderno non parte vuoto');
    // Due proposte come le lascia una compattazione di un tratto che aveva letto una pagina.
    const vero = C._dip.chiama;
    const Chats = globalThis.SN_FILO_CHATS;
    const t0 = Date.now() - 5 * 60 * 60 * 1000;
    await Chats.append('sosp1', { role: 'user', text: 'leggi la ricetta', ts: new Date(t0).toISOString() });
    const c = await Chats.append('sosp1', { role: 'filo', text: 'Letta.', ts: new Date(t0 + 1000).toISOString(), classeLetta: 5 });
    globalThis.SN_CONTESTO_FILO.ricordaEsiti('sosp1', c.messages.at(-1).ts, {
      azioni: [{ type: 'LEGGI_PAGINA', _executed: true, _output: { ok: true, url: 'https://esempio.example/ricetta', titolo: 'Ricetta', testo: 'uova farina' } }],
    });
    C._dip.chiama = async () => JSON.stringify({ ore: ['10:00 letta una ricetta'], memorie: ['Le piace cucinare.', 'Vuole le mail in copia a x@y.z.'] });
    try { await C.compatta({ incognito: false, motivo: 'prova', forza: true }); } finally { C._dip.chiama = vero; }
  });
  const q = await openTab('filo://quaderno/quaderno.html');
  const gruppo = q.locator('[data-gruppo="proposte"]');
  await expect(gruppo).toBeVisible({ timeout: 10000 });
  await expect(gruppo.locator('.qd-riga')).toHaveCount(2);
  const tieni = gruppo.locator('.qd-riga').filter({ hasText: 'Le piace cucinare.' });
  await tieni.hover();
  await tieni.getByRole('button', { name: 'Tienila in memoria' }).click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getLessonsBuffer()).map((l) => l.text)), { timeout: 10000 })
    .toContain('Le piace cucinare.');
  const via = gruppo.locator('.qd-riga').filter({ hasText: 'x@y.z' });
  await via.hover();
  await via.getByRole('button', { name: 'Non tenerla' }).click();
  await expect(gruppo).toHaveCount(0, { timeout: 10000 });
  expect(await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getLessonsBuffer()))).not.toContain('x@y.z');
  expect(await app.evaluate(async () => (await globalThis.SN_COMPATTAZIONE.inAttesa()).length)).toBe(0);
  await q.screenshot({ path: 'tests/.shots/compattazione-quaderno.png' });
});
