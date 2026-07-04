-- ============================================================================
-- In-App Support chat — mövcud conversations cədvəlini reuse edir.
--
-- Support conversation:
--   • opportunity_id = NULL
--   • customer_id    = istifadəçi
--   • provider_id    = platform_config.support_user_id (admin/support işçi)
--
-- Frontend: open_support_conversation() çağırır → ChatScreen-ə yönlənir.
-- Admin: kendi MessagesTab-da bütün support sövbətlərini görür.
--
-- ÖN ŞƏRT: 20260526_chat_messaging.sql ƏVVƏLCƏ run olunmalıdır
-- (conversations cədvəli orada yaradılır).
-- ============================================================================

-- 0. Ön şərt yoxlanışı — conversations cədvəli mövcud olmalıdır
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'conversations'
  ) then
    raise exception
      'Migration sırası səhvdir: əvvəlcə 20260526_chat_messaging.sql run edin (conversations cədvəlini yaradır), sonra bu migration-ı.';
  end if;
end $$;

-- 1. platform_config-ə support_user_id (admin user UUID kimi)
--    User bu yaranan adminin UUID-sini Dashboard-dan əl ilə qoymalıdır.
insert into public.platform_config (key, value)
values ('support_user_id', '"00000000-0000-0000-0000-000000000000"'::jsonb)
on conflict (key) do nothing;

-- 2. opportunity_id NULL-ı dəstəkləməsi üçün unique constraint-i yenidən qur
--    Köhnə constraint: unique(opportunity_id, customer_id, provider_id)
--    NULL fərqliyə görə yeni constraint coalesce-lə işləyir.
do $$
begin
  -- Köhnə unique constraint-i sil (varsa)
  if exists (
    select 1 from pg_constraint
    where conname = 'conversations_opportunity_id_customer_id_provider_id_key'
       or conname like '%conversations%customer_id_provider_id_key'
  ) then
    -- Tap və sil
    execute (
      select 'alter table public.conversations drop constraint ' || conname
        from pg_constraint
       where conrelid = 'public.conversations'::regclass
         and contype = 'u'
       limit 1
    );
  end if;
exception when others then
  raise notice 'Could not drop old unique constraint: %', sqlerrm;
end $$;

-- NULL-aware unique index
drop index if exists conversations_unique_pair;
create unique index conversations_unique_pair
  on public.conversations (
    coalesce(opportunity_id::text, 'support'),
    customer_id,
    provider_id
  );

-- 3. RPC: open_support_conversation()
create or replace function public.open_support_conversation()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_support uuid;
  v_id      uuid;
  v_raw     text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  select value::text into v_raw
    from public.platform_config where key = 'support_user_id';
  if v_raw is null then
    raise exception 'Support agent not configured';
  end if;
  -- jsonb string-i çıxar: "uuid" → uuid
  v_support := trim(both '"' from v_raw)::uuid;

  if v_caller = v_support then
    raise exception 'Cannot open support chat with yourself';
  end if;

  insert into public.conversations
    (opportunity_id, customer_id, provider_id)
  values (null, v_caller, v_support)
  on conflict (coalesce(opportunity_id::text, 'support'), customer_id, provider_id)
  do update set last_message_at = public.conversations.last_message_at
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.open_support_conversation() from public, anon;
grant   execute on function public.open_support_conversation() to authenticated;

notify pgrst, 'reload schema';
