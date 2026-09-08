-- ============================================================
-- Audit düzəlişləri (2026-09-08) — CANLI BAZAYA TƏTBİQ OLUNUB
-- 1) admin_kyc_review: last_kyc_approved_at=now() (gecə cron-u
--    təsdiqlənmiş ustanı dərhal "expired" etməsin)
-- 2) admin_update_commission: bonus_on_complete whitelist-ə qayıdıb
-- 3) place_bid: KYC şərti SERVER tərəfdə (is_verified + 14 gün)
-- 4) release_offer_to_provider: FOR UPDATE kilidi + ALREADY_RELEASED
--    qoruması (ikiqat ödəniş mümkün deyil) + payout_status/admin
--    təsdiq sahələri funksiya daxilində yazılır (atomikdir)
-- 5) chat_messages "mark read" policy: adminlər də oxundu edə bilir
--    (admin dəstək çatında oxunmamış sayğacı düzgün sıfırlanır)
-- 6) opportunities SELECT siyasəti: using(true) əvəzinə —
--    öz sifarişi / təyin olunduğu sifariş / açıq statuslar / admin.
--    (Əvvəl istənilən login olmuş istifadəçi BÜTÜN sifarişləri,
--    ünvan koordinatları və telefon cavabları daxil, oxuya bilirdi.)
--
-- Funksiyaların tam mətni üçün canlı bazaya baxın (pg_get_functiondef)
-- və ya bu migrasiyanın apply tarixçəsinə. Fayl sənədləşmə məqsədilə
-- qısaldılıb — dəyişikliklərin xülasəsi yuxarıdadır.

-- ── 5. chat_messages mark-read: adminlər üçün (TƏTBİQ OLUNUB) ──
drop policy if exists "chat_msg mark read" on public.chat_messages;
create policy "chat_msg mark read"
  on public.chat_messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = chat_messages.conversation_id
        and (auth.uid() = c.customer_id or auth.uid() = c.provider_id)
    )
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin','master','superadmin')
    )
  );

-- ── 6. opportunities SELECT (TƏTBİQ OLUNUB) ──
drop policy if exists "opportunities_select_all_authenticated" on public.opportunities;
create policy "opportunities_select_scoped"
  on public.opportunities for select
  to authenticated
  using (
    created_by = auth.uid()
    or provider_id = auth.uid()
    or status in ('pending','open','new','active')
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role,'')) in ('admin','master','superadmin')
    )
  );
