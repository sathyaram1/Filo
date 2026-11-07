// Verifica #1563 giro 5, rilievo 1: il diario della compattazione segue lo stato di ciò da cui nasce.
// Una conversazione nascosta durante una compattazione torna davanti a Filo quando la si rimette; una pagina cancellata
// dalla cronologia non resta nel diario sul disco.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const ORA_MS = 60 * 60 * 1000;

// Chi compatta riscrive quello che riceve: una riga che nomina Lisbona solo se l'ha vista; `fissa`, quella data.
const compattatoreFinto = (app, fissa = null) => app.evaluate((_e, fissa) => {
  const C = globalThis.SN_COMPATTAZIONE;
  globalThis.__compattatoreVero = C._dip.chiama;
  C._dip.chiama = async ({ messages }) => {
    const testo = messages.map((m) => m.content).join('\n');
    const righe = [];
    if (fissa) righe.push({ testo: fissa });
    else if (/Lisbona/.test(testo)) righe.push({ testo: '08:00 prenotato il volo TAP per Lisbona del 12' });
    if (!righe.length) righe.push({ testo: '09:30 salutato Filo' });
    return JSON.stringify({ ore: righe, memorie: [] });
  };
}, fissa);
const rimettiCompattatore = (app) => app.evaluate(() => {
  if (globalThis.__compattatoreVero) globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__compattatoreVero;
});
const compatta = (app) => app.evaluate(async () => {
  const r = await globalThis.SN_COMPATTAZIONE.compatta({ incognito: false, motivo: 'soglia', tetti: globalThis.SN_FILO_CONTESTO.tetti(null, null) });
  return r && r.fatto;
});
const diarioSulDisco = (app) => app.evaluate(() => {
  const rq = process.mainModule.require;
  const f = rq('node:path').join(globalThis.SN_COMPATTAZIONE._dip.cartella(), 'livelli.json');
  try { return rq('node:fs').readFileSync(f, 'utf8'); } catch (_) { return ''; }
});

test('r1 una conversazione nascosta mentre la chat compatta, rimessa, torna davanti a Filo', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(async (_e, ore) => {
    const Chats = globalThis.SN_FILO_CHATS;
    const t0 = Date.now() - 6 * ore;
    await Chats.append('lisbona1', { role: 'user', text: 'prenota il volo per Lisbona del 12, il TAP delle 7:40', ts: new Date(t0).toISOString() });
    await Chats.append('lisbona1', { role: 'filo', text: 'Fatto: TAP delle 7:40, posto 14C.', ts: new Date(t0 + 5000).toISOString() });
    await Chats.append('saluti1', { role: 'user', text: 'ciao', ts: new Date(t0 + ore).toISOString() });
    await Chats.append('saluti1', { role: 'filo', text: 'Ciao!', ts: new Date(t0 + ore + 5000).toISOString() });
    await Chats.nascondi('lisbona1', true);
  }, ORA_MS);
  await compattatoreFinto(app);
  try {
    expect(await compatta(app)).toBe(true);
    await app.evaluate(() => globalThis.SN_FILO_CHATS.nascondi('lisbona1', false));
    await modelloFinto(app, [{ text: 'Parte alle 7:40.' }]);
    await chiedi(page, 'a che ora parte il mio volo?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Parte alle 7:40.' })).toBeVisible({ timeout: 20000 });
    const [richiesta] = await chiamateAlModello(app);
    expect(JSON.stringify(richiesta), 'rimessa, la conversazione del volo è di nuovo davanti a Filo (diario o tratto)').toContain('Lisbona');
  } finally {
    await rimettiCompattatore(app);
    await ripristina(app);
  }
});

test('r1 una pagina cancellata dalla cronologia esce subito dal diario sul disco', async ({ app }) => {
  await home(app);
  const visita = await app.evaluate(async (_e, ore) => {
    const Chats = globalThis.SN_FILO_CHATS;
    const t0 = Date.now() - 5 * ore;
    await Chats.append('esame1', { role: 'user', text: 'dove posso fare quell\'esame?', ts: new Date(t0).toISOString() });
    const v = await globalThis.SN_IL_FILO.registraVisita({ url: 'https://clinica.example/esami', titolo: 'Esami', ts: new Date(t0 + 500).toISOString() }, { incognito: false });
    await Chats.append('esame1', { role: 'filo', text: 'Qui vicino.', ts: new Date(t0 + 1000).toISOString() });
    return { ts: v.ts, url: 'https://clinica.example/esami' };
  }, ORA_MS);
  await compattatoreFinto(app, '09:00 cercata la clinica.example per un esame');
  try {
    expect(await compatta(app)).toBe(true);
    expect(await diarioSulDisco(app)).toContain('clinica.example');
    await app.evaluate((_e, v) => globalThis.SN_IL_FILO.cancellaVisite([v], { incognito: false }), visita);
    await expect.poll(() => diarioSulDisco(app), { timeout: 5000, message: 'la pagina cancellata resta nel diario sul disco' }).not.toContain('clinica.example');
  } finally {
    await rimettiCompattatore(app);
  }
});
