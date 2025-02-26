/*
  # Add package details to bookings table
  
  1. Changes
    - Add columns for storing package details:
      - package_name (text)
      - package_price (decimal)
      - package_duration (text)
  
  2. Notes
    - These columns store the selected package details at the time of booking
    - This prevents issues if package details change later
*/

-- Add package details columns to bookings table
ALTER TABLE bookings 
ADD COLUMN package_name text,
ADD COLUMN package_price decimal(10,2),
ADD COLUMN package_duration text;