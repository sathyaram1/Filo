async function paga(messaggi) {
  const P = globalThis.SN_PROVIDER_OPENROUTER;
  return await P.complete({ apiKey: "k", model: "x", messages: messaggi });
}
module.exports = { paga };
