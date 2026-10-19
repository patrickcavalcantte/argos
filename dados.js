// Formato dos dados publicados (noticias.json / contagens.json), compartilhado por server.js e coletar.js
const DIAS_JANELA = 30; // notícias recentes: carregadas direto no painel (noticias.json)
const ARQUIVO_DIAS = 365; // notícias mais antigas ficam em arquivos por mês (arquivo/AAAA-MM.json), até 1 ano; as contagens diárias ficam para sempre

const CAMPOS_BRUTOS = ['id', 'titulo', 'link', 'resumo', 'data', 'fonte', 'fonteId', 'grupo', 'fonteUf', 'coletadoEm'];
// O link já serve de identificador, então 'id' não é publicado
const CAMPOS_SAIDA = ['titulo', 'link', 'resumo', 'data', 'fonte', 'fonteId', 'grupo', 'coletadoEm', 'cats', 'arma', 'uf', 'regiao', 'mun', 'regiaoRJ', 'morte', 'dup', 'caso'];

const quando = (i) => i.data || i.coletadoEm || '';
const bruto = (i) => Object.fromEntries(CAMPOS_BRUTOS.map((c) => [c, i[c] ?? null]));
const saida = (i) => Object.fromEntries(CAMPOS_SAIDA.filter((c) => i[c] != null && i[c] !== false && !(Array.isArray(i[c]) && !i[c].length)).map((c) => [c, i[c]]));

const limite = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
const limiteJanela = () => limite(DIAS_JANELA);
const limiteArquivo = () => limite(ARQUIVO_DIAS);
const naJanela = (itens) => { const lim = limiteJanela(); return itens.filter((i) => quando(i) >= lim); };
const mesDe = (i) => quando(i).slice(0, 7);

// Contagens por dia de publicação. Conta casos distintos (sem duplicatas), como o painel de análise.
function contar(itens) {
  const dias = {};
  for (const i of itens) {
    if (!i.data || i.dup) continue;
    const d = (dias[i.data.slice(0, 10)] ??= { casos: 0, mortes: 0, mun: {}, cat: {}, arma: {} });
    const soma = (o, k) => { o[k] = (o[k] || 0) + 1; };
    d.casos++;
    if (i.morte) { d.mortes++; soma(d.arma, i.arma || 'Não informada'); }
    if (i.mun) soma(d.mun, i.mun);
    for (const c of i.cats || []) soma(d.cat, c);
  }
  return dias;
}

// Termo da busca no Google Notícias de uma fonte (sem o período): 'site:dominio' ou o q= da própria url
function consultaGoogle(f) {
  if (f.googleSite) return `site:${f.googleSite}`;
  return decodeURIComponent(new URL(f.url).searchParams.get('q')).replace(/\s*when:\S+/, '');
}
const urlGoogle = (termo) => `https://news.google.com/rss/search?q=${encodeURIComponent(termo)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

module.exports = { DIAS_JANELA, ARQUIVO_DIAS, CAMPOS_BRUTOS, quando, bruto, saida, limiteJanela, limiteArquivo, naJanela, mesDe, contar, consultaGoogle, urlGoogle };
