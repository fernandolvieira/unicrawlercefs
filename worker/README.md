# Worker de disparo do Unicrawler

Este Worker do Cloudflare é o intermediário seguro entre o botão "Atualizar agora" do
site e a API do GitHub. Ele existe para que o token do GitHub **nunca** apareça no
código do site (que é público).

## Por que isso é necessário

O site (`docs/`) é hospedado no GitHub Pages, que serve apenas arquivos estáticos.
Qualquer token colocado diretamente no JavaScript do site ficaria visível a qualquer
visitante (basta abrir o DevTools do navegador). O Worker resolve isso guardando o
token como *secret* do lado do Cloudflare, fora do alcance do navegador.

## Passo 1 — Criar o token do GitHub (fine-grained, com escopo mínimo)

1. Acesse: `https://github.com/settings/tokens?type=beta`
2. Clique em **Generate new token** (Fine-grained personal access token).
3. **Repository access:** escolha "Only select repositories" → selecione apenas o
   repositório do Unicrawler.
4. **Permissions → Repository permissions:**
   - **Actions:** `Read and write` (é a única permissão necessária — dispara e lê o status do workflow).
   - Deixe todas as outras como "No access".
5. Defina uma expiração (recomendado: 90 dias, e renovar depois — tokens eternos são
   mais arriscados se algum dia forem expostos por acidente).
6. Copie o token gerado (só aparece uma vez).

## Passo 2 — Criar o Worker no Cloudflare (gratuito)

```bash
cd worker
npm install -g wrangler   # CLI oficial do Cloudflare, se ainda não tiver
wrangler login            # abre o navegador para autenticar
```

Edite `wrangler.toml` e troque:
- `GITHUB_OWNER` → seu usuário/organização do GitHub
- `GITHUB_REPO` → nome do repositório
- `ALLOWED_ORIGIN` → a URL do seu GitHub Pages (ex: `https://fernando.github.io`)

Depois, configure o token como secret (não vai para o `wrangler.toml`, não fica em
nenhum arquivo do projeto):

```bash
wrangler secret put GITHUB_TOKEN
# cole o token quando solicitado
```

Publique o Worker:

```bash
wrangler deploy
```

Ao final, o terminal mostra a URL pública do Worker, algo como:

```
https://unicrawler-cefs-trigger.SEU-SUBDOMINIO.workers.dev
```

**Copie essa URL** — você vai colar no arquivo `docs/assets/js/app.js` (constante
`WORKER_URL`, já indicada com um comentário `// TODO` nesse arquivo).

## Passo 3 — Testar o Worker isoladamente (opcional, mas recomendado)

```bash
curl -X POST https://SEU-WORKER.workers.dev/trigger
curl https://SEU-WORKER.workers.dev/status
```

Se o `/trigger` retornar `{"ok": true, ...}`, confira na aba **Actions** do GitHub se
uma nova execução do workflow apareceu.

## Segurança — o que este desenho garante e o que não garante

**Garante:**
- O token nunca trafega para o navegador do visitante.
- O token tem permissão mínima (só dispara/lê esse workflow, nada mais).
- Você pode revogar o token a qualquer momento em
  `github.com/settings/tokens` sem afetar o resto da sua conta.

**Não garante:**
- Qualquer pessoa que acesse o site público poderá clicar no botão e disparar o
  crawler (o Worker, como está, não exige login). Isso é aceitável para este caso de
  uso (o pior cenário é alguém forçar execuções extras do crawler), mas **não** adicione
  ações mais sensíveis (como escrever arquivos arbitrários) a este mesmo Worker sem
  adicionar autenticação.
- Se quiser restringir quem pode clicar, a forma mais simples é exigir uma senha
  simples enviada no corpo da requisição e verificada no Worker (posso implementar
  isso se quiser).

## Custo

O plano gratuito do Cloudflare Workers cobre até 100.000 requisições/dia — muito acima
do que esse botão vai gerar.
