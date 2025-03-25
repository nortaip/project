export type UserRole = 'customer' | 'provider' | 'admin';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  avatar_url?: string;
  created_at: string;
  balance: number;
}

export interface Service {
  id: string;
  title: string;
  description: string;
  category: string;
  price: number;
  provider_id: string;
  provider: {
    name: string;
    avatar_url: string | null;
  };
  rating: number;
  reviews_count: number;
  location: string;
  availability: string[];
  created_at: string;
}

export interface Booking {
  id: string;
  service_id: string;
  customer_id: string;
  provider_id: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  date: string;
  time: string;
  total_amount: number;
  created_at: string;
}