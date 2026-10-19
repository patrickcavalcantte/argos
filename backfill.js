// Preenche o histórico com notícias antigas usando as buscas do Google Notícias (after:/before:).
// Uso:  node backfill.js [inicio] [fim] [--fontes id1,id2]      ex.: node backfill.js 2026-01-01
//   --fontes: só essas fontes (padrão: todas que têm busca no Google Notícias)
// Fontes com googleSite começam com janelas de 7 dias; se uma busca atinge o limite de 100 itens do Google,
// a janela é dividida ao meio até chegar a 1 dia. As demais buscas são feitas dia a dia.
// IMPORTANTE: pare o servidor (server.js) antes; ele reescreve historico.json e sobrescreveria o resultado.
// Pode ser interrompido (Ctrl+C) e rodado de novo: continua de onde parou.
const fs = require('fs');
const path = require('path');
const { parsear, feeds, ehSeguranca } = require('./server.js');
const { consultaGoogle, urlGoogle } = require('./dados.js');

const ARQ_HISTORICO = path.join(__dirname, 'historico.json');
const ARQ_PROGRESSO = path.join(__dirname, 'backfill-progresso.json');
const CAMPOS = ['id', 'titulo', 'link', 'resumo', 'data', 'fonte', 'fonteId', 'grupo', 'fonteUf', 'coletadoEm'];
const PAUSA_MS = 1200;
const LIMITE_GOOGLE = 100; // o Google devolve no máximo 100 itens por busca
const JANELA_SITE = 7; // dias por busca nas fontes googleSite

const args = process.argv.slice(2);
const iFontes = args.indexOf('--fontes');
const ids = iFontes >= 0 ? new Set((args[iFontes + 1] || '').split(',')) : null;
const posicionais = args.filter((a, i) => !a.startsWith('--') && (iFontes < 0 || i !== iFontes + 1));
const inicio = posicionais[0] || '2026-01-01';
const fim = posicionais[1] || new Date().toISOString().slice(0, 10);
const buscas = feeds.filter((f) => (f.google || f.googleSite) && (!ids || ids.has(f.id)));
if (ids && buscas.length !== ids.size) console.log('Atenção: fontes não encontradas ou sem busca no Google:', [...ids].filter((id) => !buscas.some((f) => f.id === id)).join(', '));

const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };
const gravar = (arq, obj) => { fs.writeFileSync(arq + '.tmp', JSON.stringify(obj)); fs.renameSync(arq + '.tmp', arq); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const somarDia = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const historico = new Map(lerJson(ARQ_HISTORICO, []).map((i) => [i.id, i]));
const progresso = lerJson(ARQ_PROGRESSO, { feito: {}, cheias: [] });

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

let pedidos = 0, novas = 0, falhasSeguidas = 0;

// Busca a janela [ini, ini + n dias); se bater no limite do Google, divide ao meio
async function janela(f, ini, n) {
  const chave = n === 1 ? `${f.id}|${ini}` : `${f.id}|${ini}+${n}`; // chaves de 1 dia iguais às de antes
  if (progresso.feito[chave] !== undefined) return;
  let itens;
  try {
    itens = parsear(await buscar(urlGoogle(`${consultaGoogle(f)} after:${ini} before:${somarDia(ini, n)}`)), { ...f, google: true });
    falhasSeguidas = 0;
  } catch (e) {
    console.log(`  falhou ${chave}: ${e.message}`);
    if (++falhasSeguidas >= 10) { salvar(); console.log('Muitas falhas seguidas; parando. Rode de novo mais tarde.'); process.exit(1); }
    return;
  }
  const total = itens.length;
  if (f.filtrar) itens = itens.filter(ehSeguranca);
  const agora = new Date().toISOString();
  for (const i of itens) if (!historico.has(i.id)) { historico.set(i.id, { ...i, coletadoEm: agora }); novas++; }
  if (++pedidos % 20 === 0) { salvar(); console.log(`${ini} · ${f.id} · ${pedidos} pedidos · ${novas} notícias novas · histórico: ${historico.size}`); }
  await dormir(PAUSA_MS);
  if (total >= LIMITE_GOOGLE && n > 1) {
    const metade = Math.ceil(n / 2);
    await janela(f, ini, metade);
    await janela(f, somarDia(ini, metade), n - metade);
  } else if (total >= LIMITE_GOOGLE) progresso.cheias.push(chave);
  progresso.feito[chave] = total; // só depois das metades: se for interrompido, a janela inteira é refeita
}

(async () => {
  const dias = Math.round((new Date(fim) - new Date(inicio)) / 86400000) + 1;
  console.log(`Período ${inicio} → ${fim} (${dias} dias), ${buscas.length} fontes. Histórico atual: ${historico.size}.`);
  for (const f of buscas) {
    const passo = f.googleSite ? JANELA_SITE : 1;
    const antes = novas;
    for (let d = inicio; d <= fim; d = somarDia(d, passo)) await janela(f, d, Math.min(passo, Math.round((new Date(fim) - new Date(d)) / 86400000) + 1));
    salvar();
    console.log(`✓ ${f.nome}: ${novas - antes} notícias novas`);
  }
  salvar();
  console.log(`\nConcluído. ${novas} notícias novas; histórico: ${historico.size}.`);
  if (progresso.cheias.length) console.log(`${progresso.cheias.length} buscas de 1 dia atingiram o limite de ${LIMITE_GOOGLE} itens (cobertura parcial nesses dias).`);
})();
