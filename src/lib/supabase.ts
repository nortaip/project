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

export async function fetchPaymentHistory(userId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) {
    console.error('Error fetching payment history:', error);
    return [];
  }

  console.log('Fetching payment history for user:', userId);
  console.log('Fetched data:', data);

  return data;
}

export async function logPayment(userId: string, amount: number, status: string, description: string) {
  const { data, error } = await supabase
    .from('payments')
    .insert([{ user_id: userId, amount, status, description }]);

  if (error) {
    console.error('Error logging payment:', error);
    return null;
  }

  return data;
}

export async function fetchUserBalance(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('balance')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Error fetching balance:', error);
    return 0;
  }

  const balance = typeof data.balance === 'number' ? data.balance : parseFloat(data.balance) || 0;
  console.log('Fetched balance:', balance);
  return balance;
}