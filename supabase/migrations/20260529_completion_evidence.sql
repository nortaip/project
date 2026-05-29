-- Add completion evidence columns to opportunities_offers table
-- Stores photos and signature from provider when completing job

alter table public.opportunities_offers
add column if not exists completion_photos text[] default null,
add column if not exists customer_signature_url text default null,
add column if not exists payout_status text default null,
add column if not exists admin_approved_at timestamp with time zone default null,
add column if not exists admin_approved_by uuid default null;

-- Update opportunities table to add work completion timestamp
alter table public.opportunities
add column if not exists work_ended_at timestamp with time zone default null;

-- Add constraint for payout_status values
alter table public.opportunities_offers
drop constraint if exists payout_status_check,
add constraint payout_status_check
  check (payout_status in ('pending_review', 'approved', 'paid', 'rejected'));
