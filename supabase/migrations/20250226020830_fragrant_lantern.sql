/*
  # Update Bookings RLS Policies
  
  1. Changes
    - Drop existing policies for bookings table
    - Add new policies that allow:
      - Customers to create bookings
      - Users to read their own bookings (as customer or provider)
      - Providers to update bookings they receive
  
  2. Security
    - Ensures proper access control for bookings
    - Prevents unauthorized access or modifications
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can read own bookings" ON bookings;
DROP POLICY IF EXISTS "Customers can create bookings" ON bookings;

-- Create new policies
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