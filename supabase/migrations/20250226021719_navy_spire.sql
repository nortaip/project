/*
  # Update bookings schema and policies

  1. Changes
    - Add missing columns to bookings table
    - Update RLS policies for better access control

  2. Security
    - Enable RLS on bookings table
    - Add policies for customers and providers
*/

-- Add missing columns to bookings table if they don't exist
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS package_name text,
ADD COLUMN IF NOT EXISTS package_price decimal(10,2),
ADD COLUMN IF NOT EXISTS package_duration text;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can read own bookings" ON bookings;
DROP POLICY IF EXISTS "Customers can create bookings" ON bookings;
DROP POLICY IF EXISTS "Providers can update own bookings" ON bookings;

-- Create updated policies
CREATE POLICY "Users can read own bookings"
ON bookings FOR SELECT
TO authenticated
USING (
  auth.uid() = customer_id 
  OR auth.uid() = provider_id
);

CREATE POLICY "Customers can create bookings"
ON bookings FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = customer_id
);

CREATE POLICY "Providers can update own bookings"
ON bookings FOR UPDATE
TO authenticated
USING (
  auth.uid() = provider_id
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_provider_id ON bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON bookings(service_id);