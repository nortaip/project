export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          role: 'customer' | 'provider' | 'admin'
          name: string | null
          avatar_url: string | null
          phone: string | null
          address: string | null
          birthDate: string | null
          company: string | null
          experience: string | null
          specialties: string[] | null
          created_at: string
          updated_at: string
          status: 'active' | 'inactive' | 'pending'
        }
        Insert: {
          id: string
          role: 'customer' | 'provider' | 'admin'
          name?: string | null
          avatar_url?: string | null
          phone?: string | null
          address?: string | null
          birthDate?: string | null
          company?: string | null
          experience?: string | null
          specialties?: string[] | null
          created_at?: string
          updated_at?: string
          status?: 'active' | 'inactive' | 'pending'
        }
        Update: {
          id?: string
          role?: 'customer' | 'provider' | 'admin'
          name?: string | null
          avatar_url?: string | null
          phone?: string | null
          address?: string | null
          birthDate?: string | null
          company?: string | null
          experience?: string | null
          specialties?: string[] | null
          created_at?: string
          updated_at?: string
          status?: 'active' | 'inactive' | 'pending'
        }
      }
      services: {
        Row: {
          id: string
          provider_id: string
          title: string
          description: string | null
          category: string
          price: number
          location: string | null
          availability: string[]
          images: string[]
          packages: Json[]
          website: string | null
          requirements: string[] | null
          cancellation_policy: string | null
          business_hours: Json | null
          faqs: Json[] | null
          tags: string[] | null
          social_media: Json | null
          rating: number
          reviews_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          provider_id: string
          title: string
          description?: string | null
          category: string
          price: number
          location?: string | null
          availability?: string[]
          images?: string[]
          packages?: Json[]
          website?: string | null
          requirements?: string[] | null
          cancellation_policy?: string | null
          business_hours?: Json | null
          faqs?: Json[] | null
          tags?: string[] | null
          social_media?: Json | null
          rating?: number
          reviews_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          provider_id?: string
          title?: string
          description?: string | null
          category?: string
          price?: number
          location?: string | null
          availability?: string[]
          images?: string[]
          packages?: Json[]
          website?: string | null
          requirements?: string[] | null
          cancellation_policy?: string | null
          business_hours?: Json | null
          faqs?: Json[] | null
          tags?: string[] | null
          social_media?: Json | null
          rating?: number
          reviews_count?: number
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}