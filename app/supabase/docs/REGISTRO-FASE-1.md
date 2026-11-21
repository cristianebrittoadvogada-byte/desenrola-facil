# Relatório de execução — Fase 1 e preparação da Fase 2

Atualizado em 21/11/2026. O painel local `app/server.mjs` e os arquivos locais existentes foram preservados. O relatório abaixo registra a execução de 20/11; esta atualização é a evidência mais recente.

## Execução atual — 21/11/2026

- Confirmado o projeto Supabase correto e ativo antes da alteração. Aplicada a migração aditiva com versão remota `20261121132758`; o histórico passou a ter 8 entradas. A função confirma o usuário em `auth.users`, limita o e-mail, serializa chamadas concorrentes e não concede acesso público.
- Publicadas as Edge Functions `bootstrap-owner`, `meta-webhook`, `asaas-webhook` e `payments`. Todas estão `ACTIVE`. Endpoints: `https://nmkneyzyxxhebkurgimh.supabase.co/functions/v1/bootstrap-owner`, `/meta-webhook`, `/asaas-webhook` e `/payments`.
- Verificação remota da RPC: existe; `anon` e `authenticated` não podem executá-la; `service_role` pode. O teste remoto com UUID e e-mail fictícios foi recusado e a contagem continuou em zero proprietários.
- A suíte completa final foi executada uma vez depois das alterações: **69 aprovados, 0 falhas**. Testes focados do onboarding: **5/5**; checkout Sandbox/CORS: **8/8**; pacote Render: **3/3**; sintaxe dos módulos web passou.
- Meta/Asaas ainda não estão conectados: as funções fecham com indisponibilidade sem os segredos. Nenhuma cobrança ou mensagem externa foi enviada.
- GitHub informa sessão autenticada, porém nenhum repositório disponível e não há ferramenta de criação de repositório. O workspace Render `My Workspace` foi usado explicitamente na consulta e não tem serviços existentes. A página e o painel ainda não foram publicados e não há URL pública.
- Não há usuário Supabase Auth; por isso, login, recuperação real e autorização de módulos ainda aguardam o convite e a confirmação da proprietária. O Auth remoto ainda precisa permitir o redirect da URL pública final.

Nenhum serviço foi contratado, nenhuma integração paga foi habilitada e nenhuma credencial foi lida ou exibida.

## O que foi preparado no workspace

- Revisadas e corrigidas as migrações `202611190001_fase1_foundation.sql` e `202611190002_meta_channels_foundation.sql`.
- Criada a migração aditiva `202611190003_automation_payments.sql` com fila de automação, referências de clientes/cobranças Asaas, RLS, RPC de identidade Meta e reserva única de checkout por venda.
- Criada a migração aditiva `202611200001_business_completion.sql` para restringir escrita direta em vendas/financeiro, provisionar usuários por caminho confiável, agregar indicadores sob RLS e criar/ativar mentorias vinculadas às vendas.
- Criada a migração aditiva `202611200002_contracts.sql` e o módulo de contratos: rascunhos vinculados a vendas, histórico de envio e assinatura, texto editável somente antes do envio, trilha de auditoria e RLS por função. A ação de assinatura permanece um registro manual; não representa assinatura eletrônica.
- Expandida a API autenticada para CRM, ofertas, funil, vendas, financeiro, agenda, mentorias, vivências, inscrições, conversas e handoff.
- Expandida a interface responsiva para esses módulos; a URL homologada e a chave publicável ficam em `web/app-config.js`, e o access token fica apenas em memória.
- Preparados endpoints de webhook oficial da Meta e Asaas Sandbox, motor comercial determinístico, autenticação dos callbacks, deduplicação e tratamento de erros.
- Criado checkout Asaas limitado ao host Sandbox; exige usuário autorizado e envia CPF/CNPJ diretamente ao provedor sem armazená-lo no CRM ou em logs.
- A confirmação da venda consulta o pagamento diretamente no Asaas. `PAYMENT_CONFIRMED` ativa a inscrição sem marcar saldo como disponível; somente `PAYMENT_RECEIVED` liquida a entrada financeira.
- O cliente HTTP Asaas envia `User-Agent` conforme exigido pela documentação oficial para novas contas.
- Respostas automáticas Meta são limitadas à janela de atendimento de 24 horas, informam que o atendimento é virtual, não enviam marketing, não usam LLM externo e transferem mídia, pedidos de pessoa, questões sensíveis e falhas para a equipe.
- Adicionado acompanhamento interno de oportunidade quando o lead demonstra interesse por uma oferta. Não há disparo automático de follow-up fora da janela autorizada.
- O painel agora usa métricas agregadas do servidor, edita a etapa do contato, permite reagendar follow-ups e configura duração numérica das ofertas para ativar mentorias com encerramento calculado.
- Corrigida exceção ao receber mensagem WhatsApp marcada como texto mas sem corpo; o evento passa para handoff humano.
- Criada a página comercial responsiva da mentoria, com nome, WhatsApp, objetivo, consentimento apenas para resposta, mensagem revisável, validação de telefone e eventos anônimos de conversão locais. O código do webhook Meta está preparado para associar a mensagem recebida ao contato e registrar consentimento de serviço com deduplicação quando for implantado; nenhum envio direto para o CRM foi simulado.
- Criado `scripts/deploy-staging.ps1` com ref fixada, validação de migrações, listagem remota, dry-run e implantação sem secrets, Vault ou seed.

