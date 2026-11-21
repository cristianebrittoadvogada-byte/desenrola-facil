# Comparação: Supabase Free e Neon Free

Consulta registrada em 19/11/2026. Limites e preços mudam; revalidar no painel antes de criar projeto.

| Critério | Supabase Free | Neon Free |
|---|---|---|
| Custo base | US$ 0; 2 projetos ativos | US$ 0; até 100 projetos |
| PostgreSQL | 500 MB por projeto | 1 GB por projeto |
| Pausa/compute | Pode pausar após 7 dias de baixa atividade; shared CPU, 500 MB RAM | 100 CU-h/projeto/mês; escala a zero; até 2 CU |
| Auth e API | Auth, PostgREST, RLS e Edge Functions no mesmo produto | Neon Auth/Better Auth e funções Node.js disponíveis; exige adaptar a API/RLS desta implantação |
| Backup/recuperação | Sem backup automático no Free; exportação lógica manual recomendada | Histórico de restauração instantânea de até 6 horas, sujeito ao limite de alterações; não equivale a backup externo de longo prazo |
| Saída/migração | PostgreSQL, CLI e pg_dump; exportação manual | PostgreSQL e pg_dump; branches ajudam testar migrações |
| Disponibilidade | Plano gratuito sem SLA divulgado na página do plano; o projeto pode pausar | Plano gratuito sem SLA divulgado na página do plano; compute pode hibernar |
| Adequação a esta homologação | Melhor encaixe inicial: RLS, Auth, API e functions integrados | Alternativa para prova paralela do banco; auth/API demandam código adicional |

## Recomendação

Usar Supabase Free somente para homologação com dados fictícios, depois de executar localmente e testar a restauração. A integração reduz trabalho nesta fase. Manter cópia exportável e evitar dependência irreversível de Auth: perfis e papéis da aplicação ficam em tabelas próprias; o adaptador de identidade fica concentrado em uma função.

Não usar nenhum plano gratuito como armazenamento de dados reais antes de verificar contrato/DPA, região, controles da organização, política de retenção, backup e recuperação em projeto isolado. Não consigo comprovar disponibilidade contratual nos planos gratuitos; não são uma base adequada para operação crítica.

## Custos dentro do teto

- Supabase Free + Cloudflare Pages Free: R$ 0 recorrentes dentro das cotas; limites e pausa podem interromper o ambiente.
- Neon Free: R$ 0 dentro dos limites; compute tem franquia mensal.
- Supabase Pro: US$ 25/mês, aproximadamente R$ 147 na PTAX de venda de R$ 5,8889 em 19/11/2026, antes de IOF/câmbio do cartão; excede o teto de R$ 100. Não foi contratado.
- Serviços opcionais, domínio próprio, consumo de IA, WhatsApp, pagamentos e taxas transacionais: não ativados e fora do custo da Fase 1.

## Fontes oficiais

- [Supabase — preços e limites](https://supabase.com/pricing)
- [Supabase — pausa de projetos gratuitos](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase — backups e exportação](https://supabase.com/docs/guides/platform/backups)
- [Neon — mudanças no Free Plan em outubro de 2026](https://neon.com/blog/neon-free-plan-1-gb-per-project)
- [Neon — restauração e histórico de branches](https://neon.com/blog/practical-guide-to-database-branching)
- [Cloudflare — limites Workers Free](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare — limites Pages](https://developers.cloudflare.com/pages/platform/limits/)
- [PTAX de 19/11/2026](https://fincast.info/pt-br/pairs/usd-brl)

