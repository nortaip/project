-- ============================================================
-- Ellit.az — tam DB sxemi (Supabase public sxemindən çıxarılıb)
-- Mənbə: canlı baza (44 cədvəl). RLS köçürülmür — icazə məntiqi
-- API qatındadır. auth.users → public.users yönləndirilib.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Yeni auth cədvəlləri (FastAPI backend) ──────────────────
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email character varying(320),
  phone character varying(32),
  password_hash text,
  role character varying(24) NOT NULL DEFAULT 'customer',
  is_active boolean NOT NULL DEFAULT true,
  email_verified boolean NOT NULL DEFAULT false,
  legacy_supabase_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_phone_key UNIQUE (phone),
  CONSTRAINT users_legacy_key UNIQUE (legacy_supabase_id)
);

CREATE TABLE public.oauth_identities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider character varying(16) NOT NULL,
  provider_sub character varying(255) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT oauth_identities_pkey PRIMARY KEY (id),
  CONSTRAINT ix_oauth_provider_sub UNIQUE (provider, provider_sub)
);

CREATE TABLE public.refresh_sessions (
  jti character varying(64) NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_agent character varying(255),
  ip character varying(64),
  expires_at timestamp with time zone NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT refresh_sessions_pkey PRIMARY KEY (jti)
);
CREATE INDEX ix_refresh_sessions_user ON public.refresh_sessions(user_id);

-- ── Köçürülən sxem ───────────────────────────────────────────
-- Sequences
CREATE SEQUENCE IF NOT EXISTS public.promotion_plans_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.provider_bonus_logs_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.services_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.payments_id_seq;

-- Tables
CREATE TABLE public.announcements (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  side character varying(10) NOT NULL,
  image_url text NOT NULL,
  href text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  actor uuid,
  target_type text
);

CREATE TABLE public.banners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  image_url text NOT NULL,
  link_url text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  service_id bigint,
  customer_id uuid,
  provider_id uuid,
  status text NOT NULL,
  date date NOT NULL,
  "time" text NOT NULL,
  total_amount numeric(10,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  package_name text,
  package_price numeric(10,2),
  package_duration text
);

CREATE TABLE public.brigade_applications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  applicant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  categories text[] NOT NULL DEFAULT '{}'::text[],
  contact_phone text,
  contact_email text,
  address text,
  logo_url text,
  status text NOT NULL DEFAULT 'pending'::text,
  admin_note text,
  brigade_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  decided_at timestamp with time zone,
  decided_by uuid,
  applicant_name text,
  applicant_email text,
  applicant_phone text
);

CREATE TABLE public.brigade_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  brigade_id uuid NOT NULL,
  member_id uuid NOT NULL,
  source_type text NOT NULL DEFAULT 'booking'::text,
  source_id text NOT NULL,
  assigned_by uuid,
  status text NOT NULL DEFAULT 'assigned'::text,
  notes text,
  priority smallint NOT NULL DEFAULT 5,
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  responded_at timestamp with time zone,
  completed_at timestamp with time zone
);

CREATE TABLE public.brigade_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  brigade_id uuid NOT NULL,
  invited_by uuid NOT NULL,
  email text,
  phone text,
  intended_role text NOT NULL DEFAULT 'member'::text,
  commission_pct numeric(5,2),
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending'::text,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '7 days'::interval),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  responded_at timestamp with time zone
);

CREATE TABLE public.brigade_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  brigade_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member'::text,
  is_active boolean NOT NULL DEFAULT true,
  commission_pct numeric(5,2),
  notes text,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  is_online boolean NOT NULL DEFAULT false,
  last_heartbeat timestamp with time zone
);

CREATE TABLE public.brigade_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  brigade_id uuid NOT NULL,
  category_id uuid NOT NULL,
  subcategory_id uuid,
  unit text NOT NULL DEFAULT 'job'::text,
  price numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'AZN'::text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.brigades (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  slug text,
  description text,
  logo_url text,
  cover_url text,
  contact_phone text,
  contact_email text,
  address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  working_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  categories text[] NOT NULL DEFAULT ARRAY[]::text[],
  service_radius_km integer,
  is_active boolean NOT NULL DEFAULT true,
  is_verified boolean NOT NULL DEFAULT false,
  rating numeric(3,2) NOT NULL DEFAULT 0,
  total_orders integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  balance numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  attachments text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  read_at timestamp with time zone
);

CREATE TABLE public.config (
  key text NOT NULL,
  value text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  opportunity_id uuid,
  customer_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_message_at timestamp with time zone,
  last_message_preview text,
  category text,
  user_role text
);

CREATE TABLE public.dispute_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL,
  size_bytes integer,
  uploaded_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.disputes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  raised_by uuid NOT NULL,
  against_user uuid NOT NULL,
  reason text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open'::text,
  resolution_notes text,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.featured_services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  price text,
  image_url text,
  tag text,
  order_num integer
);

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_id uuid,
  sender_id uuid,
  receiver_id uuid,
  content text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'info'::text,
  title text NOT NULL,
  body text,
  related_id text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  kind text,
  link text
);

