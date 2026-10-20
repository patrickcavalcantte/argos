// Servidor local do buscador de notícias de segurança pública.
// Uso: node server.js  ->  http://localhost:3737
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const zlib = require('zlib');
const path = require('path');
const { CAMPOS_BRUTOS, quando, saida, contar, consultaGoogle, urlGoogle } = require('./dados');

const PORTA = process.env.PORT || 3737;
const INTERVALO_MS = 24 * 60 * 60 * 1000;
const feeds = JSON.parse(fs.readFileSync(path.join(__dirname, 'feeds.json'), 'utf8'));

// Palavras-chave de segurança pública (comparadas sem acentos, em minúsculas)
const PALAVRAS = [
  'assassinat', 'homicidio', 'latrocinio', 'feminicidio', 'morto a tiros', 'encontrado morto', 'mortes violentas',
  'tiroteio', 'ataque a tiros', 'baleado', 'baleada', 'balear', 'disparo', 'bala perdida',
  'roubo', 'furto', 'assalto', 'sequestro', 'estupro', 'agressao', 'violencia',
  'preso', 'presa', 'presos', 'prisao', 'mandado de prisao', 'flagrante', 'detido', 'foragido', 'apreendid', 'apreensao',
  'policia', 'policial', 'pm ', 'pms ', 'pf ', 'prf', 'guarda municipal', 'bope', 'batalhao', 'delegacia', 'delegado',
  'operacao policial', 'operacao da pf', 'investigacao', 'inquerito', 'denuncia do mp', 'ministerio publico',
  'trafic', 'droga', 'entorpecente', 'cocaina', 'maconha', 'fuzil', 'arma de fogo', 'armas', 'municao', 'explosivo',
  'faccao', 'milicia', 'miliciano', 'crime organizado', 'pcc', 'comando vermelho', 'lavagem de dinheiro',
  'seguranca publica', 'secretaria de seguranca', 'penitenciaria', 'presidio', 'sistema prisional', 'fuga de presos',
  'maria da penha', 'medida protetiva', 'violencia domestica', 'contra a mulher', 'lesao corporal',
  'chacina', 'refem', 'rebelia', 'homicida', 'criminos', 'crime', 'suspeito', 'vitima', 'habeas corpus',
  'golpe', 'estelionato', 'fraude', 'corrupcao',
  // indicadores: linchamento, discriminação, socioambiental, violência contra criança
  'linch', 'racis', 'injuria racial', 'homofob', 'transfob', 'lgbt', 'intolerancia religiosa', 'desmatament', 'garimp', 'grilagem',
  'crime ambiental', 'conflito agrario', 'conflito fundiario', 'trabalho escravo', 'abuso sexual', 'maus-tratos', 'pedofil'
];

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ehSeguranca = (item) => {
  const t = ' ' + norm(item.titulo + ' ' + item.resumo) + ' ';
  return PALAVRAS.some((p) => t.includes(p));
};

const entidades = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodificar = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => entidades[n.toLowerCase()] ?? m);
const limpar = (s) => decodificar(decodificar(s || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (bloco, nome) => {
  const m = bloco.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i'));
  return m ? m[1] : '';
};

function parsear(xml, fonte) {
  const itens = [];
  const blocos = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const b of blocos) {
    let link = limpar(tag(b, 'link'));
    if (!link) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? decodificar(m[1]) : '';
    }
    const data = new Date(limpar(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')));
    let titulo = limpar(tag(b, 'title'));
    let origem = '';
    if (fonte.google) {
      // Google Notícias: título vem como "Manchete - Veículo"
      origem = limpar(tag(b, 'source'));
      if (origem && titulo.endsWith(' - ' + origem)) titulo = titulo.slice(0, -(origem.length + 3));
    }
    if (!titulo || !link) continue;
    itens.push({
      id: link,
      titulo,
      link,
      resumo: fonte.google ? '' : limpar(tag(b, 'description') || tag(b, 'summary')).slice(0, 300),
      data: isNaN(data) ? null : data.toISOString(),
      fonte: origem || fonte.nome,
      fonteId: fonte.id,
      grupo: fonte.grupo,
      fonteUf: fonte.uf || null,
    });
  }
  return itens;
}

let cache = { itens: [], status: [], stats: null, atualizadoEm: null };

// Histórico acumulado em disco (historico.json): cada notícia entra uma vez, identificada pelo link.
// Só guarda os campos brutos; a classificação é refeita a cada coleta, então melhorias no analise.py
// valem também para o que já foi coletado.
const ARQ_HISTORICO = process.env.HISTORICO || path.join(__dirname, 'historico.json');
const historico = new Map();
try {
  for (const i of JSON.parse(fs.readFileSync(ARQ_HISTORICO, 'utf8'))) historico.set(i.id, i);
  console.log(`Histórico carregado: ${historico.size} notícias`);
} catch {}

function salvarHistorico() {
  const lista = [...historico.values()].map((i) => Object.fromEntries(CAMPOS_BRUTOS.map((c) => [c, i[c] ?? null])));
  const tmp = ARQ_HISTORICO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lista));
  fs.renameSync(tmp, ARQ_HISTORICO); // troca atômica: um erro no meio não corrompe o arquivo
}

// Chama analise.py: classifica as notícias (crime, arma, estado) e calcula estatísticas
function analisar(itens) {
  return new Promise((resolve) => {
    const py = spawn(process.env.PYTHON || 'python', ['-I', path.join(__dirname, 'analise.py')]);
    let saida = '', erro = '';
    py.stdout.on('data', (d) => (saida += d));
    py.stderr.on('data', (d) => (erro += d));
    py.on('error', (e) => { console.log('  análise indisponível:', e.message); resolve(null); });
    py.on('close', (codigo) => {
      if (codigo !== 0) { console.log('  análise falhou:', erro.trim().split('\n').pop()); return resolve(null); }
      try { resolve(JSON.parse(saida)); } catch { resolve(null); }
    });
    py.stdin.end(JSON.stringify({ itens }));
  });
}

