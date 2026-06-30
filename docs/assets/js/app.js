// ============================================================================
// Unicrawler — CEFS
// Carrega data/instituicoes.json, data/calendario_curado.json e
// data/crawler_output.json (todos copiados para docs/data/ no build),
// e renderiza o painel. Não depende de nenhum framework.
// ============================================================================

const DATA_PATHS = {
  instituicoes: "data/instituicoes.json",
  calendario: "data/calendario_curado.json",
  crawler: "data/crawler_output.json",
};

// TODO: depois de publicar o Worker (ver worker/README.md), cole aqui a URL gerada
// pelo `wrangler deploy`, por exemplo:
// "https://unicrawler-cefs-trigger.SEU-SUBDOMINIO.workers.dev"
const WORKER_URL = "";

const POLL_INTERVAL_MS = 8000;     // intervalo entre checagens de status
const POLL_TIMEOUT_MS = 6 * 60_000; // desiste de checar após 6 minutos

const MESES_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

let ESTADO_ATIVO = "todos";
let CACHE = { instituicoes: [], calendario: null, crawler: null };

async function carregarJSON(caminho) {
  try {
    const resp = await fetch(caminho, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error(`Falha ao carregar ${caminho}:`, e);
    return null;
  }
}

function formatarDataCurta(isoStr) {
  if (!isoStr) return null;
  const [ano, mes, dia] = isoStr.split("-").map(Number);
  return { dia, mesLabel: MESES_PT[mes - 1], ano };
}

function intervaloLabel(inicio, fim) {
  const di = formatarDataCurta(inicio);
  const df = formatarDataCurta(fim);
  if (di && df) {
    return { principal: `${df.dia}`, sub: `${df.mesLabel} ${df.ano}`, faixa: `${di.dia}/${di.mesLabel} → ${df.dia}/${df.mesLabel}` };
  }
  if (df) return { principal: `${df.dia}`, sub: `${df.mesLabel} ${df.ano}`, faixa: `até ${df.dia}/${df.mesLabel}` };
  if (di) return { principal: `${di.dia}`, sub: `${di.mesLabel} ${di.ano}`, faixa: `a partir de ${di.dia}/${di.mesLabel}` };
  return { principal: "—", sub: "", faixa: "data a confirmar" };
}

function nomeInstituicao(id) {
  const inst = CACHE.instituicoes.find((i) => i.id === id);
  return inst ? inst.sigla : id;
}

// ---------------------------------------------------------------- calendário

function renderCalendario() {
  const container = document.getElementById("lista-calendario");
  if (!CACHE.calendario || !CACHE.calendario.eventos) {
    container.innerHTML = `<p class="empty-state">Calendário indisponível no momento.</p>`;
    return;
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  let eventos = CACHE.calendario.eventos.filter((ev) => {
    const inst = CACHE.instituicoes.find((i) => i.id === ev.instituicao_id);
    if (!inst) return false;
    if (ESTADO_ATIVO !== "todos" && inst.estado !== ESTADO_ATIVO) return false;
    return true;
  });

  // ordena por data_fim (ou data_inicio se não houver fim), futuros primeiro
  eventos.sort((a, b) => {
    const da = new Date(a.data_fim || a.data_inicio || "9999-12-31");
    const db = new Date(b.data_fim || b.data_inicio || "9999-12-31");
    return da - db;
  });

  if (eventos.length === 0) {
    container.innerHTML = `<p class="empty-state">Nenhuma data cadastrada para este filtro ainda. Confira diretamente os links oficiais abaixo.</p>`;
    return;
  }

  container.innerHTML = eventos
    .map((ev) => {
      const inst = CACHE.instituicoes.find((i) => i.id === ev.instituicao_id);
      const { principal, sub, faixa } = intervaloLabel(ev.data_inicio, ev.data_fim);
      const dataFimObj = ev.data_fim ? new Date(ev.data_fim) : null;
      const passado = dataFimObj && dataFimObj < hoje;
      const tipoTag = ev.tipo === "seriado" ? "tag--seriado" : "tag--convencional";
      const confiancaTag = ev.confianca === "alta" ? "tag--alta" : "tag--auto";

      return `
        <div class="calendar-row" style="${passado ? "opacity:.45;" : ""}">
          <div class="calendar-row__date">
            ${principal}<span>${sub}</span>
          </div>
          <div class="calendar-row__body">
            <h3>${inst ? inst.sigla : ev.instituicao_id} — ${ev.evento}</h3>
            <p>${ev.processo} · ${faixa} · fonte: ${ev.fonte || "—"}</p>
          </div>
          <div class="calendar-row__tag">
            <span class="tag ${tipoTag}">${ev.tipo === "seriado" ? "Seriado" : "Convencional"}</span>
            <span class="tag ${confiancaTag}">${ev.confianca === "alta" ? "Confiança alta" : "Extração automática"}</span>
          </div>
        </div>`;
    })
    .join("");
}

// ---------------------------------------------------------------- cards

function pdfsParaInstituicao(id) {
  if (!CACHE.crawler || !CACHE.crawler.resultados) return [];
  const r = CACHE.crawler.resultados.find((x) => x.id === id);
  if (!r || !r.pdfs_encontrados) return [];
  return r.pdfs_encontrados.filter((p) => p.relevante_por_palavra_chave).slice(0, 3);
}

function renderCards() {
  const container = document.getElementById("grade-instituicoes");
  let lista = CACHE.instituicoes;
  if (ESTADO_ATIVO !== "todos") {
    lista = lista.filter((i) => i.estado === ESTADO_ATIVO);
  }

  lista = [...lista].sort((a, b) => a.sigla.localeCompare(b.sigla, "pt-BR"));

  if (lista.length === 0) {
    container.innerHTML = `<p class="empty-state">Nenhuma instituição encontrada para este filtro.</p>`;
    return;
  }

  container.innerHTML = lista
    .map((inst) => {
      const pdfs = pdfsParaInstituicao(inst.id);
      const docsHtml = (inst.documentos_exigidos_padrao || [])
        .map((d) => `<li>${d}</li>`)
        .join("");

      const pdfsHtml = pdfs.length
        ? `<details class="card__pdfs">
             <summary>PDFs localizados pelo crawler (${pdfs.length})</summary>
             ${pdfs.map((p) => `<a href="${p.url}" target="_blank" rel="noopener">${p.texto_ancora || p.url}</a>`).join("")}
           </details>`
        : "";

      const obsHtml = inst.observacao
        ? `<p class="card__obs">${inst.observacao}</p>`
        : "";

      const seriadoTag = inst.possui_seriado
        ? `<span class="tag tag--seriado">${inst.nome_seriado || "Seriado"}</span>`
        : "";

      return `
        <article class="card" data-estado="${inst.estado}">
          <div class="card__head">
            <div>
              <span class="card__sigla">${inst.sigla} · ${inst.estado}</span>
              <h3>${inst.nome}</h3>
            </div>
          </div>
          <div class="card__meta">
            <span>${inst.cidade}</span>
            <span>·</span>
            <span>${inst.orgao_executor}</span>
          </div>
          ${seriadoTag ? `<div>${seriadoTag}</div>` : ""}
          ${obsHtml}
          <a class="card__cta" href="${inst.url_vestibular}" target="_blank" rel="noopener">
            Página oficial do processo seletivo →
          </a>
          <details class="card__docs">
            <summary>Documentos normalmente exigidos</summary>
            <ul>${docsHtml}</ul>
          </details>
          ${pdfsHtml}
        </article>`;
    })
    .join("");
}

// ---------------------------------------------------------------- resumo por estado

function renderResumoEstados() {
  const container = document.getElementById("resumo-estados");
  const estados = ["MG", "RJ", "SP"];
  container.innerHTML = estados
    .map((uf) => {
      const count = CACHE.instituicoes.filter((i) => i.estado === uf).length;
      const nomeCompleto = { MG: "Minas Gerais", RJ: "Rio de Janeiro", SP: "São Paulo" }[uf];
      return `
        <div class="state-card">
          <span class="state-card__count">${count}</span>
          <span class="state-card__label">instituições em ${nomeCompleto}</span>
        </div>`;
    })
    .join("");
}

// ---------------------------------------------------------------- filtros + topo

function configurarFiltros() {
  const botoes = document.querySelectorAll("[data-filter-estado]");
  botoes.forEach((btn) => {
    btn.addEventListener("click", () => {
      ESTADO_ATIVO = btn.dataset.filterEstado;
      botoes.forEach((b) => b.classList.toggle("is-active", b === btn));
      renderCalendario();
      renderCards();
    });
  });
}

function renderTopo() {
  const agora = new Date();
  document.getElementById("data-atual").textContent = agora.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const ultimaAtualizacaoEl = document.getElementById("ultima-atualizacao");
  if (CACHE.crawler && CACHE.crawler.gerado_em_utc) {
    const dt = new Date(CACHE.crawler.gerado_em_utc);
    const label = isNaN(dt.getTime())
      ? "ainda não executado"
      : `crawler: ${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} UTC`;
    ultimaAtualizacaoEl.textContent = label;
  } else {
    ultimaAtualizacaoEl.textContent = "status do crawler indisponível";
  }
}

// ---------------------------------------------------------------- botão "Atualizar agora"

function setFeedback(texto, classe) {
  const el = document.getElementById("update-feedback");
  el.textContent = texto;
  el.classList.remove("is-success", "is-error");
  if (classe) el.classList.add(classe);
}

function setBotaoCarregando(carregando) {
  const btn = document.getElementById("btn-atualizar");
  btn.disabled = carregando;
  btn.classList.toggle("is-loading", carregando);
  btn.querySelector(".update-btn__label").textContent = carregando
    ? "Atualizando…"
    : "Atualizar agora";
}

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function consultarStatusWorker() {
  const resp = await fetch(`${WORKER_URL}/status`, { cache: "no-store" });
  if (!resp.ok) throw new Error(`status HTTP ${resp.status}`);
  return resp.json();
}

async function recarregarDadosEReRenderizar() {
  const [instituicoesData, calendarioData, crawlerData] = await Promise.all([
    carregarJSON(DATA_PATHS.instituicoes),
    carregarJSON(DATA_PATHS.calendario),
    carregarJSON(DATA_PATHS.crawler),
  ]);
  CACHE.instituicoes = instituicoesData ? instituicoesData.instituicoes : CACHE.instituicoes;
  CACHE.calendario = calendarioData || CACHE.calendario;
  CACHE.crawler = crawlerData || CACHE.crawler;
  renderTopo();
  renderCalendario();
  renderCards();
  renderResumoEstados();
}

async function acompanharExecucao(timestampAntesDoClique) {
  const inicio = Date.now();

  while (Date.now() - inicio < POLL_TIMEOUT_MS) {
    await aguardar(POLL_INTERVAL_MS);
    let status;
    try {
      status = await consultarStatusWorker();
    } catch (e) {
      console.error("Falha ao consultar status:", e);
      continue; // tenta de novo no próximo ciclo, em vez de desistir por uma falha pontual
    }

    if (!status.ok) continue;

    // Só nos importa uma execução que tenha começado DEPOIS do clique.
    const iniciouDepoisDoClique =
      status.created_at && new Date(status.created_at).getTime() >= timestampAntesDoClique;

    if (status.status === "completed" && iniciouDepoisDoClique) {
      if (status.conclusion === "success") {
        setFeedback("Concluído! Recarregando dados…", "is-success");
        await recarregarDadosEReRenderizar();
        setFeedback("Dados atualizados.", "is-success");
      } else {
        setFeedback(`Execução concluída com problema (${status.conclusion}).`, "is-error");
      }
      return;
    }

    if (status.status === "in_progress" || status.status === "queued") {
      setFeedback("Crawler em execução no GitHub Actions…", null);
    }
  }

  setFeedback("Demorou mais do que o esperado. Confira a aba Actions no GitHub.", "is-error");
}

async function dispararAtualizacao() {
  if (!WORKER_URL) {
    setFeedback("Worker não configurado ainda — veja worker/README.md.", "is-error");
    return;
  }

  setBotaoCarregando(true);
  setFeedback("Disparando atualização…", null);
  const timestampDoClique = Date.now();

  try {
    const resp = await fetch(`${WORKER_URL}/trigger`, { method: "POST" });
    const data = await resp.json();

    if (!data.ok) {
      setFeedback(data.message || "Não foi possível disparar a atualização.", "is-error");
      setBotaoCarregando(false);
      return;
    }

    setFeedback("Atualização disparada. Acompanhando…", null);
    await acompanharExecucao(timestampDoClique);
  } catch (e) {
    console.error("Erro ao disparar atualização:", e);
    setFeedback("Erro de conexão com o Worker.", "is-error");
  } finally {
    setBotaoCarregando(false);
  }
}

function configurarBotaoAtualizar() {
  const btn = document.getElementById("btn-atualizar");
  if (!btn) return;
  btn.addEventListener("click", dispararAtualizacao);
}

// ---------------------------------------------------------------- init

async function init() {
  const [instituicoesData, calendarioData, crawlerData] = await Promise.all([
    carregarJSON(DATA_PATHS.instituicoes),
    carregarJSON(DATA_PATHS.calendario),
    carregarJSON(DATA_PATHS.crawler),
  ]);

  CACHE.instituicoes = instituicoesData ? instituicoesData.instituicoes : [];
  CACHE.calendario = calendarioData;
  CACHE.crawler = crawlerData;

  renderTopo();
  configurarFiltros();
  configurarBotaoAtualizar();
  renderCalendario();
  renderCards();
  renderResumoEstados();
}

document.addEventListener("DOMContentLoaded", init);
