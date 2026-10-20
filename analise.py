"""Classifica notícias por tipo de crime, arma e estado, e calcula estatísticas.

Entrada (stdin):  JSON {"itens": [{id, titulo, resumo, data, fonteUf?}, ...]}
Saída (stdout):   JSON {"tags": {id: {cats, arma, uf}}, "stats": {...}}
Só usa a biblioteca padrão.
"""
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


# ---------- Categorias de crime (aplicadas ao texto em minúsculas, sem acento) ----------
CATEGORIAS = {
    "Homicídio / morte": r"\b(morto|morta|mortos|mortas|morre|morreu|morrem|morte|mortes|assassinad\w*|assassinat\w*|homicid\w*|matou|matar|mata|latrocini\w*|feminicidi\w*|chacina|execucao|executad\w*|encontrad[oa]s? morto|corpo)\b",
    "Roubo / assalto": r"\b(roubo|roubos|roubar|roubou|assalt\w*|arrastao|latrocini\w*)\b",
    "Furto": r"\b(furto|furtos|furtar|furtou|furtad\w*)\b",
    "Tiroteio / baleados": r"\b(tiroteio|balead\w*|balead[oa]s|bala perdida|a tiros|tiros|disparos?|atirou|atiraram)\b",
    "Tráfico de drogas": r"\b(trafic\w*|drogas?|cocaina|maconha|crack|entorpecente\w*|entorpecentes)\b",
    "Facção / milícia": r"\b(faccao|faccoes|milicia\w*|miliciano\w*|crime organizado|pcc|comando vermelho|cv)\b",
    "Violência sexual": r"\b(estupr\w*|abuso sexual|importunacao sexual)\b",
    "Violência doméstica": r"\b(feminicidi\w*|violencia domestica|maria da penha|medida protetiva|agressao contra a mulher)\b",
    "Sequestro": r"\b(sequestr\w*|carcere privado|refem|refens)\b",
    "Golpe / fraude": r"\b(golp(?!e de estado|e militar|ismo|ista)\w*|estelionat\w*|fraude\w*)\b",
    "Violência policial": r"\b(morto pela (pm|policia)|morto em confronto|morre em confronto|confronto com a (pm|policia)|intervencao policial|letalidade policial|abordagem policial|agente\w* mata\w*|policial\w* (mata|matou|atira|atirou))\b",
    # "operação" sozinha é ambígua (Operação Navio, operação financeira): só conta com contexto policial
    "Prisão / operação": r"\b(preso|presa|presos|presas|prisao|prisoes|prende\w*|mandados?|flagrante|foragid\w*|apreend\w*|apreensao|detid\w*)\b",
}
OPERACAO = re.compile(r"\boperacao\b")
CONTEXTO_POLICIAL = re.compile(r"\b(policia\w*|pf|pm|prf|civil|militar|federal|gaeco|ministerio publico|deflagr\w*|trafic\w*|apreend\w*|mandados?|prende\w*|presos?|milicia\w*|faccao)\b")
# Notícia política (campanha, discurso): "prisão" ali é opinião, não ocorrência
POLITICA = re.compile(r"\b(lula|bolsonaro|pec da seguranca|candidat\w*|eleica\w*|campanha|segundo turno|2o turno|senado|congresso|deputad\w*|governador\w*|discurso|debate)\b")
# Política partidária/eleitoral: nomes e termos de campanha. Sem nenhum fato criminal (morte, roubo, tiroteio...),
# a notícia não é segurança pública, mesmo que fale de "crime", "PF" ou "golpe".
POLITICA_FORTE = re.compile(r"\b(lula|bolsonaro|flavio|michelle|moraes|janja|valdemar|planalto|stf|congresso|senado|camara dos deputados|segundo turno|primeiro turno|2o turno|1o turno|eleicao|eleicoes|eleitoral|eleitores?|partido|pesquisa quaest|pesquisa datafolha|tse|governo federal|emendas?|cartel)\b")
CATS_FATO = {"Homicídio / morte", "Roubo / assalto", "Furto", "Tiroteio / baleados", "Violência sexual", "Violência doméstica", "Sequestro"}
TENTATIVA = re.compile(r"\btentativas? de (homicidio|assassinato|latrocinio|feminicidio|morte)\b")

MORTE = re.compile(CATEGORIAS["Homicídio / morte"] + r"|\bmortal\b")
MORTE_FORTE = re.compile(r"\b(morto|morta|mortos|mortas|morre|morreu|morrem|morte|mortes|assassinad\w*|assassinat\w*|homicid\w*|matou|matar|latrocini\w*|feminicidi\w*|chacina|execucao|executad\w*)\b")

