-- Add customer service fee to platform_config
-- Müştəri sifariş edəndə əlavə tutulan servis haqqı (faiz).
-- Default 0 — admin admin panelindən dəyişə bilər.

insert into public.platform_config (key, value, description)
values (
  'commission_customer_service_fee',
  '0'::jsonb,
  'Müştəri servis haqqı (%). 0 olarsa müştəridən tutulmaz.'
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