CREATE TABLE public.opportunities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  created_by uuid,
  date date NOT NULL,
  location text,
  category_id uuid,
  subcategory_id uuid,
  budget numeric,
  extra_answers jsonb,
  created_at timestamp with time zone DEFAULT now(),
  provider_id uuid,
  accepted_offer_id uuid,
  status text,
  work_started_at timestamp with time zone,
  work_ended_at timestamp with time zone,
  navigation_started_at timestamp with time zone,
  cancellation_reason text,
  completed_at timestamp with time zone,
  photos text[] NOT NULL DEFAULT '{}'::text[],
  latitude numeric,
  longitude numeric
);

CREATE TABLE public.opportunities_offers (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  opportunity_id uuid,
  provider_id uuid,
  offer_amount numeric(12,2) NOT NULL,
  status text DEFAULT 'pending'::text,
  created_at timestamp without time zone DEFAULT now(),
  paid_at timestamp with time zone,
  payment_id uuid,
  payment_method text,
  brigade_id uuid,
  updated_at timestamp with time zone DEFAULT now(),
  escrow_released_at timestamp with time zone,
  cash_deposit_amount numeric,
  completion_photos text[] DEFAULT '{}'::text[],
  customer_signature_url text,
  payout_status text,
  admin_approved_at timestamp with time zone,
  admin_approved_by uuid,
  notes text
);

CREATE TABLE public.opportunity_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL,
  old_status text,
  new_status text,
  actor_id uuid,
  actor_role text,
  reason text,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.password_otps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  otp text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.payments (
  id bigint NOT NULL DEFAULT nextval('payments_id_seq'::regclass),
  service_id integer,
  status text,
  method text,
  paid_at timestamp without time zone,
  amount numeric,
  order_id text,
  user_id uuid,
  net_amount numeric(12,2) DEFAULT 0,
  commission numeric(12,2) DEFAULT 0,
  external_id text,
  currency text NOT NULL DEFAULT 'AZN'::text,
  provider text NOT NULL DEFAULT 'epoint'::text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE TABLE public.platform_config (
  key text NOT NULL,
  value jsonb NOT NULL,
  description text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.popular_services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  icon_name text,
  order_num integer
);

CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text,
  password_hash text,
  name text,
  role text NOT NULL,
  phone_number text,
  address text,
  birth_date date,
  company_name text,
  experience_years integer DEFAULT 0,
  specialties text[],
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  balance numeric DEFAULT 0,
  is_verified boolean DEFAULT false,
  avatar_url text,
  settings jsonb DEFAULT '{}'::jsonb,
  rating text,
  bonus_balance numeric DEFAULT 0,
  total_bonus_earned numeric DEFAULT 0,
  latitude double precision,
  longitude double precision,
  epoint_card_uid text,
  epoint_card_mask text,
  is_online boolean NOT NULL DEFAULT false,
  availability_status text DEFAULT 'offline'::text,
  last_seen_at timestamp with time zone,
  verification_status text DEFAULT 'not_submitted'::text,
  last_kyc_approved_at timestamp with time zone,
  rating_count integer NOT NULL DEFAULT 0,
  is_bot boolean DEFAULT false
);

CREATE TABLE public.promo_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  discount_type text NOT NULL,
  discount_value numeric(12,2) NOT NULL,
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  per_user_limit integer,
  min_order_amount numeric(12,2),
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.promo_redemptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  promo_id uuid NOT NULL,
  user_id uuid,
  offer_id uuid,
  opportunity_id uuid,
  discount_amount numeric(12,2) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.promotion_plans (
  id integer NOT NULL DEFAULT nextval('promotion_plans_id_seq'::regclass),
  type character varying(20) NOT NULL,
  days integer NOT NULL,
  price numeric(10,2) NOT NULL
);

CREATE TABLE public.provider_bonus_logs (
  id bigint NOT NULL,
  provider_id uuid NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL,
  source text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  reason text
);

CREATE TABLE public.provider_commissions_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  offer_id text NOT NULL,
  amount numeric(10,2) NOT NULL,
  status text NOT NULL,
  type text NOT NULL,
  source text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  refunded_at timestamp with time zone
);

CREATE TABLE public.provider_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  message text,
  company_name text,
  experience_years integer,
  specialties text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'pending'::text,
  admin_note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  decided_at timestamp with time zone,
  decided_by uuid
);

CREATE TABLE public.provider_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid,
  offer_id uuid,
  rating integer,
  comment text,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE public.provider_status (
  provider_id uuid NOT NULL,
  online boolean NOT NULL DEFAULT false,
  blocked boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.provider_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  id_front_path text NOT NULL,
  id_back_path text NOT NULL,
  selfie_path text NOT NULL,
  full_name_on_id text,
  id_number text,
  birth_date date,
  status text NOT NULL DEFAULT 'pending'::text,
  rejection_reason text,
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_renewal boolean NOT NULL DEFAULT false
);

