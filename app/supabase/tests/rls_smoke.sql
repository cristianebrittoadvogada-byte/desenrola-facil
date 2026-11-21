begin;
select plan(46);

select has_table('public','profiles','profiles existe');
select has_table('public','user_roles','user_roles existe');
select has_table('public','products','produtos existem');
select has_table('public','contacts','CRM existe');
select has_table('public','opportunities','funil existe');
select has_table('public','sales','vendas existem');
select has_table('public','contracts','contratos existem');
select has_table('public','finance_entries','financeiro existe');
select has_table('public','appointments','agenda existe');
select has_table('public','integration_events','logs de integração existem');
select ok((select relrowsecurity from pg_class where oid='public.contacts'::regclass),'RLS ativa em contatos');
select ok((select relrowsecurity from pg_class where oid='public.sales'::regclass),'RLS ativa em vendas');
select ok((select relrowsecurity from pg_class where oid='public.contracts'::regclass),'RLS ativa em contratos');
select is((select count(*)::int from public.sales where status='confirmed'),0,'seed não inventa pagamento confirmado');

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('70000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'owner.homolog@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict (id) do nothing;
insert into public.profiles (id,full_name)
values ('70000000-0000-4000-8000-000000000001','Usuário Sintético')
on conflict (id) do nothing;
insert into public.user_roles (user_id,role)
values ('70000000-0000-4000-8000-000000000001','owner')
on conflict do nothing;
insert into public.profiles (id,full_name)
values ('70000000-0000-4000-8000-000000000002','Usuário Sem Permissão')
on conflict (id) do nothing;
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('70000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','comercial.homolog@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('70000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro.homolog@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict (id) do nothing;
insert into public.profiles (id,full_name)
values ('70000000-0000-4000-8000-000000000003','Comercial Fictício'),('70000000-0000-4000-8000-000000000004','Financeiro Fictício')
on conflict (id) do nothing;
insert into public.user_roles (user_id,role)
values ('70000000-0000-4000-8000-000000000003','commercial'),('70000000-0000-4000-8000-000000000004','finance')
on conflict do nothing;
insert into public.contacts(id,full_name,email,source,lifecycle_stage)
values ('30000000-0000-4000-8000-000000000002','Participante Fictício de Mentoria','mentorado@example.invalid','seed_demo','lead')
on conflict (id) do nothing;
insert into public.contacts(id,full_name,email,source,lifecycle_stage)
values ('30000000-0000-4000-8000-000000000003','Participante Fictício Extra','participante@example.invalid','seed_demo','lead')
on conflict (id) do nothing;
insert into public.experiences(id,code,name,status,capacity)
values ('20000000-0000-4000-8000-000000000002','vivencia-teste-capacidade','Vivência Fictícia de Teste','planned',1)
on conflict (id) do nothing;

select ok(not has_table_privilege('authenticated','public.sales','INSERT'),'usuários não podem inserir vendas diretamente');
select ok(not has_table_privilege('authenticated','public.sales','UPDATE'),'usuários não podem alterar vendas diretamente');
select ok(not has_table_privilege('authenticated','public.sales','DELETE'),'vendas não podem ser apagadas por usuários');
select ok(not has_table_privilege('authenticated','public.contracts','DELETE'),'contratos não podem ser apagados por usuários');
select ok(has_column_privilege('authenticated','public.contracts','contract_text','UPDATE'),'texto de rascunho pode ser atualizado');
select ok(not has_column_privilege('authenticated','public.contracts','sale_id','UPDATE'),'vínculo contrato-venda é imutável');
select ok(not has_column_privilege('authenticated','public.contracts','contract_number','UPDATE'),'número do contrato é imutável');
select ok(not has_column_privilege('authenticated','public.finance_entries','amount','UPDATE'),'financeiro não pode alterar valor após lançamento');
select ok(has_column_privilege('authenticated','public.finance_entries','status','UPDATE'),'financeiro pode atualizar somente o estado autorizado');
select ok(not has_table_privilege('authenticated','public.finance_entries','DELETE'),'lançamentos financeiros não podem ser apagados por usuários');

set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from public.contacts where id='30000000-0000-4000-8000-000000000001'),1,'owner lê contato de teste');
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.contacts),0,'usuário sem função não lê contatos');
select is((select count(*)::int from public.products),0,'usuário sem função não lê ofertas');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.create_sale_with_receivable(
  '30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','pix',null,null
)$$,'comercial cria venda pendente pela RPC protegida');
select is((select status from public.mentorship_enrollments where sale_id=(
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
)), 'pending_payment','venda de mentoria cria acompanhamento pendente');
select lives_ok($$insert into public.contracts(sale_id,contract_text,created_by)
  select id,'Texto sintético usado somente pelo teste de homologação.',auth.uid()
  from public.sales where contact_id='30000000-0000-4000-8000-000000000002'$$,
  'comercial cria rascunho de contrato para venda fictícia');
select is((select status from public.contracts where sale_id=(
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
)), 'draft','contrato nasce em rascunho');
select lives_ok($$update public.contracts set status='sent' where sale_id=(
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
)$$,'comercial marca o envio do contrato');
select ok((select sent_at is not null from public.contracts where sale_id=(
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
)),'envio registra data automática');
select throws_ok($$update public.contracts set contract_text='Texto alterado depois do envio'
  where sale_id=(select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002')$$,
  '22023','Only draft contract text can be edited','texto deixa de ser editável após o envio');
select lives_ok($$update public.contracts set status='signed' where sale_id=(
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
)$$,'comercial registra assinatura após envio efetivo');
select ok((select signed_at is not null from public.contracts where sale_id=(
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
)),'assinatura registra data automática');
select is((select status from public.sales where contact_id='30000000-0000-4000-8000-000000000002'),
  'pending','assinatura de contrato não confirma pagamento');
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000004',true);
select lives_ok($$select public.confirm_sale_receipt((
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
),'synthetic-payment-reference',true)$$,'financeiro confirma a venda de teste pela RPC protegida');
select is((select lifecycle_stage from public.contacts where id='30000000-0000-4000-8000-000000000002'),
  'customer','pagamento confirmado atualiza o ciclo de vida do contato');
select is((select status from public.mentorship_enrollments where sale_id=(
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
)), 'active','pagamento confirmado ativa o acompanhamento');
select ok((select ends_at > started_at from public.mentorship_enrollments where sale_id=(
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
)),'duração da oferta calcula o encerramento da mentoria');
select is((select status from public.finance_entries where sale_id=(
  select id from public.sales where contact_id='30000000-0000-4000-8000-000000000002'
)), 'confirmed','confirmação recebida liquida o lançamento correspondente');
select lives_ok($$select public.register_experience_participant(
  '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',null
)$$,'comercial registra participante em vivência publicada');
select is((select status from public.experience_registrations where experience_id='20000000-0000-4000-8000-000000000002'),
  'pending_payment','inscrição sem venda não é marcada como paga');
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.register_experience_participant(
  '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',null
)$$,'42501',null,'usuário sem função não pode registrar participantes');
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.register_experience_participant(
  '20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',null
)$$,'22023','Experience capacity has been reached','vivência respeita o limite de vagas');
reset role;

select * from finish();
rollback;

