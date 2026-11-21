# Fundação de nuvem — estado técnico

Atualizado em 21/11/2026. A aplicação local original, incluindo `app/server.mjs` e `app/public/`, foi preservada. O registro detalhado abaixo inclui evidências históricas de 20/11; a atualização atual prevalece onde houver diferença.

## Atualização de execução — 21/11/2026

- Supabase confirmado como `nmkneyzyxxhebkurgimh` / `desenrola-facil-homologacao`, `ACTIVE_HEALTHY`, PostgreSQL 17.12, Free, Oregon. A oitava migração aditiva foi aplicada com versão remota `20261121132758` (nome no histórico: `20261121120000_first_owner_bootstrap`); o prefixo local foi alinhado à versão. A RPC só pode ser executada por `service_role`, exige o e-mail empresarial confirmado, usa lock transacional e não substitui o primeiro proprietário existente.
- Edge Functions `bootstrap-owner`, `meta-webhook`, `asaas-webhook` e `payments` foram publicadas e estão `ACTIVE`. JWT está obrigatório para `bootstrap-owner`, `payments` e `api`; webhooks Meta/Asaas aceitam chamadas sem JWT da plataforma, mas validam assinatura/token do provedor. Meta e Asaas permanecem fechados sem segredos: não há conta conectada nem pagamento processado.
- Consulta SQL remota confirmou existência da RPC, permissões `anon=false`, `authenticated=false`, `service_role=true` e zero proprietários. Chamada fictícia não autorizada foi rejeitada sem criar usuário ou proprietário. Login positivo não pode ser testado até o convite do e-mail empresarial.
- O painel agora suporta convite/definição da primeira senha, recuperação e provisionamento único de proprietária; autoinscrição continua desativada. A URL de retorno e o convite ainda precisam ser configurados no Auth do Supabase após a publicação do painel.
- Testes focados de primeiro acesso: **5/5**; checkout Sandbox e CORS: **8/8**; pacote Render: **3/3**; sintaxe dos módulos web: aprovada; suíte completa final: **69/69**, sem falhas.
- O projeto local foi enviado ao repositório privado `cristianebrittoadvogada-byte/desenrola-facil`, branch `main`, commit `583f8d4`; 87 arquivos do workspace foram incluídos, preservando o painel local, as migrações, a API, os testes e a página. Arquivos transitórios de `work/` e dependências `node_modules/` ficaram de fora. O `.gitignore` raiz exclui ambientes e artefatos de segredo/backup.
- No workspace Render `My Workspace`, a lista de serviços continua vazia. A criação do Blueprint falhou com HTTP 400 porque a integração Render não consegue acessar o repositório/branch/arquivo. Nenhum Blueprint ou site foi criado; não há URL pública. Os sites estáticos não exigem variáveis de ambiente no Render; o painel usa a chave publicável do Supabase no cliente, sem chave privilegiada.
- Auditoria Supabase: os avisos sobre três RPCs `SECURITY DEFINER` correspondem a funções com checagem interna de papel (`owner/admin/finance` ou `owner/admin/commercial`). Três tabelas sem política RLS são filas/configuração internas, sem acesso de usuário final; nenhum aviso novo foi gerado pela RPC de bootstrap.
- Pendência de recuperação remota: backup físico e restauração do banco não foram executados. A migração desta atualização apenas adicionou uma função, sem alterar dados ou tabelas.

