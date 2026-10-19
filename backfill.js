// Preenche o histórico com notícias antigas usando as buscas do Google Notícias (after:/before:).
// Uso:  node backfill.js [inicio] [fim]      ex.: node backfill.js 2026-01-01
// IMPORTANTE: pare o servidor (server.js) antes; ele reescreve historico.json e sobrescreveria o resultado.
// Pode ser interrompido (Ctrl+C) e rodado de novo: continua de onde parou.
const fs = require('fs');
const path = require('path');
const { parsear, feeds } = require('./server.js');

const ARQ_HISTORICO = path.join(__dirname, 'historico.json');
const ARQ_PROGRESSO = path.join(__dirname, 'backfill-progresso.json');
const CAMPOS = ['id', 'titulo', 'link', 'resumo', 'data', 'fonte', 'fonteId', 'grupo', 'fonteUf', 'coletadoEm'];
const PAUSA_MS = 1200;
const LIMITE_GOOGLE = 100; // o Google devolve no máximo 100 itens por busca

const inicio = process.argv[2] || '2026-01-01';
const fim = process.argv[3] || new Date().toISOString().slice(0, 10);
const buscas = feeds.filter((f) => f.google);

const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };
const gravar = (arq, obj) => { fs.writeFileSync(arq + '.tmp', JSON.stringify(obj)); fs.renameSync(arq + '.tmp', arq); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const somarDia = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const historico = new Map(lerJson(ARQ_HISTORICO, []).map((i) => [i.id, i]));
const progresso = lerJson(ARQ_PROGRESSO, { feito: {}, cheias: [] });

function urlDaBusca(f, dia) {
  const q = decodeURIComponent(new URL(f.url).searchParams.get('q')).replace(/\s*when:\S+/, '');
  const termo = `${q} after:${dia} before:${somarDia(dia, 1)}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(termo)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

async function buscar(url) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 BuscadorSegurancaPublica/1.0' }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.text();
      if (r.status !== 429 && r.status < 500) throw new Error('HTTP ' + r.status);
    } catch (e) {
      if (tentativa === 3) throw e;
    }
    const espera = 30000 * 2 ** tentativa; // 30 s, 60 s, 120 s
    console.log(`  aguardando ${espera / 1000}s antes de tentar de novo…`);
    await dormir(espera);
  }
  throw new Error('sem resposta');
}

const salvar = () => { gravar(ARQ_HISTORICO, [...historico.values()].map((i) => Object.fromEntries(CAMPOS.map((c) => [c, i[c] ?? null])))); gravar(ARQ_PROGRESSO, progresso); };
process.on('SIGINT', () => { salvar(); console.log('\nInterrompido. Progresso salvo.'); process.exit(0); });

(async () => {
  const dias = [];
  for (let d = inicio; d <= fim; d = somarDia(d, 1)) dias.push(d);
  const total = dias.length * buscas.length;
  let feitos = 0, novas = 0, falhasSeguidas = 0;
  console.log(`Período ${inicio} → ${fim}: ${dias.length} dias × ${buscas.length} buscas = ${total} pedidos. Histórico atual: ${historico.size}.`);

  for (const dia of dias) {
    for (const f of buscas) {
      const chave = `${f.id}|${dia}`;
      feitos++;
      if (progresso.feito[chave] !== undefined) continue;
      try {
        const itens = parsear(await buscar(urlDaBusca(f, dia)), f);
        const agora = new Date().toISOString();
        for (const i of itens) if (!historico.has(i.id)) { historico.set(i.id, { ...i, coletadoEm: agora }); novas++; }
        progresso.feito[chave] = itens.length;
        if (itens.length >= LIMITE_GOOGLE) progresso.cheias.push(chave);
        falhasSeguidas = 0;
      } catch (e) {
        console.log(`  falhou ${chave}: ${e.message}`);
        if (++falhasSeguidas >= 10) { salvar(); console.log('Muitas falhas seguidas; parando. Rode de novo mais tarde.'); process.exit(1); }
      }
      if (feitos % 20 === 0) { salvar(); console.log(`${dia} · ${feitos}/${total} pedidos · ${novas} notícias novas · histórico: ${historico.size}`); }
      await dormir(PAUSA_MS);
    }
  }
  salvar();
  console.log(`\nConcluído. ${novas} notícias novas; histórico: ${historico.size}.`);
  if (progresso.cheias.length) console.log(`${progresso.cheias.length} buscas atingiram o limite de ${LIMITE_GOOGLE} itens (cobertura parcial nesses dias).`);
})();
