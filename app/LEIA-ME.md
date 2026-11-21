# Painel local — Desenrola Fácil®

Aplicação inicial de uso local, feita com Node.js e APIs nativas, sem dependências npm, assinatura, conta externa ou serviço pago.

## Iniciar

1. Instale Node.js 20 ou superior, caso ainda não esteja instalado.
2. Abra um terminal nesta pasta `app`.
3. Execute `node server.mjs`.
4. Acesse `http://127.0.0.1:4177` no navegador deste computador.
5. No primeiro acesso, crie uma senha forte com pelo menos 12 caracteres.

O servidor aceita conexões somente em `127.0.0.1` (este computador). Não publique a porta na internet ou na rede local.

## Dados e privacidade

- Os dados operacionais ficam em `app/data/company.json`, criptografados com AES-256-GCM. A chave é derivada da senha usando scrypt e fica somente na memória do servidor durante a sessão.
- O arquivo `app/data/auth.json` guarda salt e hash da senha, nunca a senha em texto simples.
- A sessão expira após até 8 horas sem atividade ou quando o servidor é encerrado.
- O botão **Exportar backup** baixa um JSON legível e **não criptografado**. Guarde-o em local protegido. O botão **Importar backup** restaura um backup compatível após confirmação e antes baixa uma cópia de segurança dos dados atuais.
- Esquecer a senha impede a leitura dos dados criptografados. Não apague `auth.json` para “recuperar” a conta: isso não descriptografa os dados. Preserve a senha e backups seguros.
- Evite registrar relatos de sessão, informações clínicas, dados de pagamento completos, documentos pessoais ou dados bancários. O cadastro serve para operação comercial e acompanhamento mínimo.
- “Recebido” significa que uma pessoa conferiu manualmente o pagamento. O painel não consulta banco nem gateway.

## O que já funciona

- Cadastro e edição de contatos com perfil, origem, etapa e próxima ação.
- Registro de vendas. A venda entra como pendente e cria um item a receber.
- Confirmação manual do recebimento, que atualiza a venda, o financeiro e o perfil do cliente. Vendas de mentoria também criam uma jornada com onboarding pendente.
- Lançamentos manuais de receita e despesa; marcação de receita recebida ou despesa paga; resumo de caixa, valores a receber e despesas pagas.
- Agenda interna de mentorias, atendimentos e vivências; edição histórica de referência da vivência de 13 a 15/11/2026.
- Acompanhamento operacional de mentorias.
- Cadastro e edição de ofertas e preços sem mexer no código; alterações de preço ficam registradas no histórico do produto.
- Exportação de contatos e financeiro para CSV e backup geral para JSON.
- Documentação e estados de integrações futuras. Todos permanecem desligados.

## Limites conhecidos desta versão

- Sem sincronização entre computadores, usuários ou celulares.
- Sem envio de e-mail/WhatsApp, captura automática de formulários, API de pagamento, nota fiscal, recibo fiscal ou conciliação bancária.
- A senha protege a aplicação e a base local, mas os backups baixados são texto simples.
- Não substitui contabilidade, emissão fiscal, gestão clínica, armazenamento documental seguro ou revisão jurídica.
- Não existe recuperação de senha automatizada.

## Verificações locais

Na pasta `app`, execute `node --check server.mjs`, `node --check public/app.js` e `node --test test/smoke.mjs`. O teste HTTP usa diretório temporário, testa instalação, login, persistência criptografada e limites de integração, e não usa dados reais da empresa.
