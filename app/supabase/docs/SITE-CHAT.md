# Assistente comercial da página da mentoria

## Estado deste branch

O chat comercial está preparado no código, mas permanece desativado até que a função seja implantada no projeto correto e as credenciais do provedor sejam adicionadas pelo painel oficial. Nenhuma credencial foi gravada, nenhuma chamada de IA foi feita e não houve deploy.

O projeto Supabase padrão em `config.toml` é a homologação. A implantação futura em produção precisa indicar explicitamente `majpjlklkbswvvxwpvdm`:

```sh
supabase functions deploy site-chat --project-ref majpjlklkbswvvxwpvdm
```

## Segredos e custo

O código usa os valores padrão de Edge Functions `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` somente no servidor, para consultar uma oferta ativa e confirmada. O navegador recebe apenas a chave publicável já usada pela página.

Para habilitar o modelo depois de uma decisão de custo, devem ser adicionados em Edge Function Secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

O endpoint fica indisponível se qualquer requisito faltar ou se a oferta da mentoria não estiver ativa com o valor confirmado de R$ 3.000. Não existe fallback para OpenAI nem chamada de modelo sem essas credenciais.

Cloudflare documenta uma alocação gratuita de 10.000 Neurons por dia no plano Workers Free; pedidos acima dessa alocação falham nesse plano. No Workers Paid, o uso acima da cota gratuita é cobrado a US$ 0,011 por mil Neurons. O código não consegue verificar qual plano está ativo. Portanto, para manter custo adicional zero, a titular deve confirmar no painel da Cloudflare que a conta está no Workers Free antes de adicionar as credenciais. Não habilitar em uma conta paga sem autorização expressa.

Fontes oficiais consultadas em 25/11/2026:

- [Preço e cota do Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Tratamento de dados pelo Workers AI](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- [Endpoint compatível com Chat Completions](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)

## Dados, consentimento e CRM

- A caixa de ciência informa que a pergunta e até sete mensagens anteriores serão processadas por IA e que o conteúdo não será salvo no CRM. O controle de envio permanece desativado até a pessoa marcar a ciência.
- O histórico fica limitado à sessão da página e é enviado somente ao endpoint da função. E-mail, telefone e CPF que correspondam aos padrões reconhecidos são removidos no servidor antes de enviar a Cloudflare; a filtragem não identifica todos os dados pessoais.
- A função não grava mensagens, histórico ou textos livres no CRM. O botão para pedir retorno leva ao formulário existente, cujo fluxo `lead-intake` requer consentimento separado e cadastra apenas os campos de contato autorizados.
- A origem é limitada ao domínio da página comercial e aos endereços locais de desenvolvimento. Há limite de tamanho de requisição, de mensagens e de respostas, timeout e limite de requisições por endereço por instância. O limitador é volátil e não substitui uma proteção distribuída contra abuso.
- Assuntos jurídicos, clínicos, financeiros individualizados e termos associados a sofrimento/risco são desviados para uma mensagem segura e para o formulário, sem chamada ao modelo.

## Comportamento sem credenciais

Sem as credenciais de Cloudflare, ou enquanto a oferta não passar pela verificação do catálogo, o endpoint responde que o chat não está configurado. O navegador mantém o campo de envio desabilitado e oferece o formulário de retorno já existente. O site continua apresentando a oferta, o preço e as opções atuais de contato.

## Limites da integração

- O assistente atende somente dúvidas comerciais da Mentoria Desenrola Fácil; não envia WhatsApp, não responde Instagram e não confirma agendamento, vagas ou pagamento.
- O chat não cria lead por si só. A pessoa precisa optar pelo formulário e consentir separadamente para que os dados mínimos de contato sejam enviados ao CRM.
- CORS e a chave publicável do Supabase não autenticam o visitante contra clientes HTTP fora do navegador; o limite por endereço é apenas best-effort por instância. Antes de ativar, revisar o limite de gasto no provedor e a política de abuso.
- A página comercial do Render continua com seus botões levando ao WhatsApp. O checkout público da InfinitePay é uma rota de compra separada e não está presente nesses botões neste branch.
