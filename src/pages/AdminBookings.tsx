import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Booking {
  id: string;
  service: {
    title: string;
    location: string;
    provider: {
      name: string;
    };
  };
  customer: {
    id: string;
    name: string;
    email: string;
    phone_number: string;
  };
  date: string;
  time: string;
  total_amount: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
}

interface Service {
  id: string;
  title: string;
  description: string;
  location: string;
  price: number;
  images?: string[]; // Add images array
  provider: {
    name: string;
  };
}

export function AdminBookings() {
  const [activeTab, setActiveTab] = useState<'bookings' | 'services'>('bookings');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // For editing service
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', location: '', price: 0 });
  const [aboutService, setAboutService] = useState<Service | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    if (activeTab === 'bookings') {
      loadAllBookings();
    } else {
      loadAllServices();
    }
    // eslint-disable-next-line
  }, [activeTab]);

  const loadAllBookings = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          service:services (
            title,
            location,
            provider:profiles (
              name
            )
          ),
          customer:profiles (
            id,
            name,
            email,
            phone_number
          )
        `)
        .order('date', { ascending: false });

      if (error) throw error;
      setBookings(data);
    } catch (error) {
      setError('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  const loadAllServices = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('services')
        .select(`
          *,
          provider:profiles (
            name
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setServices(data);
    } catch (error) {
      setError('Failed to load services');
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (service: Service) => {
    setEditingService(service);
    setEditForm({
      title: service.title,
      description: service.description,
      location: service.location,
      price: service.price,
    });
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImageFile(e.target.files[0]);
    }
  };

  const handleEditSave = async () => {
    if (!editingService) return;
    setLoading(true);
    try {
      let imageUrl = editingService.images?.[0] || '';
      if (imageFile) {
        // Upload logic here (e.g., Supabase Storage)
        // After upload, set imageUrl = uploaded file URL
      }
      const { error } = await supabase
        .from('services')
        .update({
          title: editForm.title,
          description: editForm.description,
          location: editForm.location,
          price: Number(editForm.price),
          images: imageUrl ? [imageUrl] : [],
        })
        .eq('id', editingService.id);
      if (error) throw error;
      setEditingService(null);
      setImageFile(null);
      loadAllServices();
    } catch (error) {
      setError('Failed to update service');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Admin Dashboard</h1>
        <div className="mb-6 flex space-x-4">
          <button
            className={`px-4 py-2 rounded ${activeTab === 'bookings' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            onClick={() => setActiveTab('bookings')}
          >
            Bookings
          </button>
          <button
            className={`px-4 py-2 rounded `}
            onClick={() => window.location.href = '/SMR/service-accept'}
          >
            Yoxlama
          </button>
          <button
            className={`px-4 py-2 rounded ${activeTab === 'services' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            onClick={() => setActiveTab('services')}
          >
            Services
          </button>
        </div>
        {loading ? (
          <div className="text-center py-10">Loading...</div>
        ) : error ? (
          <div className="text-center text-red-500 py-10">{error}</div>
        ) : activeTab === 'bookings' ? (
          bookings.length === 0 ? (
            <p className="text-center text-gray-500">No bookings found.</p>
          ) : (
            <div className="overflow-x-auto bg-white shadow rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Service</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {bookings.map((booking) => (
                    <tr key={booking.id}>
                      <td className="px-4 py-2 text-sm text-gray-700">{booking.id}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">{booking.service?.title}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">{booking.service?.provider?.name}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">
                        {booking.customer?.name}<br />
                        <span className="text-xs text-gray-500">{booking.customer?.email}</span>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-700">{new Date(booking.date).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">{booking.time}</td>
                      <td className="px-4 py-2 text-sm text-gray-700 capitalize">{booking.status}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">${booking.total_amount?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div>
            {editingService ? (
              <div className="mb-6 p-4 bg-white rounded shadow">
                <h2 className="text-xl font-semibold mb-4">Edit Service</h2>
                <div className="mb-2">
                  <label className="block text-sm font-medium">Title</label>
                  <input
                    className="w-full border px-2 py-1 rounded"
                    name="title"
                    value={editForm.title}
                    onChange={handleEditChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium">Description</label>
                  <textarea
                    className="w-full border px-2 py-1 rounded"
                    name="description"
                    value={editForm.description}
                    onChange={handleEditChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium">Location</label>
                  <input
                    className="w-full border px-2 py-1 rounded"
                    name="location"
                    value={editForm.location}
                    onChange={handleEditChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium">Price</label>
                  <input
                    className="w-full border px-2 py-1 rounded"
                    name="price"
                    type="number"
                    value={editForm.price}
                    onChange={handleEditChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium">Image</label>
                  {editingService.images?.[0] && (
                    <img src={editingService.images[0]} alt="Service" className="h-24 mb-2 rounded" />
                  )}
                  <input type="file" accept="image/*" onChange={handleImageChange} />
                </div>
                <div className="flex space-x-2 mt-4">
                  <button
                    className="px-4 py-2 bg-indigo-600 text-white rounded"
                    onClick={handleEditSave}
                  >
                    Save
                  </button>
                  <button
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded"
                    onClick={() => setEditingService(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto bg-white shadow rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {services.map((service) => (
                    <tr key={service.id}>
                      <td className="px-4 py-2 text-sm text-gray-700">{service.id}</td>
                      <td className="px-4 py-2 text-sm text-gray-700 flex items-center gap-2">
                        {service.images?.[0] && (
                          <img src={service.images[0]} alt="Service" className="h-10 w-10 rounded object-cover" />
                        )}
                        {service.title}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-700">{service.provider?.name}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">{service.location}</td>
                      <td className="px-4 py-2 text-sm text-gray-700">${service.price?.toFixed(2)}</td>
                      <td className="px-4 py-2 text-sm">
                        <button
                          className="px-3 py-1 bg-blue-500 text-white rounded"
                          onClick={() => handleEditClick(service)}
                        >
                          Edit
                        </button>
                        <button
                          className="px-3 py-1 bg-green-500 text-white rounded"
                          onClick={() => setAboutService(service)}
                        >
                          About
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminBookings;