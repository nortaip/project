import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { format } from 'date-fns';
import { az } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  CheckCircle,
  Clock,
  Loader,
  ChevronLeft,
  MapPin,
  EyeIcon,
  Linkedin, // Assuming you have these icons
  Facebook, // Assuming you have these icons
  Instagram,// Assuming you have these icons
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
  is_verified: boolean; // Add is_verified property
}

interface ServiceData {
  socialMedia: any;
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
  contact_email: string;
  contact_phone: string;
  tags?: string[];
  cancellation_policy?: string;
  view_count?: number;
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
              is_verified
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

        // Explicitly cast serviceData to ServiceData type
        const typedServiceData = serviceData as unknown as ServiceData;

        // Parse JSON strings using the typed data
        const parsedPackages = typeof typedServiceData.packages === 'string' ? JSON.parse(typedServiceData.packages) : typedServiceData.packages;
        const parsedRequirements = typeof typedServiceData.requirements === 'string' ? JSON.parse(typedServiceData.requirements) : typedServiceData.requirements;
        const parsedFaq = typeof typedServiceData.faqs === 'string' ? JSON.parse(typedServiceData.faqs) : typedServiceData.faqs; // Note: used faqs here based on interface
        const parsedBusinessHours = typeof typedServiceData.business_hours === 'string' ? JSON.parse(typedServiceData.business_hours) : typedServiceData.business_hours;

        const uniqueImages = Array.from(
          new Set(
            (typedServiceData.images || []).map((img) =>
              img.split('?')[0].trim().replace(/\/+$/, '')
            )
          )
        );

        console.log("Fetched images:", typedServiceData.images);

        setService({
          ...typedServiceData, // Use typed data here
          packages: parsedPackages,
          requirements: parsedRequirements,
          faqs: parsedFaq,
          business_hours: parsedBusinessHours,
          view_count: typedServiceData.view_count,
          images: uniqueImages,
          provider: { // Ensure provider object is correctly typed
            ...typedServiceData.provider, // Use typed data here
            is_verified: typedServiceData.provider.is_verified // Assign the fetched value
          }
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

      // fetch("https://ellit.az/data/send-sms.php", {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json"
      //   },
      //   body: JSON.stringify({
      //     phoneNumber: service.contact_phone,
      //     resetCode:
      //       "Yeni rezervasiya mövcuddur!\n" +
      //       // "Rezervasiya ID: " + createdBooking.id + "\n" +
      //       "Xidmət: " + service.title + "\n" +
      //       "Paket: " + (selectedPackage.name || "Default Package") + "\n" +
      //       "Qiymət: " + (selectedPackage.price || 0) + " ₼\n" +
      //       "Müştəri: " + (user?.name || user?.email || user?.id) + "\n" +
      //       "Rezervasiya tarixi: " + format(selectedDate, 'MMMM d, yyyy') + "\n" +
      //       "Rezervasiya vaxtı: " + selectedTime + "\n" +
      //       "Status: " + createdBooking.status
      //   })
      // })
      //   .then((res) => res.json())
      //   .then(console.log)
      //   .catch(console.error);

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
    const start = new Date(`1970-01-01T${openTime}:00`);
    const end = new Date(`1970-01-01T${closeTime}:00`);

    while (start < end) {
      slots.push(start.toLocaleTimeString('az-AZ', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }));
      start.setMinutes(start.getMinutes() + interval);
    }

    return slots;
  };


  // Update the Time Selection section
  const getAvailableTimeSlotsForDate = (date: Date) => {
    const dayOfWeek = format(date, 'EEEE', { locale: az });
    const businessHours = service?.business_hours?.find(hours => hours.day === dayOfWeek);

    if (!businessHours || businessHours.closed) {
      return [];
    }

    return generateTimeSlots(businessHours.open, businessHours.close);
  };

