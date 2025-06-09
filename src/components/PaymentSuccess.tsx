import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { message } from 'antd'; // Assuming 'antd' is installed for messages

export function PaymentSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const serviceId = params.get('serviceId');
    const promotiontype = params.get('promotiontype');
    const promotionpriceStr = params.get('promotionprice'); // Get as string first
    const promotiondurationStr = params.get('promotionduration'); // Get as string first
    const orderRef = params.get('ref'); // Assuming 'ref' is passed back from epoint.az, or your custom order ID

    // Basic validation of required parameters
    if (!serviceId || !promotiontype || !promotionpriceStr || !promotiondurationStr) {
      message.error('Promosyon məlumatları natamamdır. Ödəniş təsdiqlənmədi.');
      setErrorMessage('Promosyon məlumatları natamamdır. Zəhmət olmasa dəstək ilə əlaqə saxlayın.');
      setLoading(false);
      navigate('/'); // Or a more specific error page
      return;
    }

    // Parse numbers, handle potential NaN
    const promotionprice = Number(promotionpriceStr);
    const promotionduration = Number(promotiondurationStr);

    if (isNaN(promotionprice) || isNaN(promotionduration)) {
      message.error('Promosyon qiyməti və ya müddəti yanlışdır. Ödəniş təsdiqlənmədi.');
      setErrorMessage('Yanlış qiymət və ya müddət. Zəhmət olmasa dəstək ilə əlaqə saxlayın.');
      setLoading(false);
      navigate('/');
      return;
    }

    const updatePromotion = async () => {
      try {
        console.log('Attempting to update service with ID:', serviceId);
        console.log('Promotion Type:', promotiontype);
        console.log('Promotion Price:', promotionprice);
        console.log('Promotion Duration:', promotionduration);
        console.log('Order Reference (if available):', orderRef);

        // *** SECURITY WARNING ***
        // This update is being performed directly on the frontend based on URL parameters.
        // This is highly insecure as URL parameters can be easily manipulated by users.
        // The proper way to confirm payment and update the database is via a secure backend callback
        // from Epoint.az (using your `result_url`) that verifies the payment's authenticity
        // with your private key (which should NEVER be on the frontend).
        // DO NOT USE THIS METHOD IN PRODUCTION WITHOUT A BACKEND VERIFICATION LAYER.
        // *** END SECURITY WARNING ***

        const { data: existingService, error: fetchError } = await supabase
          .from('services')
          .select('id') // Select only the ID to check existence
          .eq('id', Number(serviceId))
          .single();

        if (fetchError || !existingService) {
          console.error('Service not found or error fetching:', fetchError);
          message.error('Xidmət tapılmadı. Promosyon aktivləşdirilmədi.');
          setErrorMessage('Xidmət məlumatları yanlışdır. Zəhmət olmasa dəstək ilə əlaqə saxlayın.');
          return;
        }

        const { error: updateError } = await supabase
          .from('services')
          .update({
            promotion_type: promotiontype,
            promotion_price: promotionprice,
            promotion_duration: promotionduration,
            promotion_paid: true,
            // You might want to store the orderRef/transaction ID from Epoint.az here for reconciliation
            // epoint_order_ref: orderRef,
          })
          .eq('id', Number(serviceId));

        if (updateError) throw updateError;

        message.success('Promosyon uğurla yeniləndi!');
      } catch (error) {
        console.error('Promosyon aktivləşdirmə xətası:', error);
        message.error('Promosyon aktivləşdirilmədi. Xəta: ' + (error as Error).message);
        setErrorMessage('Promosyon aktivləşdirilmədi. Zəhmət olmasa dəstək ilə əlaqə saxlayın.');
      } finally {
        setLoading(false);
      }
    };

    updatePromotion();
  }, [location.search, navigate]); // Added navigate to dependency array

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600 text-lg">Promosyon aktivləşdirilir...</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50">
        <div className="bg-white p-6 rounded shadow-md max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Xəta baş verdi!</h2>
          <p className="text-gray-700">{errorMessage}</p>
          <button
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            onClick={() => navigate('/')} // Redirect to home on error
          >
            Əsas səhifəyə qayıt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-green-50">
      <div className="bg-white p-6 rounded shadow-md max-w-md w-full text-center">
        <h2 className="text-2xl font-bold text-green-600 mb-2">Promosyon uğurla tamamlandı!</h2>
        <p className="text-gray-700">Xidmət irəli çəkildi və ödəniş təsdiqləndi.</p>
        <button
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          onClick={() => {
            const serviceId = new URLSearchParams(location.search).get('serviceId');
            navigate(serviceId ? `/profile/balance` : '/'); // Navigate to service page or home
          }}
        >
          Xidmət səhifəsinə qayıt
        </button>
      </div>
    </div>
  );
}