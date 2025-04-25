import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  CheckCircle,
  AlertCircle,
  Clock,
  Award,
  Shield,
  Loader,
  CreditCard,
  Star,
  Mail,
  Phone,
  ChevronLeft
} from 'lucide-react';
import Slider from 'react-slick';
import 'slick-carousel/slick/slick.css';
import 'slick-carousel/slick/slick-theme.css';

interface TimeSlot {
  id: string;
  time: string;
  available: boolean;
}

interface ServiceProvider {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  experience: string | null;
  specialties: string[] | null;
}

interface ServiceData {
  id: string;
  title: string;
  description: string;
  price: number;
  rating: number;
  reviews_count: number;
  location: string;
  category: string;
  images: string[];
  packages: any[];
  requirements?: string[];
  provider_id: string;
  provider: ServiceProvider;
  availableTimeSlots: TimeSlot[];
  business_hours: { day: string; open: string; close: string; closed: boolean }[];
  faqs: { question: string; answer: string }[];
  contactEmail: string;
  contactPhone: string;
  tags?: string[];
  cancellation_policy?: string;
}

export function BookService() {
  const { t } = useTranslation();
  const { serviceId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState<ServiceData | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<any>(null);
  const [userPosts, setUserPosts] = useState<any[]>([]);

  const sliderSettings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 1,
    slidesToScroll: 1,
    arrows: true,
    autoplay: true,
    autoplaySpeed: 3000,
    className: "service-slider"
  };

  useEffect(() => {
    if (!serviceId) {
      setError('No service specified');
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        const { data: serviceData, error: serviceError } = await supabase
          .from('services')
          .select(`
            *,
            provider:profiles (
              id,
              name,
              avatar_url,
              role
            )
          `)
          .eq('id', serviceId)
          .single();

        if (serviceError) {
          console.error('Supabase error:', serviceError);
          throw serviceError;
        }

        if (!serviceData) {
          throw new Error('Service not found');
        }

        // Parse JSON strings
        const parsedPackages = typeof serviceData.packages === 'string' ? JSON.parse(serviceData.packages) : serviceData.packages;
        const parsedRequirements = typeof serviceData.requirements === 'string' ? JSON.parse(serviceData.requirements) : serviceData.requirements;
        const parsedFaq = typeof serviceData.faq === 'string' ? JSON.parse(serviceData.faq) : serviceData.faq;
        const parsedBusinessHours = typeof serviceData.business_hours === 'string' ? JSON.parse(serviceData.business_hours) : serviceData.business_hours;

        setService({
          ...serviceData,
          packages: parsedPackages,
          requirements: parsedRequirements,
          faqs: parsedFaq,
          business_hours: parsedBusinessHours
        });

        if (parsedPackages && parsedPackages.length > 0) {
          setSelectedPackage(parsedPackages[0]);
        }
      } catch (error) {
        console.error('Error fetching service:', error);
        setError('Failed to load service details. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [serviceId]);

  useEffect(() => {
    if (user) {
      fetchUserPosts().then((posts) => {
        setUserPosts(posts);
      });
    }
  }, [user]);

  const fetchUserPosts = async () => {
    try {
      const { data: postsData, error: postsError } = await supabase
        .from('services') // Replace with your actual posts table name
        .select('*')
        .eq('id', serviceId); // Assuming user.id is the foreign key

      if (postsError) {
        console.error('Error fetching user posts:', postsError);
        throw postsError;
      }

      return postsData || [];
    } catch (error) {
      console.error('Error fetching user posts:', error);
      return [];
    }
  };

  const handleBooking = async () => {
    if (!selectedDate || !selectedTime) {
      setError('Please select both date and time');
      return;
    }

    if (!user) {
      navigate('/login', { state: { from: location } });
      return;
    }

    if (!service || !selectedPackage) {
      setError('Service information is missing');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create booking data with all required fields and fallbacks
      const bookingData = {
        service_id: service.id,
        customer_id: user.id,
        provider_id: service.provider_id,
        package_name: selectedPackage.name || 'Default Package',
        package_price: selectedPackage.price || 0,
        package_duration: selectedPackage.duration || 'N/A',
        date: format(selectedDate, 'yyyy-MM-dd'),
        time: selectedTime,
        total_amount: selectedPackage.price || 0,
        status: 'pending'
      };

      const { data: createdBooking, error: bookingError } = await supabase
        .from('bookings')
        .insert(bookingData)
        .select()
        .single();

      if (bookingError) throw bookingError;

      // Navigate with complete booking data
      navigate('/bookings/confirmation', {
        replace: true, // Use replace to prevent going back to booking page
        state: {
          booking: {
            id: createdBooking.id,
            service_id: service.id,
            customer_id: user.id,
            provider_id: service.provider_id,
            date: format(selectedDate, 'MMMM d, yyyy'),
            time: selectedTime,
            status: createdBooking.status,
            service: {
              id: service.id,
              title: service.title,
              provider: {
                id: service.provider.id,
                name: service.provider.name,
                avatar_url: service.provider.avatar_url
              },
              location: service.location
            },
            package: {
              name: selectedPackage.name || 'Default Package',
              price: selectedPackage.price || 0,
              duration: selectedPackage.duration || 'N/A',
              features: selectedPackage.features || []
            }
          }
        }
      });

    } catch (error) {
      console.error('Booking error:', error);
      setError('Failed to create booking. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Add this helper function to generate time slots
  const generateTimeSlots = (openTime: string, closeTime: string, interval: number = 60) => {
    const slots = [];
    const start = new Date(`2000-01-01T${openTime}`);
    const end = new Date(`2000-01-01T${closeTime}`);

    while (start < end) {
      slots.push(start.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }));
      start.setMinutes(start.getMinutes() + interval);
    }

    return slots;
  };

  // Update the Time Selection section
  const getAvailableTimeSlotsForDate = (date: Date) => {
    const dayOfWeek = format(date, 'EEEE');
    const businessHours = service?.business_hours?.find(hours => hours.day === dayOfWeek);

    if (!businessHours || businessHours.closed) {
      return [];
    }

    return generateTimeSlots(businessHours.open, businessHours.close);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader className="h-12 w-12 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!service || !selectedPackage) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{t('bookService.error.serviceNotFound')}</h2>
        <p className="text-gray-600 mb-8">{t('bookService.error.serviceNotFoundDesc')}</p>
        <button
          onClick={() => navigate('/services')}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition duration-200"
        >
          {t('bookService.error.browseServices')}
        </button>
      </div>
    );
  }

  const dates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date;
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <button 
          onClick={() => navigate(-1)} 
          className="flex items-center text-indigo-600 hover:text-indigo-800 transition duration-200 mb-6"
        >
          <ChevronLeft className="h-5 w-5 mr-1" />
          {t('bookService.actions.backToServices')}
        </button>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-6">{service.title}</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Service Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Provider Info Card */}
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <div className="flex items-start space-x-4">
                <img
                  src={service.provider.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(service.provider.name)}&background=random`}
                  alt={service.provider.name}
                  className="w-24 h-24 rounded-full object-cover border-2 border-indigo-100"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">
                        {service.provider.name}
                        <Award className="inline-block h-5 w-5 text-blue-500 ml-2" />
                      </h3>
                      <p className="text-gray-600">{service.category}</p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center text-yellow-400">
                        <Star className="h-5 w-5 fill-current" />
                        <span className="ml-1 text-gray-900 font-medium">{service.rating.toFixed(1)}</span>
                        <span className="mx-1 text-gray-500">·</span>
                        <span className="text-gray-500">{service.reviews_count} {t('serviceCard.reviews')}</span>
                      </div>
                      <p className="text-gray-600 mt-1">{service.location}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div className="flex items-center text-gray-600">
                      <Shield className="h-5 w-5 mr-2 text-green-500" />
                      <span>{t('bookService.providerInfo.verified')}</span>
                    </div>
                    <div className="flex items-center text-gray-600">
                      <Clock className="h-5 w-5 mr-2 text-indigo-500" />
                      <span>{t('bookService.providerInfo.quickResponse')}</span>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex flex-wrap gap-2">
                      {service.tags?.map((tag, index) => (
                        <span
                          key={index}
                          className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Service Overview */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition duration-200">
              <div className="relative">
                <Slider {...sliderSettings}>
                  {service.images && service.images.length > 0 ? (
                    service.images.map((image, index) => (
                      <div key={index} className="relative">
                        <img
                          src={image}
                          alt={`${service.title} image ${index + 1}`}
                          className="w-full h-[400px] object-cover"
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-20"></div>
                      </div>
                    ))
                  ) : (
                    <div className="relative">
                      <div className="w-full h-[400px] bg-gray-200 flex items-center justify-center">
                        <p className="text-gray-500">{t('bookService.noImages')}</p>
                      </div>
                    </div>
                  )}
                </Slider>
              </div>
              <div className="p-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">{t('bookService.about')}</h2>
                <p className="text-gray-600 mb-6 leading-relaxed">{service.description}</p>
              </div>
            </div>

            {/* Service Packages */}
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('postService.packages.title')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {service.packages.map((pkg) => (
                  <div
                    key={pkg.name}
                    onClick={() => setSelectedPackage(pkg)}
                    className={`border rounded-lg p-4 cursor-pointer transition duration-200 hover:border-indigo-300 ${
                      selectedPackage?.name === pkg.name
                        ? 'border-indigo-600 ring-1 ring-indigo-500 bg-indigo-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">{pkg.name}</h3>
                    <p className="text-gray-600 mb-2">{pkg.duration}</p>
                    <p className="text-indigo-600 font-bold text-lg mb-4">{pkg.price} ₼</p>
                    <ul className="text-sm text-gray-600 space-y-2">
                      {(pkg.features || []).map((feature: string, idx: number) => (
                        <li key={idx} className="flex items-center">
                          <CheckCircle className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {pkg.popular && (
                      <div className="mt-4 text-sm font-medium text-indigo-600">
                        ★ {t('bookService.mostPopular')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Date Selection */}
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Calendar className="inline-block w-5 h-5 mr-2 text-indigo-600" />
                {t('bookService.actions.selectDate')}
              </h2>
              <div className="grid grid-cols-7 gap-2">
                {dates.map((date, index) => (
                  <button
                    key={`date-${index}`}
                    onClick={() => setSelectedDate(date)}
                    className={`p-3 text-center rounded-lg transition duration-200 hover:bg-indigo-50 ${
                      selectedDate.toDateString() === date.toDateString()
                        ? 'bg-indigo-100 text-indigo-700 font-medium shadow-sm'
                        : 'text-gray-700'
                    }`}
                  >
                    <div className="text-xs text-gray-500">{format(date, 'EEE')}</div>
                    <div className="font-medium text-lg">{format(date, 'd')}</div>
                    <div className="text-xs">{format(date, 'MMM')}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Time Selection */}
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Clock className="inline-block w-5 h-5 mr-2 text-indigo-600" />
                {t('bookService.actions.selectTime')}
              </h2>
              {selectedDate && (
                <>
                  {service?.business_hours?.find(hours => hours.day === format(selectedDate, 'EEEE'))?.closed ? (
                    <p className="text-red-500 p-3 bg-red-50 rounded-md">{t('bookService.scheduleInfo.closed')} {format(selectedDate, 'EEEE')}</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                      {getAvailableTimeSlotsForDate(selectedDate).map((time, index) => (
                        <button
                          key={index}
                          onClick={() => setSelectedTime(time)}
                          className={`p-3 text-center rounded-lg transition duration-200 ${
                            selectedTime === time
                              ? 'bg-indigo-100 text-indigo-700 font-medium shadow-sm'
                              : 'hover:bg-indigo-50 text-gray-700'
                          }`}
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Requirements Section */}
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('bookService.scheduleInfo.requirements')}</h2>
              {service.requirements && service.requirements.length > 0 ? (
                <ul className="space-y-3">
                  {service.requirements.map((requirement, index) => (
                    <li key={index} className="flex items-start">
                      <CheckCircle className="h-5 w-5 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{requirement}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 italic p-3 bg-gray-50 rounded-md">{t('bookService.scheduleInfo.noRequirements')}</p>
              )}
            </div>

            {/* Cancellation Policy */}
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('bookService.scheduleInfo.cancellationPolicy')}</h2>
              {service.cancellation_policy ? (
                <p className="text-gray-700 leading-relaxed">{service.cancellation_policy}</p>
              ) : (
                <p className="text-gray-500 italic p-3 bg-gray-50 rounded-md">{t('bookService.scheduleInfo.noCancellationPolicy')}</p>
              )}
            </div>

            {/* Business Hours */}
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('bookService.scheduleInfo.businessHours')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(service.business_hours || []).map((hours, index) => (
                  <div key={`${hours.day}-${index}`} className="flex justify-between p-3 border rounded-md">
                    <span className="font-medium text-gray-800">{hours.day}:</span>
                    {hours.closed ? (
                      <span className="text-red-500 font-medium">{t('bookService.scheduleInfo.closed')}</span>
                    ) : (
                      <span className="text-gray-700">{hours.open} - {hours.close}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* FAQs */}
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('bookService.scheduleInfo.faq')}</h2>
              {service.faqs && service.faqs.length > 0 ? (
                <div className="space-y-6">
                  {service.faqs.map((faq, index) => (
                    <div key={index} className="border-b border-gray-200 pb-5 last:border-b-0 last:pb-0">
                      <h4 className="font-medium text-gray-800 text-lg mb-2">{faq.question}</h4>
                      <p className="text-gray-700 leading-relaxed">{faq.answer}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 italic p-3 bg-gray-50 rounded-md">{t('bookService.scheduleInfo.noFaq')}</p>
              )}
            </div>

            {/* Contact Information */}
            <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('bookService.scheduleInfo.contactInfo')}</h2>
              <div className="space-y-3">
                <div className="flex items-center">
                  <Mail className="h-5 w-5 text-indigo-500 mr-3" />
                  <span className="text-gray-700">{t('bookService.scheduleInfo.email')}: {service.contactEmail}</span>
                </div>
                <div className="flex items-center">
                  <Phone className="h-5 w-5 text-indigo-500 mr-3" />
                  <span className="text-gray-700">{t('bookService.scheduleInfo.phone')}: {service.contactPhone}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Booking Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-md p-6 sticky top-8 hover:shadow-lg transition duration-200">
              <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <CreditCard className="inline-block w-5 h-5 mr-2 text-indigo-600" />
                {t('bookService.summary.title')}
              </h2>

              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t('bookService.summary.package')}</span>
                  <span className="font-medium">{selectedPackage.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t('bookService.summary.duration')}</span>
                  <span className="font-medium">{selectedPackage.duration}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t('bookService.summary.date')}</span>
                  <span className="font-medium">
                    {selectedDate ? format(selectedDate, 'MMM d, yyyy') : t('bookService.summary.notSelected')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t('bookService.summary.time')}</span>
                  <span className="font-medium">
                    {selectedTime || t('bookService.summary.notSelected')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t('bookService.summary.location')}</span>
                  <span className="font-medium">{service.location}</span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-600">{t('bookService.summary.packagePrice')}</span>
                  <span className="font-medium">{selectedPackage.price} ₼</span>
                </div>

                <div className="flex items-center justify-between font-medium text-lg">
                  <span>{t('bookService.summary.total')}</span>
                  <span className="text-indigo-600">{selectedPackage.price} ₼</span>
                </div>
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

              <button
                onClick={handleBooking}
                disabled={loading || !selectedDate || !selectedTime}
                className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
              >
                {loading ? t('bookService.actions.processing') : t('bookService.actions.bookNow')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}