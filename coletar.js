// Coleta única (para o GitHub Actions): busca os feeds, classifica e grava os JSON publicados.
// Uso:  node coletar.js <pasta-de-dados> [--semente historico.json]
// --semente: importa um histórico local; as contagens diárias saem de todo ele e as notícias só dos últimos 30 dias.
const fs = require('fs');
const path = require('path');
const { buscarFeeds, analisar, feeds } = require('./server.js');
const { DIAS_JANELA, quando, bruto, saida, naJanela, contar } = require('./dados.js');

const dir = process.argv[2] || 'dados';
const iSemente = process.argv.indexOf('--semente');
const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };
const gravar = (arq, obj) => { fs.writeFileSync(arq + '.tmp', JSON.stringify(obj)); fs.renameSync(arq + '.tmp', arq); };

// Classifica e aplica os mesmos descartes do servidor local
async function classificar(brutos) {
  const itens = brutos.sort((a, b) => quando(b).localeCompare(quando(a)));
  const analise = await analisar(itens);
  if (!analise) throw new Error('a análise (analise.py) falhou; nada foi publicado');
  return itens
    .map((i) => ({ ...i, ...analise.tags[i.id] }))
    .filter((i) => !(i.grupo === 'Google Notícias' && !(i.cats && i.cats.length)) && !i.exterior && !i.politica);
}

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const anterior = lerJson(path.join(dir, 'noticias.json'), { itens: [] });
  const contagens = lerJson(path.join(dir, 'contagens.json'), { dias: {} });
  const mapa = new Map();

  if (iSemente > 0) {
    const arq = process.argv[iSemente + 1];
    for (const i of lerJson(arq, [])) mapa.set(i.id, bruto(i));
    console.log(`Semente: ${mapa.size} notícias de ${arq}`);
    Object.assign(contagens.dias, contar(await classificar([...mapa.values()])));
  }
  for (const i of anterior.itens) mapa.set(i.link, bruto({ ...i, id: i.link }));

  const resultados = await buscarFeeds();
  const agora = new Date().toISOString();
  let novas = 0;
  for (const i of resultados.flatMap((r) => r.itens)) {
    if (!mapa.has(i.id)) { mapa.set(i.id, bruto({ ...i, coletadoEm: agora })); novas++; }
  }

  const itens = await classificar(naJanela([...mapa.values()]));
  // Os dias da janela são recalculados a cada coleta (notícias do mesmo dia ainda chegam); os mais antigos ficam congelados
  Object.assign(contagens.dias, contar(itens));

  const datas = itens.map((i) => i.data).filter(Boolean).sort();
  const status = resultados.map((r) => r.status);
  const ok = status.filter((s) => s.ok).length;
  if (!ok) throw new Error('nenhuma fonte respondeu; nada foi publicado');
  gravar(path.join(dir, 'noticias.json'), {
    atualizadoEm: agora, janelaDias: DIAS_JANELA, de: datas[0] || null, ate: datas[datas.length - 1] || null,
    status, itens: itens.map(saida),
  });
  gravar(path.join(dir, 'contagens.json'), { atualizadoEm: agora, dias: contagens.dias });

  console.log(`${novas} novas; ${itens.length} notícias na janela de ${DIAS_JANELA} dias; ${Object.keys(contagens.dias).length} dias de contagens; fontes OK: ${ok}/${feeds.length}`);
  for (const s of status.filter((s) => !s.ok)) console.log(`  falhou: ${s.nome} (${s.erro})`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
