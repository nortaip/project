/*
  # Storage setup for service images

  1. Changes
    - Create storage bucket for service images
    - Set up storage policies for authenticated uploads and public viewing

  2. Security
    - Enable public access to view images
    - Restrict upload permissions to authenticated users
*/

-- Create storage bucket for service images if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'service-images'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('service-images', 'service-images', true);
  END IF;
END $$;

-- Enable RLS on storage.objects if not already enabled
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to upload images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public to view images" ON storage.objects;

-- Create storage policies
CREATE POLICY "Allow authenticated users to upload images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'service-images');

CREATE POLICY "Allow public to view images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'service-images');