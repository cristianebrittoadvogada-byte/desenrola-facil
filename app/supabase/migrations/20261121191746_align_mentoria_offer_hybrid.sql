-- Align the active catalog with the current approved commercial terms.
-- This updates one product's delivery mode; price and other offers are untouched.
begin;

do $$
declare
  updated_rows integer;
begin
  update public.products
  set delivery_mode = 'hibrido', updated_at = now()
  where code = 'mentoria-desenrola-facil'
    and category = 'mentoria'
    and active = true;

  get diagnostics updated_rows = row_count;
  if updated_rows <> 1 then
    raise exception 'expected_one_active_mentoria_product';
  end if;
end
$$;

commit;

