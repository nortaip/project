-- Create config table for platform settings
-- Stores key-value pairs for site-wide configuration

CREATE TABLE IF NOT EXISTS public.config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT key_format CHECK (key ~ '^[a-z_]+$')
);

-- Enable RLS
ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Admins can read config" ON public.config;
DROP POLICY IF EXISTS "Admins can update config" ON public.config;
DROP POLICY IF EXISTS "Admins can insert config" ON public.config;

-- Only admins can read/write config
CREATE POLICY "Admins can read config" ON public.config
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update config" ON public.config
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can insert config" ON public.config
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Insert default platform settings
INSERT INTO public.config (key, value, description) VALUES
  ('support_phone', '+994 55 939 01 06', 'Support phone number shown in Footer'),
  ('support_email', 'support@ellit.az', 'Support email shown in Footer'),
  ('platform_address', 'Bakı, Azərbaycan', 'Company headquarters address'),
  ('commission_on_accept', '10', 'Commission percentage when offer accepted (%)'),
  ('commission_on_complete', '5', 'Commission percentage when job completed (%)'),
  ('commission_on_withdrawal', '2', 'Commission percentage on withdrawal (%)'),
  ('min_withdrawal_amount', '10', 'Minimum withdrawal amount (AZN)')
ON CONFLICT (key) DO NOTHING;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS config_update_timestamp ON public.config;

-- Drop function if exists
DROP FUNCTION IF EXISTS public.update_config_timestamp() CASCADE;

-- Create function to update updated_at timestamp
CREATE FUNCTION public.update_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER config_update_timestamp
  BEFORE UPDATE ON public.config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_config_timestamp();