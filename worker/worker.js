/**
 * Unicrawler — CEFS — Worker de disparo do crawler
 * ---------------------------------------------------------------------------
 * Este Worker é o ÚNICO lugar onde o token do GitHub existe. Ele nunca é
 * exposto ao navegador. O site público chama este Worker; o Worker chama
 * a API do GitHub usando um secret configurado no painel do Cloudflare.
 *
 * Rotas:
 *   POST /trigger   -> dispara o workflow (workflow_dispatch)
 *   GET  /status    -> retorna o status da execução mais recente do workflow
 *
 * Secrets/variáveis necessários (configurados no Cloudflare, NUNCA no código):
 *   GITHUB_TOKEN        - fine-grained PAT, permissão "Actions: Read and write"
 *                         apenas no repositório do Unicrawler.
 *   GITHUB_OWNER        - usuário/organização do repositório (ex: "fernando")
 *   GITHUB_REPO         - nome do repositório (ex: "unicrawler-cefs")
 *   WORKFLOW_FILENAME   - nome do arquivo do workflow (ex: "crawler.yml")
 *   ALLOWED_ORIGIN      - origem permitida para CORS (ex: o domínio do GitHub Pages)
 */

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env),
    },
  });
}

async function githubFetch(env, path, init = {}) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "unicrawler-cefs-worker",
      ...(init.headers || {}),
    },
  });
}

async function handleTrigger(request, env) {
  // Dispara o workflow via workflow_dispatch
  const resp = await githubFetch(
    env,
    `/actions/workflows/${env.WORKFLOW_FILENAME}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({ ref: env.GITHUB_REF || "main" }),
    }
  );

  if (resp.status === 204) {
    return jsonResponse({ ok: true, message: "Atualização disparada com sucesso." }, 200, env);
  }

  const detalhe = await resp.text();
  return jsonResponse(
    { ok: false, message: "Falha ao disparar o workflow.", status: resp.status, detalhe },
    502,
    env
  );
}

async function handleStatus(request, env) {
  // Busca as execuções mais recentes deste workflow específico
  const resp = await githubFetch(
    env,
    `/actions/workflows/${env.WORKFLOW_FILENAME}/runs?per_page=1`
  );

  if (!resp.ok) {
    return jsonResponse({ ok: false, message: "Não foi possível consultar o status." }, 502, env);
  }

  const data = await resp.json();
  const run = data.workflow_runs && data.workflow_runs[0];

  if (!run) {
    return jsonResponse({ ok: true, status: "nenhuma_execucao" }, 200, env);
  }

  return jsonResponse(
    {
      ok: true,
      status: run.status,            // queued | in_progress | completed
      conclusion: run.conclusion,    // success | failure | null
      created_at: run.created_at,
      updated_at: run.updated_at,
      html_url: run.html_url,
    },
    200,
    env
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (url.pathname === "/trigger" && request.method === "POST") {
      return handleTrigger(request, env);
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return handleStatus(request, env);
    }

    return jsonResponse({ ok: false, message: "Rota não encontrada." }, 404, env);
  },
};