ARMAS = [
    ("Arma de fogo", r"\b(tiro|tiros|balead\w*|balead[oa]s|bala|balas|disparo|disparos|fuzil|fuzis|pistola|revolver|arma de fogo|armas de fogo|metralhadora|atirou|atiraram|a tiros)\b"),
    ("Arma branca", r"\b(faca|facas|facada|facadas|esfaque\w*|punhal|facao|canivete|arma branca|armas brancas|estoc\w*|golpes? de faca|golpeado)\b"),
    ("Agressão física", r"\b(espanc\w*|agredid\w*|pauladas?|socos?|chutes?|pedrada\w*|marteladas?|barra de ferro)\b"),
    ("Atropelamento", r"\b(atropel\w*)\b"),
    ("Asfixia / enforcamento", r"\b(enforcad\w*|estrangul\w*|asfixi\w*|afogad\w*)\b"),
    ("Fogo / incêndio", r"\b(incendi\w*|queimad[oa]s?|carbonizad\w*)\b"),
]
ARMAS = [(n, re.compile(p)) for n, p in ARMAS]
CATEGORIAS_RE = {n: re.compile(p) for n, p in CATEGORIAS.items()}

# ---------- Indicadores de monitoramento (uma notícia pode ter mais de um) ----------
IND_POLICIAMENTO = "Ações de policiamento"
IND_ATAQUES = "Ações e ataques criminais"
IND_MULHER = "Violência contra a mulher"
IND_CRIANCA = "Violência contra criança e adolescente"
IND_AGENTE = "Vitimização de agente"
IND_CHACINA = "Chacina e tentativa de chacina"
IND_LINCHAMENTO = "Linchamento e tentativa de linchamento"
IND_SOCIOAMBIENTAL = "Crimes e conflitos socioambientais"
IND_DISCRIMINACAO = "Violência étnico-racial, religiosa e LGBTIAfóbica"
INDICADORES = [IND_POLICIAMENTO, IND_ATAQUES, IND_MULHER, IND_CRIANCA, IND_AGENTE, IND_CHACINA, IND_LINCHAMENTO, IND_SOCIOAMBIENTAL, IND_DISCRIMINACAO]

_QTD = r"(?:dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|[2-9]|\d{2,})"
_MULHER_TERMO = r"(?:mulher|mulheres|esposa|companheira|namorada|ex-namorada|ex-companheira|ex-mulher|ex-esposa|gestante|idosa)"
_CRIANCA_TERMO = r"(?:crianca\w*|bebe\w*|recem-nascid\w*|menino\w*|menina\w*|adolescente\w*|menor(?:es)? de idade|garoto\w*|garota\w*|infantil)"
_AGENTE_TERMO = r"(?:policia(?:l|is)\w*|pm|pms|soldado|sargento|cabo(?! frio)|tenente|capitao|agente\w*|inspetor\w*|delegad[oa]|guardas? municipa\w+|bombeir\w*|pf|prf)"