// Baixa um feed, repetindo só as falhas transitórias (timeout, rede, 5xx/429); 403/404 não adianta insistir
async function baixar(url) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 BuscadorSegurancaPublica/1.0', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      const m = /^HTTP (\d+)/.exec(e.message);
      const transitoria = !m || +m[1] >= 500 || +m[1] === 429;
      if (tentativa >= 3 || !transitoria) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * tentativa));
    }
  }
}

// Uma fonte pode ter o feed RSS próprio (url) e/ou uma busca no Google Notícias restrita ao site (googleSite);
// os itens dos dois entram juntos e a fonte conta como OK se ao menos um respondeu.
function origens(f) {
  const o = [];
  if (f.url) o.push({ url: f.url, google: !!f.google });
  if (f.googleSite) o.push({ url: urlGoogle(`${consultaGoogle(f)} when:2d`), google: true });
  return o;
}

// Busca todas as fontes em paralelo; devolve [{ itens, status }]
function buscarFeeds() {
  return Promise.all(
    feeds.map(async (f) => {
      let itens = [], total = 0, erros = [], ok = false;
      for (const o of origens(f)) {
        try {
          const lidos = parsear(await baixar(o.url), { ...f, google: o.google });
          total += lidos.length;
          itens.push(...lidos);
          ok = true;
        } catch (e) { erros.push(String(e.message || e)); }
      }
      const vistos = new Set(); // o mesmo link pode vir do RSS e do Google
      itens = itens.filter((i) => !vistos.has(i.id) && vistos.add(i.id));
      if (f.filtrar) itens = itens.filter(ehSeguranca);
      const status = { id: f.id, nome: f.nome, grupo: f.grupo, ok };
      return { itens, status: ok ? { ...status, total, relevantes: itens.length } : { ...status, erro: erros.join('; ') } };
    })
  );
}

async function atualizar() {
  const resultados = await buscarFeeds();
  const agora = new Date().toISOString();
  const adicionadas = [];
  for (const i of resultados.flatMap((r) => r.itens)) {
    if (!historico.has(i.id)) { historico.set(i.id, { ...i, coletadoEm: agora }); adicionadas.push(i.id); }
  }
  let itens = [...historico.values()].sort((a, b) => quando(b).localeCompare(quando(a)));
  const analise = await analisar(itens);
  if (analise) {
    for (const i of itens) Object.assign(i, analise.tags[i.id]);
    // Buscas do Google trazem ruído: sem nenhum tipo de crime reconhecido, não é segurança pública
    for (const i of itens) if (i.grupo === 'Google Notícias' && !(i.cats && i.cats.length)) historico.delete(i.id);
    // Fora do escopo (fora do RJ, exterior ou política partidária): fica no histórico, mas não aparece nem é exportado
    itens = itens.filter((i) => historico.has(i.id) && !i.exterior && !i.politica && i.uf === 'RJ');
  }
  salvarHistorico();
  const novas = adicionadas.filter((id) => historico.has(id)).length;
  cache = { itens, status: resultados.map((r) => r.status), stats: analise ? analise.stats : null, atualizadoEm: agora };
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${novas} novas; histórico: ${itens.length} notícias; fontes OK: ${cache.status.filter((s) => s.ok).length}/${feeds.length}`);
  for (const s of cache.status.filter((s) => !s.ok)) console.log(`  falhou: ${s.nome} (${s.erro})`);
}

// Mesmo formato que o coletar.js publica no GitHub Pages; só que localmente vai todo o histórico (sem janela de 30 dias)
const payloadNoticias = () => ({
  atualizadoEm: cache.atualizadoEm, janelaDias: null, status: cache.status,
  itens: cache.itens.map(saida),
});

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const estatico = (res, arquivo) => {
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] });
  res.end(fs.readFileSync(path.join(__dirname, arquivo)));
};

function json(req, res, obj) {
  const corpo = JSON.stringify(obj);
  const cab = { 'Content-Type': 'application/json; charset=utf-8' };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(200, { ...cab, 'Content-Encoding': 'gzip' });
    return res.end(zlib.gzipSync(corpo));
  }
  res.writeHead(200, cab);
  res.end(corpo);
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/data/noticias.json') return json(req, res, payloadNoticias());
  // Localmente as contagens vêm de todo o histórico em disco
  if (url.pathname === '/data/contagens.json') return json(req, res, { atualizadoEm: cache.atualizadoEm, dias: contar(cache.itens) });
  if (url.pathname === '/api/atualizar') {
    return atualizar().then(() => json(req, res, { atualizadoEm: cache.atualizadoEm }));
  }
  if (url.pathname === '/' || url.pathname === '/index.html') return estatico(res, 'index.html');
  if (['/xlsx.js', '/relatorio.js', '/logo.png', '/favicon.png', '/favicon-32.png', '/apple-touch-icon.png', '/og-image.png'].includes(url.pathname)) return estatico(res, url.pathname.slice(1));
  res.writeHead(404).end('Não encontrado');
});

module.exports = { parsear, feeds, buscarFeeds, analisar, ehSeguranca }; // reaproveitado por backfill.js e coletar.js

if (require.main === module) {
  atualizar().then(() => servidor.listen(PORTA, () => console.log(`Aberto em http://localhost:${PORTA}`)));
  setInterval(atualizar, INTERVALO_MS);
}
