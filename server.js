// Servidor local do buscador de notícias de segurança pública.
// Uso: node server.js  ->  http://localhost:3737
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const zlib = require('zlib');
const path = require('path');
const { gerarXlsx } = require('./xlsx');

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
  'chacina', 'refem', 'rebelia', 'homicida', 'criminos', 'crime', 'suspeito', 'vitima', 'habeas corpus',
  'golpe', 'estelionato', 'fraude', 'corrupcao'
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
const CAMPOS_BRUTOS = ['id', 'titulo', 'link', 'resumo', 'data', 'fonte', 'fonteId', 'grupo', 'fonteUf', 'coletadoEm'];
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
const quando = (i) => i.data || i.coletadoEm || '';

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

async function atualizar() {
  const resultados = await Promise.all(
    feeds.map(async (f) => {
      try {
        let texto;
        for (let tentativa = 1; ; tentativa++) {
          try {
            const r = await fetch(f.url, {
              headers: { 'User-Agent': 'Mozilla/5.0 BuscadorSegurancaPublica/1.0', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
              signal: AbortSignal.timeout(15000),
              redirect: 'follow',
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            texto = await r.text();
            break;
          } catch (e) {
            // Só repete falhas transitórias (timeout, rede, 5xx/429); 403/404 não adianta insistir
            const m = /^HTTP (\d+)/.exec(e.message);
            const transitoria = !m || +m[1] >= 500 || +m[1] === 429;
            if (tentativa >= 3 || !transitoria) throw e;
            await new Promise((ok) => setTimeout(ok, 2000 * tentativa));
          }
        }
        let itens = parsear(texto, f);
        const total = itens.length;
        if (f.filtrar) itens = itens.filter(ehSeguranca);
        return { itens, status: { id: f.id, nome: f.nome, grupo: f.grupo, ok: true, total, relevantes: itens.length } };
      } catch (e) {
        return { itens: [], status: { id: f.id, nome: f.nome, grupo: f.grupo, ok: false, erro: String(e.message || e) } };
      }
    })
  );
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
    // Fora do escopo (exterior ou política partidária): fica no histórico, mas não aparece nem é exportado
    itens = itens.filter((i) => historico.has(i.id) && !i.exterior && !i.politica);
  }
  salvarHistorico();
  const novas = adicionadas.filter((id) => historico.has(id)).length;
  cache = { itens, status: resultados.map((r) => r.status), stats: analise ? analise.stats : null, atualizadoEm: agora };
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${novas} novas; histórico: ${itens.length} notícias; fontes OK: ${cache.status.filter((s) => s.ok).length}/${feeds.length}`);
  for (const s of cache.status.filter((s) => !s.ok)) console.log(`  falhou: ${s.nome} (${s.erro})`);
}

const CAMPOS_CSV = ['data', 'fonte', 'grupo', 'titulo', 'resumo', 'link', 'uf', 'regiao', 'categorias', 'arma', 'morte', 'duplicata', 'caso', 'coletadoEm'];
const celula = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\s+/g, ' ')}"`;

// Filtra por período: 'horas' (últimas N horas) ou intervalo 'de'/'ate' (AAAA-MM-DD)
function noPeriodo(horas, de, ate) {
  const limite = horas ? Date.now() - horas * 3600000 : 0;
  return cache.itens
    .filter((i) => !limite || new Date(quando(i)) >= limite)
    .filter((i) => !de || quando(i).slice(0, 10) >= de)
    .filter((i) => !ate || quando(i).slice(0, 10) <= ate);
}

// Só os campos que a tela usa (o link já serve de identificador)
const CAMPOS_TELA = ['titulo', 'link', 'resumo', 'data', 'fonte', 'fonteId', 'grupo', 'cats', 'arma', 'uf', 'morte', 'dup'];
const paraTela = (i) => Object.fromEntries(CAMPOS_TELA.filter((c) => i[c] != null && !(Array.isArray(i[c]) && !i[c].length)).map((c) => [c, i[c]]));

function valorCampo(i, c) {
  if (c === 'categorias') return (i.cats || []).join('; ');
  if (c === 'duplicata' || c === 'morte') return (c === 'duplicata' ? i.dup : i.morte) ? 'sim' : 'nao';
  return i[c];
}
const nomeCampo = (c) => (c === 'coletadoEm' ? 'coletado_em' : c);

function gerarCsv(horas, de, ate) {
  const linhas = noPeriodo(horas, de, ate).map((i) => CAMPOS_CSV.map((c) => celula(valorCampo(i, c))).join(','));
  // BOM para o Excel reconhecer UTF-8
  return '﻿' + [CAMPOS_CSV.map(nomeCampo).join(','), ...linhas].join('\r\n');
}

function gerarPlanilha(horas, de, ate) {
  const larguras = { data: 20, fonte: 22, grupo: 18, titulo: 70, resumo: 50, link: 45, categorias: 28, coletadoEm: 20 };
  return gerarXlsx(
    CAMPOS_CSV.map(nomeCampo),
    noPeriodo(horas, de, ate).map((i) => CAMPOS_CSV.map((c) => valorCampo(i, c) ?? '')),
    CAMPOS_CSV.indexOf('link'),
    CAMPOS_CSV.map((c) => larguras[c] || 12)
  );
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/exportar.csv') {
    const nome = `argos-${new Date().toISOString().slice(0, 10)}.csv`;
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"` });
    return res.end(gerarCsv(+url.searchParams.get('horas') || 0, url.searchParams.get('de') || '', url.searchParams.get('ate') || ''));
  }
  if (url.pathname === '/api/exportar.xlsx') {
    const nome = `argos-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nome}"` });
    return res.end(gerarPlanilha(+url.searchParams.get('horas') || 0, url.searchParams.get('de') || '', url.searchParams.get('ate') || ''));
  }
  if (url.pathname === '/api/noticias') {
    const q = url.searchParams;
    const itens = noPeriodo(+q.get('horas') || 0, q.get('de') || '', q.get('ate') || '').map(paraTela);
    const corpo = JSON.stringify({ itens, total: cache.itens.length, status: cache.status, atualizadoEm: cache.atualizadoEm });
    const cab = { 'Content-Type': 'application/json; charset=utf-8' };
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.writeHead(200, { ...cab, 'Content-Encoding': 'gzip' });
      return res.end(zlib.gzipSync(corpo));
    }
    res.writeHead(200, cab);
    return res.end(corpo);
  }
  if (url.pathname === '/api/atualizar') {
    return atualizar().then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(cache));
    });
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }
  res.writeHead(404).end('Não encontrado');
});

module.exports = { parsear, feeds }; // reaproveitado por backfill.js

if (require.main === module) {
  atualizar().then(() => servidor.listen(PORTA, () => console.log(`Aberto em http://localhost:${PORTA}`)));
  setInterval(atualizar, INTERVALO_MS);
}