_RX = {
    IND_POLICIAMENTO: re.compile(
        r"\b(preso|presa|presos|presas|prisao|prisoes|prende\w*|mandados? de (prisao|busca)|flagrante|foragid\w*|apreend\w*|apreensao|detid\w*|capturad\w*|"
        r"intervencao policial|confronto com a (pm|policia)|morto em confronto|morre em confronto|troca de tiros com (a )?(pm|policia|policiais)|"
        r"operacao policial|operacao da (pf|policia)|(pm|policia|policiais)\w* (prend|apreend|abord|detiv|captur|cumpr|deflagr)\w*|deflagr\w*)\b"),
    IND_ATAQUES: re.compile(
        r"\b(faccao|faccoes|faccionad\w*|milicia\w*|miliciano\w*|comando vermelho|terceiro comando|tcp|ada|pcc|crime organizado|quadrilha\w*|bando|grupo armado|"
        r"guerra entre|disputa (de|por) (territorio|pontos?)|toque de recolher|arrastao|ataques? (de|dos|por) (criminosos|traficantes|bandidos|faccionados)|"
        r"(onibus|veiculos|carros) incendiados|ataques? a (bases?|delegacias?|viaturas?|upp)|criminosos armados|bandidos armados)\b"),
    IND_CHACINA: re.compile(
        r"\b(chacina\w*|duplo homicidio|triplo homicidio|quadruplo homicidio|" + _QTD + r" (pessoas )?(mortos|mortas|morrem|morreram|vitimas fatais|assassinados|assassinadas)|"
        r"(um|uma|1) (morto|morta|morte) e " + _QTD + r" (feridos|feridas|baleados|baleadas)|(mortos|mortas|morrem|morre|morreu) e " + _QTD + r" (feridos|feridas|baleados|baleadas))\b"),
    IND_LINCHAMENTO: re.compile(
        r"\b(linch\w*|justica com as proprias maos|(espancad\w*|agredid\w*) (por|pela|pelos|pelas) (populares|multidao|moradores|vizinhos)|"
        r"(populares|multidao|moradores) (agrid\w*|espanc\w*|amarr\w*))\b"),
    IND_SOCIOAMBIENTAL: re.compile(
        r"\b(desmatament\w*|garimp\w*|mineracao ilegal|queimadas?|crimes? ambienta\w+|ibama|icmbio|grilagem|grileiros?|conflitos? (agrario|agrarios|fundiario|fundiarios|por terra|de terra|socioambienta\w+)|"
        r"sem[- ]terra|mst|quilombol\w*|indigena\w*|terras? indigenas?|ribeirinh\w*|assentamento\w*|reintegracao de posse|trabalho escravo|trabalho analogo a escravidao|"
        r"poluicao|derramamento de (oleo|petroleo)|rompimento de barragem|lixao|loteamento\w* irregula\w+|construcoes? irregula\w+ em area|area de preservacao|"
        r"unidade de conservacao|parque (nacional|estadual|municipal)|mata atlantica|manguezal|restinga|pesca (ilegal|predatoria)|caca ilegal|trafico de animais|animais silvestres|fauna silvestre|extracao ilegal)\b"),
    IND_DISCRIMINACAO: re.compile(
        r"\b(racis\w*|injuria racial|discriminacao (racial|religiosa|por orientacao)|preconceito racial|xenofob\w*|antissemit\w*|nazis\w*|neonazis\w*|supremacis\w*|"
        r"intolerancia religiosa|racismo religioso|terreiro\w*|candomble|umbanda|lgbt\w*|homofob\w*|transfob\w*|lesbofob\w*|bifob\w*|travesti\w*|transexua\w+|transgener\w*|"
        r"pessoas? trans|mulher(es)? trans|homens? trans|gays?|lesbicas?|crimes? de odio|crime motivado por odio)\b"),
}
_MULHER_DIRETO = re.compile(r"\b(feminicid\w*|violencia domestica|violencia contra (a )?mulher\w*|maria da penha|medida protetiva|contra (a )?mulher(es)?|violencia de genero|estupr\w*|importunacao sexual|misoginia|agressao a mulher)\b")
_MULHER_VITIMA = re.compile(r"\b" + _MULHER_TERMO + r"\b(?:\W+\w+){0,4}?\W+(morta|assassinada|esfaqueada|agredida|espancada|baleada|atacada|estrangulada|queimada|morre|morreu|mata|violentada)\b")
_MULHER_AGRESSOR = re.compile(r"\b(matou|mata|esfaqueou|agrediu|espancou|atirou em|estrangulou|queimou|assassinou)\b(?:\W+\w+){0,3}?\W+" + _MULHER_TERMO + r"\b")
_CRIANCA_VIOLENCIA = r"(morta|morto|morre\w*|assassinad\w*|balead\w*|bala perdida|esfaquead\w*|agredid\w*|espancad\w*|estupr\w*|abus\w*|maus-tratos|sequestrad\w*|atropelad\w*|vitima|violencia|torturad\w*|queimad\w*|afogad\w*|desaparecid\w*|ferid\w*|atingid\w*)"
_CRIANCA_VITIMA = re.compile(r"\b" + _CRIANCA_TERMO + r"\b(?:\W+\w+){0,6}?\W+" + _CRIANCA_VIOLENCIA + r"\b")
_CRIANCA_VITIMA_INV = re.compile(r"\b" + _CRIANCA_VIOLENCIA + r"\b(?:\W+\w+){0,4}?\W+(?:de|da|do|contra|a|ao|em)\W+(?:\w+\W+){0,2}" + _CRIANCA_TERMO + r"\b")
_CRIANCA_DIRETO = re.compile(r"\b(estupro de vulneravel|abuso sexual (infantil|de (crianca|menor))|pedofil\w*|violencia (infantil|contra (a )?crianca\w*)|maus-tratos a (crianca|menor)|exploracao sexual|trabalho infantil)\b")
_AGENTE_RX = re.compile(r"\b" + _AGENTE_TERMO + r"\b")
_AGENTE_VITIMA = re.compile(r"\b(morto|morta|mortos|morre\w*|assassinad\w*|balead\w*|ferid\w*|atingid\w*|atacad\w*|esfaquead\w*|emboscad\w*|executad\w*|sequestrad\w*|agredid\w*)\b")
_AGENTE_BLOQ = re.compile(r"\b(prende\w*|prend\w+|mata\w*|atira\w*|apreend\w*|socorr\w*|captur\w*|detem|persegu\w*|resgat\w*|suspeit\w*|bandid\w*|criminos\w*|traficante\w*|ladr\w+|assaltante\w*|homem|jovem|motorista|acusad\w*|denunciad\w*)\b")
_AGENTE_INV = re.compile(r"\b(morte|mortes|ataque|ataques|emboscada|atentado|tiros contra|disparos contra)\b(?:\W+\w+){0,3}?\W+(?:de|a|contra|aos?|dos?)\W+(?:\w+\W+){0,2}" + _AGENTE_TERMO + r"\b")
_FERIDOS = re.compile(r"\b" + _QTD + r" (pessoas )?(baleadas|baleados|feridos|feridas)\b")


