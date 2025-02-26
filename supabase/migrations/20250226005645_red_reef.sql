/*
  # Add additional service fields

  1. New Fields
    - `images`: Array of image URLs
    - `business_hours`: JSON object for business hours
    - `requirements`: Text array for service requirements
    - `cancellation_policy`: Text for cancellation policy
    - `faqs`: Array of FAQ objects
    - `tags`: Array of service tags
    - `website`: Optional website URL
    - `social_media`: JSON object for social media links

  2. Changes
    - Added new columns to services table
    - Added validation for business hours and social media JSON
*/

-- Add new columns to services table
ALTER TABLE services ADD COLUMN IF NOT EXISTS images text[] DEFAULT ARRAY[]::text[];
ALTER TABLE services ADD COLUMN IF NOT EXISTS business_hours jsonb DEFAULT '{}'::jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS requirements text[] DEFAULT ARRAY[]::text[];
ALTER TABLE services ADD COLUMN IF NOT EXISTS cancellation_policy text;
ALTER TABLE services ADD COLUMN IF NOT EXISTS faqs jsonb[] DEFAULT ARRAY[]::jsonb[];
ALTER TABLE services ADD COLUMN IF NOT EXISTS tags text[] DEFAULT ARRAY[]::text[];
ALTER TABLE services ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE services ADD COLUMN IF NOT EXISTS social_media jsonb DEFAULT '{}'::jsonb;

-- Create validation functions
CREATE OR REPLACE FUNCTION validate_business_hours(hours jsonb)
RETURNS boolean AS $$
BEGIN
  RETURN (
    hours IS NULL OR (
      jsonb_typeof(hours) = 'object' AND
      (
        SELECT bool_and(
          value->>'open' IS NOT NULL AND
          value->>'close' IS NOT NULL
        )
        FROM jsonb_each(hours)
      )
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add validation constraints
ALTER TABLE services
  ADD CONSTRAINT valid_business_hours
  CHECK (validate_business_hours(business_hours));

ALTER TABLE services
  ADD CONSTRAINT valid_social_media
  CHECK (
    social_media IS NULL OR
    jsonb_typeof(social_media) = 'object'
  );