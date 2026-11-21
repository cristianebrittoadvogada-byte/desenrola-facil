# Arquitetura de integrações — Desenrola Fácil®

**Estado atual:** documentação e registros locais apenas. Nenhum provedor foi autenticado, contratado ou conectado.

## Princípios

- Cada provedor deve ser implementado atrás de um adaptador do domínio. O CRM, o calendário e o financeiro não devem depender diretamente de SDK proprietário.
- `enabled` permanece falso até a integração passar por revisão, testes e autorização da fundadora.
- Tokens, chaves, senhas OAuth e segredos de webhook não podem ser armazenados no HTML, JavaScript do navegador, banco de dados do painel, CSV ou Git.
- Em uma implantação futura, guardar segredos somente em variáveis de ambiente protegidas ou cofre de segredos do servidor. Nunca solicitar cartão ou credencial bancária neste painel.
- Conservar ID interno e ID externo com vínculo explícito, registrar sincronização e erro sem despejar dados pessoais nos logs.
- Webhooks devem validar assinatura, tolerar campos novos, ser idempotentes e confirmar eventos consultando o provedor quando necessário.
- A operação manual permanece disponível como fallback. Falha de integração não pode criar venda duplicada ou confirmar recebimento indevido.

## Interfaces de domínio planejadas

```text
ContactRepository
  createOrUpdateContact(localContact)
  findContactByExternalId(provider, externalId)

MessageChannel
  createClickToChatLink(phone, approvedMessage)
  // Envio automatizado ainda não implementado.

PaymentProvider
  createCharge(sale) -> externalChargeId + checkoutUrl
  getChargeStatus(externalChargeId)
  verifyWebhook(request) -> verifiedEvent
  // A venda só é Recebida depois de evento verificado ou consulta autenticada.

CalendarProvider
  createOrUpdateEvent(appointment)
  // O calendário interno permanece a fonte operacional até a conexão real.

FileProvider
  exportBackup(data)
  // Drive/Workspace não conectado.
```

## Matriz de provedores

| Provedor | Uso futuro | Configuração esperada | Estado atual |
|---|---|---|---|
| Gmail atual | Notificações comerciais enviadas com consentimento | OAuth escopado, remetente verificado, modelos aprovados | Manual; nenhum e-mail é enviado pelo painel |
| WhatsApp atual | Abrir conversa comercial | Link `wa.me` para clique manual; mensagem revisada | Manual; sem API ou envio automático |
| Canva Sites | Direcionar visitantes a formulário/WhatsApp | URL pública e parâmetros de origem aprovados | Site institucional; sem leitura automática do Canva |
| Google Workspace | Agenda e armazenamento empresariais | OAuth, scopes mínimos, Calendar/Drive selecionados | Não contratado/não conectado |
| Kommo | CRM/canais sociais | URL de conta, token guardado no servidor, mapeamento de contatos e pipeline | Não contratado/não conectado |
| Asaas | Cobranças Pix/cartão e eventos financeiros | Chave de API em segredo no servidor, webhook validado, ambiente sandbox | Não contratado/não conectado |
| WhatsApp Business Platform | Caixa de entrada/API futura | Conta Meta Business, número, templates e autorização aplicável | Não conectado |

## Campos não secretos de configuração

Quando uma integração for planejada, o painel pode guardar: provedor, finalidade, responsável, ambiente (`sandbox`/`produção`), escopos planejados, estado, referência de documentação, data da última revisão e nota de implantação. Segredos ficam fora do painel e devem ser fornecidos pelo administrador do servidor somente quando a fundadora aprovar a conexão.

## Roteiro de habilitação futura

1. Validar necessidade, custo recorrente, termos do provedor e impacto nos dados.
2. Definir campos compartilhados, finalidade, retenção e permissão por função.
3. Implementar adaptador isolado e configuração não secreta.
4. Armazenar segredos no ambiente seguro do servidor.
5. Executar testes em sandbox e validar logs, reprocessamento, duplicidade e fallback manual.
6. Obter aprovação expressa da fundadora para conectar a conta real e mudar o estado para conectado.
7. Monitorar falhas, revisar escopos e permitir desligamento sem perda do cadastro interno.