_ACIDENTE = re.compile(r"\b(acidente\w*|capotamento|colisao|queda de (helicoptero|aviao|aeronave)|atropelamento)\b")


def _vitimizacao_agente(baixo):
    for m in _AGENTE_RX.finditer(baixo):
        resto = baixo[m.end():m.end() + 70]
        mv = _AGENTE_VITIMA.search(resto)
        if mv:
            gap = resto[:mv.start()]
            if len(gap.split()) <= 4 and not _AGENTE_BLOQ.search(gap):
                return True
    return bool(_AGENTE_INV.search(baixo))


def indicadores(baixo, morte):
    """Indicadores de monitoramento que o texto (sem acento, minúsculo) sugere; uma notícia pode ter vários."""
    achou = {n for n, rx in _RX.items() if rx.search(baixo)}
    if not achou & {IND_CHACINA} and morte and _FERIDOS.search(baixo):
        achou.add(IND_CHACINA)  # pelo menos uma morte e duas pessoas feridas no mesmo fato
    if _MULHER_DIRETO.search(baixo) or _MULHER_VITIMA.search(baixo) or _MULHER_AGRESSOR.search(baixo):
        achou.add(IND_MULHER)
    if _CRIANCA_DIRETO.search(baixo) or _CRIANCA_VITIMA.search(baixo) or _CRIANCA_VITIMA_INV.search(baixo):
        achou.add(IND_CRIANCA)
    if _vitimizacao_agente(baixo):
        achou.add(IND_AGENTE)
    if _ACIDENTE.search(baixo):  # acidente não é ataque nem chacina
        achou -= {IND_CHACINA, IND_AGENTE}
    return [n for n in INDICADORES if n in achou]

# ---------- Regiões ----------
UF_NOME = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará",
    "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso",
    "MS": "Mato Grosso do Sul", "MG": "Minas Gerais", "PA": "Pará", "PB": "Paraíba", "PR": "Paraná",
    "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
    "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina", "SP": "São Paulo",
    "SE": "Sergipe", "TO": "Tocantins",
}
REGIAO = {
    "Norte": ["AC", "AP", "AM", "PA", "RO", "RR", "TO"],
    "Nordeste": ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
    "Centro-Oeste": ["DF", "GO", "MT", "MS"],
    "Sudeste": ["ES", "MG", "RJ", "SP"],
    "Sul": ["PR", "RS", "SC"],
}
UF_REGIAO = {uf: r for r, ufs in REGIAO.items() for uf in ufs}

