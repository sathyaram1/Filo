// Verifica #592, giro 6 — le superfici che scrivono le impostazioni e non sono
// una pagina di impostazioni.
//
// I giri 3, 4 e 5 hanno insegnato la stessa regola tre volte: chi salva da sé
// manda soltanto quello che l'utente ha toccato lì, e per le mappe che viaggiano
// intere riparte da quello che c'è in memoria al momento del salvataggio. La
// cura è stata messa nelle tre pagine di impostazioni (Preferenze, Opzioni,
// Sicurezza).
//
// Qui si prova la quarta superficie, che non è una pagina: il riquadro che Filo
// offre in chat subito dopo aver applicato un colore, per scegliere la tonalità
// esatta. Scrive la stessa mappa dei colori che il giro 5 ha sistemato nelle
// Preferenze (una mappa che si salva INTERA: chi manca viene cancellato), e
// parte dalla fotografia scattata quando il riquadro si è aperto.
//
// E la coda dei campi che la rilettura non rimette al loro posto: quelli che non
// sono caselle di testo. Le due manopole della lettura ad alta voce si salvano
// dopo una pausa, come il riquadro dello stile, ma non sono testo: quello che
// l'utente ha appena spostato non viene rimesso.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const PREFERENZE = 'filo://preferences/preferences.html';

const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

const eseguiInChat = (page, action) =>
  page.evaluate(async (a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

// Apre la home e fa arrivare in chat la risposta di Filo con l'azione estetica,
// senza chiamare nessun modello: la risposta della chat è l'unica cosa
// stubbata. Tutto il resto (la scrittura delle impostazioni, il riquadro di
// raffinamento) è quello vero.
async function apriRiquadroTonalita(openTab) {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => {
    const { MSG } = window.SN_MSG;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === MSG.FILO_CHAT) {
        cb && cb({
          ok: true,
          text: 'Fatto, ho reso i bottoni verdi — qui sotto scegli la tonalità esatta.',
          actions: [{ type: 'IMPOSTA_ESTETICA', token: 'button.bg', valore: '#3a7d44' }],
        });
        return;
      }
      return orig(msg, cb);
    };
  });

  await page.fill('#input', 'rendi i bottoni verdi');
  await page.click('#sendBtn');

  const trigger = page.locator('.sn-refine-trigger');
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  // Il colore proposto da Filo è davvero in memoria.
  await expect(async () => {
    expect((await impostazioni(page)).themeTokens?.['button.bg']).toBe('#3a7d44');
  }).toPass({ timeout: 8_000 });

  await trigger.click();
  await expect(page.locator('.sn-refine-overlay')).toBeVisible({ timeout: 8_000 });
  return page;
}

test('il riquadro della tonalità non deve cancellare un colore chiesto mentre era aperto', async ({ openTab }) => {
  const page = await apriRiquadroTonalita(openTab);

  // Mentre il riquadro è aperto (l'utente sta scegliendo la tonalità) chiede a
  // Filo un'altra cosa estetica, e Filo la applica: in memoria c'è.
  await eseguiInChat(page, { type: 'IMPOSTA_ESTETICA', token: 'accent', valore: '#0055ff' });
  await expect(async () => {
    expect((await impostazioni(page)).themeTokens?.accent).toBe('#0055ff');
  }).toPass({ timeout: 8_000 });

  // Ora sceglie la tonalità esatta nel riquadro.
  await page.evaluate(() => {
    const inp = document.querySelector('.sn-refine-color');
    inp.value = '#112233';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1000);

  const dopo = await impostazioni(page);
  // Quello che l'utente ha scelto qui si salva…
  expect(dopo.themeTokens?.['button.bg']).toBe('#112233');
  // …e quello che non ha toccato resta dov'era.
  expect(dopo.themeTokens?.accent).toBe('#0055ff');
});

test('chiudere il riquadro della tonalità non deve cancellare un colore chiesto nel frattempo', async ({ openTab }) => {
  const page = await apriRiquadroTonalita(openTab);

  await eseguiInChat(page, { type: 'IMPOSTA_ESTETICA', token: 'accent', valore: '#0055ff' });
  await expect(async () => {
    expect((await impostazioni(page)).themeTokens?.accent).toBe('#0055ff');
  }).toPass({ timeout: 8_000 });

  // L'utente ci ripensa e chiude con «Annulla»: torna il colore che Filo aveva
  // proposto, e nient'altro deve muoversi.
  await page.click('.sn-refine-cancel');
  await page.waitForTimeout(1000);

  const dopo = await impostazioni(page);
  expect(dopo.themeTokens?.['button.bg']).toBe('#3a7d44');
  expect(dopo.themeTokens?.accent).toBe('#0055ff');
});

test('la velocità di lettura appena spostata non deve tornare indietro perché è cambiato altro', async ({ openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#ttsRate', { timeout: 20_000 });
  await page.waitForSelector('#tok-radius', { timeout: 20_000 });

  // Se in questo ambiente la lettura ad alta voce non c'è, la manopola è
  // disabilitata e la porta non si può provare: si dichiara, non si finge.
  const disabilitata = await page.evaluate(() => !!document.getElementById('ttsRate').disabled);
  test.skip(disabilitata, 'lettura ad alta voce non disponibile in questo ambiente');

  // L'utente sposta la velocità: il salvataggio parte da sé dopo una pausa.
  await page.evaluate(() => {
    const el = document.getElementById('ttsRate');
    el.value = '1.8';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Nello stesso momento chiede a Filo un'altra impostazione, e Filo la applica.
  await eseguiInChat(page, { type: 'IMPOSTA_ESTETICA', token: 'accent', valore: '#0055ff' });
  await page.waitForTimeout(1500);

  // Quello che ha spostato è ancora quello che vede…
  expect(await page.inputValue('#ttsRate')).toBe('1.8');
  // …e quello che è scritto in memoria.
  expect((await impostazioni(page)).tts?.rate).toBe(1.8);
});