CREATE TABLE public.provider_wallets (
  provider_id uuid NOT NULL,
  bonus_balance numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  balance numeric DEFAULT 0,
  total_earned numeric(12,2) NOT NULL DEFAULT 0,
  total_withdrawn numeric(12,2) NOT NULL DEFAULT 0,
  locked_balance numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.service_categories (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  label text NOT NULL,
  icon_name text,
  label_ru text,
  label_en text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.service_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category_id uuid,
  subcategory_id uuid,
  question_name text,
  option_value text,
  min_price numeric,
  max_price numeric
);

CREATE TABLE public.service_questions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  category_id uuid,
  label text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  options text[],
  order_num integer DEFAULT 0,
  required boolean DEFAULT true,
  subcategory_id text,
  label_ru text,
  label_en text,
  question_ru text,
  question_en text,
  placeholder_ru text,
  placeholder_en text,
  options_ru jsonb,
  options_en jsonb
);

CREATE TABLE public.service_subcategories (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  category_id uuid NOT NULL,
  label text NOT NULL,
  label_ru text,
  label_en text
);

CREATE TABLE public.services (
  id bigint NOT NULL,
  title text,
  description text,
  category text,
  price numeric,
  location text,
  requirements text,
  cancellation_policy text,
  faq text,
  tags text[],
  website text,
  "socialMedia" text,
  packages text,
  contact_email text,
  contact_phone text,
  business_hours text,
  images text[],
  rating numeric,
  reviews_count integer,
  availability text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  provider_id uuid,
  status character varying,
  view_count integer DEFAULT 0,
  promotion_type character varying(16) DEFAULT 'normal'::character varying,
  promotion_duration integer,
  promotion_price numeric(10,2),
  promotion_paid boolean DEFAULT false,
  promotion_expires_at timestamp with time zone
);

CREATE TABLE public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  type text,
  amount numeric(12,2),
  balance_after numeric(12,2),
  description text,
  related_id text,
  payment_id uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.user_blocks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  reason text,
  scope text NOT NULL DEFAULT 'global'::text,
  brigade_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.user_devices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  platform text,
  fcm_token text NOT NULL,
  last_seen timestamp with time zone DEFAULT now()
);

CREATE TABLE public.user_settings (
  user_id uuid NOT NULL,
  notifications_enabled boolean NOT NULL DEFAULT true,
  location_enabled boolean NOT NULL DEFAULT true,
  dark_mode_enabled boolean NOT NULL DEFAULT false,
  language text NOT NULL DEFAULT 'English'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.user_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  order_id text,
  transaction_id text,
  amount numeric,
  currency text,
  status text,
  payment_method text,
  transaction_date timestamp with time zone,
  response_payload jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.withdrawals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid,
  amount_requested numeric(12,2) NOT NULL,
  commission_percent numeric(5,2) NOT NULL,
  commission_amount numeric(12,2) NOT NULL,
  net_amount numeric(12,2) NOT NULL,
  bank_card text,
  status text NOT NULL DEFAULT 'pending'::text,
  admin_notes text,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  external_id text
);