CIDADES = {
    "RJ": "Rio de Janeiro|Nova Iguaçu|Duque de Caxias|Niterói|São Gonçalo|Belford Roxo|Campos dos Goytacazes|Petrópolis|Macaé|Angra dos Reis|Volta Redonda|Itaboraí|Magé|Queimados|Rio das Ostras|Cabo Frio|Nova Friburgo|Teresópolis|Nilópolis|São João de Meriti|Maricá|Búzios|Resende|Barra Mansa|Seropédica|Itaguaí|Complexo da Maré|Complexo do Alemão|Baixada Fluminense|BRT",
    "SP": "São Paulo|Guarulhos|Campinas|Osasco|Santo André|São Bernardo do Campo|Ribeirão Preto|Sorocaba|São José dos Campos|Paraisópolis|Mauá|Diadema|Barueri|Jundiaí|Piracicaba|Bauru|Praia Grande|Guarujá|Taubaté|Mogi das Cruzes|Itaquaquecetuba|Cracolândia|Grande São Paulo",
    "MG": "Belo Horizonte|Contagem|Betim|Uberlândia|Juiz de Fora|Montes Claros|Uberaba|Governador Valadares|Ipatinga|Divinópolis|Sete Lagoas|Poços de Caldas|Varginha|Ribeirão das Neves|Santa Luzia",
    "BA": "Salvador|Feira de Santana|Vitória da Conquista|Camaçari|Lauro de Freitas|Ilhéus|Itabuna|Porto Seguro|Simões Filho|Candeias|Barreiras|Teixeira de Freitas",
    "PE": "Recife|Olinda|Jaboatão|Caruaru|Petrolina|Cabo de Santo Agostinho|Camaragibe|Garanhuns|Vitória de Santo Antão",
    "CE": "Fortaleza|Caucaia|Juazeiro do Norte|Maracanaú|Sobral|Crato|Itapipoca",
    "PA": "Belém|Marabá|Santarém|Ananindeua|Castanhal|Parauapebas|Altamira|Tucuruí|Novo Repartimento|Redenção",
    "PR": "Curitiba|Londrina|Maringá|Cascavel|São José dos Pinhais|Ponta Grossa|Foz do Iguaçu|Guarapuava|Paranaguá|Jandaia do Sul|Apucarana|Araucária",
    "SC": "Florianópolis|Joinville|Blumenau|Brusque|Itajaí|Chapecó|Criciúma|Balneário Camboriú|Palhoça|Lages|Jaraguá do Sul",
    "RS": "Porto Alegre|Caxias do Sul|Pelotas|Canoas|Gravataí|Viamão|Novo Hamburgo|São Leopoldo|Passo Fundo|Alvorada|Cachoeirinha",
    "GO": "Goiânia|Aparecida de Goiânia|Anápolis|Rio Verde|Luziânia|Águas Lindas de Goiás|Valparaíso de Goiás|Trindade",
    "DF": "Brasília|Ceilândia|Taguatinga|Samambaia|Planaltina|Sobradinho|Águas Claras|Plano Piloto|Recanto das Emas",
    "MT": "Cuiabá|Várzea Grande|Rondonópolis|Sinop|Tangará da Serra|Cáceres|Sorriso",
    "MS": "Campo Grande|Dourados|Três Lagoas|Corumbá|Ponta Porã",
    "AM": "Manaus|Parintins|Itacoatiara|Manacapuru|Tabatinga",
    "MA": "São Luís|Imperatriz|Timon|Codó|Bacabal|Paço do Lumiar|São José de Ribamar",
    "PI": "Teresina|Parnaíba|Picos|Floriano",
    "RN": "Natal|Mossoró|Parnamirim|São Gonçalo do Amarante|Caicó",
    "PB": "João Pessoa|Campina Grande|Santa Rita|Patos|Bayeux",
    "AL": "Maceió|Arapiraca|Rio Largo|Palmeira dos Índios",
    "SE": "Aracaju|Nossa Senhora do Socorro|Lagarto|Itabaiana",
    "ES": "Vitória|Vila Velha|Cariacica|Guarapari|Linhares|Colatina|Cachoeiro de Itapemirim|São Mateus",
    "TO": "Palmas|Araguaína|Gurupi|Porto Nacional",
    "RO": "Porto Velho|Ji-Paraná|Ariquemes|Vilhena|Cacoal",
    "AC": "Rio Branco|Cruzeiro do Sul",
    "AP": "Macapá",
    "RR": "Boa Vista",
}

# Nomes de estados (exceto os que coincidem com a capital, tratados como estado)
ESTADOS = {sem_acento(nome): uf for uf, nome in UF_NOME.items()}
CIDADES_RE = sorted(
    ((re.compile(r"\b" + re.escape(sem_acento(c)) + r"\b"), uf) for uf, lista in CIDADES.items() for c in lista.split("|")),
    key=lambda x: -len(x[0].pattern),
)


# ---------- Municípios (IBGE): 5.571 nomes, só os que existem em um único estado ----------
NOMES_COMUNS = {"Luz", "Pedra", "Aurora", "Bonito", "Esperanca", "Planalto", "Salto", "Uniao", "Palmas", "Serra", "Campos", "Natal"}


def _carregar_municipios():
    caminho = os.path.join(os.path.dirname(os.path.abspath(__file__)), "municipios.json")
    try:
        with open(caminho, encoding="utf-8") as f:
            lista = json.load(f)
    except OSError:
        return None
    por_nome = defaultdict(set)
    for nome, uf in lista:
        por_nome[sem_acento(nome)].add(uf)
    unicos = {n: next(iter(u)) for n, u in por_nome.items() if len(u) == 1 and len(n) >= 4 and n not in NOMES_COMUNS}
    # Exige preposição ou pontuação antes do nome ("em Iguatu", "de Pelotas", ", Tupã"), o que evita
    # confundir sobrenomes e palavras comuns com cidades. Nomes mais longos primeiro.
    nomes = sorted(unicos, key=len, reverse=True)
    rx = re.compile(r"(?:\b(?:em|de|do|da|no|na|pela|pelo|para|ao|a)\s+|[,(/\u2013-]\s*)(" + "|".join(re.escape(n) for n in nomes) + r")\b")
    return rx, unicos


