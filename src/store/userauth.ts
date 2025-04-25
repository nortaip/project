import { supabase, handleSupabaseError } from '../lib/supabase';
import { User } from '../types';

interface AuthResponse {
  user: User | null;
  error: string | null;
}

export const signIn = async (email: string, password: string): Promise<AuthResponse> => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError) throw profileError;

    return {
      user: {
        id: data.user.id,
        email: data.user.email!,
        role: profile.role,
        name: profile.name || data.user.email!,
        created_at: data.user.created_at,
        balance: profile.balance || 0
      },
      error: null
    };
  } catch (error: any) {
    const errorMessage = handleSupabaseError(error);
    return { user: null, error: errorMessage };
  }
};

export const signUp = async (email: string, password: string, role: 'customer' | 'provider', additionalData?: any): Promise<AuthResponse> => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role,
          name: additionalData.name,
          phone: additionalData.phone,
          address: additionalData.address,
          birthDate: additionalData.birthDate,
          company: additionalData.company || null,
          experience: additionalData.experience || null,
          specialties: additionalData.specialties || []
        }
      }
    });

    if (error) throw error;

    if (data.user) {
      return {
        user: {
          id: data.user.id,
          email: data.user.email!,
          role,
          name: additionalData.name || data.user.email!,
          created_at: data.user.created_at,
          balance: 0
        },
        error: null
      };
    }

    return { user: null, error: 'User creation failed' };
  } catch (error: any) {
    const errorMessage = handleSupabaseError(error);
    return { user: null, error: errorMessage };
  }
};

export const signOut = async (): Promise<string | null> => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return null;
  } catch (error: any) {
    return handleSupabaseError(error);
  }
};