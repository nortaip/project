import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase credentials. Please check your .env file.');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

export const handleSupabaseError = (error: any): string => {
  if (!error) return 'An unexpected error occurred';

  // Handle specific Supabase error codes
  switch (error.code) {
    case 'auth/invalid-email':
      return 'Invalid email address';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists';
    case 'auth/weak-password':
      return 'Password is too weak. Please use at least 6 characters';
    case '23505': // Unique violation
      return 'This email is already registered';
    case 'P0001': // Raise exception
      return error.message;
    default:
      if (error.message?.includes('duplicate key')) {
        return 'This email is already registered';
      }
      if (error.message?.includes('invalid_credentials')) {
        return 'Invalid email or password';
      }
      return error.message || 'An unexpected error occurred';
  }
};