_MUN = _carregar_municipios()


def uf_por_municipio(texto_sem_acento):
    if not _MUN:
        return None
    rx, mapa = _MUN
    m = rx.search(texto_sem_acento)
    return mapa[m.group(1)] if m else None
# ---------- Municípios do RJ (recorte dentro do estado) ----------
REGIOES_RJ = {
    "Metropolitana": "Belford Roxo|Cachoeiras de Macacu|Duque de Caxias|Guapimirim|Itaboraí|Itaguaí|Japeri|Magé|Maricá|Mesquita|Nilópolis|Niterói|Nova Iguaçu|Paracambi|Queimados|Rio de Janeiro|São Gonçalo|São João de Meriti|Seropédica|Tanguá|Rio Bonito",
    "Baixadas Litorâneas": "Araruama|Armação dos Búzios|Arraial do Cabo|Cabo Frio|Casimiro de Abreu|Iguaba Grande|Rio das Ostras|São Pedro da Aldeia|Saquarema|Silva Jardim",
    "Norte Fluminense": "Campos dos Goytacazes|Carapebus|Cardoso Moreira|Conceição de Macabu|Macaé|Quissamã|São Fidélis|São Francisco de Itabapoana|São João da Barra",
    "Noroeste Fluminense": "Aperibé|Bom Jesus do Itabapoana|Cambuci|Italva|Itaocara|Itaperuna|Laje do Muriaé|Miracema|Natividade|Porciúncula|Santo Antônio de Pádua|São José de Ubá|Varre-Sai",
    "Serrana": "Bom Jardim|Cantagalo|Carmo|Cordeiro|Duas Barras|Macuco|Nova Friburgo|Petrópolis|Santa Maria Madalena|São José do Vale do Rio Preto|São Sebastião do Alto|Sumidouro|Teresópolis|Trajano de Moraes",
    "Centro-Sul Fluminense": "Areal|Comendador Levy Gasparian|Engenheiro Paulo de Frontin|Mendes|Miguel Pereira|Paraíba do Sul|Paty do Alferes|Sapucaia|Três Rios|Vassouras",
    "Médio Paraíba": "Barra do Piraí|Barra Mansa|Itatiaia|Pinheiral|Piraí|Porto Real|Quatis|Resende|Rio Claro|Rio das Flores|Valença|Volta Redonda",
    "Baía da Ilha Grande": "Angra dos Reis|Mangaratiba|Paraty",
}
MUN_REGIAO_RJ = {m: r for r, ms in REGIOES_RJ.items() for m in ms.split("|")}
# Bairros, favelas e expressões que indicam a capital
ALIAS_CAPITAL = ("complexo da mare|complexo do alemao|complexo da penha|complexo de israel|jacarezinho|rocinha|cidade de deus|vidigal|zona norte do rio|zona oeste do rio|zona sul do rio|"
                 "santa cruz|campo grande|bangu|realengo|madureira|copacabana|ipanema|leblon|barra da tijuca|tijuca|centro do rio|capital fluminense|capital carioca|cidade do rio|"
                 "av. brasil|avenida brasil|linha vermelha|linha amarela").split("|")
_ALIAS_MUN = {sem_acento(m).lower(): m for m in MUN_REGIAO_RJ}
_ALIAS_MUN.update({a: "Rio de Janeiro" for a in ALIAS_CAPITAL})
_ALIAS_MUN["rio"] = "Rio de Janeiro"
_nomes_rj = sorted(_ALIAS_MUN, key=len, reverse=True)
# "rio" sozinho só vale precedido de preposição e fora de nomes compostos (Rio Branco, Rio Grande…)
_MUN_RJ_RE = re.compile(r"(?:\b(?:em|de|do|da|no|na|pela|pelo|para|ao|a|entre)\s+|[,(/–-]\s*)(" + "|".join(re.escape(n) for n in _nomes_rj) + r")\b(?!\s+(?:grande|branco|preto|verde|negro|doce|pardo|claro de|das ostras de)\b)")