  useEffect(() => {
    const updateViewCount = async () => {
      if (!serviceId) return;

      try {
        const { data: serviceData, error: serviceError } = await supabase
          .from('services')
          .select('view_count')
          .eq('id', serviceId)
          .single();

        if (serviceError) throw serviceError;

        const newViewCount = (serviceData.view_count || 0) + 1;

        const { error: updateError } = await supabase
          .from('services')
          .update({ view_count: newViewCount })
          .eq('id', serviceId);

        if (updateError) throw updateError;
      } catch (error) {
        console.error('Error updating view count:', error);
      }
    };

    updateViewCount();
  }, [serviceId]);

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
        {/* {isProvider && (
        <button
          onClick={() => navigate(`/edit-service/${service.id}`)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition duration-200 mb-4"
        >
          Edit Post
        </button>
      )} */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Service Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Provider Info Card */}
            {/* <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
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
              </div> */}

            {/* Service Overview */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition duration-200">
              <div className="relative">
                {service.images && service.images.length > 1 ? (
                  <Slider
                    {...{
                      dots: true,
                      infinite: true,
                      speed: 500,
                      slidesToShow: 1,
                      slidesToScroll: 1,
                      arrows: true,
                      autoplay: true,
                      autoplaySpeed: 3000,
                      className: "service-slider"
                    }}
                  >
                    {service.images.map((image, index) => (
                      <img
                        key={`img-${index}`}
                        src={image}
                        alt={`Service Image ${index + 1}`}
                        className="w-full h-[400px] object-cover"
                      />
                    ))}
                  </Slider>
                ) : service.images && service.images.length === 1 ? (
                  <img
                    src={service.images[0]}
                    alt="Service Image"
                    className="w-full h-[400px] object-cover"
                  />
                ) : (
                  <div className="relative">
                    <div className="w-full h-[400px] bg-gray-200 flex items-center justify-center">
                      <p className="text-gray-500">{t('bookService.noImages')}</p>
                    </div>
                  </div>
                )}
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
                    className={`border rounded-lg p-4 cursor-pointer transition duration-200 hover:border-indigo-300 ${selectedPackage?.name === pkg.name
                      ? 'border-indigo-600 ring-1 ring-indigo-500 bg-indigo-50'
                      : 'border-gray-200'
                      }`}
                  >
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">{pkg.name}</h3>
                    <p className="text-gray-600 mb-2">{pkg.duration}</p>
                    <div className="flex items-center">
                      <span className="text-indigo-600 font-bold text-lg mb-4">{pkg.price} ₼</span>
                    </div>
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
                    className={`p-3 text-center rounded-lg transition duration-200 hover:bg-indigo-50 ${selectedDate.toDateString() === date.toDateString()
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
                          className={`p-3 text-center rounded-lg transition duration-200 ${selectedTime === time
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
            {/* <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition duration-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('bookService.scheduleInfo.contactInfo')}</h2>
              <div className="space-y-3">
                <div className="flex items-center">
                  <Mail className="h-5 w-5 text-indigo-500 mr-3" />
                  <span className="text-gray-700">{t('bookService.scheduleInfo.email')}: {service.contact_email}</span>
                </div>
                <div className="flex items-center">
                  <Phone className="h-5 w-5 text-indigo-500 mr-3" />
                  <span className="text-gray-700">{t('bookService.scheduleInfo.phone')}: {service.contact_phone}</span>
                </div>
              </div>
              </div> */}
          </div>

          {/* Right Column - Booking Summary */}
          <div className="lg:col-span-1">
            <div className={` ${service.provider.is_verified ? 'border-blue-500 border-2' : 'border-gray-300 border-2'}  rounded-lg shadow-md p-6 sticky top-8 hover:shadow-lg transition duration-200 flex flex-col`}>
              {/* Price Section */}
              <div className="mb-2">
                <div className="text-2xl font-bold text-gray-900">
                  {selectedPackage.price} ₼
                </div>

                {/* <div className="text-gray-500 text-sm">
                  ≈ {(selectedPackage.price * 1.7).toFixed(0)} USD
                </div> */}
              </div>
              <hr className="my-3" />

              {/* Provider Info */}
              <div className="flex items-center mb-4">
                <img
                  src={service.provider.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(service.provider.name)}&background=random`}
                  alt={service.provider.name}
                  className="w-10 h-10 rounded-full object-cover border"
                />
                <div className="flex items-center">
                  <span className="ml-3 font-medium text-gray-800">{service.provider.name}</span>
                  {service.provider.is_verified && (
                    <CheckCircle className="h-5 w-5 text-blue-500 ml-2" />
                  )}
                </div>
              </div>

              {/* Social Media Links */}
              {service.socialMedia && (() => {
                try {
                  const socialMediaLinks = JSON.parse(service.socialMedia);
                  const hasSocialMedia = socialMediaLinks.linkedin || socialMediaLinks.facebook || socialMediaLinks.instagram;

                  if (hasSocialMedia) {
                    return (
                      <>
                        <hr className="my-3" />
                        <div className="mb-4">
                          <div className="flex gap-4">
                            {socialMediaLinks.linkedin && (
                              <a href={socialMediaLinks.linkedin} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-blue-700 transition duration-200">
                                <Linkedin className="h-4 w-4" />
                              </a>
                            )}
                            {socialMediaLinks.facebook && (
                              <a href={socialMediaLinks.facebook} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-blue-600 transition duration-200">
                                <Facebook className="h-4 w-4" />
                              </a>
                            )}
                            {socialMediaLinks.instagram && (
                              <a href={socialMediaLinks.instagram} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-pink-600 transition duration-200">
                                <Instagram className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        </div>
                      </>
                    );
                  }
                  return null; // Don't render if no social media links exist
                } catch (e) {
                  console.error("Failed to parse socialMedia JSON:", e);
                  return null; // Handle parsing errors gracefully
                }
              })()}


              {/* Call Button */}
              {/* <button
                className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold text-lg py-3 rounded-lg flex items-center justify-center mb-4 transition"
                onClick={() => window.open(`tel:${service.contact_phone}`, '_self')}
              >
                <Phone className="h-4 w-4 mr-2" />
                {service.contact_phone}
              </button> */}

              <hr className="my-3" />

              {/* Service Description */}
              <div className="mb-2 text-gray-700 text-sm">
                "{service.title}" - {service.description?.slice(0, 60)}...
              </div>
              {/* <div className="mb-2 text-gray-500 text-xs">
                  {t('bookService.summary.providerDesc')}
                </div> */}
              {/* <a href="#" className="text-indigo-600 hover:underline text-sm mb-2 block">
                  {t('bookService.summary.providerMore')}
                </a> */}

              <hr className="my-3" />

              {/* Date, Time, Location */}
              <div className="space-y-2 mb-4">
                {/* <div className="flex items-center text-gray-600 text-sm">
                    <Clock className="h-4 w-4 mr-2" />
                    {t('bookService.summary.workingHours')}: {service.business_hours?.map(bh => !bh.closed ? `${bh.open}-${bh.close}` : '').join(', ')}
                  </div> */}
                <div className="flex items-center text-gray-600 text-sm">
                  <MapPin className="h-4 w-4 mr-2" />
                  {service.location}
                </div>
                <div className="flex items-center text-gray-600 text-sm">
                  <Calendar className="h-4 w-4 mr-2" />
                  {selectedDate ? format(selectedDate, 'MMM d, yyyy') : t('bookService.summary.notSelected')}
                </div>
                <div className="flex items-center text-gray-600 text-sm">
                  <Clock className="h-4 w-4 mr-2" />
                  {selectedTime || t('bookService.summary.notSelected')}
                </div>
                <div className="flex items-center text-gray-600 text-sm">
                  <EyeIcon className="h-4 w-4 mr-2" />
                  <span className="ml-1 text-gray-600">{service.view_count}</span>
                </div>

              </div>

              {/* Book Button */}
              <button
                onClick={handleBooking}
                disabled={loading || !selectedDate || !selectedTime}
                className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200 mt-auto"
              >
                {loading ? t('bookService.actions.processing') : t('bookService.actions.bookNow')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div >
  );
};