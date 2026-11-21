# Módulo Meta — WhatsApp e Instagram

Status: OAuth oficial de Instagram, consulta de Portfólio somente leitura, Vault e publicação por confirmação estão implementados no ambiente de homologação. Nenhuma Meta App foi criada/configurada e nenhuma conta, credencial ou webhook foi conectada ainda.

## Fluxo planejado

Instagram/site → consentimento e captura → contato/identidade de canal → thread de conversa → mensagem normalizada → qualificação e oportunidade no CRM → oferta → checkout em fase posterior. O motor de automação deve registrar a origem, usar respostas aprovadas, respeitar a janela de mensagens e pausar quando a thread entra em handoff humano.

Uma única camada de conversa alimenta CRM e histórico; os adaptadores WhatsApp Cloud e Instagram Messaging permanecem independentes para isolar IDs, permissões, tokens, limites e regras de cada produto. Os estados em integration_settings e conversation_threads não significam que uma API esteja conectada.

## WhatsApp Business Platform — oficial

Usaremos a Cloud API oficial da Meta, endpoint Graph API versionado e webhook do objeto WhatsApp Business Account. A configuração futura exigirá, conforme o tipo de conta/acesso aprovado:

- Meta Developer account e Meta App com o caso de uso WhatsApp.
- Meta Business Portfolio com acesso administrativo à WABA e número comercial.
- WhatsApp Business Account (WABA), Phone Number ID e registro/verificação do número.
- Permissões mínimas previstas: whatsapp_business_messaging para mensagens e whatsapp_business_management para configuração/conta/templates. O nível Standard serve para ativos/usuários com papel na app; Advanced Access e App Review são necessários quando o aplicativo operar para pessoas fora dos papéis de desenvolvimento. A Meta pode exigir Business Verification e análise de uso antes de liberar acesso avançado.
- Webhook HTTPS assinado, inscrito para mensagens, status e eventos necessários da WABA.
- Templates aprovados para mensagens iniciadas pela empresa quando exigidos; consentimento documentado para comunicações promocionais e respeito às regras de janela/categoria e preços vigentes.

Para este projeto, a arquitetura registra opt-in por canal e finalidade; não haverá campanha automática sem base de consentimento. A janela de suporte, templates e custo por mensagem serão revalidados antes de ligar produção.

O uso simultâneo do WhatsApp Business App e da Cloud API com o mesmo número existe em uma oferta oficial de coexistência, mas elegibilidade, país, estado do número e recursos suportados precisam ser confirmados no onboarding Meta. O número atual não será conectado até haver teste de coexistência aprovado pela fundadora.

## Instagram Messaging — oficial

Recomendação para avaliar primeiro: Instagram API with Instagram Login (Business Login for Instagram) para a conta profissional/Creator da empresa. A documentação da Meta informa que esse fluxo não exige uma Página Facebook e usa host graph.instagram.com. Permissões de mensagens do fluxo incluem instagram_business_basic e instagram_business_manage_messages. A aprovação para uso por pessoas externas aos papéis do app pode exigir Advanced Access, Business Verification, App Review e análise de tratamento de dados.

Alternativa: Facebook Login for Business / Messenger API for Instagram, normalmente com conta profissional vinculada a uma Página, token da Página e permissões específicas como pages_messaging, pages_manage_metadata, instagram_basic e instagram_manage_messages. Não misturar permissões/hosts de fluxos distintos; a rota definitiva será escolhida no onboarding, após verificar as configurações reais da conta.

Os webhooks previstos incluem mensagens e eventos necessários para encaminhamento. Para handoff, o CRM muda o controle da thread para human_requested/human_assigned e bloqueia respostas automáticas; se a Meta Conversation Routing/thread control estiver habilitada para aquela conta, o adaptador aguardará o evento de transferência apropriado antes de enviar em nome da empresa. Respostas devem respeitar a janela padrão e a permissão Human Agent quando aplicável.

## Webhooks, tokens e armazenamento