def municipio_rj(titulo, resumo):
    """Município do RJ citado no título (ou, na falta, no resumo). A capital só vale se nenhum outro município
    aparecer, porque 'Rio de Janeiro' no título costuma ser o estado."""
    for texto in (sem_acento(titulo).lower(), sem_acento(resumo).lower()):
        achados = [_ALIAS_MUN[m.group(1)] for m in _MUN_RJ_RE.finditer(texto)]
        outros = [m for m in achados if m != "Rio de Janeiro"]
        if outros:
            return outros[0]
        if achados:
            return achados[0]
    return None
# nomes mais longos primeiro (ex.: "Rio Grande do Sul" antes de "Rio")
ESTADOS_RE = sorted(((re.compile(r"\b" + re.escape(n) + r"\b"), uf) for n, uf in ESTADOS.items()), key=lambda x: -len(x[0].pattern))
SIGLA_RE = re.compile(r"(?:\(|/|, | - |(?:em|no|na|do|da|de) )(" + "|".join(UF_NOME) + r")(?=\)|[\s,.:;!?]|$)")


# ---------- Notícias de fora do Brasil ----------
# O escopo é segurança pública nacional. Usa o texto ORIGINAL (com acento): sem acento "França" viraria
# "Franca" (cidade de SP). Países/regiões distantes valem sempre, a menos que o texto cite um estado
# brasileiro; países vizinhos só valem se nenhum local brasileiro for reconhecido (fronteira é Brasil).
EXTERIOR_SIGLAS = re.compile(r"\b(EUA|ICE|FBI|CIA)\b")
EXTERIOR_FORTE = re.compile(
    r"\b(Estados Unidos|Trump|Casa Branca|Nova York|Nova Iorque|Calif[óo]rnia|Texas|Fl[óo]rida|Miami|Los Angeles|Chicago|Minneapolis|Washington|Pent[áa]gono|"
    r"Israel\w*|Gaza|Palestin\w+|Hamas|Ucr[âa]nia|ucraniano\w*|R[úu]ssia|Putin|Maduro|Portugal|Reino Unido|Londres|Espanha|It[áa]lia|Alemanha|Fran[çc]a|"
    r"China|chin[eê]s\w*|Jap[ãa]o|japon[êe]s\w*|Okinawa|Canad[áa]|[ÍI]ndia|Ir[ãa]|Iraque|S[íi]ria|L[íi]bano|Turquia|Austr[áa]lia|Coreia|Nig[ée]ria|[ÁA]frica do Sul|"
    r"Buenos Aires|Bogot[áa]|Caracas|Montevid[ée]u|Quito|Cidade do M[ée]xico|Europa|europe\w+|americano\w*|americana\w*|norte-americano\w*|Haiti|Cuba)\b", re.IGNORECASE)
EXTERIOR_VIZINHOS = re.compile(r"\b(Venezuela\w*|M[ée]xic\w+|mexican\w+|Argentin\w+|Col[ôo]mbia|colombian\w+|Equador|equatorian\w+|Peru|peruan\w+|Chile|chilen\w+|Bol[ íi]via|boliviano\w*|Paraguai\w*|Uruguai\w*)\b", re.IGNORECASE)


def uf_explicita(titulo_orig, sem):
    m = SIGLA_RE.search(titulo_orig)
    if m:
        return m.group(1)
    for rx, uf in ESTADOS_RE:
        if rx.search(sem):
            return uf
    return None


def eh_exterior(titulo_orig, texto_orig):
    forte = EXTERIOR_SIGLAS.search(texto_orig) or EXTERIOR_FORTE.search(texto_orig)
    vizinho = EXTERIOR_VIZINHOS.search(texto_orig)
    if not (forte or vizinho):
        return False
    sem = sem_acento(texto_orig)
    if uf_explicita(titulo_orig, sem):
        return False
    if forte:
        return True
    return detectar_uf(titulo_orig, texto_orig, None) is None  # vizinho: só é exterior sem local brasileiro


def detectar_uf(titulo_orig, texto_orig, fallback):
    sem = sem_acento(texto_orig)
    m = SIGLA_RE.search(titulo_orig)
    if m:
        return m.group(1)
    # "Rio Grande do Sul/Norte" etc. antes de "Rio de Janeiro": estados por nome completo
    for rx, uf in ESTADOS_RE:
        if rx.search(sem):
            return uf
    uf = uf_por_municipio(sem_acento(titulo_orig)) or uf_por_municipio(sem)
    if uf:
        return uf
    for rx, uf in CIDADES_RE:
        if rx.search(sem):
            return uf
    return fallback


