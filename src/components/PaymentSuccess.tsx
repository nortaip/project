import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const PaymentSuccessPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "confirmed" | "already" | "rejected" | "failed">("loading");
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    const checkPaymentStatus = async () => {
      const receivedOrderId = searchParams.get("orderId");
      const paymentStatus = searchParams.get("status");
      setOrderId(receivedOrderId);

      if (paymentStatus === "success" && receivedOrderId) {
        try {
          const response = await fetch(`https://ellit.az/data/check_status.php?order_id=${receivedOrderId}`);
          const result = await response.json();

          console.log("📥 Status yoxlama nəticəsi:", result);

          if (result.success && result.message?.includes("tamamlandı")) {
            setStatus("confirmed");
          } else if (result.success && result.message?.includes("Artıq tamamlanıb")) {
            setStatus("already");
          } else if (
            result.epoint_response?.status === "server_error" &&
            result.epoint_response?.message === "record not found"
          ) {
            setStatus("rejected");
          } else {
            setStatus("failed");
          }
        } catch (err) {
          console.error("❌ Status yoxlanarkən xəta:", err);
          setStatus("failed");
        }
      } else {
        setStatus("failed");
      }
    };

    checkPaymentStatus();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-white">
      <div className="p-8 rounded-2xl shadow-lg border text-center max-w-md w-full">
        {status === "loading" ? (
          <p className="text-gray-500 text-lg">Yoxlanır...</p>
        ) : status === "confirmed" ? (
          <>
            <h1 className="text-3xl font-bold text-green-600 mb-4">Ödəniş uğurla tamamlandı!</h1>
            <p className="text-gray-500">Balansınıza əlavə olundu.</p>
          </>
        ) : status === "already" ? (
          <>
            <h1 className="text-3xl font-bold text-blue-600 mb-4">Bu ödəniş artıq tamamlanmışdı</h1>
            <p className="text-gray-500">Balansınız artıq yenilənmişdir.</p>
          </>
        ) : status === "rejected" ? (
          <>
            <h1 className="text-3xl font-bold text-yellow-600 mb-4">Qeyd tapılmadı</h1>
            <p className="text-gray-500">Ödəniş məlumatı tapılmadı və rədd edildi.</p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-red-600 mb-4">Ödəniş uğursuz oldu</h1>
            <p className="text-gray-500">Zəhmət olmasa yenidən cəhd edin.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default PaymentSuccessPage;
