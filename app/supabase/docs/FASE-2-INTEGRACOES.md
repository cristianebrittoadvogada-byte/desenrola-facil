# Fase 2 — integrações oficiais e ativação controlada

Este documento descreve a arquitetura já preparada localmente. **Nada aqui está conectado a contas externas ou publicado no Supabase.**

## Componentes prontos no código

| Componente | Implementação local | Validação realizada |
|---|---|---|
| API autenticada | Edge Function `api` com JWT e RLS para os módulos empresariais | Testes locais e revisão estática |
| Agente comercial | Regras determinísticas e catálogo ativo; sem provedor de LLM | Testes locais de intenções, preço e handoff |
| Webhook Meta | HMAC sobre bytes originais, challenge, deduplicação, CRM, histórico, status WhatsApp e roteamento de controle Instagram | Testes locais de assinatura e normalização |
| Envio Meta | WhatsApp Cloud API oficial e Instagram API com Instagram Login | Testes do construtor HTTP com `fetch` simulado |
| Atendimento | Janela de 24 horas, transparência de automação, handoff e oportunidade qualificada | Regras locais; não testado em conta Meta |
| Checkout Asaas | Endpoint Sandbox apenas, reserva por venda, dados fiscais transitórios | Testes com `fetch` simulado |
| Webhook Asaas | Token exclusivo, leitura do pagamento pela API Sandbox, checagem de ID, referência e valor | Testes de lógica; não testado em conta Asaas |
| Financeiro | Confirmação da venda e liquidação contábil em estados separados | Inspeção SQL e testes de lógica |

## Página comercial da mentoria

`web/mentoria/` contém uma página responsiva, independente do CRM, com investimento, duração, modalidades e formulário. O formulário exige nome, WhatsApp, objetivo e autorização para retorno; prepara um texto para `+55 21 96737-1083` e só compartilha os dados quando a pessoa revisa e envia no WhatsApp. Eventos sem dados pessoais ficam no `dataLayer` e na sessão do navegador. Não há postagem direta nem integração CRM simulada. Quando o webhook oficial for implantado, a mensagem recebida cria/resolve o contato no CRM e registra apenas o consentimento explícito de atendimento como evidência de serviço, nunca marketing.

Não foi publicada. O Blueprint em `pra/render.yaml` prepara um site estático gratuito que publica somente `web/mentoria/` e aplica cabeçalhos de segurança. O Render exige conta e repositório Git conectado; nenhum deles está conectado aqui, portanto ainda não existe URL pública. O plano de sites estáticos é gratuito, com limites de banda e minutos de build descritos na documentação oficial.

## URLs de função após deploy

- API autenticada: `https://<project-ref>.supabase.co/functions/v1/api`
- Recepção Meta: `https://<project-ref>.supabase.co/functions/v1/meta-webhook`
- Recepção Asaas Sandbox: `https://<project-ref>.supabase.co/functions/v1/asaas-webhook`
- Checkout Asaas Sandbox: `https://<project-ref>.supabase.co/functions/v1/payments`

O domínio base do projeto é conhecido, mas essas rotas só existirão depois que as migrações e funções forem implantadas.

## Credenciais (somente pelo painel seguro de secrets do Supabase)

Não salvar valores em arquivos, HTML, repositório, histórico de terminal, logs ou chat.

| Nome do secret | Uso |
|---|---|
| `META_APP_SECRET` | Validar `X-Hub-Signature-256` do webhook Meta |
| `META_WEBHOOK_VERIFY_TOKEN` | Challenge inicial do webhook Meta |
| `META_GRAPH_VERSION` | Versão Graph aprovada no momento do deploy |
| `WHATSAPP_PHONE_NUMBER_ID` | Número habilitado para Cloud API |
| `WHATSAPP_ACCESS_TOKEN` | Token de sistema da WABA |
| `INSTAGRAM_ACCOUNT_ID` | Conta profissional conectada |
| `INSTAGRAM_ACCESS_TOKEN` | Token de acesso Instagram Login |
| `ASAAS_SANDBOX_API_KEY` | Somente chave do Sandbox Asaas |
| `ASAAS_WEBHOOK_AUTH_TOKEN` | Token próprio do webhook, diferente da chave de API |
| `WEB_ORIGIN` | Origem HTTPS exata do painel para CORS |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são consumidos pelas funções do Supabase. A chave `service_role` fica somente em execução de servidor e nunca no navegador.

## Preparação necessária na Meta

1. Conta/portfólio empresarial Meta sob administração da fundadora.
2. Aplicativo em Meta for Developers com casos de uso de mensagens e webhook.
3. WhatsApp Business Account, número comercial elegível e verificado, ID do número e token de usuário de sistema.
4. Revisar acesso avançado, verificação empresarial e permissões `whatsapp_business_messaging` e `whatsapp_business_management` para o modo de produção.
5. Registrar callback `/functions/v1/meta-webhook`, token de verificação e assinatura HMAC; subscrever eventos de mensagens e status.
6. Antes do número atual entrar em uso, verificar elegibilidade e condições de coexistência com o WhatsApp Business App. A documentação atual da Meta oferece caminhos de coexistência, mas a disponibilidade depende do onboarding/conta; nenhum registro do número foi iniciado.
7. Para Instagram, usar conta profissional e fluxo Instagram Login oficial, habilitar permissões `instagram_business_basic` e `instagram_business_manage_messages`, registrar webhook e concluir revisão de app/conta quando solicitada.
8. Confirmar política de privacidade, aviso de atendimento virtual, consentimentos e procedimento de transferência humana antes de mensagens reais.

