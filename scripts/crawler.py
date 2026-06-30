#!/usr/bin/env python3
"""
Crawler de processos seletivos de universidades (MG, RJ, SP).

O que este script faz:
1. Lê data/instituicoes.json (lista curada de instituições + URL oficial do vestibular).
2. Para cada instituição, baixa a página do vestibular (e, se houver, 1 nível de
   links internos relevantes) e tenta extrair:
   - links para PDFs que pareçam ser editais/manuais/cronogramas
   - datas em texto próximas a palavras-chave (inscrições, prova, resultado, matrícula)
3. Grava tudo em data/crawler_output.json, junto com metadados de quando e com que
   confiança cada informação foi extraída.

O que este script NÃO faz (por design, para evitar afirmar coisas erradas):
- Não tenta "entender" semanticamente o conteúdo do PDF.
- Não decide sozinho qual é "a" data oficial: ele apenas propõe candidatos.
  A página final do site sempre rotula isso como extraído automaticamente,
  e mantém o link da página oficial como fonte de verdade.

Este script é desenhado para rodar via GitHub Actions (ver .github/workflows/crawler.yml),
mas funciona localmente com: pip install -r scripts/requirements.txt && python scripts/crawler.py
"""

import json
import re
import sys
import time
import logging
import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("crawler")

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
INSTITUICOES_FILE = DATA_DIR / "instituicoes.json"
OUTPUT_FILE = DATA_DIR / "crawler_output.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; VestibularesBR-Crawler/1.0; "
        "+https://github.com/) crawler academico sem fins comerciais"
    )
}

REQUEST_TIMEOUT = 20
MAX_INTERNAL_LINKS_PER_SITE = 6
SLEEP_BETWEEN_REQUESTS = 1.5  # segundos, para sermos educados com os servidores

# --- Padrões de detecção ---------------------------------------------------

PALAVRAS_CHAVE_DOCUMENTO = [
    "edital", "manual do candidato", "manual do ingresso", "cronograma",
    "guia de provas", "guia de jornada", "guia de carreiras",
    "processo seletivo", "vestibular", "resolução", "retificação",
]

PALAVRAS_CHAVE_DATA_CONTEXTO = [
    "inscri", "isen", "redução de taxa", "prova", "resultado",
    "matrícula", "matricula", "chamada", "convocação", "convocacao",
    "gabarito", "edital",
]

# dd/mm/aaaa, dd/mm, "DD de MÊS de AAAA", "DD de MÊS"
REGEX_DATA_NUMERICA = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b")
MESES = (
    "janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|"
    "setembro|outubro|novembro|dezembro"
)
REGEX_DATA_EXTENSO = re.compile(
    rf"\b(\d{{1,2}})\s*(?:de)?\s*({MESES})\s*(?:de)?\s*(\d{{4}})?\b",
    re.IGNORECASE,
)

REGEX_PDF_LINK = re.compile(r"\.pdf($|\?)", re.IGNORECASE)


def carregar_instituicoes():
    with open(INSTITUICOES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)["instituicoes"]


def buscar_pagina(url):
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.text, resp.url
    except requests.RequestException as e:
        log.warning(f"  Falha ao acessar {url}: {e}")
        return None, None


def extrair_links_pdf(soup, base_url):
    """Retorna lista de dicts {url, texto_ancora} para links que aparentam ser editais em PDF."""
    encontrados = []
    vistos = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href:
            continue
        texto_ancora = a.get_text(strip=True) or ""
        full_url = urljoin(base_url, href)

        eh_pdf = bool(REGEX_PDF_LINK.search(full_url))
        texto_relevante = any(
            kw in texto_ancora.lower() for kw in PALAVRAS_CHAVE_DOCUMENTO
        )

        if eh_pdf and (texto_relevante or True):
            # Mantemos todo PDF, mas marcamos relevância para ordenação posterior.
            if full_url not in vistos:
                vistos.add(full_url)
                encontrados.append({
                    "url": full_url,
                    "texto_ancora": texto_ancora[:200],
                    "relevante_por_palavra_chave": texto_relevante,
                })
    return encontrados


def extrair_links_internos_relevantes(soup, base_url):
    """Acha até N links internos cujo texto sugira página de vestibular/edital,
    para seguir 1 nível e tentar achar mais PDFs/datas."""
    dominio_base = urlparse(base_url).netloc
    candidatos = []
    vistos = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        texto = (a.get_text(strip=True) or "").lower()
        if not href or not texto:
            continue
        full_url = urljoin(base_url, href)
        if urlparse(full_url).netloc != dominio_base:
            continue  # só seguimos links internos ao mesmo domínio
        if full_url in vistos or full_url == base_url:
            continue
        if REGEX_PDF_LINK.search(full_url):
            continue  # PDFs já são tratados separadamente

        if any(kw in texto for kw in PALAVRAS_CHAVE_DOCUMENTO):
            vistos.add(full_url)
            candidatos.append(full_url)
        if len(candidatos) >= MAX_INTERNAL_LINKS_PER_SITE:
            break
    return candidatos


