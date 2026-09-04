// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';

const KEY = (readFileSync('C:/Users/agenti AI/Desktop/Filo/agent-bench/.env', 'utf8')
  .match(/OPENROUTER_KEY=(\S+)/) || [])[1];

async function setKey(openTab, { openWeights = false } = {}) {
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(2500);
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(500);
  await opt.locator('#apiKey').fill(KEY);
  await opt.locator('#apiKey').blur();
  if (openWeights) {
    const ow = opt.locator('#openWeightsOnly');
    if (!(await ow.isChecked())) await ow.click();
  }
  await opt.waitForTimeout(2500);
  return opt;
}

test('voce: testo lungo, caratteri strani, velocità diversa, voce scelta', async ({ openTab }) => {
  test.setTimeout(300000);
  await setKey(openTab);
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForTimeout(2500);

  const casi = [
    ['lungo', 'Nel mezzo del cammin di nostra vita mi ritrovai per una selva oscura. '.repeat(20), 'it', ''],
    ['strano', 'Émoji 🚀 e simboli <>&"\' — 3,14 € · 100% ok?!', 'it', ''],
    ['vuoto', '', 'it', ''],
    ['voce inglese', 'The quick brown fox jumps over the lazy dog.', 'en', 'am_adam'],
    ['voce inesistente', 'Prova con una voce che non esiste.', 'it', 'zz_nessuna'],
  ];
  for (const [nome, text, lang, voice] of casi) {
    const r = await pref.evaluate(async ([t, l, v]) => {
      const res = await chrome.runtime.sendMessage({ type: 'tts_synth', text: t, lang: l, voice: v });
      return { ok: res && res.ok, model: res && res.model, bytes: res && res.audioBase64 ? res.audioBase64.length : 0, error: res && res.error };
    }, [text, lang, voice]);
    console.log(`CASO ${nome}:`, JSON.stringify(r).slice(0, 300));
  }
});

test('a pesi aperti soltanto: voce e dettatura funzionano lo stesso', async ({ openTab }) => {
  test.setTimeout(300000);
  await setKey(openTab, { openWeights: true });
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForTimeout(2500);
  const tts = await pref.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: 'tts_synth', text: 'Prova a pesi aperti.', lang: 'it', voice: '' });
    return { ok: r && r.ok, model: r && r.model, error: r && r.error, bytes: r && r.audioBase64 ? r.audioBase64.length : 0 };
  });
  console.log('VOCE (solo pesi aperti):', JSON.stringify(tts).slice(0, 300));
  expect(tts.ok, 'la voce funziona anche a soli pesi aperti').toBe(true);

  const arc = await openTab('filo://archive/archive.html');
  await arc.waitForTimeout(2000);
  await arc.locator('#search').fill('prova');
  await arc.locator('#search').press('Enter');
  await arc.waitForTimeout(10000);
  console.log('ARCHIVIO (solo pesi aperti):', JSON.stringify((await arc.locator('#searchNote').textContent() || '').trim()));
});
