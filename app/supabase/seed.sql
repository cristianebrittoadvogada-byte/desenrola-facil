-- Somente registros demonstrativos e dados empresariais fornecidos pela fundadora.
-- Nenhum dado de cliente real. A venda de demonstração fica pendente, nunca confirmada.
insert into public.products
  (id,code,name,category,description,price,currency,delivery_mode,format,duration_text,duration_months,active)
values
  ('10000000-0000-4000-8000-000000000001','mentoria-desenrola-facil','MENTORIA DESENROLA FÁCIL','mentoria','Metodologia PPDD®, integrando desenvolvimento comportamental, financeiro, relacional e sistêmico.',3000.00,'BRL','hibrido','individual e coletivo','3 meses',3,true),
  ('10000000-0000-4000-8000-000000000002','livro-desenrola-facil','LIVRO','livro','Produto editorial vendido online e por canais digitais.',69.90,'BRL','editorial','produto editorial',null,null,true),
  ('10000000-0000-4000-8000-000000000003','constelacao-online','CONSTELAÇÃO SISTÊMICA ONLINE','constelacao','Atendimento individual online.',799.99,'BRL','online','individual','A definir',null,true),
  ('10000000-0000-4000-8000-000000000004','constelacao-presencial','CONSTELAÇÃO SISTÊMICA PRESENCIAL','constelacao','Atendimento individual no Rio de Janeiro/RJ.',999.99,'BRL','presencial','individual','A definir',null,true)
on conflict (code) do update set name=excluded.name,category=excluded.category,
  description=excluded.description,price=excluded.price,currency=excluded.currency,
  delivery_mode=excluded.delivery_mode,format=excluded.format,
  duration_text=excluded.duration_text,duration_months=excluded.duration_months,active=excluded.active;

insert into public.experiences (id,code,name,description,location,starts_at,ends_at,status)
values ('20000000-0000-4000-8000-000000000001','o-lugar-que-e-meu-ref-2026',
  'O LUGAR QUE É MEU — edição de referência',
  'Vivência coletiva sobre pertencimento, reconhecimento, relações, merecimento, recepção e expansão pessoal. Idealização e condução: Cristiane Britto.',
  'Barra de Guaratiba, Rio de Janeiro/RJ','2026-11-13 12:00:00-03','2026-11-15 12:00:00-03','completed')
on conflict (code) do update set name=excluded.name,description=excluded.description,
  location=excluded.location,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status;

insert into public.contacts (id,full_name,email,source,lifecycle_stage,notes)
values ('30000000-0000-4000-8000-000000000001','Contato Fictício de Homologação',
  'teste.crm@example.invalid','seed_demo','lead','Registro fictício exclusivo para validar a homologação.')
on conflict (id) do nothing;

insert into public.opportunities (id,contact_id,product_id,stage,expected_value)
values ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','new',3000.00)
on conflict (id) do nothing;

insert into public.sales (id,contact_id,product_id,opportunity_id,status,amount,payment_method)
values ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
  'pending',3000.00,'pix')
on conflict (id) do nothing;

insert into public.appointments
  (id,appointment_type,title,starts_at,ends_at,status,location,operational_notes)
values ('60000000-0000-4000-8000-000000000001','reuniao','Evento demonstrativo de agenda',
  '2026-11-20 14:00:00-03','2026-11-20 14:30:00-03','scheduled','Online',
  'Registro fictício; remover ao encerrar os testes de homologação.')
on conflict (id) do nothing;


