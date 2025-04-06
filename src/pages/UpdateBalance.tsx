import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { useNavigate } from 'react-router-dom';

const UpdateBalance = () => {
  const { user } = useAuthStore();
  const [currentBalance, setCurrentBalance] = useState<number>(0);
  const [additionalAmount, setAdditionalAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCurrentBalance = async () => {
      if (user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('balance')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error fetching balance:', error);
          setError('Failed to fetch current balance.');
        } else {
          setCurrentBalance(data.balance || 0);
        }
      }
    };

    fetchCurrentBalance();
  }, [user]);

  const handleUpdateBalance = async () => {
    if (!user) {
      setError('You must be logged in to update your balance.');
      return;
    }

    const parsedAmount = parseFloat(additionalAmount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      setError('Please enter a valid positive number to add to your balance.');
      return;
    }

    const newBalance = currentBalance + parsedAmount;

    try {
      // Update the balance in the profiles table
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({ balance: newBalance })
        .eq('id', user.id);

      if (updateError) {
        console.error('Error updating balance:', updateError);
        setError('Failed to update balance. Please try again.');
        navigate('/payment/error');
        return;
      }

      // Insert a record into the payments table
      const { error: paymentError } = await supabase
        .from('payments')
        .insert([
          {
            user_id: user.id, // Assuming user.id is a UUID
            amount: parsedAmount,
            date: new Date().toISOString(), // Current timestamp
            status: 'completed', // You can adjust this based on your logic
            description: 'Balance update', // Description of the transaction
          },
        ]);

      if (paymentError) {
        console.error('Error inserting payment record:', paymentError);
        setError('Failed to log payment. Please try again.');
        navigate('/payment/error');
        return;
      }

      setSuccess('Balance updated successfully and logged in payments!');
      setAdditionalAmount(''); // Clear the input field
      navigate('/payment/success');
    } catch (error) {
      console.error('Unexpected error:', error);
      setError('An unexpected error occurred. Please try again.');
      navigate('/payment/error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-6 rounded shadow-md">
        <h1 className="text-2xl font-bold mb-4">Update Balance</h1>
        <p className="mb-4">Current Balance: ${currentBalance}</p>
        {error && <p className="text-red-500">{error}</p>}
        {success && <p className="text-green-500">{success}</p>}
        <input
          type="number"
          placeholder="Enter amount to add"
          value={additionalAmount}
          onChange={(e) => setAdditionalAmount(e.target.value)}
          className="border rounded p-2 mb-4 w-full"
        />
        <button
          onClick={handleUpdateBalance}
          className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
        >
          Update Balance
        </button>
      </div>
    </div>
  );
};

export default UpdateBalance;