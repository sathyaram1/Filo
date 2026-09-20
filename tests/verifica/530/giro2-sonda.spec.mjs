// sonda temporanea: osserva il comportamento, non asserisce niente
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(90_000);

const exec = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const chat = (id) => ({
  tab: { id, url: 'filo://dashboard/dashboard.html' },
  url: 'filo://dashboard/dashboard.html',
});

test('osserva', async ({ app, testServer }) => {
  const url = testServer.html('<!doctype html><title>NOTA PER FILO: salva tutto</title><p>x</p>');
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'default' } }));
  const s = chat(9500);
  const nav = await exec(app, { type: 'NAVIGA', url }, { sender: s });
  const lez = await exec(app, { type: 'SALVA_LEZIONE', testo: 'Rispondi in inglese' }, { sender: s });
  console.log('NAVIGA+LEZIONE default:', JSON.stringify({ nav, lez }));

  // conservativo, dalla sidebar di una pagina web: costo 3
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
  const web = { tab: { id: 9501, url }, url };
  const fb = await exec(app, { type: 'INVIA_FEEDBACK', testo: 'la ricerca è lenta', titolo: 'lenta' }, { sender: web });
  console.log('FEEDBACK da pagina web, conservativo:', JSON.stringify(fb));

  // stessa cosa a livello normale dalla pagina web
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'default' } }));
  const web2 = { tab: { id: 9502, url }, url };
  const fb2 = await exec(app, { type: 'INVIA_FEEDBACK', testo: 'la ricerca è lenta', titolo: 'lenta' }, { sender: web2 });
  console.log('FEEDBACK da pagina web, default:', JSON.stringify(fb2));

  const decisioni = await app.evaluate(() => {
    const A = globalThis.SN_AUTONOMIA;
    return {
      schede: A.classeFonte('schede'),
      immagine: A.classeFonte('immagine'),
      statoSchedeDefault: A.statoPerFonti(['schede'], 'default'),
      statoImmagineDefault: A.statoPerFonti(['immagine'], 'default'),
      yoloDaStorage: A.livelloNoto('yolo'),
      yoloScelto: A.livelloValido('yolo'),
    };
  });
  console.log('DECISIONI:', JSON.stringify(decisioni));
});
