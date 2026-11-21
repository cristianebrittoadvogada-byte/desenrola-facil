-- Desenrola Fácil | Fecha execução direta de funções internas usadas apenas por triggers.
-- Aditiva: não altera dados nem a execução dos triggers.
begin;

revoke all on function app_private.set_updated_at() from public, anon, authenticated;
revoke all on function app_private.guard_sale_confirmation() from public, anon, authenticated;
revoke all on function app_private.guard_paid_enrollment() from public, anon, authenticated;
revoke all on function app_private.write_audit_log() from public, anon, authenticated;

commit;