-- Constraints
ALTER TABLE public.announcements ADD CONSTRAINT ad_banners_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.banners ADD CONSTRAINT banners_pkey PRIMARY KEY (id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);
ALTER TABLE public.brigade_applications ADD CONSTRAINT brigade_applications_pkey PRIMARY KEY (id);
ALTER TABLE public.brigade_assignments ADD CONSTRAINT brigade_assignments_pkey PRIMARY KEY (id);
ALTER TABLE public.brigade_invites ADD CONSTRAINT brigade_invites_pkey PRIMARY KEY (id);
ALTER TABLE public.brigade_members ADD CONSTRAINT brigade_members_pkey PRIMARY KEY (id);
ALTER TABLE public.brigade_prices ADD CONSTRAINT brigade_prices_pkey PRIMARY KEY (id);
ALTER TABLE public.brigades ADD CONSTRAINT brigades_pkey PRIMARY KEY (id);
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.config ADD CONSTRAINT config_pkey PRIMARY KEY (key);
ALTER TABLE public.conversations ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);
ALTER TABLE public.dispute_attachments ADD CONSTRAINT dispute_attachments_pkey PRIMARY KEY (id);
ALTER TABLE public.disputes ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);
ALTER TABLE public.featured_services ADD CONSTRAINT featured_services_pkey PRIMARY KEY (id);
ALTER TABLE public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);
ALTER TABLE public.opportunities_offers ADD CONSTRAINT opportunities_offers_pkey PRIMARY KEY (id);
ALTER TABLE public.opportunity_audit_log ADD CONSTRAINT opportunity_audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.password_otps ADD CONSTRAINT password_otps_pkey PRIMARY KEY (id);
ALTER TABLE public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
ALTER TABLE public.platform_config ADD CONSTRAINT platform_config_pkey PRIMARY KEY (key);
ALTER TABLE public.popular_services ADD CONSTRAINT popular_services_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_pkey PRIMARY KEY (id);
ALTER TABLE public.promo_redemptions ADD CONSTRAINT promo_redemptions_pkey PRIMARY KEY (id);
ALTER TABLE public.promotion_plans ADD CONSTRAINT promotion_plans_pkey PRIMARY KEY (id);
ALTER TABLE public.provider_bonus_logs ADD CONSTRAINT provider_bonus_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.provider_commissions_logs ADD CONSTRAINT provider_commissions_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.provider_requests ADD CONSTRAINT provider_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.provider_reviews ADD CONSTRAINT provider_reviews_pkey PRIMARY KEY (id);
ALTER TABLE public.provider_status ADD CONSTRAINT provider_status_pkey PRIMARY KEY (provider_id);
ALTER TABLE public.provider_verifications ADD CONSTRAINT provider_verifications_pkey PRIMARY KEY (id);
ALTER TABLE public.service_categories ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);
ALTER TABLE public.service_prices ADD CONSTRAINT service_prices_pkey PRIMARY KEY (id);
ALTER TABLE public.service_questions ADD CONSTRAINT service_questions_pkey PRIMARY KEY (id);
ALTER TABLE public.service_subcategories ADD CONSTRAINT service_subcategories_pkey PRIMARY KEY (id);
ALTER TABLE public.services ADD CONSTRAINT services_pkey PRIMARY KEY (id);
ALTER TABLE public.transactions ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);
ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (id);
ALTER TABLE public.user_devices ADD CONSTRAINT user_devices_pkey PRIMARY KEY (id);
ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);
ALTER TABLE public.user_transactions ADD CONSTRAINT user_transactions_pkey PRIMARY KEY (id);
ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_pkey PRIMARY KEY (id);
ALTER TABLE public.brigade_assignments ADD CONSTRAINT brigade_assignments_brigade_id_source_id_member_id_key UNIQUE (brigade_id, source_id, member_id);
ALTER TABLE public.brigade_members ADD CONSTRAINT brigade_members_brigade_id_profile_id_key UNIQUE (brigade_id, profile_id);
ALTER TABLE public.brigades ADD CONSTRAINT brigades_slug_key UNIQUE (slug);
ALTER TABLE public.opportunities ADD CONSTRAINT unique_accepted_offer_id UNIQUE (accepted_offer_id);
ALTER TABLE public.payments ADD CONSTRAINT payments_order_id_key UNIQUE (order_id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
ALTER TABLE public.provider_wallets ADD CONSTRAINT provider_wallets_provider_id_key UNIQUE (provider_id);
ALTER TABLE public.user_devices ADD CONSTRAINT user_devices_user_id_fcm_token_key UNIQUE (user_id, fcm_token);
ALTER TABLE public.user_transactions ADD CONSTRAINT user_transactions_transaction_id_key UNIQUE (transaction_id);
ALTER TABLE public.announcements ADD CONSTRAINT ad_banners_side_check CHECK (((side)::text = ANY (ARRAY[('left'::character varying)::text, ('right'::character varying)::text])));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE public.brigade_applications ADD CONSTRAINT brigade_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));
ALTER TABLE public.brigade_assignments ADD CONSTRAINT brigade_assignments_priority_check CHECK (((priority >= 1) AND (priority <= 10)));
ALTER TABLE public.brigade_assignments ADD CONSTRAINT brigade_assignments_source_type_check CHECK ((source_type = ANY (ARRAY['booking'::text, 'opportunity'::text, 'manual'::text])));
ALTER TABLE public.brigade_assignments ADD CONSTRAINT brigade_assignments_status_check CHECK ((status = ANY (ARRAY['offered'::text, 'assigned'::text, 'accepted'::text, 'declined'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'expired'::text])));
ALTER TABLE public.brigade_invites ADD CONSTRAINT brigade_invites_intended_role_check CHECK ((intended_role = ANY (ARRAY['dispatcher'::text, 'member'::text])));
ALTER TABLE public.brigade_invites ADD CONSTRAINT brigade_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text, 'expired'::text])));
ALTER TABLE public.brigade_members ADD CONSTRAINT brigade_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'dispatcher'::text, 'member'::text])));
ALTER TABLE public.brigade_prices ADD CONSTRAINT brigade_prices_price_check CHECK ((price >= (0)::numeric));
ALTER TABLE public.brigade_prices ADD CONSTRAINT brigade_prices_unit_check CHECK ((unit = ANY (ARRAY['job'::text, 'hour'::text, 'm2'::text, 'piece'::text, 'day'::text])));
ALTER TABLE public.config ADD CONSTRAINT key_format CHECK ((key ~ '^[a-z_]+$'::text));
ALTER TABLE public.dispute_attachments ADD CONSTRAINT dispute_attachments_file_type_check CHECK ((file_type = ANY (ARRAY['image'::text, 'video'::text, 'doc'::text])));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_description_check CHECK ((length(btrim(description)) >= 10));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_reason_check CHECK ((reason = ANY (ARRAY['work_not_done'::text, 'poor_quality'::text, 'damage'::text, 'no_show'::text, 'overcharged'::text, 'rude_behavior'::text, 'theft'::text, 'other'::text])));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_status_check CHECK ((status = ANY (ARRAY['open'::text, 'under_review'::text, 'resolved_customer'::text, 'resolved_provider'::text, 'cancelled'::text])));
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'open'::text, 'new'::text, 'active'::text, 'accepted'::text, 'i-am-here'::text, 'ongoing'::text, 'pending_review'::text, 'completed'::text, 'disputed'::text, 'refunded'::text, 'cancelled'::text, 'rejected'::text])));
ALTER TABLE public.opportunities_offers ADD CONSTRAINT offers_payment_method_check CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['cash'::text, 'card'::text]))));
ALTER TABLE public.opportunities_offers ADD CONSTRAINT opportunities_offers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'ongoing'::text, 'completed'::text])));
ALTER TABLE public.opportunities_offers ADD CONSTRAINT payout_status_check CHECK ((payout_status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'paid'::text, 'rejected'::text])));
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK ((amount > (0)::numeric));
ALTER TABLE public.payments ADD CONSTRAINT payments_provider_check CHECK ((provider = ANY (ARRAY['epoint'::text, 'kapitalbank'::text, 'manual'::text, 'test'::text])));
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'refunded'::text, 'cancelled'::text])));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_availability_status_check CHECK ((availability_status = ANY (ARRAY['online'::text, 'offline'::text, 'busy'::text, 'away'::text])));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'provider'::text, 'admin'::text])));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_verification_status_check CHECK (((verification_status IS NULL) OR (verification_status = ANY (ARRAY['not_submitted'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'resubmit_required'::text]))));
ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_discount_type_check CHECK ((discount_type = ANY (ARRAY['percent'::text, 'fixed'::text])));
ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_discount_value_check CHECK ((discount_value > (0)::numeric));
ALTER TABLE public.promotion_plans ADD CONSTRAINT promotion_plans_type_check CHECK (((type)::text = ANY (ARRAY[('normal'::character varying)::text, ('vip'::character varying)::text, ('premium'::character varying)::text])));
ALTER TABLE public.provider_requests ADD CONSTRAINT provider_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));
ALTER TABLE public.provider_reviews ADD CONSTRAINT provider_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
ALTER TABLE public.provider_verifications ADD CONSTRAINT provider_verifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));
ALTER TABLE public.services ADD CONSTRAINT services_promotion_type_check CHECK (((promotion_type)::text = ANY (ARRAY[('normal'::character varying)::text, ('vip'::character varying)::text, ('premium'::character varying)::text, ('totop'::character varying)::text])));
ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check CHECK ((type = ANY (ARRAY['top_up'::text, 'booking_charge'::text, 'refund'::text, 'bonus_earn'::text, 'bonus_convert'::text, 'withdrawal'::text, 'admin_adjust'::text, 'escrow_lock'::text, 'escrow_release'::text, 'platform_revenue'::text, 'cash_deposit_lock'::text, 'brigade_payout'::text, 'promo_discount'::text])));
ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'brigade'::text, 'customer'::text])));
ALTER TABLE public.user_devices ADD CONSTRAINT user_devices_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])));
ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_amount_requested_check CHECK ((amount_requested > (0)::numeric));
ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processed'::text, 'rejected'::text])));
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_fkey FOREIGN KEY (actor) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE public.bookings ADD CONSTRAINT fk_customer_id FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.brigade_applications ADD CONSTRAINT brigade_applications_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.brigade_applications ADD CONSTRAINT brigade_applications_brigade_id_fkey FOREIGN KEY (brigade_id) REFERENCES brigades(id) ON DELETE SET NULL;
ALTER TABLE public.brigade_applications ADD CONSTRAINT brigade_applications_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.brigade_assignments ADD CONSTRAINT brigade_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.brigade_assignments ADD CONSTRAINT brigade_assignments_brigade_id_fkey FOREIGN KEY (brigade_id) REFERENCES brigades(id) ON DELETE CASCADE;
ALTER TABLE public.brigade_assignments ADD CONSTRAINT brigade_assignments_member_id_fkey FOREIGN KEY (member_id) REFERENCES brigade_members(id) ON DELETE CASCADE;
ALTER TABLE public.brigade_invites ADD CONSTRAINT brigade_invites_brigade_id_fkey FOREIGN KEY (brigade_id) REFERENCES brigades(id) ON DELETE CASCADE;
ALTER TABLE public.brigade_invites ADD CONSTRAINT brigade_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.brigade_members ADD CONSTRAINT brigade_members_brigade_id_fkey FOREIGN KEY (brigade_id) REFERENCES brigades(id) ON DELETE CASCADE;
ALTER TABLE public.brigade_members ADD CONSTRAINT brigade_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.brigade_prices ADD CONSTRAINT brigade_prices_brigade_id_fkey FOREIGN KEY (brigade_id) REFERENCES brigades(id) ON DELETE CASCADE;
ALTER TABLE public.brigade_prices ADD CONSTRAINT brigade_prices_category_id_fkey FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE CASCADE;
ALTER TABLE public.brigade_prices ADD CONSTRAINT brigade_prices_subcategory_id_fkey FOREIGN KEY (subcategory_id) REFERENCES service_subcategories(id) ON DELETE CASCADE;
ALTER TABLE public.brigades ADD CONSTRAINT brigades_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.dispute_attachments ADD CONSTRAINT dispute_attachments_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES disputes(id) ON DELETE CASCADE;
ALTER TABLE public.dispute_attachments ADD CONSTRAINT dispute_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);
ALTER TABLE public.disputes ADD CONSTRAINT disputes_against_user_fkey FOREIGN KEY (against_user) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.disputes ADD CONSTRAINT disputes_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES opportunities_offers(id) ON DELETE CASCADE;
ALTER TABLE public.disputes ADD CONSTRAINT disputes_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;
ALTER TABLE public.disputes ADD CONSTRAINT disputes_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.disputes ADD CONSTRAINT disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);
ALTER TABLE public.messages ADD CONSTRAINT messages_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.opportunities ADD CONSTRAINT fk_accepted_offer FOREIGN KEY (accepted_offer_id) REFERENCES opportunities_offers(id) ON DELETE SET NULL;
ALTER TABLE public.opportunities ADD CONSTRAINT fk_opportunity_created_by FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.opportunities ADD CONSTRAINT fk_provider FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_category_id_fkey FOREIGN KEY (category_id) REFERENCES service_categories(id);
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_subcategory_id_fkey FOREIGN KEY (subcategory_id) REFERENCES service_subcategories(id);
ALTER TABLE public.opportunities_offers ADD CONSTRAINT fk_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;
ALTER TABLE public.opportunities_offers ADD CONSTRAINT fk_provider FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.opportunities_offers ADD CONSTRAINT fk_provider_id FOREIGN KEY (provider_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.opportunities_offers ADD CONSTRAINT fk_provider_id_users FOREIGN KEY (provider_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.opportunities_offers ADD CONSTRAINT opportunities_offers_brigade_id_fkey FOREIGN KEY (brigade_id) REFERENCES brigades(id) ON DELETE SET NULL;
ALTER TABLE public.opportunities_offers ADD CONSTRAINT opportunities_offers_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;
ALTER TABLE public.opportunities_offers ADD CONSTRAINT opportunities_offers_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.opportunity_audit_log ADD CONSTRAINT opportunity_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.opportunity_audit_log ADD CONSTRAINT opportunity_audit_log_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;
ALTER TABLE public.payments ADD CONSTRAINT payments_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id);
ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.promo_redemptions ADD CONSTRAINT promo_redemptions_promo_id_fkey FOREIGN KEY (promo_id) REFERENCES promo_codes(id) ON DELETE CASCADE;
ALTER TABLE public.promo_redemptions ADD CONSTRAINT promo_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.provider_bonus_logs ADD CONSTRAINT provider_bonus_logs_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.provider_requests ADD CONSTRAINT provider_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.provider_requests ADD CONSTRAINT provider_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.provider_reviews ADD CONSTRAINT provider_reviews_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES opportunities_offers(id) ON DELETE CASCADE;
ALTER TABLE public.provider_reviews ADD CONSTRAINT provider_reviews_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.provider_status ADD CONSTRAINT provider_status_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.provider_verifications ADD CONSTRAINT provider_verifications_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.provider_verifications ADD CONSTRAINT provider_verifications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);
ALTER TABLE public.provider_wallets ADD CONSTRAINT provider_wallets_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.service_prices ADD CONSTRAINT service_prices_category_id_fkey FOREIGN KEY (category_id) REFERENCES service_categories(id);
ALTER TABLE public.service_prices ADD CONSTRAINT service_prices_subcategory_id_fkey FOREIGN KEY (subcategory_id) REFERENCES service_subcategories(id);
ALTER TABLE public.service_questions ADD CONSTRAINT service_questions_category_id_fkey FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE CASCADE;
ALTER TABLE public.service_subcategories ADD CONSTRAINT service_subcategories_category_id_fkey FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE CASCADE;
ALTER TABLE public.services ADD CONSTRAINT fk_provider_auth_user FOREIGN KEY (provider_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.services ADD CONSTRAINT services_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES profiles(id);
ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_brigade_id_fkey FOREIGN KEY (brigade_id) REFERENCES brigades(id) ON DELETE CASCADE;
ALTER TABLE public.user_devices ADD CONSTRAINT user_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_transactions ADD CONSTRAINT user_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX audit_log_created_at_idx ON public.audit_log USING btree (created_at DESC);
CREATE INDEX banners_active_sort_idx ON public.banners USING btree (is_active, sort_order);
CREATE INDEX brigade_applications_applicant_idx ON public.brigade_applications USING btree (applicant_id);
CREATE UNIQUE INDEX brigade_applications_one_pending_idx ON public.brigade_applications USING btree (applicant_id) WHERE (status = 'pending'::text);
CREATE INDEX brigade_applications_status_idx ON public.brigade_applications USING btree (status);
CREATE INDEX brigade_assignments_brigade_idx ON public.brigade_assignments USING btree (brigade_id);
CREATE INDEX brigade_assignments_member_idx ON public.brigade_assignments USING btree (member_id, status);
CREATE INDEX brigade_assignments_source_idx ON public.brigade_assignments USING btree (source_type, source_id);
CREATE INDEX brigade_invites_brigade_idx ON public.brigade_invites USING btree (brigade_id);
CREATE INDEX brigade_invites_email_idx ON public.brigade_invites USING btree (lower(email)) WHERE (email IS NOT NULL);
CREATE INDEX brigade_invites_phone_idx ON public.brigade_invites USING btree (phone) WHERE (phone IS NOT NULL);
CREATE INDEX brigade_invites_token_idx ON public.brigade_invites USING btree (token);
CREATE INDEX brigade_members_brigade_idx ON public.brigade_members USING btree (brigade_id);
CREATE INDEX brigade_members_online_idx ON public.brigade_members USING btree (brigade_id, is_online) WHERE ((is_active = true) AND (is_online = true));
CREATE INDEX brigade_members_profile_idx ON public.brigade_members USING btree (profile_id);
CREATE INDEX brigade_prices_brigade_idx ON public.brigade_prices USING btree (brigade_id);
CREATE INDEX brigade_prices_category_idx ON public.brigade_prices USING btree (category_id, subcategory_id);
CREATE UNIQUE INDEX brigade_prices_unique_idx ON public.brigade_prices USING btree (brigade_id, category_id, COALESCE(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid), unit);
CREATE INDEX brigades_active_idx ON public.brigades USING btree (is_active, is_verified);
CREATE INDEX brigades_balance_idx ON public.brigades USING btree (balance);
CREATE INDEX brigades_owner_idx ON public.brigades USING btree (owner_id);
CREATE UNIQUE INDEX brigades_slug_unique ON public.brigades USING btree (lower(slug)) WHERE (slug IS NOT NULL);
CREATE INDEX chat_messages_conv_created_idx ON public.chat_messages USING btree (conversation_id, created_at DESC);
CREATE INDEX conversations_category_idx ON public.conversations USING btree (category) WHERE (opportunity_id IS NULL);
CREATE INDEX conversations_customer_idx ON public.conversations USING btree (customer_id, last_message_at DESC NULLS LAST);
CREATE INDEX conversations_provider_idx ON public.conversations USING btree (provider_id, last_message_at DESC NULLS LAST);
CREATE UNIQUE INDEX conversations_unique_pair ON public.conversations USING btree (COALESCE((opportunity_id)::text, ('support_'::text || COALESCE(category, 'general'::text))), customer_id, provider_id);
CREATE INDEX conversations_user_role_idx ON public.conversations USING btree (user_role) WHERE (opportunity_id IS NULL);
CREATE INDEX dispute_attachments_dispute_idx ON public.dispute_attachments USING btree (dispute_id, created_at DESC);
CREATE INDEX disputes_against_idx ON public.disputes USING btree (against_user, created_at DESC);
CREATE UNIQUE INDEX disputes_one_active_per_opp ON public.disputes USING btree (opportunity_id) WHERE (status = ANY (ARRAY['open'::text, 'under_review'::text]));
CREATE INDEX disputes_open_idx ON public.disputes USING btree (status) WHERE (status = ANY (ARRAY['open'::text, 'under_review'::text]));
CREATE INDEX disputes_opportunity_idx ON public.disputes USING btree (opportunity_id);
CREATE INDEX disputes_raised_by_idx ON public.disputes USING btree (raised_by, created_at DESC);
CREATE INDEX idx_bookings_customer_id ON public.bookings USING btree (customer_id);
CREATE INDEX idx_bookings_provider_id ON public.bookings USING btree (provider_id);
CREATE INDEX idx_bookings_service_id ON public.bookings USING btree (service_id);
CREATE INDEX idx_messages_booking_id ON public.messages USING btree (booking_id);
CREATE INDEX idx_messages_receiver_id ON public.messages USING btree (receiver_id);
CREATE INDEX idx_messages_sender_id ON public.messages USING btree (sender_id);
CREATE UNIQUE INDEX idx_payments_external_id_unique ON public.payments USING btree (external_id) WHERE (external_id IS NOT NULL);
CREATE INDEX idx_provider_commissions_logs_offer_id ON public.provider_commissions_logs USING btree (offer_id);
CREATE INDEX idx_provider_commissions_logs_provider_id ON public.provider_commissions_logs USING btree (provider_id);
CREATE INDEX idx_provider_commissions_logs_type_status ON public.provider_commissions_logs USING btree (type, status);
CREATE INDEX idx_services_promotion_active ON public.services USING btree (promotion_type, promotion_expires_at) WHERE (promotion_expires_at IS NOT NULL);
CREATE INDEX notifications_unread_idx ON public.notifications USING btree (user_id, is_read) WHERE (is_read = false);
CREATE INDEX notifications_user_id_idx ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id, is_read, created_at DESC);
CREATE INDEX offers_brigade_idx ON public.opportunities_offers USING btree (brigade_id) WHERE (brigade_id IS NOT NULL);
CREATE INDEX offers_opp_idx ON public.opportunities_offers USING btree (opportunity_id, status);
CREATE INDEX offers_opportunity_id_idx ON public.opportunities_offers USING btree (opportunity_id, status);
CREATE INDEX offers_provider_idx ON public.opportunities_offers USING btree (provider_id, status);
CREATE INDEX offers_status_idx ON public.opportunities_offers USING btree (status, created_at DESC);
CREATE INDEX opportunities_created_by_idx ON public.opportunities USING btree (created_by);
CREATE INDEX opportunities_provider_idx ON public.opportunities USING btree (provider_id) WHERE (provider_id IS NOT NULL);
CREATE INDEX opportunities_status_idx ON public.opportunities USING btree (status, created_at DESC);
CREATE INDEX opportunity_audit_log_actor_idx ON public.opportunity_audit_log USING btree (actor_id, created_at DESC);
CREATE INDEX opportunity_audit_log_opportunity_idx ON public.opportunity_audit_log USING btree (opportunity_id, created_at DESC);
CREATE INDEX password_otps_phone_idx ON public.password_otps USING btree (phone);
CREATE INDEX payments_purpose_idx ON public.payments USING btree (((metadata ->> 'purpose'::text)), completed_at DESC) WHERE (status = 'completed'::text);
CREATE INDEX payments_status_completed_idx ON public.payments USING btree (status, completed_at DESC) WHERE (status = 'completed'::text);
CREATE INDEX payments_status_idx ON public.payments USING btree (status, created_at DESC);
CREATE INDEX payments_user_id_idx ON public.payments USING btree (user_id, created_at DESC);
CREATE INDEX profiles_created_at_idx ON public.profiles USING btree (created_at DESC);
CREATE INDEX profiles_online_idx ON public.profiles USING btree (is_online, role) WHERE (is_online = true);
CREATE INDEX profiles_provider_location_idx ON public.profiles USING btree (role, is_online, latitude, longitude) WHERE ((role = 'provider'::text) AND (latitude IS NOT NULL) AND (longitude IS NOT NULL));
CREATE INDEX profiles_role_idx ON public.profiles USING btree (role);
CREATE UNIQUE INDEX promo_codes_code_upper_idx ON public.promo_codes USING btree (upper(code));
CREATE INDEX promo_redemptions_promo_idx ON public.promo_redemptions USING btree (promo_id);
CREATE INDEX promo_redemptions_user_idx ON public.promo_redemptions USING btree (user_id);
CREATE UNIQUE INDEX provider_requests_one_pending_idx ON public.provider_requests USING btree (user_id) WHERE (status = 'pending'::text);
CREATE INDEX provider_requests_status_idx ON public.provider_requests USING btree (status);
CREATE INDEX provider_requests_user_idx ON public.provider_requests USING btree (user_id);
CREATE UNIQUE INDEX provider_verifications_one_pending ON public.provider_verifications USING btree (provider_id) WHERE (status = 'pending'::text);
CREATE INDEX provider_verifications_provider_idx ON public.provider_verifications USING btree (provider_id, created_at DESC);
CREATE INDEX provider_verifications_status_idx ON public.provider_verifications USING btree (status) WHERE (status = 'pending'::text);
CREATE INDEX provider_wallets_provider_id_idx ON public.provider_wallets USING btree (provider_id);
CREATE UNIQUE INDEX transactions_payment_id_unique ON public.transactions USING btree (payment_id) WHERE (payment_id IS NOT NULL);
CREATE INDEX transactions_related_idx ON public.transactions USING btree (related_id, type) WHERE (related_id IS NOT NULL);
CREATE INDEX transactions_type_user_idx ON public.transactions USING btree (type, user_id, created_at DESC);
CREATE INDEX transactions_user_id_idx ON public.transactions USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX uniq_active_opportunity_per_provider ON public.opportunities USING btree (provider_id) WHERE ((provider_id IS NOT NULL) AND (status = ANY (ARRAY['accepted'::text, 'i-am-here'::text, 'ongoing'::text])));
CREATE INDEX user_blocks_blocked_idx ON public.user_blocks USING btree (blocked_id);
CREATE INDEX user_blocks_blocker_idx ON public.user_blocks USING btree (blocker_id);
CREATE UNIQUE INDEX user_blocks_unique_idx ON public.user_blocks USING btree (blocker_id, blocked_id, scope, COALESCE(brigade_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX withdrawals_provider_idx ON public.withdrawals USING btree (provider_id, requested_at DESC);
CREATE INDEX withdrawals_status_idx ON public.withdrawals USING btree (status, requested_at DESC);

-- ── Identity sütunları (generator DEFAULT kimi göstərmir) ────
ALTER TABLE public.provider_bonus_logs
  ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.services
  ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY;
