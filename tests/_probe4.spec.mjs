import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/newtab.html';
const leggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getSettings();
  return JSON.parse(JSON.stringify({
    terminal: s.terminal, safeBrowse: s.security?.safeBrowse, cookies: s.security?.cookies,
    fingerprint: s.security?.fingerprint, adblock: s.security?.adblock, siteBlock: s.security?.siteBlock,
    protectIpLeak: s.security?.protectIpLeak, blockPopups: s.security?.blockPopups,
    monthlyLimitEur: s.monthlyLimitEur, useDefaultModels: s.useDefaultModels,
    modelsChat: s.models && s.models.filo_chat, registro: Object.keys(s.modelRegistry || {}).length,
  }));
});

const daWeb = (app, settings) => app.evaluate(async (s) => {
  const r = await globalThis.SN_HANDLE_MESSAGE(
    { type: 'update_settings', settings: s },
    { url: 'https://sito-ostile.example/pagina.html' });
  return !!(r && r.ok);
}, settings);

test('una pagina web può spegnere le difese e accendere il terminale?', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  console.log('PRIMA', JSON.stringify(await leggi(app)));

  console.log('terminale ok =', await daWeb(app, { terminal: { enabled: true, shell: 'bash' } }));
  console.log('DOPO-terminale', JSON.stringify((await leggi(app)).terminal));

  console.log('difese ok =', await daWeb(app, { security: {
    safeBrowse: { enabled: false }, cookies: { mode: 'manual' }, fingerprint: { mode: 'off' },
    adblock: { enabled: false }, siteBlock: { enabled: false }, protectIpLeak: false, blockPopups: false } }));
  console.log('DOPO-difese', JSON.stringify(await leggi(app)));

  console.log('spesa ok =', await daWeb(app, { monthlyLimitEur: 9999, useDefaultModels: false }));
  console.log('DOPO-spesa', JSON.stringify(await leggi(app)));
});

test('una pagina web può dirottare il modello?', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  console.log('ok =', await daWeb(app, { models: { filo_chat: 'attaccante/modello' } }));
  console.log('DOPO', JSON.stringify((await leggi(app)).modelsChat));
});
