/*
  # Add status column to profiles table

  1. Changes
    - Add status column to profiles table with allowed values:
      - 'active'
      - 'inactive'
      - 'pending'
    - Set default value to 'active'
    - Add check constraint for valid status values

  2. Security
    - No changes to RLS policies needed
*/

-- Add status column to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS status text NOT NULL 
DEFAULT 'active' 
CHECK (status IN ('active', 'inactive', 'pending'));