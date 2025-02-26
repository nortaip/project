/*
  # Add packages column to services table

  1. Changes
    - Add packages column to services table as JSONB array
    - Add validation constraint for packages structure

  2. Security
    - No changes to RLS policies needed
*/

-- Add packages column to services table if it doesn't exist
ALTER TABLE services 
ADD COLUMN IF NOT EXISTS packages jsonb[] DEFAULT ARRAY[]::jsonb[];

-- Create validation function for packages
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
CREATE OR REPLACE FUNCTION validate_packages(packages jsonb[])
RETURNS boolean AS $$
BEGIN
  RETURN (
    packages IS NULL OR (
      array_length(packages, 1) IS NULL OR
      (
        SELECT bool_and(validate_package(jsonb_array_element(packages::jsonb)))
        FROM jsonb_array_elements(packages::jsonb)
      )
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add validation constraint
ALTER TABLE services
  ADD CONSTRAINT valid_packages
  CHECK (validate_packages(packages));