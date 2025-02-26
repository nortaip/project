/*
  # Fix packages column in services table

  1. Changes
    - Drop existing packages column and constraints
    - Re-add packages column as JSONB (not JSONB array)
    - Update validation functions to work with JSONB

  2. Security
    - No changes to RLS policies needed
*/

-- Drop existing constraint and column
ALTER TABLE services DROP CONSTRAINT IF EXISTS valid_packages;
ALTER TABLE services DROP COLUMN IF EXISTS packages;

-- Add packages column as JSONB
ALTER TABLE services 
ADD COLUMN packages jsonb DEFAULT '[]'::jsonb;

-- Create validation function for a single package
CREATE OR REPLACE FUNCTION validate_package(package jsonb)
RETURNS boolean AS $$
BEGIN
  RETURN (
    package IS NULL OR (
      jsonb_typeof(package) = 'object' AND
      package->>'name' IS NOT NULL AND
      package->>'price' IS NOT NULL AND
      package->>'duration' IS NOT NULL AND
      jsonb_typeof(package->'features') = 'array'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create validation function for packages array
CREATE OR REPLACE FUNCTION validate_packages(packages jsonb)
RETURNS boolean AS $$
BEGIN
  RETURN (
    packages IS NULL OR
    jsonb_typeof(packages) = 'array' AND
    (
      SELECT bool_and(validate_package(package))
      FROM jsonb_array_elements(packages) AS package
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add validation constraint
ALTER TABLE services
  ADD CONSTRAINT valid_packages
  CHECK (validate_packages(packages));