import React from "react";
import { Navigate, useLocation } from "react-router-dom";

// Köhnə (legacy) ödəniş səhifəsi — yoxlama artıq /payment/result səhifəsində aparılır.
// Query parametrlərini saxlayaraq oraya yönləndiririk.
const PaymentSuccessPage: React.FC = () => {
  const location = useLocation();
  return <Navigate to={`/payment/result${location.search}`} replace />;
};

export default PaymentSuccessPage;
