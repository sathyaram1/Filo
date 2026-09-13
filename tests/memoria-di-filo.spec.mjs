// #592 — la memoria di Filo si rilegge e si cancella una riga per volta.
//
// Le lezioni che Filo si appunta e i moduli in cui finiscono hanno la stessa
// portata dello stile dell'agente: entrano nel prompt di ogni conversazione e
// sopravvivono al riavvio. Una lezione però entra SENZA chiedere niente, e ci
// si arriva anche di traverso (il titolo di una scheda, un risultato web, il
// riassunto di un file che convincono Filo a «ricordarsi» una regola). L'unica
// cosa che la tiene a bada è che l'utente possa rileggerla e toglierla.
//
// Prima non c'era nessun posto dove farlo: in nessuna pagina di Filo si vedeva
// quello che si era appuntato, e l'unica strada per togliere una riga era
// cancellare TUTTA la memoria, profilo di mesi compreso.
//
// Gli assert guardano quello che vede l'utente: la riga sullo schermo, e la
// memoria che Filo si porta nella conversazione dopo.

import { test, expect } from './fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';

const memoria = (app) => app.evaluate(async () => ({
  memory: await globalThis.SN_FILO_MEMORY.getMemory(),
  lessons: await globalThis.SN_FILO_MEMORY.getLessonsBuffer(),
}));

async function apri(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#memoryBox', { timeout: 20_000 });
  return page;
}

const righe = (page) => page.locator('#memoryBox .mem-line');

test('una lezione appuntata da Filo si rilegge in Preferenze e si toglie da lì', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.appendLesson('L\'utente non beve caffe');
    await globalThis.SN_FILO_MEMORY.appendLesson('L\'utente lavora di notte');
  });

  const page = await apri(openTab);
  await expect(righe(page)).toHaveCount(2);
  await expect(page.locator('#memoryBox')).toContainText('non beve caffe');
  await expect(page.locator('#memoryBox')).toContainText('lavora di notte');

  // L'utente toglie la prima.
  await page.locator('.mem-line', { hasText: 'non beve caffe' }).locator('.mem-forget').click();

  // Sparisce dallo schermo…
  await expect(righe(page)).toHaveCount(1);
  await expect(page.locator('#memoryBox')).not.toContainText('non beve caffe');
  // …e Filo non se la porta più nelle conversazioni.
  const dopo = await memoria(app);
  expect(dopo.lessons.map((l) => l.text)).toEqual(["L'utente lavora di notte"]);
});

test('una riga del profilo si toglie senza portarsi via le altre', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Vive a Lisbona\nHa due gatti\nNon guida',
      PREFERENZE: 'Risposte corte',
    });
  });

  const page = await apri(openTab);
  await expect(righe(page)).toHaveCount(4);

  await page.locator('.mem-line', { hasText: 'Ha due gatti' }).locator('.mem-forget').click();
  await expect(righe(page)).toHaveCount(3);

  const dopo = await memoria(app);
  expect(dopo.memory.PROFILO).toBe('Vive a Lisbona\nNon guida');
  expect(dopo.memory.PREFERENZE).toBe('Risposte corte');
});

test('«Dimentica tutto» svuota un modulo solo e lascia stare gli altri', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Vive a Lisbona\nHa due gatti',
      PREFERENZE: 'Risposte corte',
    });
  });

  const page = await apri(openTab);
  await page.locator('.mem-group-head', { hasText: 'Chi sei' }).locator('.mem-clear').click();

  await expect(righe(page)).toHaveCount(1);
  const dopo = await memoria(app);
  expect(dopo.memory.PROFILO).toBe('');
  expect(dopo.memory.PREFERENZE).toBe('Risposte corte');
});

test('senza niente in memoria la pagina lo dice, invece di lasciare un buco', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: '', PREFERENZE: '' });
    await globalThis.SN_FILO_MEMORY.clearLessonsBuffer();
  });

  const page = await apri(openTab);
  await expect(righe(page)).toHaveCount(0);
  await expect(page.locator('#memoryBox')).toContainText('non si è ancora appuntato niente');
});

test('una lezione scritta da Filo mentre la pagina è aperta compare da sé', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: '', PREFERENZE: '' });
    await globalThis.SN_FILO_MEMORY.clearLessonsBuffer();
  });

  const page = await apri(openTab);
  await expect(page.locator('#memoryBox')).toContainText('non si è ancora appuntato niente');

  // Filo se la appunta mentre l'utente è lì (è quello che fa a fine scambio).
  await app.evaluate(async () => globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'SALVA_LEZIONE', testo: 'L\'utente preferisce il tram',
  }));

  await expect(page.locator('#memoryBox')).toContainText('preferisce il tram', { timeout: 8_000 });
});

test('una pagina web non legge e non cancella la memoria', async ({ app }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Vive a Lisbona', PREFERENZE: '' });
    await globalThis.SN_FILO_MEMORY.clearLessonsBuffer();
    await globalThis.SN_FILO_MEMORY.appendLesson('L\'utente non beve caffe');
  });

  const web = { tab: { id: 7, url: 'http://evil.example/' }, url: 'http://evil.example/' };
  const dispatch = (msg) => app.evaluate((_e, { msg, sender }) =>
    globalThis.SN_HANDLE_MESSAGE(msg, sender), { msg, sender: web });

  for (const msg of [
    { type: 'filo_list_memory' },
    { type: 'filo_forget_lesson', text: "L'utente non beve caffe" },
    { type: 'filo_forget_memory_line', module: 'PROFILO', index: 0, atteso: 'Vive a Lisbona' },
    { type: 'filo_forget_memory_module', module: 'PROFILO' },
  ]) {
    const r = await dispatch(msg);
    expect(r.ok, msg.type).toBe(false);
    expect(r.error, msg.type).toBe('forbidden');
  }

  // Controprova: dalla pagina interna la stessa lettura passa.
  const filo = { tab: { id: 8, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
  const ok = await app.evaluate((_e, sender) =>
    globalThis.SN_HANDLE_MESSAGE({ type: 'filo_list_memory' }, sender), filo);
  expect(ok.ok).toBe(true);
  expect(ok.memory.PROFILO).toBe('Vive a Lisbona');

  // E niente è stato cancellato dalla pagina web.
  const dopo = await memoria(app);
  expect(dopo.memory.PROFILO).toBe('Vive a Lisbona');
  expect(dopo.lessons).toHaveLength(1);
});

test('la pagina rimasta indietro non cancella la riga sbagliata', async ({ app }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Vive a Lisbona\nHa due gatti', PREFERENZE: '' });
  });

  const filo = { tab: { id: 8, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
  // La pagina crede che alla riga 1 ci sia «Non guida»: non c'è più.
  const r = await app.evaluate((_e, sender) => globalThis.SN_HANDLE_MESSAGE(
    { type: 'filo_forget_memory_line', module: 'PROFILO', index: 1, atteso: 'Non guida' }, sender), filo);
  expect(r.ok).toBe(true);
  expect(r.tolta).toBe(false);

  const dopo = await memoria(app);
  expect(dopo.memory.PROFILO).toBe('Vive a Lisbona\nHa due gatti');
});