def classificar(item):
    titulo = item.get("titulo", "")
    resumo = item.get("resumo", "")
    texto_orig = f"{titulo}. {resumo}"
    baixo = sem_acento(texto_orig).lower()
    # "tentativa de homicídio" não é morte
    efetivo = TENTATIVA.sub(" ", baixo)
    cats = [n for n, rx in CATEGORIAS_RE.items() if rx.search(efetivo if n in ("Homicídio / morte", "Violência doméstica") else baixo)]
    if OPERACAO.search(baixo) and CONTEXTO_POLICIAL.search(baixo) and "Prisão / operação" not in cats:
        cats.append("Prisão / operação")
    if POLITICA.search(baixo):
        cats = [c for c in cats if c not in ("Prisão / operação", "Violência policial")]
    arma = None
    morte = bool(MORTE_FORTE.search(efetivo))
    if morte or "Tiroteio / baleados" in cats:
        for nome, rx in ARMAS:
            if rx.search(baixo):
                arma = nome
                break
    politica = bool(POLITICA_FORTE.search(baixo)) and not (CATS_FATO & set(cats))
    exterior = eh_exterior(titulo, texto_orig)
    uf = None if exterior else detectar_uf(titulo, texto_orig, item.get("fonteUf"))
    mun = municipio_rj(titulo, resumo) if uf == "RJ" and not exterior else None
    ind = [] if (exterior or politica) else indicadores(baixo, morte)
    return {"cats": cats, "ind": ind, "arma": arma, "uf": uf, "regiao": UF_REGIAO.get(uf), "mun": mun, "regiaoRJ": MUN_REGIAO_RJ.get(mun), "morte": morte, "exterior": exterior, "politica": politica}


STOP = set("de da do das dos em no na nos nas por para com sem sob sobre apos ate que como mais mas uma uns umas ele ela eles elas foi sao ser ter tem pode vai um o a e os as ao aos pela pelo suspeito suspeita homem mulher policia civil militar preso presos presa apos diz".split())


def tokens(titulo):
    return {t for t in re.findall(r"[a-z0-9]+", sem_acento(titulo).lower()) if len(t) > 3 and t not in STOP}


def agrupar_casos(itens, tags):
    """Marca como duplicata (dup=True) a notícia cujo título é muito parecido com o de outra já vista.
    A primeira da lista (a mais recente) é a representante do caso."""
    reps = []  # (id, tokens, uf)
    indice = defaultdict(list)  # token -> posições em reps
    for it in itens:
        tk = tokens(it.get("titulo", ""))
        tag = tags[it["id"]]
        tag["dup"] = False
        # só compara com quem divide palavras: evita o O(n²) quando o histórico cresce
        candidatos = Counter(pos for t in tk for pos in indice[t])
        for pos, comum in candidatos.most_common():
            if comum < 3:
                break
            rid, rtk, ruf = reps[pos]
            if ruf and tag["uf"] and ruf != tag["uf"]:
                continue
            if comum / len(tk | rtk) >= 0.5:
                tag["dup"] = True
                tag["caso"] = rid
                break
        if not tag["dup"]:
            reps.append((it["id"], tk, tag["uf"]))
            for t in tk:
                indice[t].append(len(reps) - 1)


def main():
    itens = json.load(sys.stdin).get("itens", [])
    tags = {it["id"]: classificar(it) for it in itens}
    agrupar_casos(itens, tags)
    cont_cat = Counter()
    cont_arma = Counter()
    por_uf = defaultdict(lambda: {"total": 0, "cats": Counter()})
    por_dia = Counter()
    sem_uf = 0
    sem_cat = 0
    for it in itens:
        t = tags[it["id"]]
        if t["dup"]:
            continue
        cont_cat.update(t["cats"])
        if not t["cats"]:
            sem_cat += 1
        if t["morte"]:
            cont_arma[t["arma"] or "Não informada"] += 1
        if t["uf"]:
            por_uf[t["uf"]]["total"] += 1
            por_uf[t["uf"]]["cats"].update(t["cats"])
        else:
            sem_uf += 1
        if it.get("data"):
            por_dia[it["data"][:10]] += 1

    por_regiao = Counter()
    for uf, d in por_uf.items():
        por_regiao[UF_REGIAO.get(uf, "?")] += d["total"]

    stats = {
        "total": len(itens),
        "categorias": cont_cat.most_common(),
        "armas_mortes": cont_arma.most_common(),
        "por_uf": {uf: {"nome": UF_NOME.get(uf, uf), "regiao": UF_REGIAO.get(uf), "total": d["total"], "cats": dict(d["cats"])} for uf, d in por_uf.items()},
        "por_regiao": por_regiao.most_common(),
        "por_dia": sorted(por_dia.items()),
        "sem_uf": sem_uf,
        "sem_categoria": sem_cat,
    }
    json.dump({"tags": tags, "stats": stats}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
