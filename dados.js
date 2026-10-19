// Formato dos dados publicados (noticias.json / contagens.json), compartilhado por server.js e coletar.js
const DIAS_JANELA = 30; // notícias ficam publicadas por 30 dias; as contagens diárias ficam para sempre

const CAMPOS_BRUTOS = ['id', 'titulo', 'link', 'resumo', 'data', 'fonte', 'fonteId', 'grupo', 'fonteUf', 'coletadoEm'];
// O link já serve de identificador, então 'id' não é publicado
const CAMPOS_SAIDA = ['titulo', 'link', 'resumo', 'data', 'fonte', 'fonteId', 'grupo', 'coletadoEm', 'cats', 'arma', 'uf', 'regiao', 'morte', 'dup', 'caso'];

const quando = (i) => i.data || i.coletadoEm || '';
const bruto = (i) => Object.fromEntries(CAMPOS_BRUTOS.map((c) => [c, i[c] ?? null]));
const saida = (i) => Object.fromEntries(CAMPOS_SAIDA.filter((c) => i[c] != null && i[c] !== false && !(Array.isArray(i[c]) && !i[c].length)).map((c) => [c, i[c]]));

const limiteJanela = () => new Date(Date.now() - DIAS_JANELA * 86400000).toISOString();
const naJanela = (itens) => { const lim = limiteJanela(); return itens.filter((i) => quando(i) >= lim); };

// Contagens por dia de publicação. Conta casos distintos (sem duplicatas), como o painel de análise.
function contar(itens) {
  const dias = {};
  for (const i of itens) {
    if (!i.data || i.dup) continue;
    const d = (dias[i.data.slice(0, 10)] ??= { casos: 0, mortes: 0, uf: {}, cat: {}, arma: {} });
    const soma = (o, k) => { o[k] = (o[k] || 0) + 1; };
    d.casos++;
    if (i.morte) { d.mortes++; soma(d.arma, i.arma || 'Não informada'); }
    if (i.uf) soma(d.uf, i.uf);
    for (const c of i.cats || []) soma(d.cat, c);
  }
  return dias;
}

module.exports = { DIAS_JANELA, CAMPOS_BRUTOS, quando, bruto, saida, naJanela, contar };