1. Endpoint somente HTTPS; GET de verificação valida hub.mode, hub.verify_token e devolve hub.challenge. App Secret, token Instagram e verify token ficam no Supabase Vault; as funções de acesso ao Vault só podem ser chamadas por service_role.
2. POST lê o corpo bruto e valida X-Hub-Signature-256 (HMAC-SHA256 com App Secret) antes de interpretar JSON. O auxiliar em functions/meta-webhook/security.mjs faz essa validação e tem teste sintético.
3. Validar também produto, IDs de conta assinados e campos permitidos; limitar tamanho, registrar apenas códigos de erro seguros e nunca colocar token ou mensagem completa em logs.
4. Criar chave idempotente estável por conta, ID de mensagem/evento, tipo e timestamp. Registrar metadados/estado/retentativas em integration_events; índice impede duplicação das mensagens normalizadas. Responder rapidamente após persistência segura, processar com tentativas limitadas e fila de falhas.
5. Persistir somente o conteúdo mínimo necessário na conversation_events e identificar thread/contact em conversation_threads e channel_identities. O histórico de communication_consents é append-only; revogação gera um novo registro, sem apagar a evidência anterior. Não baixar ou guardar mídia em Fase 1. Guardar histórico sujeito à política de retenção e exclusão que será definida antes da operação real.
6. Tokens, App Secret e verify token ficam como Supabase Edge Function secrets, separados por produto e ambiente, com rotação/revogação documentadas. integration_settings pode guardar IDs não secretos e nomes de variáveis secretas; nunca o valor do token. A chave service_role só pode ser usada dentro da função servidor e nunca no browser.
7. OAuth state é aleatório, de uso único, armazenado apenas como hash com validade curta em meta_oauth_states. Validar redirect URI exatamente e descartar state após callback.

## Handoff humano e automação

- Thread começa em automation apenas após consentimentos, provedor conectado e regras testadas.
- Pedido explícito de pessoa, baixa confiança, tema não suportado, cobrança contestada ou erro do provedor mudam o estado para human_requested; registra motivo, responsável e próxima ação no CRM.
- Com human_requested/human_assigned, o agente não envia mensagem automaticamente. Reativação exige ação explícita de atendente ou regra aprovada.
- Follow-up comercial é uma tarefa com prazo e política do canal; não contorna janela, template, opt-in ou limites da Meta.
- Respostas geradas por IA precisam de limite de custo, logs sem segredos, respostas padrão para indisponibilidade e opção clara de atendimento humano.

## Contas, aprovações e dados necessários na Fase 2

A fundadora precisará entrar diretamente em Meta Business Suite e Meta for Developers. Não enviar senhas ou códigos de autenticação no chat. A lista exata será validada no painel:

- Acesso administrativo às contas empresariais, Instagram profissional e WABA/número escolhido.
- Uma Meta App em Development Mode, contas de teste e webhooks de teste.
- App Instagram com Business Login, Instagram App ID/Secret e permissão de publicação; App Secret será cadastrado no painel HTTPS e guardado no Vault. O OAuth valida a conta-alvo `@cristianebritto.desenrola` e persiste token longo criptografado.
- Callbacks a registrar na Meta: `https://nmkneyzyxxhebkurgimh.supabase.co/functions/v1/meta-instagram-oauth-callback` e `https://nmkneyzyxxhebkurgimh.supabase.co/functions/v1/meta-business-oauth-callback`.
- Para consultar o vínculo do Portfólio, habilitar Facebook Login e `business_management`; o fluxo consulta apenas `me/businesses`, `owned_instagram_assets` e `client_instagram_assets`, sem alterar ativos.
- O verify token do webhook é gerado no Vault e pode ser revelado sob demanda no painel autenticado; o endpoint validará assinatura HMAC com o App Secret.
- Se a integração for usada com clientes fora das funções da app: Business Verification, App Review/Advanced Access, Data Use Checkup e políticas de privacidade/deleção de dados conforme a avaliação Meta.
- Para produção: consentimento da pessoa, templates e regras de mensagem; teste de coexistência do número WhatsApp; teste de janela, handoff, reentrega e duplicação de webhooks.

Os endpoints OAuth e webhook estão publicados no projeto Supabase de homologação. Ainda não houve login Meta, leitura real do perfil/Portfólio, teste de publicação ou inscrição do webhook porque a Meta App e a autorização da titular não estão configuradas.



## Referências oficiais consultadas

- [WhatsApp Business Platform overview e Cloud API](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview)
- [WhatsApp Business Account e permissões](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/)
- [Meta Webhooks: HTTPS, challenge, X-Hub-Signature-256 e retentativas](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)
- [Instagram Messaging overview](https://developers.facebook.com/documentation/business-messaging/instagram-messaging)
- [Instagram Login: permissões novas e ausência de exigência de Página](https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/)
- [Business Login para Instagram: OAuth, permissões atuais e renovação do token](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Instagram assets no Portfólio empresarial](https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/instagram-accounts)
- [Webhooks de Instagram](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram)
- [Changelog Instagram Messaging e Conversation Routing](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/changelog/)
- [Meta: Standard Access, Advanced Access e acesso a pessoas fora da função do app](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/data-handling-questions/faqs/)
