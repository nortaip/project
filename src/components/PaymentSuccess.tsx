import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { message } from 'antd';

export default function PaymentSuccess() {
  const [params] = useSearchParams();
  const serviceId = params.get('id');

  useEffect(() => {
    if (!serviceId) return;

    const markPromotionAsPaid = async () => {
      console.log('Trying to update service with ID:', serviceId);

      // Step 1: Update the service row
      const { error: updateError } = await supabase
        .from('services')
        .update({ promotion_paid: true })
        .eq('id', Number(serviceId));

      if (updateError) {
        console.error('Update failed:', updateError);
        message.error('Ödəniş uğurlu oldu, ancaq status yenilənmədi.');
        return;
      }

      // Step 2: Log the payment in a separate table
      const { error: logError } = await supabase
        .from('payments')
        .insert([
          {
            service_id: Number(serviceId),
            status: 'success',
            method: 'epoint',
            paid_at: new Date().toISOString(),
            amount: null // Optionally add amount if available
          }
        ]);

      if (logError) {
        console.error('Payment log failed:', logError);
        message.warning('Ödəniş təsdiqləndi, lakin log yazılmadı.');
      } else {
        message.success('Ödəniş təsdiqləndi!');
      }
    };

    markPromotionAsPaid();
  }, [serviceId]);

  return (
    <div className="text-center mt-24">
      <h2 className="text-xl font-bold">Ödəniş tamamlandı</h2>
      <p className="text-gray-600 mt-2">Elanınız ödənişli olaraq qeyd edildi.</p>
    </div>
  );
}
