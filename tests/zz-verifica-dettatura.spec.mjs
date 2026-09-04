// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
// Dettatura dal vivo: il "microfono" è una voce vera sintetizzata prima.
import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';

const KEY = (readFileSync('C:/Users/agenti AI/Desktop/Filo/agent-bench/.env', 'utf8')
  .match(/OPENROUTER_KEY=(\S+)/) || [])[1];
const WAV_B64 = readFileSync(
  'C:/Users/AGENTI~1/AppData/Local/Temp/claude/C--Users-agenti-AI-Desktop-Filo-Filo/868afa78-eb42-4303-8142-6ea39d549556/scratchpad/voce.wav',
).toString('base64');

async function setKey(openTab, key) {
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(2500);
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(500);
  await opt.locator('#apiKey').fill(key);
  await opt.locator('#apiKey').blur();
  await opt.waitForTimeout(2500);
}

test('dettatura: quel che dico finisce nel campo', async ({ openTab, testServer }) => {
  test.setTimeout(240000);
  await setKey(openTab, KEY);

  const page = await testServer.openReady(openTab, `
    <html lang="it"><body style="font:16px sans-serif;padding:40px">
      <h1>Prova dettatura</h1>
      <textarea id="campo" rows="5" cols="60"></textarea>
    </body></html>`);

  // Microfono finto: una voce VERA (WAV sintetizzato) al posto del microfono.
  await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(buf.buffer);
    const dest = ctx.createMediaStreamDestination();
    window.__filoFakeMic = () => {
      const src = ctx.createBufferSource();
      src.buffer = audio;
      src.loop = true;
      src.connect(dest);
      src.start();
      return dest.stream;
    };
    navigator.mediaDevices.getUserMedia = async () => window.__filoFakeMic();
  }, WAV_B64);

  await page.locator('#campo').click();
  await page.locator('#campo').type('nota: ');
  // Tasto destro sul campo → menu di Filo
  await page.locator('#campo').click({ button: 'right' });
  await page.waitForTimeout(1500);
  const menuText = await page.evaluate(() => {
    const m = document.querySelector('.sn-popup, .sn-context-menu, [class*="sn-menu"]');
    return m ? m.innerText : '(nessun menu trovato)';
  });
  console.log('VOCI DEL MENU:\n' + menuText);

  const detta = page.locator('text=Detta').first();
  await expect(detta, 'la voce "Detta" esiste nel menu').toBeVisible({ timeout: 5000 });
  page.on('console', (m) => console.log('[pagina]', m.type(), m.text()));
  await detta.click();
  await page.waitForTimeout(4000);
  console.log('TOAST/CORPO:', await page.evaluate(() => {
    const t = [...document.querySelectorAll('[class*="toast"], .sn-toast, [class*="sn-"]')]
      .map((e) => e.className + ' :: ' + (e.innerText || '').slice(0, 120));
    return t.join('\n');
  }));
  const pill = page.locator('.sn-dictate-pill');
  await expect(pill, 'compare il riquadro "ti ascolto"').toBeVisible({ timeout: 8000 });

  // parla per un po', poi guarda la trascrizione provvisoria
  await page.waitForTimeout(14000);
  const live = await page.evaluate(() => {
    const el = document.querySelector('.sn-dictate-pill-live');
    return el && !el.hidden ? el.textContent : '';
  });
  console.log('PROVVISORIO IN DIRETTA:', JSON.stringify(live));

  await pill.click();
  await page.waitForTimeout(20000);
  const val = await page.locator('#campo').inputValue();
  console.log('CAMPO DOPO LA DETTATURA:', JSON.stringify(val));
  expect(val.toLowerCase(), 'il testo dettato è finito nel campo').toContain('gatto');
  expect(val.startsWith('nota: '), 'il testo si aggiunge dove stava il cursore').toBe(true);
});
