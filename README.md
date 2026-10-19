# Argos

Monitor de notícias de segurança pública no Brasil. O Argos reúne dezenas de fontes num painel único, filtra o que é segurança pública, classifica cada notícia e agrupa as repetições do mesmo caso, transformando o fluxo disperso de notícias de crime em dados comparáveis.

**Painel online:** https://patrickcavalcantte.github.io/argos/

## O que ele faz

- **Coleta** 33 fontes: grandes portais, mídia independente e buscas no Google Notícias.
- **Filtra** o que é segurança pública (por palavras-chave) e descarta política partidária e notícias do exterior.
- **Classifica** cada notícia por tipo de crime, arma envolvida, estado e região, e se houve morte.
- **Agrupa duplicatas:** várias matérias sobre o mesmo fato contam como um único caso.
- **Painel** com lista de notícias, busca, filtros por fonte, favoritos e "não lidos".
- **Análise** por tipo de crime, arma, estado, região e dia, mais a evolução mensal de casos.
- **Exporta** o período escolhido em **CSV** ou **XLSX** (com links clicáveis nas notícias).

## Como funciona online

```
GitHub Actions (todo dia, 06h Brasília)
   └─ coletar.js ── busca os feeds ── analise.py (classifica) ──┐
                                                                ▼
                        branch gh-pages: noticias.json + contagens.json
                                                                ▼
                          GitHub Pages ── index.html lê os JSON
```

- O workflow `.github/workflows/coletar.yml` roda uma vez por dia (e manualmente, em **Actions → Coletar e publicar → Run workflow**).
- As notícias ficam disponíveis por **30 dias** (`data/noticias.json`). Quem precisar guardar mais deve exportar CSV/XLSX periodicamente.
- Só as **contagens diárias** (casos, mortes e totais por estado, tipo de crime e arma) são acumuladas sem limite (`data/contagens.json`). Elas alimentam o gráfico "Casos por mês" da aba Análise.
- A branch `gh-pages` recebe sempre um único commit, sobrescrito a cada coleta, então o repositório não cresce.
- O painel online é estático: não há servidor, nem botão "Atualizar", nem login. Todo o conteúdo é público.

## Rodar localmente

Requisitos: **Node 18+** e **Python 3** (só biblioteca padrão; nenhuma dependência para instalar).

```
node server.js
```

Abre em http://localhost:3737. O servidor local:

- busca os feeds ao iniciar e a cada 24 horas, e tem o botão **Atualizar**;
- guarda o **histórico completo** em `historico.json` (não vai para o git);
- usa a mesma tela e o mesmo formato de dados do painel online.

Para preencher notícias antigas pelo Google Notícias: `node backfill.js [inicio] [fim]` (pare o servidor antes).

Variáveis opcionais: `PORT` (padrão 3737), `PYTHON` (comando do Python, padrão `python`), `HISTORICO` (caminho do histórico).

## Adicionar ou alterar fontes

Edite `feeds.json`. Cada fonte tem:

| Campo | Significado |
|---|---|
| `id`, `nome`, `grupo` | identificação e agrupamento no menu |
| `url` | feed RSS/Atom |
| `filtrar` | `true` aplica o filtro de palavras-chave de segurança pública; `false` aceita tudo |
| `google` | `true` para buscas do Google Notícias (o título vem como "Manchete - Veículo") |
| `uf` | estado da fonte, usado como pista quando a notícia não cita o local |

Alguns sites bloqueiam os IPs de datacenter do GitHub (erro 403). Nesse caso a fonte funciona localmente, mas falha na coleta online; uma busca do Google Notícias restrita ao domínio (`site:exemplo.com.br`) costuma resolver.

## Publicar a sua própria cópia

1. Faça um fork do repositório.
2. Em **Settings → Pages**, escolha a branch `gh-pages` (pasta `/`). Ela é criada na primeira execução do workflow.
3. Em **Actions**, rode **Coletar e publicar** uma vez. Dali em diante ele roda sozinho todo dia.

Para começar com histórico, rode `node coletar.js <pasta> --semente historico.json` e publique a pasta na `gh-pages` (as notícias da semente entram só pelos últimos 30 dias; as contagens, por todo o período).

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | painel (lista, análise e exportações no navegador) |
| `xlsx.js` | gerador de XLSX sem dependências, usado no navegador |
| `feeds.json` | fontes monitoradas |
| `analise.py` | classificação por palavras-chave (crime, arma, estado, duplicatas) |
| `municipios.json` | municípios, para identificar o estado pelo texto |
| `coletar.js` | coleta única, usada pelo GitHub Actions |
| `dados.js` | formato dos dados publicados e cálculo das contagens |
| `server.js` | servidor local |
| `backfill.js` | preenche notícias antigas |
| `.github/workflows/coletar.yml` | coleta e publicação diárias |

## Limitações

- A classificação é feita por **palavras-chave** sobre título e resumo. É uma estimativa, **não estatística oficial**: pode errar o tipo de crime, o estado ou a existência de morte.
- Notícias sem local identificável ficam de fora dos gráficos por estado.
- O RSS dos portais mostra só as notícias mais recentes. Com coleta diária, um portal que publica muito pode ter itens que passam sem ser coletados.
- O conteúdo das notícias pertence aos veículos de origem. O Argos guarda apenas título, resumo curto e link, e o painel leva o leitor à matéria original.