## Verificações locais

- Testes focados de configuração do painel, login, CORS e Blueprint: **25 aprovados, 0 falhas**; `node --check` passou para `web/app.js` e `web/app-config.js`. Depois, a suíte completa foi executada uma vez: **62 aprovados, 0 falhas**.
- Smoke test da aplicação local original: **1 aprovado, 0 falhas**; inicialização, autenticação, persistência cifrada e fronteiras de integração foram exercitadas com dados fictícios em diretório temporário.
- `node --check` passou para a interface, API e módulos Meta revisados.
- O script de deploy foi revisado por análise estática, mas não foi executado contra o remoto.
- O Blueprint Render agora separa dois sites gratuitos, a página comercial e o painel. Os arquivos da página continuam no pacote privado isolado `outputs/mentoria-render-release/`. Não há repositório remoto acessível nem URL pública para informar.
- `tests/rls_smoke.sql` contém agora 32 verificações de privilégios, fluxo de venda/mentoria e capacidade de vivências; ainda depende de PostgreSQL e pgTAP para execução real.
- Os testes locais não substituem o login e a chamada HTTP autenticada em produção de homologação.
- Node.js 24.22.3 detectado. npm não está instalado; pnpm 11.25.0 está disponível. A CLI oficial Supabase 3.2.0 foi instalada como dependência de desenvolvimento em `app/supabase/package.json`, sem custo. A verificação oficial `supabase projects list`, com configuração isolada, retornou `AccessTokenRequiredError`: não há autenticação CLI disponível no ambiente.

## Evidência remota registrada em 20/11/2026

- Projeto confirmado imediatamente antes da publicação: `nmkneyzyxxhebkurgimh`, `desenrola-facil-homologacao`, Free, `ACTIVE_HEALTHY`, região Oregon (`us-west-2`).
- Sete migrações estão no histórico remoto: as cinco migrações base (`202611190001` a `202611200002`), `20261121010800_trigger_exec_acl_hardening` e `20261121011200_offer_catalog_seed`. O Supabase MCP atribuiu versões de aplicação `20261121010543`, `20261121010651`, `20261121010658`, `20261121010705`, `20261121010726`, `20261121011131` e `20261121012039`, nessa ordem.
- Consulta remota verificou 23/23 tabelas públicas com RLS, 52 políticas e 60 índices; não há grants de tabela a `anon`. Os gatilhos internos não têm `EXECUTE` para `anon`/`authenticated`; as funções privilegiadas expostas checam função do usuário.
- Teste remoto de negócio usou registros fictícios dentro de transação encerrada com `ROLLBACK`: criação de venda/conta a receber, confirmação, ativação de mentoria, restrição de escrita direta e isolamento de perfil somente leitura passaram. Nova consulta confirmou zero linhas residuais nas tabelas de teste.
- O catálogo remoto contém as quatro ofertas oficiais informadas pela empresa, com preços e duração correspondentes.
- API Edge `api` implantada no projeto (versão 2, `ACTIVE`, `verify_jwt=true`); CORS inclui a URL prevista do painel Render. A implantação foi aceita pela plataforma; uma chamada HTTP autenticada não foi possível neste ambiente, e nenhum usuário Auth foi criado.
- O painel web está fixado no projeto homologado, com chave publicável, login por e-mail/senha, cadastro público removido e JWT em memória. Nenhuma chave service_role está no cliente.
- O Blueprint Render foi ampliado para publicar painel e página em sites estáticos separados. Ele ainda não foi criado no Render nem implantado.
- Não há dados fictícios persistentes de cliente. Os únicos registros de negócio são as quatro ofertas seed e os registros de auditoria de migração.

