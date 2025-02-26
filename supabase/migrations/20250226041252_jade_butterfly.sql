/*
  # Add Contact Information and Validation

  1. New Columns
    - contact_email (text)
    - contact_phone (text)
    - faq (jsonb array)

  2. Changes
    - Update business_hours to array format
    - Add validation functions for business hours and FAQ
    - Add indexes for contact information
*/

-- Add new columns to services table
ALTER TABLE services
ADD COLUMN IF NOT EXISTS contact_email text,
ADD COLUMN IF NOT EXISTS contact_phone text;

-- Drop existing business_hours column and recreate as array
ALTER TABLE services DROP COLUMN IF EXISTS business_hours;
ALTER TABLE services ADD COLUMN business_hours jsonb DEFAULT '[]'::jsonb;

-- Drop existing faq column and recreate
ALTER TABLE services DROP COLUMN IF EXISTS faq;
ALTER TABLE services ADD COLUMN faq jsonb DEFAULT '[]'::jsonb;

-- Create validation functions
CREATE OR REPLACE FUNCTION validate_business_hours(hours jsonb)
RETURNS boolean AS $$
BEGIN
  RETURN (
    hours IS NULL OR (
      jsonb_typeof(hours) = 'array' AND
      (
        SELECT bool_and(
          hour->>'day' IS NOT NULL AND
          hour->>'open' IS NOT NULL AND
          hour->>'close' IS NOT NULL AND
          hour->>'closed' IS NOT NULL
        )
        FROM jsonb_array_elements(hours) AS hour
      )
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION validate_faq(faq jsonb)
RETURNS boolean AS $$
BEGIN
  RETURN (
    faq IS NULL OR (
      jsonb_typeof(faq) = 'array' AND
      (
        SELECT bool_and(
          item->>'question' IS NOT NULL AND
          item->>'answer' IS NOT NULL
        )
        FROM jsonb_array_elements(faq) AS item
      )
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add validation constraints
DO $$ BEGIN
  ALTER TABLE services DROP CONSTRAINT IF EXISTS valid_business_hours;
  ALTER TABLE services ADD CONSTRAINT valid_business_hours CHECK (validate_business_hours(business_hours));
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE services DROP CONSTRAINT IF EXISTS valid_faq;
  ALTER TABLE services ADD CONSTRAINT valid_faq CHECK (validate_faq(faq));
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_services_contact_email ON services(contact_email);
CREATE INDEX IF NOT EXISTS idx_services_contact_phone ON services(contact_phone);