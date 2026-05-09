import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types';
import { supabase, handleSupabaseError } from '../lib/supabase';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, role: 'customer' | 'provider', additionalData?: any) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  logout: () => void;
}

// Initialize auth store with data from localStorage
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      loading: false,
      error: null,
      isAuthenticated: false,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      logout: async () => {
        // Sign-out hətta supabase fail olsa belə local state mütləq təmizlənməlidir
        set({ loading: true, error: null });
        try {
          await supabase.auth.signOut();
        } catch (error: any) {
          // Log amma davam et
          console.error('Sign-out error:', error);
        }
        ['auth-storage', 'user', 'isLoggedIn'].forEach((k) => {
          try { localStorage.removeItem(k); } catch { /* noop */ }
        });
        set({ user: null, loading: false, error: null, isAuthenticated: false });
      },
      signIn: async (email, password) => {
        try {
          set({ loading: true, error: null });
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
          });

          if (error) throw error;

          // Directly use email for user identification
          set({
            user: {
              id: data.user.id,
              email: data.user.email!,
              name: data.user.email!, // Use email as name if no profile name
              created_at: data.user.created_at,
              role: 'customer',
              balance: 0
            },
            isAuthenticated: true
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
                name: additionalData.name || email, // Use email if name is not provided
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
            set({
              user: {
                id: data.user.id,
                email: data.user.email!,
                role,
                name: additionalData.name || email, // Use email if name is not provided
                created_at: data.user.created_at,
                balance: 0
              },
              isAuthenticated: true
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
          set({ user: null, isAuthenticated: false });
        } catch (error: any) {
          const errorMessage = handleSupabaseError(error);
          set({ error: errorMessage });
          throw error;
        } finally {
          set({ loading: false });
        }
      },
      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
    }
  )
);

// Initialize from localStorage if needed
const initializeFromLocalStorage = () => {
  const user = localStorage.getItem('user');
  if (user && localStorage.getItem('isLoggedIn') === 'true') {
    useAuthStore.getState().setUser(JSON.parse(user));
  }
};

// Run immediately
initializeFromLocalStorage();

// Also run when the page loads
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initializeFromLocalStorage);
}