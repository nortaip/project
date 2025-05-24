import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { message } from 'antd';

export function PaymentSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const serviceId = params.get('serviceId');
    const promotiontype = params.get('promotiontype');
    const promotionprice = params.get('promotionprice');
    const promotionduration = params.get('promotionduration');

    if (!serviceId || !promotiontype) {
      message.error('Promosyon məlumatları natamamdır.');
      navigate('/');
      return;
    }

    const updatePromotion = async () => {
      try {
        console.log('Updating service with ID:', serviceId);
        console.log('Promotion Type:', promotiontype);
        console.log('Promotion Price:', promotionprice);
        console.log('Promotion Duration:', promotionduration);

        const { error } = await supabase
          .from('services')
          .update({
            promotion_type: promotiontype,
            promotion_price: Number(promotionprice),
            promotion_duration: Number(promotionduration),
            promotion_paid: true
          })
          .eq('id', Number(serviceId));

        if (error) throw error;

        message.success('Promosyon uğurla yeniləndi!');
      } catch (error) {
        console.error(error);
        message.error('Promosyon aktivləşdirilmədi.');
      } finally {
        setLoading(false);
      }
    };

    updatePromotion();
  }, [location.search, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600 text-lg">Promosyon aktivləşdirilir...</p>
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
          onClick={() => navigate(`/services/${new URLSearchParams(location.search).get('serviceId')}`)}
        >
          Xidmət səhifəsinə qayıt
        </button>
      </div>
    </div>
  );
}
