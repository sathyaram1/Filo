import { test, expect } from './fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

test('il salvataggio di un token fa rileggere la pagina a se stessa?', async ({ openTab }) => {
  const p = await openTab(PREFERENZE);
  await p.waitForSelector('#agentStyleText', { timeout: 20000 });
  await p.waitForSelector('#tok-radius', { timeout: 20000 });

  // conta le riletture
  await p.evaluate(() => {
    window.__riletture = 0;
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'settings_updated') window.__riletture++; });
  });

  const lungo = 'Parla come un capitano di mare. '.repeat(30);
  await p.fill('#agentStyleText', lungo);
  await p.waitForTimeout(1500);
  console.log('A) memoria stile =', JSON.stringify((await impostazioni(p)).agentStyle || ''));
  console.log('A) riquadro lungo?', (await p.inputValue('#agentStyleText')).length);
  console.log('A) annunci ricevuti =', await p.evaluate(() => window.__riletture));

  await p.fill('#tok-radius', '9px');
  await p.waitForTimeout(2500);
  console.log('B) memoria radius =', (await impostazioni(p)).themeTokens?.radius);
  console.log('B) riquadro lunghezza =', (await p.inputValue('#agentStyleText')).length);
  console.log('B) annunci ricevuti =', await p.evaluate(() => window.__riletture));
  console.log('B) errore visibile =', await p.locator('#agentStyleError').isVisible());
});

test('tema cambiato in chat: quanti annunci arrivano alla pagina?', async ({ openTab }) => {
  const p = await openTab(PREFERENZE);
  await p.waitForSelector('#agentStyleText', { timeout: 20000 });
  await p.evaluate(() => {
    window.__riletture = 0;
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'settings_updated') window.__riletture++; });
  });
  const lungo = 'Parla come un capitano di mare. '.repeat(30);
  await p.fill('#agentStyleText', lungo);
  await p.waitForTimeout(1200);
  console.log('C) riquadro prima =', (await p.inputValue('#agentStyleText')).length);
  // Filo cambia il tema da un'altra parte
  await p.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action', action: { type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' } }));
  await p.waitForTimeout(2500);
  console.log('C) annunci =', await p.evaluate(() => window.__riletture));
  console.log('C) riquadro dopo =', (await p.inputValue('#agentStyleText')).length);
  console.log('C) errore visibile =', await p.locator('#agentStyleError').isVisible());
  console.log('C) tema pagina =', await p.inputValue('#theme'));
});