## O que ainda não foi comprovado

- Backup/exportação e restauração reais: não executados. Supabase Free não oferece backup automático; a orientação oficial é exportar manualmente com CLI. O teste anterior do script de criptografia foi local, não é backup do banco remoto.
- Login positivo de um usuário e acesso autorizado à API: não testados, pois não há conta Auth owner provisionada. A validação remota de RLS e o bloqueio das funções administrativas foram feitos com consultas de banco.
- Não há URL pública para a página/painel. O endereço `https://nmkneyzyxxhebkurgimh.supabase.co` é somente a API.
- WhatsApp/Instagram e Asaas permanecem sem credenciais ou aprovação de conta; os handlers agora estão implantados, mas retornam indisponível até configuração segura dos secrets e webhooks.
- As sete migrações históricas têm versões remotas MCP diferentes dos prefixos locais. A nova migração usa o timestamp remoto `20261121132758`; não foi feita escrita manual na tabela interna. Validar o histórico antes de `db push`.

## Acessos externos que ainda faltam — estado em 21/11

- **Render/GitHub:** sessão GitHub autenticada sem repositórios visíveis; Render lista `My Workspace`, mas nenhuma seleção foi feita. O conector GitHub não cria repositórios. Falta criar o repositório privado e confirmar o workspace/autorizar o vínculo.
- **Supabase Auth:** zero usuários Auth. Falta convite da proprietária e inclusão do redirect público real. Não há ferramenta de Auth Admin no conector.
- **Meta/Asaas:** sem conectores ou credenciais. As Edge Functions foram implantadas; faltam contas, permissões, secrets e configuração dos webhooks. Não enviar chaves pelo chat.
- **Backup:** CLI sem login e conector sem exportação/restauração; backup físico e restauração real continuam pendentes.

Nenhum segredo foi extraído ou exibido. Nenhum serviço foi contratado e não houve upgrade.

## Custos e limites

- Despesa gerada por este trabalho: **R$ 0,00**. Nenhum serviço foi contratado e nenhuma chamada a Meta/Asaas foi realizada.
- O projeto informado permanece no plano Free. O plano inclui 500 MB de banco e 50 mil usuários ativos mensais, não inclui backup automático e pode pausar projetos após uma semana de inatividade. Isso é adequado para homologação com dados fictícios, mas não atende à garantia operacional de uma empresa em produção. Consulte os [limites e preços oficiais da Supabase](https://supabase.com/pricing).
- O script local de backup criptografado teve seu formato testado em memória; não foi produzido dump do projeto real nem restaurado um banco. O Free da Supabase não inclui backups automáticos. Uma rotina manual exigirá ferramenta de dump, chave de criptografia sob custódia da empresa e teste de restauração isolado.
- As tarifas de pagamento, quando ativadas, serão variáveis e cobradas por transação. Nenhuma cobrança foi feita no Sandbox. As taxas publicadas pelo Asaas variam por modalidade e contrato; consulte [Preços e taxas do Asaas](https://www.asaas.com/precos-e-taxas) antes de produção.

## Estado de conclusão

**A fundação PostgreSQL e a API autenticada foram implantadas e tiveram validação remota parcial. A Fase 1 ainda não está concluída:** falta backup/restauração real, login positivo e publicação da interface. A Fase 2 segue com handlers oficiais preparados/testados localmente, mas Meta/Asaas ainda não estão conectados a contas reais ou Sandbox. O painel local continua intacto.

Consulta de contagem encontrou zero usuários em `auth.users`. O conector Supabase disponível não oferece a operação Auth Admin para convite; o titular precisa criar/invitar o primeiro usuário pelo fluxo oficial. Depois disso, a função existente `provision_company_user` poderá conceder o papel `owner` sem compartilhar senha no chat.
