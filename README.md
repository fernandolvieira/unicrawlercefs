# Unicrawler — CEFS

Painel do **Colégio Frei Seráfico (CEFS)** com calendário, links oficiais, documentos
exigidos e editais em PDF dos principais processos seletivos (vestibulares seriados e
convencionais) de **20 universidades públicas e particulares de MG, RJ e SP**, incluindo
o Afya São João del-Rei (ex-UNIPTAN) e a UFSJ.

🔗 **Site publicado:** `https://<seu-usuario>.github.io/<nome-do-repo>/` (ver seção *Deploy*)

---

## O que este projeto faz

- Mantém uma lista curada de **20 instituições** (`data/instituicoes.json`) com o link
  oficial do vestibular de cada uma, órgão executor, documentos normalmente exigidos e
  se a instituição possui modalidade seriada.
- Roda um **crawler em Python** (`scripts/crawler.py`), agendado via **GitHub Actions**,
  que visita periodicamente cada site oficial e tenta localizar:
  - links para **PDFs de editais, manuais do candidato e cronogramas**;
  - **trechos de texto com datas** próximos a palavras-chave como "inscrições", "prova",
    "resultado" e "matrícula".
- Publica um **site estático** (`docs/`) que lê esses dados e mostra:
  - um calendário com as próximas datas confirmadas;
  - cartões por instituição com link oficial, documentos exigidos e PDFs encontrados;
  - filtro por estado (MG / RJ / SP).

## Por que existem dois tipos de dados (curado vs. automático)

Datas de vestibular têm peso prático real — um erro pode custar a inscrição de alguém.
Por isso o projeto separa deliberadamente:

| Arquivo | Como é gerado | Confiabilidade |
|---|---|---|
| `data/calendario_curado.json` | Editado manualmente, revisado contra fonte oficial | Marcado como **confiança alta** |
| `data/crawler_output.json` | Gerado automaticamente pelo crawler, a cada execução | Marcado como **extração automática** — use como pista, sempre confira o link oficial |

O site **nunca afirma** que uma data extraída automaticamente é definitiva. Ele sempre
aponta para a página oficial como fonte de verdade.

---

## Estrutura do repositório

```
.
├── data/
│   ├── instituicoes.json        # lista curada das 20 instituições
│   ├── calendario_curado.json   # datas confirmadas manualmente
│   └── crawler_output.json      # saída do crawler (sobrescrita automaticamente)
├── scripts/
│   ├── crawler.py               # o crawler
│   └── requirements.txt
├── docs/                         # site estático servido pelo GitHub Pages
│   ├── index.html
│   ├── assets/{css,js,img}/
│   └── data/                    # cópia dos JSONs de data/, sincronizada pelo workflow
└── .github/workflows/crawler.yml # agendamento do crawler + publicação
```

## Como rodar o crawler localmente

```bash
pip install -r scripts/requirements.txt
python scripts/crawler.py
```

Isso atualiza `data/crawler_output.json`. Para refletir no site local, copie para `docs/data/`:

```bash
cp data/crawler_output.json docs/data/crawler_output.json
```

## Como rodar o site localmente

```bash
cd docs
python3 -m http.server 8000
```

Acesse `http://localhost:8000`.

---

## Deploy no GitHub Pages (gratuito)

1. Suba este repositório para o GitHub (público ou privado com GitHub Pro/Team).
2. Em **Settings → Pages**, em "Build and deployment", escolha:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main` — pasta **`/docs`**
3. Salve. Em alguns minutos o site estará em `https://<usuario>.github.io/<repo>/`.
4. Em **Settings → Actions → General**, confira que "Workflow permissions" está como
   **Read and write permissions** — o workflow precisa disso para commitar as
   atualizações do crawler automaticamente.

O workflow em `.github/workflows/crawler.yml` já está configurado para rodar todos os
dias às 06h UTC (≈ 03h em Brasília) e pode também ser disparado manualmente na aba
**Actions → Atualizar dados do Unicrawler → Run workflow**.

---

## Como contribuir / corrigir uma informação

Encontrou um link quebrado, uma data errada ou quer adicionar uma instituição?

1. Edite o arquivo relevante em `data/`:
   - **Link oficial errado ou instituição nova** → `data/instituicoes.json`
   - **Data errada ou nova data confirmada** → `data/calendario_curado.json`
2. Abra um **Pull Request** com a alteração.
3. Se possível, inclua na descrição do PR o link da fonte oficial que confirma a
   informação.

### Esquema de `instituicoes.json`

Cada instituição segue este formato:

```json
{
  "id": "identificador-unico-em-minusculas",
  "nome": "Nome completo da instituição",
  "sigla": "SIGLA",
  "estado": "MG | RJ | SP",
  "tipo": "publica_federal | publica_estadual | privada",
  "cidade": "Cidade (ou 'multicampi')",
  "url_oficial": "https://...",
  "url_vestibular": "https://... (página do processo seletivo)",
  "orgao_executor": "Nome do órgão/comissão responsável pelo vestibular",
  "possui_seriado": true,
  "nome_seriado": "Nome do programa seriado, se houver, senão null",
  "documentos_busca": ["palavras-chave usadas pelo crawler para achar PDFs"],
  "documentos_exigidos_padrao": ["lista de documentos normalmente exigidos"]
}
```

### Esquema de `calendario_curado.json`

```json
{
  "instituicao_id": "deve bater com o id em instituicoes.json",
  "processo": "Nome do processo seletivo e ano",
  "tipo": "seriado | convencional",
  "evento": "Ex.: Inscrições, Provas, Resultado, Matrícula",
  "data_inicio": "AAAA-MM-DD ou null",
  "data_fim": "AAAA-MM-DD ou null",
  "fonte": "Nome do órgão/fonte que confirma a data",
  "confianca": "alta"
}
```

---

## Limitações conhecidas

- O crawler usa **heurísticas de texto** (palavras-chave + regex de data), não
  interpretação semântica de PDFs. Ele pode deixar passar editais com nomenclatura
  pouco comum, ou trazer falsos positivos em páginas com muito conteúdo de notícias.
- Alguns sites de vestibular mudam de domínio entre edições (ex.: o caso do
  Afya/ex-UNIPTAN). Quando isso ocorrer, atualize `url_vestibular` em
  `instituicoes.json` via Pull Request.
- Este painel é **comunitário e não-oficial**. Em caso de qualquer divergência, a
  informação do edital publicado pela própria instituição sempre prevalece.

## Licença

Os dados estruturados (`data/`) e o código (`scripts/`, `docs/`) deste repositório
podem ser usados livremente. O logotipo do Colégio Frei Seráfico é de uso exclusivo
da instituição.
