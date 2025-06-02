import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Service = {
  id: string;
  title: string;
  description: string;
  price: number;
  created_at: string;
};

const ServicesPage: React.FC = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: provider_id-ni auth-dan götür
    const fetchServices = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("provider_id", (await supabase.auth.getUser()).data.user?.id)
        .order("created_at", { ascending: false });
      if (data) setServices(data);
      setLoading(false);
    };
    fetchServices();
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Xidmətlərim</h2>
      {loading ? (
        <div>Yüklənir...</div>
      ) : (
        <div className="space-y-3">
          {services.length === 0 && <div>Heç bir xidmət əlavə etməmisiniz.</div>}
          {services.map((service) => (
            <div key={service.id} className="bg-white p-4 rounded shadow flex justify-between items-center">
              <div>
                <div className="font-medium">{service.title}</div>
                <div className="text-gray-500 text-sm">{service.description}</div>
                <div className="text-xs text-gray-400">{new Date(service.created_at).toLocaleString()}</div>
              </div>
              <span className="text-indigo-700 font-bold">{service.price} ₼</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ServicesPage;