def extrair_trechos_com_data(texto_pagina):
    """
    Procura, em blocos de texto curtos (parágrafos/linhas), trechos que contenham
    uma data E uma palavra-chave de contexto na mesma linha. Isso reduz MUITO falsos
    positivos comparado a so extrair toda data da pagina.
    """
    trechos = []
    linhas = re.split(r"[\n\r]+", texto_pagina)
    for linha in linhas:
        linha_limpa = linha.strip()
        if len(linha_limpa) < 8 or len(linha_limpa) > 400:
            continue
        linha_lower = linha_limpa.lower()

        tem_contexto = any(kw in linha_lower for kw in PALAVRAS_CHAVE_DATA_CONTEXTO)
        if not tem_contexto:
            continue

        tem_data = REGEX_DATA_NUMERICA.search(linha_limpa) or REGEX_DATA_EXTENSO.search(
            linha_limpa
        )
        if not tem_data:
            continue

        trechos.append(linha_limpa)

    # remove duplicatas mantendo ordem
    vistos = set()
    unicos = []
    for t in trechos:
        if t not in vistos:
            vistos.add(t)
            unicos.append(t)
    return unicos[:25]  # limite de segurança


def processar_instituicao(inst):
    log.info(f"Processando {inst['sigla']} ({inst['url_vestibular']})")
    resultado = {
        "id": inst["id"],
        "sigla": inst["sigla"],
        "url_vestibular_consultada": inst["url_vestibular"],
        "status": "erro",
        "pdfs_encontrados": [],
        "trechos_com_data": [],
        "paginas_visitadas": [],
        "timestamp_utc": datetime.datetime.utcnow().isoformat() + "Z",
        "erro": None,
    }

    html, url_final = buscar_pagina(inst["url_vestibular"])
    if html is None:
        resultado["erro"] = "Não foi possível acessar a página principal do vestibular."
        return resultado

    resultado["status"] = "ok"
    resultado["paginas_visitadas"].append(url_final or inst["url_vestibular"])

    soup = BeautifulSoup(html, "html.parser")
    texto_pagina = soup.get_text(separator="\n")

    pdfs = extrair_links_pdf(soup, url_final or inst["url_vestibular"])
    trechos = extrair_trechos_com_data(texto_pagina)

    # Segue até N links internos relevantes (1 nível) para tentar enriquecer.
    links_internos = extrair_links_internos_relevantes(
        soup, url_final or inst["url_vestibular"]
    )
    for link in links_internos:
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        sub_html, sub_url_final = buscar_pagina(link)
        if sub_html is None:
            continue
        resultado["paginas_visitadas"].append(sub_url_final or link)
        sub_soup = BeautifulSoup(sub_html, "html.parser")
        sub_texto = sub_soup.get_text(separator="\n")

        pdfs.extend(extrair_links_pdf(sub_soup, sub_url_final or link))
        trechos.extend(extrair_trechos_com_data(sub_texto))

    # Dedup final de PDFs por URL
    pdfs_dedup = {}
    for p in pdfs:
        pdfs_dedup[p["url"]] = p
    pdfs_final = list(pdfs_dedup.values())

    # Ordena: PDFs com palavra-chave relevante no texto da âncora primeiro
    pdfs_final.sort(key=lambda p: not p["relevante_por_palavra_chave"])

    # Dedup de trechos
    trechos_dedup = []
    vistos = set()
    for t in trechos:
        if t not in vistos:
            vistos.add(t)
            trechos_dedup.append(t)

    resultado["pdfs_encontrados"] = pdfs_final[:30]
    resultado["trechos_com_data"] = trechos_dedup[:40]
    return resultado


def main():
    instituicoes = carregar_instituicoes()
    resultados = []

    for inst in instituicoes:
        try:
            resultado = processar_instituicao(inst)
        except Exception as e:  # nunca deixar uma instituição quebrar o crawler inteiro
            log.exception(f"Erro inesperado em {inst['sigla']}")
            resultado = {
                "id": inst["id"],
                "sigla": inst["sigla"],
                "url_vestibular_consultada": inst["url_vestibular"],
                "status": "erro",
                "pdfs_encontrados": [],
                "trechos_com_data": [],
                "paginas_visitadas": [],
                "timestamp_utc": datetime.datetime.utcnow().isoformat() + "Z",
                "erro": f"Exceção: {e}",
            }
        resultados.append(resultado)
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    output = {
        "gerado_em_utc": datetime.datetime.utcnow().isoformat() + "Z",
        "total_instituicoes": len(resultados),
        "ok": sum(1 for r in resultados if r["status"] == "ok"),
        "com_erro": sum(1 for r in resultados if r["status"] == "erro"),
        "resultados": resultados,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    log.info(
        f"Concluído. {output['ok']}/{output['total_instituicoes']} instituições "
        f"processadas com sucesso. Saída: {OUTPUT_FILE}"
    )

    if output["ok"] == 0:
        log.error("Nenhuma instituição processada com sucesso. Verifique conectividade.")
        sys.exit(1)


if __name__ == "__main__":
    main()
