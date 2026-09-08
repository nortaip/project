import React, { useState } from 'react';
import { Star, MapPin, Briefcase, Award, MessageSquare, X, Send, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { supabase } from '../lib/supabase';

interface ProviderCardProps {
  id: string;
  name: string;
  title: string;
  rating: number;
  reviewCount: number;
  location: string;
  experience: string;
  specialties: string[];
  imageUrl: string;
  verified: boolean;
  email: string;
}

export function ProviderCard({
  id,
  name,
  title,
  rating,
  reviewCount,
  location,
  experience,
  specialties,
  imageUrl,
  verified,
}: ProviderCardProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [showChatModal, setShowChatModal] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleViewProfile = () => {
    // For now, we'll just navigate to a dummy profile page with the provider ID
    // In a real app, you would have a dedicated provider profile page
    navigate(`/provider/${id}`);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      navigate('/login', { state: { from: `/providers` } });
      return;
    }

    if (!message.trim()) {
      return;
    }

    try {
      setSending(true);
      setError(null);

      // Create a dummy booking for the message (in a real app, you might handle this differently)
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          service_id: null, // This is a direct message without a service
          customer_id: user.id,
          provider_id: id,
          status: 'pending',
          date: new Date().toISOString().split('T')[0],
          time: '12:00',
          total_amount: 0
        })
        .select()
        .single();

      if (bookingError) throw bookingError;

      // Send the message
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          booking_id: bookingData.id,
          sender_id: user.id,
          receiver_id: id,
          content: message
        });

      if (messageError) throw messageError;

      setSuccess(true);
      setMessage('');
      
      // Close the modal after a short delay
      setTimeout(() => {
        setShowChatModal(false);
        setSuccess(false);
      }, 2000);
      
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Mesaj göndərilmədi — yenidən cəhd edin.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300">
      <div className="p-6">
        <div className="flex items-start space-x-4">
          <img
            src={imageUrl}
            alt={name}
            className="h-20 w-20 rounded-full object-cover"
          />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{name}</h3>
                <p className="text-gray-600">{title}</p>
              </div>
              {verified && (
                <Award className="h-6 w-6 text-blue-500" aria-label="Verified Provider" />
              )}
            </div>
            <div className="flex items-center mt-2">
              <Star className="h-5 w-5 text-yellow-400 fill-current" />
              <span className="ml-1 text-gray-900 font-medium">{Number(rating ?? 0).toFixed(1)}</span>
              <span className="mx-1 text-gray-500">·</span>
              <span className="text-gray-500">{reviewCount} reviews</span>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center text-gray-600">
            <MapPin className="h-4 w-4 mr-2" />
            <span>{location}</span>
          </div>
          <div className="flex items-center text-gray-600">
            <Briefcase className="h-4 w-4 mr-2" />
            <span>{experience}</span>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            {specialties.map((specialty, index) => (
              <span
                key={index}
                className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
              >
                {specialty}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 flex space-x-3">
          <button 
            onClick={handleViewProfile}
            className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            View Profile
          </button>
          <button 
            onClick={() => setShowChatModal(true)}
            className="flex items-center justify-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <MessageSquare className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Chat Modal */}
      {showChatModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">
                Message {name}
              </h2>
              <button
                onClick={() => setShowChatModal(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                  <div className="ml-3">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {success && (
              <div className="mb-4 bg-green-50 border border-green-200 rounded-md p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-green-400" />
                  <div className="ml-3">
                    <p className="text-sm text-green-700">Message sent successfully!</p>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSendMessage}>
              <div className="mb-4">
                <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                  Your message
                </label>
                <textarea
                  id="message"
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder={`What service do you need from ${name}?`}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                ></textarea>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={sending || !message.trim()}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {sending ? (
                    <span className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Sending...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      <Send className="h-4 w-4 mr-2" />
                      Send Message
                    </span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}