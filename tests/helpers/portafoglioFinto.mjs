// Un portafoglio finto per gli spec della bacheca (#1076): votare e riaprire chiedono i crediti di Filo, e un test
// che prova altro (l'accesso, gli errori di rete) parte da un'installazione che li ha. Niente rete: l'identità
// dell'installazione risponde da sé col suo uid.

export async function portafoglioFinto(app, { uid = 'uid-1', token = 'token-installazione' } = {}) {
  await app.evaluate((_e, { uid, token }) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]anon-auth\.js$/.test(x));
    const anon = M._cache[k].exports;
    anon.getUid = async () => uid;
    anon.getIdToken = async () => token;
    globalThis.SN_WALLET_MAIN.haPortafoglio = () => true;
  }, { uid, token });
}
