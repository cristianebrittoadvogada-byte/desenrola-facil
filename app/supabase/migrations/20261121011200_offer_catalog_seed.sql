-- Desenrola Fácil | Catálogo inicial das ofertas oficiais.
-- Inclui somente dados da empresa; não inclui clientes, participantes ou vendas.
begin;

insert into public.products
  (code,name,category,description,price,currency,delivery_mode,format,duration_text,duration_months,active)
values
  ('mentoria-desenrola-facil','Mentoria Desenrola Fácil','mentoria',
   'Metodologia PPDD® com desenvolvimento comportamental, financeiro, relacional e sistêmico.',
   3000.00,'BRL','online','Individual e coletivo','3 meses',3,true),
  ('livro-desenrola-facil','Livro Desenrola Fácil','livro',
   'Produto editorial disponível online e por canais digitais.',
   69.90,'BRL','editorial','Produto editorial',null,null,true),
  ('constelacao-sistemica-online','Constelação Sistêmica Online','constelacao',
   'Atendimento individual online.',
   799.99,'BRL','online','Individual','Sessão individual, tempo a definir',null,true),
  ('constelacao-sistemica-presencial','Constelação Sistêmica Presencial','constelacao',
   'Atendimento individual presencial no Rio de Janeiro/RJ.',
   999.99,'BRL','presencial','Individual','Sessão individual, tempo a definir',null,true)
on conflict (code) do nothing;

commit;
