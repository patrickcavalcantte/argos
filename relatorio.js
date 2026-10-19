// Relatório preliminar de monitoramento de imprensa, gerado no navegador a partir das notícias já classificadas.
// gerarRelatorio(itens, { escopo, periodo, fontes, atualizadoEm }) devolve um documento HTML completo, pronto para imprimir / salvar em PDF.
(function (raiz) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n) => n.toLocaleString('pt-BR');
  const pct = (n, t) => (t ? Math.round((n * 100) / t) + '%' : '0%');
  const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const ord = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const seguro = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

  function barras(pares, max) {
    const lista = pares.slice(0, max || 10);
    const m = Math.max(1, ...lista.map((p) => p[1]));
    if (!lista.length) return '<p class="vazio">Sem registros no período.</p>';
    return lista.map(([nome, n]) => `<div class="barra"><span class="rot">${esc(nome)}</span><span class="trilho"><i style="width:${Math.max(2, (n * 100) / m)}%"></i></span><span class="val">${num(n)}</span></div>`).join('');
  }

  function gerarRelatorio(todas, op = {}) {
    const casos = todas.filter((i) => !i.dup);
    const mortes = casos.filter((i) => i.morte);
    const cats = {}, armas = {}, regs = {}, dias = {}, fontes = {}, ufs = {};
    for (const i of casos) {
      for (const c of i.cats || []) cats[c] = (cats[c] || 0) + 1;
      const r = i.regiao || (i.uf ? 'Sem região identificada' : 'Local não identificado');
      regs[r] = (regs[r] || 0) + 1;
      if (i.uf) ufs[i.uf] = (ufs[i.uf] || 0) + 1;
      if (i.data) { const d = i.data.slice(0, 10); dias[d] = (dias[d] || 0) + 1; }
    }
    for (const i of todas) fontes[i.fonte || '—'] = (fontes[i.fonte || '—'] || 0) + 1;
    for (const i of mortes) { const a = i.arma || 'Não informada'; armas[a] = (armas[a] || 0) + 1; }
    const comArma = mortes.filter((i) => i.arma).length;
    const datas = todas.map((i) => i.data).filter(Boolean).sort();
    const picoDia = ord(dias)[0];
    const topCat = ord(cats)[0], topArma = ord(armas).filter(([a]) => a !== 'Não informada')[0], topReg = ord(regs)[0];

    const resumo = [];
    resumo.push(`No período, o monitoramento reuniu <b>${num(todas.length)} notícias</b> de ${num(Object.keys(fontes).length)} veículos, que correspondem a <b>${num(casos.length)} casos distintos</b> (as demais são repetições do mesmo fato por outros veículos).`);
    if (casos.length) resumo.push(`<b>${num(mortes.length)} casos (${pct(mortes.length, casos.length)})</b> envolvem morte${mortes.length ? `; em ${num(comArma)} deles a notícia informa o meio utilizado` : ''}.`);
    if (topCat) resumo.push(`O tipo de ocorrência mais frequente é <b>${esc(topCat[0])}</b> (${num(topCat[1])} casos, ${pct(topCat[1], casos.length)}).`);
    if (topArma) resumo.push(`Entre as mortes com meio identificado, predomina <b>${esc(topArma[0])}</b> (${num(topArma[1])}).`);
    if (topReg && topReg[0] !== 'Local não identificado') resumo.push(`A região com mais registros é <b>${esc(topReg[0])}</b> (${num(topReg[1])} casos).`);
    if (picoDia) resumo.push(`O dia de maior volume foi <b>${dataBr(picoDia[0] + 'T12:00')}</b>, com ${num(picoDia[1])} casos.`);

    const LIM_MORTES = 300, LIM_CASOS = 400;
    const linha = (i) => `<tr><td class="nw">${dataBr(i.data)}</td><td>${esc(i.regiao || i.uf || '—')}</td><td><a href="${esc(seguro(i.link))}">${esc(i.titulo)}</a></td><td>${esc(i.fonte || '')}</td><td>${esc((i.cats || []).join('; '))}</td></tr>`;
    const porData = (a, b) => (b.data || '').localeCompare(a.data || '');
    const cabecalho = '<thead><tr><th>Data</th><th>Local</th><th>Notícia</th><th>Fonte</th><th>Tipo</th></tr></thead>';
    const outros = casos.filter((i) => !i.morte).sort(porData);
    const mortesOrd = mortes.slice().sort(porData);

    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório preliminar · ${esc(op.escopo || 'Argos')}</title>
<style>
  :root { --verm: #c0392b; --txt: #1b1f24; --suave: #6b7480; --borda: #dfe3e8; --fundo: #f6f7f9; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--txt); margin: 0; background: #fff; }
  .pagina { max-width: 900px; margin: 0 auto; padding: 32px 28px 60px; }
  .barra-topo { position: sticky; top: 0; background: #fff; border-bottom: 1px solid var(--borda); padding: 10px 28px; display: flex; gap: 12px; align-items: center; justify-content: space-between; }
  .barra-topo button { font: inherit; padding: 7px 16px; border: 0; border-radius: 8px; background: var(--verm); color: #fff; cursor: pointer; }
  .barra-topo span { color: var(--suave); font-size: 13px; }
  header.capa { border-bottom: 3px solid var(--verm); padding-bottom: 14px; margin-bottom: 20px; }
  header.capa .marca { color: var(--verm); font-weight: 700; letter-spacing: .08em; font-size: 12px; text-transform: uppercase; }
  h1 { margin: 4px 0 6px; font-size: 24px; letter-spacing: -.3px; }
  header.capa p { margin: 0; color: var(--suave); }
  h2 { font-size: 16px; margin: 28px 0 10px; padding-bottom: 4px; border-bottom: 1px solid var(--borda); }
  .kpis { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0; }
  .kpi { border: 1px solid var(--borda); border-radius: 10px; padding: 10px 16px; min-width: 130px; background: var(--fundo); }
  .kpi b { display: block; font-size: 22px; }
  .kpi span { color: var(--suave); font-size: 12px; }
  ul.resumo { padding-left: 20px; } ul.resumo li { margin: 6px 0; }
  .duas { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 28px; }
  .barra { display: grid; grid-template-columns: 150px 1fr 40px; gap: 8px; align-items: center; padding: 2px 0; font-size: 13px; }
  .barra .rot { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trilho { background: var(--fundo); border-radius: 3px; height: 12px; display: block; }
  .trilho i { display: block; height: 100%; background: var(--verm); border-radius: 3px; }
  .val { text-align: right; color: var(--suave); font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; background: var(--fundo); padding: 6px 8px; border-bottom: 1px solid var(--borda); }
  td { padding: 5px 8px; border-bottom: 1px solid var(--borda); vertical-align: top; }
  td a { color: var(--txt); text-decoration: none; } td a:hover { text-decoration: underline; }
  .nw { white-space: nowrap; }
  .nota { color: var(--suave); font-size: 12px; }
  .vazio { color: var(--suave); }
  .aviso { background: var(--fundo); border-left: 3px solid var(--verm); padding: 10px 14px; font-size: 12.5px; color: var(--suave); border-radius: 0 6px 6px 0; }
  h2, .kpis, tr { break-inside: avoid; } h2 { break-after: avoid; }
  @media print { .barra-topo { display: none; } .pagina { padding: 0; max-width: none; } a { color: inherit; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @media (max-width: 640px) { .duas { grid-template-columns: 1fr; } }
</style></head><body>
<div class="barra-topo"><span>Pré-visualização do relatório</span><button onclick="window.print()">Imprimir / salvar em PDF</button></div>
<div class="pagina">
<header class="capa">
  <div class="marca">Argos · Monitoramento de imprensa</div>
  <h1>Relatório preliminar — ${esc(op.escopo || 'Brasil')}</h1>
  <p>Período: <b>${esc(op.periodo || '—')}</b>${datas.length ? ` · notícias de ${dataBr(datas[0])} a ${dataBr(datas[datas.length - 1])}` : ''}<br>
  Gerado em ${dataHora(new Date().toISOString())}${op.atualizadoEm ? ` · última coleta: ${dataHora(op.atualizadoEm)}` : ''}</p>
</header>

<h2>1. Síntese</h2>
${casos.length ? `<ul class="resumo">${resumo.map((r) => `<li>${r}</li>`).join('')}</ul>` : '<p class="vazio">Nenhuma notícia encontrada para o recorte escolhido.</p>'}
<div class="kpis">
  <div class="kpi"><b>${num(todas.length)}</b><span>notícias</span></div>
  <div class="kpi"><b>${num(casos.length)}</b><span>casos distintos</span></div>
  <div class="kpi"><b>${num(mortes.length)}</b><span>casos com morte</span></div>
  <div class="kpi"><b>${num(comArma)}</b><span>mortes com meio identificado</span></div>
</div>

<h2>2. Panorama</h2>
<div class="duas">
  <div><b>Casos por tipo de ocorrência</b><div class="nota">Um caso pode ter mais de um tipo.</div>${barras(ord(cats), 12)}</div>
  <div><b>Mortes por meio utilizado</b><div class="nota">Conforme descrito no texto da notícia.</div>${barras(ord(armas), 8)}</div>
  <div><b>Casos por região</b>${barras(ord(regs), 10)}</div>
  <div><b>Casos por dia</b>${barras(Object.entries(dias).sort().reverse().map(([d, n]) => [new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }), n]), 10)}</div>
  ${Object.keys(ufs).length > 1 ? `<div><b>Casos por estado</b>${barras(ord(ufs), 10)}</div>` : ''}
  <div><b>Veículos com mais notícias</b>${barras(ord(fontes), 10)}</div>
</div>

<h2>3. Casos com morte</h2>
${mortesOrd.length ? `<table>${cabecalho}<tbody>${mortesOrd.slice(0, LIM_MORTES).map(linha).join('')}</tbody></table>${mortesOrd.length > LIM_MORTES ? `<p class="nota">Mostrando os ${LIM_MORTES} mais recentes de ${num(mortesOrd.length)}. A lista completa está na exportação XLSX.</p>` : ''}` : '<p class="vazio">Nenhum caso com morte no período.</p>'}

<h2>4. Demais ocorrências</h2>
${outros.length ? `<table>${cabecalho}<tbody>${outros.slice(0, LIM_CASOS).map(linha).join('')}</tbody></table>${outros.length > LIM_CASOS ? `<p class="nota">Mostrando as ${LIM_CASOS} mais recentes de ${num(outros.length)}. A lista completa está na exportação XLSX.</p>` : ''}` : '<p class="vazio">Sem outras ocorrências.</p>'}

<h2>5. Metodologia e limitações</h2>
<div class="aviso">
  Relatório <b>preliminar e automatizado</b>, produzido a partir de ${num(op.fontes || Object.keys(fontes).length)} fontes de imprensa (RSS e Google Notícias). A classificação (tipo de ocorrência, meio utilizado, local e morte) é feita por palavras-chave sobre título e resumo, e <b>pode conter erros</b>; casos repetidos por vários veículos são agrupados e contados uma vez. Não é estatística oficial, não substitui dados dos órgãos de segurança e as informações devem ser verificadas nas matérias originais (links acima). Notícias sem local identificável não entram nos recortes por região e estado. O conteúdo pertence aos veículos de origem.
</div>
</div></body></html>`;
  }

  raiz.gerarRelatorio = gerarRelatorio;
  if (typeof module !== 'undefined') module.exports = { gerarRelatorio };
})(typeof window !== 'undefined' ? window : globalThis);
