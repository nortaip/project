export interface Opportunity {
    id: string;
    customer_name: string;
    phone: string;
    service_title: string;
    location: string;
    date: string;
    description: string;
    bid_count: number;
  }
  export interface Offer {
    id: string;
    opportunity_id: string;
    amount: number;
    message: string;
    status: 'pending' | 'accepted' | 'rejected';
    created_at: string;
    opportunity: Opportunity;
  }
  export interface Service {
    id: string;
    title: string;
    description: string;
    price: number;
    created_at: string;
  }
  export interface Payment {
    id: string;
    amount: number;
    type: 'deposit' | 'withdrawal';
    status: 'completed' | 'pending';
    created_at: string;
    description: string;
  }
  