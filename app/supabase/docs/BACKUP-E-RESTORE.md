# Exportação, backup e restauração

As rotinas usam pg_dump e pg_restore e Node.js nativo. Senhas não ficam no repositório.

## Variáveis locais

Defina no terminal seguro ou em um gerenciador de segredos, nunca em mensagem/chat:

- PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
- PGSSLMODE=require para conexões remotas
- BACKUP_ENCRYPTION_KEY: 32 bytes em Base64; gere localmente com node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))" e guarde-a separada do arquivo de backup.
- BACKUP_PATH: destino do arquivo .dfb.
- EXPORT_PATH e EXPORT_CONFIRM=EXPORT_SQL_CONTAINS_DATA para export SQL legível.

## Criar backup criptografado

node scripts/db-maintenance.mjs backup

O script executa pg_dump -Fc, criptografa o fluxo com AES-256-GCM, grava o arquivo sem sobrescrever um existente e apaga o temporário ao final. O arquivo contém o marcador DFB1, nonce e conteúdo autenticado. Perder a chave impede a restauração.

Guarde o .dfb e a chave em locais diferentes, com acesso restrito. Supabase Free não oferece backup automático; a rotina manual deve ser agendada e acompanhada fora da aplicação. A exportação não inclui objetos Supabase Storage.

## Exportar SQL

node scripts/db-maintenance.mjs export

A rotina exige destino explícito e confirmação por variável porque o SQL pode conter dados pessoais. Proteja o arquivo, transfira por canal seguro e remova cópias temporárias conforme a política de retenção.

## Restaurar sem sobrescrever produção

1. Crie primeiro um banco vazio e isolado chamado exatamente desenrola_homolog_restore, preferencialmente em um Postgres local descartável com schema e extensões auth compatíveis com o dump.
2. Configure as variáveis PostgreSQL apontando para esse host e banco.
3. Confirme que PGHOST é localhost, 127.0.0.1 ou ::1; restauração remota é bloqueada pelo script.
4. Defina RESTORE_CONFIRM=RESTORE_TO_HOMOLOG_ONLY.
5. Execute node scripts/db-maintenance.mjs restore caminho/backup.dfb.
6. Valide contagens e dados esperados no destino; registre data, operador e hash do arquivo.

O comando falha se o nome do banco não for desenrola_homolog_restore, exige confirmação explícita, valida o AES-GCM antes do pg_restore e não usa --clean nem --create. O destino precisa estar vazio; conflitos abortam a transação. Não aponte as variáveis para produção.

## Verificações atuais

O autoteste criptográfico não precisa de banco: node scripts/db-maintenance.mjs self-test. Ele verifica ida e volta do envelope com texto sintético, rejeição de chave incorreta e bloqueio de destino que não seja homologação.

Uma restauração PostgreSQL efetiva ainda não foi executada: não há pg_dump/pg_restore no ambiente e Docker não está ativo. Não considerar a rotina validada até que o backup e o restore terminem com sucesso no destino isolado.

