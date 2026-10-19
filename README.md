# Argos

Monitor de notícias de segurança pública. Coleta 31 fontes (portais, mídia independente e buscas no Google Notícias), classifica cada notícia por tipo de crime, arma, estado e se houve morte, agrupa as duplicatas do mesmo caso e mostra tudo num painel com busca, filtros, análise e exportação em CSV e XLSX (com links clicáveis).

**Painel online:** https://patrickcavalcantte.github.io/argos/

## Como funciona online

- Um workflow do GitHub Actions (`.github/workflows/coletar.yml`) roda uma vez por dia, executa `coletar.js` e publica o resultado na branch `gh-pages`.
- As notícias ficam disponíveis por **30 dias** (`noticias.json`). Quem precisar guardar mais deve exportar CSV/XLSX periodicamente.
- Só as **contagens diárias** (casos, mortes, por estado, tipo de crime e arma) são acumuladas sem limite (`contagens.json`), para mostrar a evolução por mês.

## Rodar localmente

Precisa de Node 18+ e Python 3 (só biblioteca padrão).

```
node server.js    # http://localhost:3737
```

O servidor local guarda o histórico completo em `historico.json` e tem o botão "Atualizar". `node backfill.js` preenche notícias antigas pelo Google Notícias.

## Arquivos

| Arquivo | Função |
|---|---|
| `feeds.json` | fontes monitoradas |
| `analise.py` | classificação por palavras-chave (crime, arma, estado, duplicatas) |
| `coletar.js` | coleta única usada pelo Actions |
| `server.js` | servidor local |
| `dados.js` | formato dos dados publicados e contagens |
| `xlsx.js` | gerador de XLSX (sem dependências) |
| `index.html` | painel |

A classificação é uma estimativa por palavras-chave sobre título e resumo, não estatística oficial.
