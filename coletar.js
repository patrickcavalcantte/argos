// Coleta única (para o GitHub Actions): busca os feeds, classifica e grava os JSON publicados.
// Uso:  node coletar.js <pasta-de-dados> [--semente historico.json]
//
// Saída em <pasta>:
//   noticias.json        últimos 30 dias (o que o painel carrega direto) + lista dos meses do arquivo
//   arquivo/AAAA-MM.json notícias mais antigas, até 1 ano, um arquivo por mês (carregado sob demanda)
//   contagens.json       contagens diárias acumuladas, sem limite
// --semente: importa um histórico local; as contagens saem de todo ele, as notícias de até 1 ano.
const fs = require('fs');
const path = require('path');
const { buscarFeeds, analisar, feeds, ehSeguranca } = require('./server.js');
const { DIAS_JANELA, ARQUIVO_DIAS, quando, bruto, saida, limiteJanela, limiteArquivo, mesDe, contar } = require('./dados.js');

const dir = process.argv[2] || 'dados';
const dirArquivo = path.join(dir, 'arquivo');
const iSemente = process.argv.indexOf('--semente');
const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };
const gravar = (arq, obj) => { fs.writeFileSync(arq + '.tmp', JSON.stringify(obj)); fs.renameSync(arq + '.tmp', arq); };

// Fontes gerais só valem pelo filtro de palavras-chave; reaplicá-lo aqui limpa também o que entrou com regras antigas
const feedsAtuais = new Set(feeds.map((f) => f.id));
const soSeguranca = new Set(feeds.filter((f) => f.filtrar).map((f) => f.id));

// Classifica e aplica os mesmos descartes do servidor local
async function classificar(brutos) {
  brutos = brutos.filter((i) => feedsAtuais.has(i.fonteId) && (!soSeguranca.has(i.fonteId) || ehSeguranca(i))); // fontes removidas do feeds.json saem dos dados
  const itens = brutos.sort((a, b) => quando(b).localeCompare(quando(a)));
  const analise = await analisar(itens);
  if (!analise) throw new Error('a análise (analise.py) falhou; nada foi publicado');
  return itens
    .map((i) => ({ ...i, ...analise.tags[i.id] }))
    .filter((i) => !(i.grupo === 'Google Notícias' && !((i.cats && i.cats.length) || (i.ind && i.ind.length))) && !i.exterior && !i.politica && i.uf === 'RJ'); // escopo: só o estado do Rio de Janeiro
}

// Junta itens (já no formato de saída) aos arquivos mensais; ao final, apaga meses além de 1 ano
function arquivar(itens) {
  fs.mkdirSync(dirArquivo, { recursive: true });
  const porMes = {};
  for (const i of itens) (porMes[mesDe(i)] ??= []).push(i);
  for (const [mes, novos] of Object.entries(porMes)) {
    const arq = path.join(dirArquivo, mes + '.json');
    const mapa = new Map(lerJson(arq, { itens: [] }).itens.map((i) => [i.link, i]));
    for (const i of novos) mapa.set(i.link, i);
    const lista = [...mapa.values()].sort((a, b) => quando(b).localeCompare(quando(a)));
    gravar(arq, { mes, itens: lista });
  }
  const corte = limiteArquivo().slice(0, 7);
  for (const f of fs.readdirSync(dirArquivo).filter((f) => /^\d{4}-\d{2}\.json$/.test(f))) {
    if (f.slice(0, 7) < corte) fs.unlinkSync(path.join(dirArquivo, f));
  }
  return fs.readdirSync(dirArquivo).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 7)).sort();
}

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const anterior = lerJson(path.join(dir, 'noticias.json'), { itens: [] });
  const contagens = lerJson(path.join(dir, 'contagens.json'), { dias: {} });
  const mapa = new Map();

  if (iSemente > 0) {
    const arq = process.argv[iSemente + 1];
    const todas = [];
    for (const i of lerJson(arq, [])) { mapa.set(i.id, bruto(i)); todas.push(bruto(i)); }
    console.log(`Semente: ${mapa.size} notícias de ${arq}`);
    const classificadas = await classificar(todas);
    Object.assign(contagens.dias, contar(classificadas));
    const lim = limiteJanela(), lim1a = limiteArquivo();
    const noArquivo = classificadas.filter((i) => quando(i) < lim && quando(i) >= lim1a).map(saida);
    console.log(`Semente: ${noArquivo.length} notícias de ${DIAS_JANELA} dias a ${ARQUIVO_DIAS} dias vão para o arquivo`);
    arquivar(noArquivo);
  }

  // Notícias da última coleta que saíram da janela de 30 dias passam para o arquivo do mês (já classificadas)
  const lim = limiteJanela();
  const saindo = anterior.itens.filter((i) => quando(i) < lim);
  for (const i of anterior.itens) if (quando(i) >= lim) mapa.set(i.link, bruto({ ...i, id: i.link }));

  const resultados = await buscarFeeds();
  const agora = new Date().toISOString();
  let novas = 0;
  for (const i of resultados.flatMap((r) => r.itens)) {
    if (!mapa.has(i.id)) { mapa.set(i.id, bruto({ ...i, coletadoEm: agora })); novas++; }
  }

  const itens = await classificar([...mapa.values()].filter((i) => quando(i) >= lim));
  // Os dias da janela são recalculados a cada coleta (notícias do mesmo dia ainda chegam); os mais antigos ficam congelados
  Object.assign(contagens.dias, contar(itens));

  const datas = itens.map((i) => i.data).filter(Boolean).sort();
  const status = resultados.map((r) => r.status);
  const ok = status.filter((s) => s.ok).length;
  if (!ok) throw new Error('nenhuma fonte respondeu; nada foi publicado');
  const meses = arquivar(saindo);
  gravar(path.join(dir, 'noticias.json'), {
    atualizadoEm: agora, janelaDias: DIAS_JANELA, arquivoDias: ARQUIVO_DIAS, arquivo: meses,
    de: datas[0] || null, ate: datas[datas.length - 1] || null, status, itens: itens.map(saida),
  });
  gravar(path.join(dir, 'contagens.json'), { atualizadoEm: agora, dias: contagens.dias });

  console.log(`${novas} novas; ${itens.length} notícias na janela de ${DIAS_JANELA} dias; ${saindo.length} foram para o arquivo (${meses.length} meses); ${Object.keys(contagens.dias).length} dias de contagens; fontes OK: ${ok}/${feeds.length}`);
  for (const s of status.filter((s) => !s.ok)) console.log(`  falhou: ${s.nome} (${s.erro})`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
