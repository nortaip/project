import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { AlertCircle, Loader } from 'lucide-react';
import sha1 from 'crypto-js/sha1';
import Base64 from 'crypto-js/enc-base64';

export function UpdateBalance() {
  const [amount, setAmount] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user } = useAuthStore();

  if (!user) {
    navigate('/login');
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Create form for submission
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = 'https://epoint.az/api/1/checkout';
      form.acceptCharset = 'utf-8';

      // Create payment data exactly as shown in docs
      const paymentData = {
        public_key: "i000200743",
        amount: amount,
        currency: "AZN",
        language: "az",
        description: "test payment",
        order_id: "1"
      };

      // Encode payment data
      const data = Base64.stringify(sha1(JSON.stringify(paymentData)));

      // Create signature
      const privateKey = 'i000200743'; // Replace with your actual private key
      const signatureString = privateKey + data + privateKey;
      const signature = Base64.stringify(sha1(signatureString));

      // Add data input
      const dataInput = document.createElement('input');
      dataInput.type = 'hidden';
      dataInput.name = 'data';
      dataInput.value = data;
      form.appendChild(dataInput);

      // Add signature input
      const signatureInput = document.createElement('input');
      signatureInput.type = 'hidden';
      signatureInput.name = 'signature';
      signatureInput.value = signature;
      form.appendChild(signatureInput);

      // Submit form
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);

    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to process payment');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Top Up Balance</h1>
          
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
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
                Amount (AZN)
              </label>
              <div className="mt-1">
                <input
                  type="number"
                  id="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="Enter amount"
                  min="0"
                  step="0.01"
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {loading ? (
                  <Loader className="w-5 h-5 animate-spin" />
                ) : (
                  'Proceed to Payment'
                )}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <h2 className="text-sm font-medium text-gray-900">Current Balance</h2>
            <p className="mt-1 text-2xl font-semibold text-indigo-600">
              {user.balance.toFixed(2)} AZN
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}