-- Vahid admin-təyinli komanda komissiyası (işçi → komanda, hər sifariş).
-- Tam funksiya mətnləri canlı apply_migration ilə tətbiq olunub:
--   • platform_config.brigade_member_commission_pct (default 0)
--   • auto_release_on_opportunity_complete — escrow buraxılışında komanda
--     payını işçinin payından tutub komanda balansına köçürür
--   • worker_earnings — komanda payını vahid faizlə hesablayır
--   • admin_update_commission whitelist-inə yeni açar əlavə olundu
insert into public.platform_config (key, value, description)
values ('brigade_member_commission_pct', '0'::jsonb,
        'İşçinin hər sifariş üçün komandaya verdiyi faiz (vahid, admin təyin edir)')
on conflict (key) do nothing;
notify pgrst, 'reload schema';