A nova API oficial Instagram Login usa `graph.instagram.com` e as permissões de negócio `instagram_business_*`; a Meta documenta que uma Página do Facebook deixou de ser requisito para esse caminho. Consulte o [changelog oficial Instagram API](https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/). A Meta também lista Cloud API, Webhooks, permissões e regras de preço no [overview oficial de WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview).

O atendimento atual responde somente a uma mensagem recebida e dentro da janela padrão de 24 horas. Não existem mensagens proativas, templates de marketing, campanhas ou retries de envio que possam duplicar uma resposta. Eventos Instagram `pass_thread_control`, `take_thread_control` e `request_thread_control` param o agente ou encaminham a conversa para revisão humana; não há retomada automática de controle. Isso acompanha o roteamento da Meta, que pode impedir respostas quando outro app/Business Agent controla o tópico ([política e changelog de mensagens Instagram](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/changelog/), [referência oficial de webhook](https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram)).

## Preparação necessária no Asaas

1. Conta Asaas criada e Sandbox habilitado sob titularidade da empresa.
2. Gerar chave do Sandbox e token de autenticação separado para o webhook.
3. Registrar o webhook `/functions/v1/asaas-webhook` para os eventos `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED` e eventos de estorno relevantes.
4. Configurar `asaas-access-token` com o token dedicado. Nunca usar a chave da API como token do webhook.
5. Testar no Sandbox com pagador e contatos fictícios.

O webhook recebe um evento, consulta a cobrança diretamente no Sandbox e valida valor, referência interna da venda e ID da cobrança antes de alterar o CRM. O Asaas documenta entrega pelo menos uma vez, idempotência pelo ID do evento e estados distintos para confirmação e disponibilidade do saldo; a aplicação respeita essa distinção. Consulte [Sandbox](https://docs.asaas.com/docs/sandbox-2), [eventos de pagamento](https://docs.asaas.com/docs/payment-events), [idempotência](https://docs.asaas.com/docs/how-to-implement-idempotence-in-webhooks) e [segurança do webhook](https://docs.asaas.com/docs/receive-asaas-events-at-your-webhook-endpoint).

O código de checkout fica permanentemente no host `api-sandbox.asaas.com`. A produção não está habilitada e exigiria uma alteração deliberada, revisão de segurança, credencial própria e confirmação do orçamento. Taxas transacionais não são custo fixo e variam por método, contrato e data; consultar o [preçário oficial](https://www.asaas.com/precos-e-taxas) antes de qualquer recebimento real.

## Limites operacionais e políticas

- Atualmente o agente é determinístico e não incorre em custo de API de IA. Em futuras integrações de LLM, limites de orçamento e retenção devem ser configurados antes de enviar conteúdo de conversa.
- Os termos correntes da WhatsApp Business Solution tratam uso de provedores de IA e proíbem usar dados da solução para criar/treinar modelos de terceiros; há tratamento específico para usuários com telefone do Brasil/EEE. O projeto não faz treinamento e não envia conversas a modelo externo ([termos oficiais](https://www.whatsapp.com/legal/business-solution-terms/)).
- Não há follow-up automático fora da janela. A próxima etapa de automação precisa incorporar consentimento/opt-in, templates aprovados quando exigidos e limites do provedor.
- Falhas de integração são registradas com códigos seguros; payload bruto, tokens e documentos fiscais não são armazenados em log.
- A homologação atual está em região Oregon, EUA. Não carregar dados reais antes de análise de segurança, retenção, backups, transferência internacional aplicável e termos do provedor.

## Implantação proposta quando o CLI estiver autenticado

1. Conferir o destino da CLI como `nmkneyzyxxhebkurgimh` e plano/região no dashboard.
2. Aplicar `202611190001`, `202611190002`, `202611190003` e `202611200001` na ordem; listar histórico e validar tabelas/RLS/RPCs.
3. Executar `tests/rls_smoke.sql` com rollback e usuários sintéticos; registrar resultado.
4. Provisionar proprietário por canal seguro e validar JWT/RLS com funções `owner`, `commercial`, `finance` e `read_only`.
5. Configurar secrets não produtivos, implantar Edge Functions e fazer testes HTTP assinados com IDs/mensagens fictícias.
6. Exportar dump cifrado e restaurar em Postgres isolado; comparar esquema/contagens sem tocar no banco de homologação.
7. Hospedar `web/` em uma origem HTTPS gratuita de site estático, configurar `WEB_ORIGIN` e URLs de autenticação. Cloudflare Pages Free é uma opção; limites do plano estão na [documentação oficial](https://developers.cloudflare.com/pages/platform/limits/). Não há conta Cloudflare vinculada, site publicado ou URL disponível.
8. Somente após homologação e autorização do operador da empresa, conectar Meta e Asaas Sandbox. Não usar produção nesta etapa.