**Ações humanas ainda necessárias:** conectar GitHub ao Render em [Account Settings](https://dashboard.render.com/u/settings) → Account Security → Git Deployment Credentials → Add credential → GitHub e autorizar o app Render a acessar somente `cristianebrittoadvogada-byte/desenrola-facil` ([configurar o app Render no GitHub](https://github.com/apps/render/installations/new)). Depois, convidar `desenrolafaciljud@gmail.com` em Supabase Auth e permitir a URL final do painel como redirect. Para ativação real, conectar as contas Meta/Instagram/WhatsApp e Asaas Sandbox e cadastrar tokens em Secrets do Supabase; as ferramentas disponíveis não gerenciam convites Auth nem esses segredos.

## Implementação local preparada

- Migrações `202611190001_fase1_foundation.sql`, `202611190002_meta_channels_foundation.sql`, `202611190003_automation_payments.sql`, `202611200001_business_completion.sql` e `202611200002_contracts.sql`.
- Modelo Postgres de CRM, funil, ofertas, vendas, financeiro, agenda, mentorias, vivências, inscrições, conversas, integrações, consentimento, auditoria e fila.
- Configuração local desativa autoinscrição; a API exige JWT e usa RLS. A configuração remota de Auth ainda não foi auditada.
- A quarta migração restringe escrita direta em vendas, limita colunas de alteração financeira, adiciona provisionamento de usuário apenas por execução confiável, métricas agregadas sob RLS e vínculo de venda confirmada com ciclo do cliente/mentoria.
- Interface responsiva com CRM, catálogo, vendas, financeiro, agenda, vivências/mentorias e atendimento.
- Página comercial responsiva da mentoria em `web/mentoria/`, formulário consent-first, mensagem WhatsApp revisável e eventos de conversão sem PII.
- Código do webhook Meta preparado para registrar consentimento de serviço somente quando receber uma mensagem WhatsApp com declaração explícita; índice único evita repetir a mesma evidência quando implantado.
- Funções de webhook Meta e Asaas, checkout exclusivo Sandbox, agente comercial determinístico e handoff.
- Exportação/criptografia e restauração restrita documentadas em `scripts/db-maintenance.mjs` e `docs/BACKUP-E-RESTORE.md`.

## Estado remoto comprovável

Projeto Supabase confirmado imediatamente antes da implantação: `nmkneyzyxxhebkurgimh`, `desenrola-facil-homologacao`, Free, Oregon (`us-west-2`), `ACTIVE_HEALTHY`.

As sete migrações locais foram aplicadas pelo conector oficial, nessa ordem: `202611190001_fase1_foundation`, `202611190002_meta_channels_foundation`, `202611190003_automation_payments`, `202611200001_business_completion`, `202611200002_contracts`, `20261121010800_trigger_exec_acl_hardening` e `20261121011200_offer_catalog_seed`. O Supabase registrou os timestamps de aplicação próprios `20261121010543`, `20261121010651`, `20261121010658`, `20261121010705`, `20261121010726`, `20261121011131` e `20261121012039`.

Consulta ao banco remoto confirmou 23/23 tabelas públicas com RLS, 52 políticas, 60 índices, ausência de grants de tabela para `anon` e ausência de `EXECUTE` para funções internas de trigger por `anon`/`authenticated`. O teste de negócio remoto usou apenas dados fictícios em uma transação com `ROLLBACK`: venda pendente, recebível, confirmação, ativação de mentoria e isolamento de usuário somente leitura passaram; as tabelas de teste permaneceram sem linhas. As quatro ofertas oficiais foram consultadas no remoto com preço, formato e duração corretos.

A Edge Function `api` está implantada na versão 2, estado `ACTIVE`, `verify_jwt=true`; CORS inclui a URL prevista do painel Render. O runtime aceitou a implantação. Teste HTTP direto não foi possível por restrição de rede do ambiente; login Auth positivo não foi testado nem usuário criado. Não há URL web publicada ainda.

O painel `web/` está fixado no projeto homologado com chave publicável obtida pelo conector Supabase. Login exige usuário autorizado; cadastro público permanece removido. O Blueprint Render separa painel e página comercial, mas ainda não foi implantado.

A CLI oficial Supabase 3.2.0 está instalada como dependência local, mas sem sessão de login. A autenticação remota deste turno ocorreu pelo conector oficial do Supabase; nenhum token, senha ou chave foi lido, copiado ou exibido.

## Segurança e limites

- Migrações são revisadas localmente quanto a RLS, privilégios, ausência de comandos destrutivos e não inserem dados reais.
- A validação remota de RLS foi feita com registros fictícios em transação revertida; o login Auth positivo e a API via usuário autenticado ainda estão pendentes.
- O backup criptográfico foi testado apenas em memória; nenhum dump remoto ou restauração real foi realizado.
- Supabase Free pode pausar por inatividade e não inclui backup automático; uso apenas para homologação fictícia até haver recuperação testada e avaliação de produção.

## Validação local registrada em 20/11/2026

- Testes focados do painel e Blueprint: **25 aprovados, 0 falhas**; `node --check` passou para os arquivos web alterados. Suíte completa executada uma vez: **62 aprovados, 0 falhas**.
- Smoke test do painel local original: **1 aprovado, 0 falhas**. Exercitou configuração/autenticação local, persistência cifrada e limites das integrações em diretório temporário fictício.
- `node --check` do painel, API Edge e módulos Meta revisados: **aprovado**.
- `tests/rls_smoke.sql` contém 32 verificações; testes equivalentes de fluxo de venda/mentoria e isolamento foram executados no banco remoto com registros transitórios e rollback. O arquivo SQL ainda não foi executado com pgTAP.
- `scripts/deploy-staging.ps1` fixa a referência homologada e exige backup cifrado antes da CLI; ainda requer alinhamento dos timestamps de migração MCP/CLI e autenticação CLI antes de uma execução por `db push`.
- A checagem de sintaxe de `web/app.js`, página da mentoria e helper WhatsApp passou. O formulário abre `wa.me/5521967371083`; contatos só chegam ao CRM após envio voluntário pelo WhatsApp e webhook oficial implantado. O pacote privado isolado em `outputs/mentoria-render-release/` contém quatro arquivos da página e `render.yaml`; verificações focadas mais recentes passaram (24/24 banco/consentimento; 2/2 pacote). Ainda não há repositório Render conectado nem URL publicada.
- O backup/exportação física e a restauração isolada ainda não foram executados. O plano Free não inclui backup automático; não se deve usar dados reais até comprovar recuperação.
- A publicação segue sem URL: Render lista o workspace `My Workspace`, mas não o selecionou; GitHub está autenticado, porém não há repositórios visíveis. O pacote privado isolado contém a página e o painel.

## Próximas etapas operacionais

1. Confirmar o workspace Render `My Workspace`, criar um repositório GitHub privado e autorizar Render a acessá-lo.
2. Convidar `desenrolafaciljud@gmail.com` no Auth do Supabase; depois da URL Render, permitir esse redirect no projeto e testar login/API.
3. Inserir credenciais oficiais Meta e Asaas Sandbox em Secrets do Supabase; testar webhooks e checkout fictício.
4. Fazer exportação cifrada e restauração isolada com sessão CLI/credencial PostgreSQL segura; não usar dados reais até validar recuperação.
5. Não executar `db push` até validar os timestamps históricos remotos; não editar a tabela interna manualmente.

Ver [REGISTRO-FASE-1.md](./REGISTRO-FASE-1.md) para o relatório desta execução e [FASE-2-INTEGRACOES.md](./FASE-2-INTEGRACOES.md) para dependências e implantação dos canais.

Consulta de contagem encontrou zero usuários em `auth.users`. O onboarding de proprietária está implantado e aguarda o convite oficial e a confirmação do e-mail.

