import { create } from 'zustand';
import { User } from '../types';
import { supabase, handleSupabaseError } from '../lib/supabase';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, role: 'customer' | 'provider', additionalData?: any) => Promise<void>;
  signOut: () => Promise<void>;
  updateUserRole: (newRole: 'customer' | 'provider') => Promise<void>;
  updateUserBalance: (newBalance: number) => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => {
  // Initialize auth state from Supabase session
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      set({ 
        user: {
          id: session.user.id,
          email: session.user.email!,
          role: (session.user.user_metadata.role || 'customer') as 'customer' | 'provider' | 'admin',
          name: session.user.user_metadata.name || session.user.email!,
          created_at: session.user.created_at,
          balance: 0
        },
        loading: false 
      });
    } else {
      set({ user: null, loading: false });
    }
  });

  // Set up auth state listener
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      set({ 
        user: {
          id: session.user.id,
          email: session.user.email!,
          role: (session.user.user_metadata.role || 'customer') as 'customer' | 'provider' | 'admin',
          name: session.user.user_metadata.name || session.user.email!,
          created_at: session.user.created_at,
          balance: 0
        },
        loading: false 
      });
    } else {
      set({ user: null, loading: false });
    }
  });

  return {
    user: null,
    loading: true,
    error: null,
    signIn: async (email, password) => {
      try {
        set({ loading: true, error: null });
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        // Fetch user profile data
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (profileError) throw profileError;

        set({
          user: {
            id: data.user.id,
            email: data.user.email!,
            role: profile.role,
            name: profile.name || data.user.email!,
            created_at: data.user.created_at,
            balance: 0
          }
        });
      } catch (error: any) {
        const errorMessage = handleSupabaseError(error);
        set({ error: errorMessage });
        throw error;
      } finally {
        set({ loading: false });
      }
    },
    signUp: async (email, password, role, additionalData) => {
      try {
        set({ loading: true, error: null });

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

        // Profile will be created automatically via database trigger
        if (data.user) {
          set({
            user: {
              id: data.user.id,
              email: data.user.email!,
              role,
              name: additionalData.name || data.user.email!,
              created_at: data.user.created_at,
              balance: 0
            }
          });
        }
      } catch (error: any) {
        const errorMessage = handleSupabaseError(error);
        set({ error: errorMessage });
        throw error;
      } finally {
        set({ loading: false });
      }
    },
    signOut: async () => {
      try {
        set({ loading: true, error: null });
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        set({ user: null });
      } catch (error: any) {
        const errorMessage = handleSupabaseError(error);
        set({ error: errorMessage });
        throw error;
      } finally {
        set({ loading: false });
      }
    },
    updateUserRole: async (newRole) => {
      try {
        set({ loading: true, error: null });
        
        const { data: { user }, error } = await supabase.auth.updateUser({
          data: { role: newRole }
        });

        if (error) throw error;

        // Update profile in database
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ role: newRole })
          .eq('id', user!.id);

        if (profileError) throw profileError;

        if (user) {
          set({ 
            user: {
              id: user.id,
              email: user.email!,
              role: newRole,
              name: user.user_metadata.name || user.email!,
              created_at: user.created_at,
              balance: user.user_metadata.balance || 0
            }
          });
        }
      } catch (error: any) {
        const errorMessage = handleSupabaseError(error);
        set({ error: errorMessage });
        throw error;
      } finally {
        set({ loading: false });
      }
    },
    updateUserBalance: async (newBalance) => {
      const { user } = get();
      if (!user) return;

      try {
        set({ loading: true, error: null });

        // Update the user's balance in the profiles table
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ balance: newBalance })
          .eq('id', user.id);

        if (updateError) throw updateError;

        // Calculate the change in balance
        const amount = newBalance - user.balance;

        // Insert a new record into the payments table
        const { error: insertError } = await supabase
          .from('payments')
          .insert({
            user_id: user.id,
            amount,
            date: new Date().toISOString(),
            status: 'completed', // or another appropriate status
            description: 'Balance update'
          });

        if (insertError) throw insertError;

        // Update the user state with the new balance
        set((state) => ({
          user: state.user ? { ...state.user, balance: newBalance } : null,
          loading: false,
          error: null
        }));
      } catch (error: any) {
        const errorMessage = handleSupabaseError(error);
        set({ error: errorMessage });
        throw error;
      } finally {
        set({ loading: false });
      }
    },
    clearError: () => set({ error: null }),
  };
});