import { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import CryptoJS from 'crypto-js';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { Form, Input, Select, Upload, Button, Steps, Card, Divider, InputNumber, Tag, Switch, TimePicker, message } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  DollarOutlined,
  MailOutlined,
  PhoneOutlined,
  GlobalOutlined,
  FacebookOutlined,
  InstagramOutlined,
  LinkedinOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { UploadFile, UploadProps, RcFile } from 'antd/es/upload/interface';

interface PostServiceFormProps {
  onClose: () => void;
  onSubmit: (serviceData: ServiceFormData) => Promise<void>;
}

export interface ServiceFormData {
  title: string;
  description: string;
  category: string;
  price: number;
  location: string;
  availability: string[];
  packages: ServicePackage[];
  // Additional fields
  tags: string[];
  contact_email: string;
  contact_phone: string;
  website?: string;
  socialMedia: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
  };
  business_hours: business_hours[];
  requirements: string[];
  cancellation_policy: string;
  faq: FAQ[];
  images: string[];
  promotionType?: 'normal' | 'vip' | 'premium';
  promotionDuration?: number; // in days
  promotion_price: number;
}

interface ServicePackage {
  name: string;
  price: number;
  duration: string;
  features: string[];
}

interface business_hours {
  day: string;
  open: string;
  close: string;
  closed: boolean;
}

interface FAQ {
  question: string;
  answer: string;
}

interface InsertServiceResult {
  success: boolean;
  data?: { id: string | number }; // ← Some Supabase tables use numeric IDs
}

const CATEGORIES = [
  {
    name: "Avtomobil xidmətləri",
    subcategories: [
      "Evakuator xidməti",
      "Avtomobil icarəsi",
      "Qaldırıcı qurğuların icarəsi",
      "Texnika icarəsi",
      "Traveqo aylıq kirayəsi",
      "Digər Nəqliyyat xidmətləri"
    ]
  },
  {
    name: "Avtomobil təmiri",
    subcategories: [
      "Avtomobil açar ustası",
      "Avtomobil təmiri ustası",
      "Təkər təmiri ustası",
      "Avtomobil Malyar ustası",
      "Oturacaqların üzlənməsi",
      "Avtomobil təmizliyi",
      "Digər avtomobil ustaları"
    ]
  },
  {
    name: "Gözəllik və Sağlamlıq",
    subcategories: [
      "Fizioterapiya",
      "Masaj xidməti",
      "Saç ustası",
      "Lazer epilyasiyası ustası",
      "Makiyaj ustası",
      "Dırnaq ustası",
      "Təmizlik xidməti",
      "Dezinfeksiya xidməti",
      "Digər Sağlamlıq ustaları"
    ]
  },
  {
    name: "İT, Biznes xidmətləri",
    subcategories: [
      "Komputer ustası",
      "Televizor ustası",
      "Foto və Video aparatları",
      "Planşet və elektron kitablar",
      "Krosna antena ustası",
      "Kamera ustası",
      "Printer ustası",
      "Digər Elektronika ustaları"
    ]
  },
  {
    name: "Təmir və Tikinti",
    subcategories: [
      "Elektrik",
      "Cam Balkon ustası",
      "Plastik Qapı Pəncərə",
      "Duş kabina",
      "Jaluz",
      "Kanalizasiya ustası",
      "Su Sızma",
      "Santexnik",
      "Çilingir, Açar ustası",
      "Laminat-parket",
      "Ev təmiri",
      "Dartma tavan ustası",
      "Divar kağızı ustası",
      "Lepka ustası",
      "Kafel-metlax ustası",
      "Malyar ustası Ev",
      "Tol ustası",
      "Məhəccər",
      "Avtomatik qapılar",
      "Beton işləri",
      "Sauna tikintisi",
      "A Frame evlərin tikintisi",
      "Digər Təmir ustaları"
    ]
  },
  {
    name: "Reklam və Dizayn",
    subcategories: [
      "Çap işləri",
      "Reklam xidmətləri",
      "İnteryer dizayn xidməti",
      "Dizayn xidməti",
      "Vinil bannerlər",
      "Video xidmətləri",
      "Foto xidmətləri",
      "Digər reklam ustaları"
    ]
  },
  {
    name: "Mebel və İnteryer",
    subcategories: [
      "Mətbəx mebeli quraşdırmaq",
      "Vitrin yığmaq",
      "Divan və kreslo ustası",
      "Ofis mebelləri",
      "Mebel ustası",
      "Digər mebel ustaları"
    ]
  },
  {
    name: "Məişət texnikası",
    subcategories: [
      "Kondisioner ustası",
      "Kombi ustası",
      "Soyuducu ustası",
      "Paltaryuyan ustası",
      "Qabyuyan ustası",
      "Ariston ustası",
      "Havalandırma ustası",
      "Pitiminiutka ustası",
      "Qaz ustası",
      "İran peçi ustası",
      "Soba ustası",
      "Su filtri ustası",
      "Tozsoran ustası",
      "Tikiş maşını ustası",
      "Digər Məişət Texnikası ustaları"
    ]
  }
];


const DAYS = [
  'Bazar ertəsi',
  'Çərşənbə axşamı',
  'Çərşənbə',
  'Cümə axşamı',
  'Cümə',
  'Şənbə',
  'Bazar'
];

const INITIAL_PACKAGE = {
  name: '',
  price: 0,
  duration: '',
  features: ['']
};

const INITIAL_BUSINESS_HOURS = DAYS.map(day => ({
  day,
  open: '09:00',
  close: '17:00',
  closed: false
}));

// Update the input styles with this reusable class

const getCategoryKey = (category: string): string => {
  return category.toLowerCase().replace(/\s+/g, '');
};

const { TextArea } = Input;
const { Step } = Steps;

export function PostServiceForm({ onClose, onSubmit }: PostServiceFormProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<ServiceFormData>({
    title: '',
    description: '',
    category: CATEGORIES[0].name,
    price: 0,
    location: '',
    availability: [],
    packages: [{ ...INITIAL_PACKAGE }],
    tags: [],
    contact_email: '',
    contact_phone: '',
    website: '',
    socialMedia: {},
    business_hours: INITIAL_BUSINESS_HOURS,
    requirements: [''],
    cancellation_policy: '',
    faq: [{ question: '', answer: '' }],
    images: [],
    promotionType: 'normal',
    promotionDuration: '',
    promotion_price: '',

  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const checkUserAuth = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();

        if (error) {
          console.error("Supabase auth error:", error);
          message.error('Xidmətləri göndərmək üçün daxil olun');
          onClose();
          return;
        }

        if (user) {
          setProviderId(user.id);
          console.log("Provider ID set from Supabase:", user.id);

          // Pre-fill contact information if available
          form.setFieldsValue({
            contact_email: user.email || '',
          });
        } else {
          console.error("No user found in Supabase");
          message.error('Xidmətləri göndərmək üçün daxil olun');
          onClose();
        }
      } catch (error) {
        console.error("Error checking Supabase auth:", error);
        message.error('Authentication error');
        onClose();
      }
    };

    checkUserAuth();
  }, []);

  useEffect(() => {
    // Set initial form values
    form.setFieldsValue({
      title: formData.title,
      description: formData.description,
      category: formData.category,
      price: formData.price,
      location: formData.location,
      contact_email: formData.contact_email,
      contact_phone: formData.contact_phone,
      website: formData.website,
      socialMedia: formData.socialMedia,
      cancellation_policy: formData.cancellation_policy
    });
  }, []);

  const handleAddPackage = () => {
    setFormData(prev => ({
      ...prev,
      packages: [...prev.packages, { ...INITIAL_PACKAGE }]
    }));
  };

  const handleRemovePackage = (index: number) => {
    if (formData.packages.length > 1) {
      setFormData(prev => ({
        ...prev,
        packages: prev.packages.filter((_, i) => i !== index)
      }));
    }
  };

  const handlePackageChange = (index: number, field: keyof ServicePackage, value: any) => {
    setFormData(prev => ({
      ...prev,
      packages: prev.packages.map((pkg, i) =>
        i === index ? { ...pkg, [field]: value } : pkg
      )
    }));
  };

  const handleAddFeature = (packageIndex: number) => {
    setFormData(prev => ({
      ...prev,
      packages: prev.packages.map((pkg, idx) =>
        idx === packageIndex
          ? { ...pkg, features: [...pkg.features, ''] }
          : pkg
      )
    }));
  };

  const handleFeatureChange = (packageIndex: number, featureIndex: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      packages: prev.packages.map((pkg, idx) =>
        idx === packageIndex
          ? {
            ...pkg,
            features: pkg.features.map((feature, fIdx) =>
              fIdx === featureIndex ? value : feature
            )
          }
          : pkg
      )
    }));
  };

  const handleRemoveFeature = (packageIndex: number, featureIndex: number) => {
    setFormData(prev => ({
      ...prev,
      packages: prev.packages.map((pkg, idx) =>
        idx === packageIndex
          ? {
            ...pkg,
            features: pkg.features.filter((_, fIdx) => fIdx !== featureIndex)
          }
          : pkg
      )
    }));
  };

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const handleAddFAQ = () => {
    setFormData(prev => ({
      ...prev,
      faq: [...prev.faq, { question: '', answer: '' }]
    }));
  };

  const handleRemoveFAQ = (index: number) => {
    setFormData(prev => ({
      ...prev,
      faq: prev.faq.filter((_, i) => i !== index)
    }));
  };

  const handleAddRequirement = () => {
    setFormData(prev => ({
      ...prev,
      requirements: [...prev.requirements, '']
    }));
  };

  const handleRemoveRequirement = (index: number) => {
    setFormData(prev => ({
      ...prev,
      requirements: prev.requirements.filter((_, i) => i !== index)
    }));
  };

  const handleRequirementChange = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      requirements: prev.requirements.map((req, i) =>
        i === index ? value : req
      )
    }));
  };

  const handleFAQChange = (index: number, field: keyof FAQ, value: string) => {
    setFormData(prev => ({
      ...prev,
      faq: prev.faq.map((faq, i) =>
        i === index ? { ...faq, [field]: value } : faq
      )
    }));
  };

  async function initiateEpointPayment(amount: number, userId: string, onSuccessUrl: string): Promise<boolean> {
    const publicKey = 'i000200743';
    const privateKey = 'u7OXr7CxGdQh1eKv1mKrcPzM';

    const payload = {
      public_key: publicKey,
      amount: amount.toFixed(2),
      currency: 'AZN',
      language: 'az',
      order_id: `order_${Date.now()}`,
      description: 'Promotion Payment',
      success_redirect_url: onSuccessUrl,
      error_redirect_url: `${window.location.origin}/error`
    };

    try {
      // Step 1: base64 encode JSON string
      const jsonString = JSON.stringify(payload);
      const dataBase64 = btoa(jsonString);

      // Step 2: sha1(privateKey + data + privateKey), then base64
      const rawSignature = privateKey + dataBase64 + privateKey;
      const hash = CryptoJS.SHA1(rawSignature);
      const signature = CryptoJS.enc.Base64.stringify(hash);

      // Step 3: Create and submit a hidden form
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = 'https://epoint.az/api/1/checkout';

      const inputData = document.createElement('input');
      inputData.type = 'hidden';
      inputData.name = 'data';
      inputData.value = dataBase64;

      const inputSignature = document.createElement('input');
      inputSignature.type = 'hidden';
      inputSignature.name = 'signature';
      inputSignature.value = signature;

      form.appendChild(inputData);
      form.appendChild(inputSignature);
      document.body.appendChild(form);

      form.submit();
      return true;
    } catch (err) {
      console.error('Epoint payment error:', err);
      message.error('Ödəniş zamanı xəta baş verdi.');
      return false;
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      const updatedFormData = {
        ...formData,
        ...values,
        socialMedia: {
          ...formData.socialMedia,
          ...(values.socialMedia || {})
        }
      };

      // 🟩 Calculate promotion price based on type and duration
      const promotionPrice =
        updatedFormData.promotionType === 'vip' && updatedFormData.promotionDuration === 30 ? 25 :
          updatedFormData.promotionType === 'vip' && updatedFormData.promotionDuration === 10 ? 10 :
            updatedFormData.promotionType === 'vip' && updatedFormData.promotionDuration === 5 ? 5 :
              updatedFormData.promotionType === 'premium' && updatedFormData.promotionDuration === 30 ? 45 :
                updatedFormData.promotionType === 'premium' && updatedFormData.promotionDuration === 15 ? 30 :
                  updatedFormData.promotionType === 'premium' && updatedFormData.promotionDuration === 5 ? 10 :
                    0;

      // 🟩 Add to updatedFormData so it’s passed to insertService
      updatedFormData.promotion_price = promotionPrice;

      setFormData(updatedFormData);
      setLoading(true);
      setError(null);

      const result = await insertService(updatedFormData);

      if (result.success && result.data?.id) {
        if (updatedFormData.promotionType !== 'normal' && updatedFormData.promotion_price > 0) {
          if (providerId) {
            const successUrl = `${window.location.origin}/promotion/success/?id=${result.data.id}&promotiontype=${updatedFormData.promotionType}&promotionprice=${updatedFormData.promotionprice}&promotionduration=${updatedFormData.promotionDuration}`;
            const paymentSuccess = await initiateEpointPayment(updatedFormData.promotion_price, providerId, successUrl);
            if (!paymentSuccess) return;

            // ✅ Only submit if payment succeeded
            await onSubmit(updatedFormData);
          } else {
            throw new Error('Provider ID is required for payment');
          }
        } else {
          await onSubmit(updatedFormData); // ✅ Normal case
          onClose();
        }
      } else {
        throw new Error('Service insert failed or no ID returned.');
      }

    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        console.error("Form validation error:", error);
        setError('Zəhmət olmasa, bütün lazımi sahələri doldurun.');
      } else {
        console.error('Error:', error);
        setError((error as Error).message || 'Failed to submit the service. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (changedValues: any) => {
    setFormData(prev => ({
      ...prev,
      ...changedValues
    }));
  };

  const steps = [
    'Əsas',
    'Qiymətləndirmə & Paketlər',
    'Adres & İş vaxtı',
    'Additional Details',
    'Contact Information'
  ];

  // Test connection
  supabase
    .from('services')
    .select('*')
    .then(({ data, error }) => {
      if (error) console.error('Connection test error:', error);
      else console.log('Connection test data:', data);
    });

  const handleUpload = async (file: RcFile): Promise<string> => {
    try {
      setUploading(true);

      // Create a unique file path for the image
      const filePath = `services/${providerId}/${new Date().getTime()}-${file.name}`;

      // Upload the file to Supabase storage
      const { error } = await supabase.storage
        .from('service-images') // Make sure this bucket exists in your Supabase storage
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      // Get the public URL for the uploaded file
      const { data: urlData } = supabase.storage
        .from('service-images')
        .getPublicUrl(filePath);

      return urlData.publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      message.error('Failed to upload image');
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange: UploadProps['onChange'] = async ({ fileList: newFileList, file }) => {
    // Update the fileList state
    setFileList(newFileList);

    // If a file was just uploaded successfully
    if (file.status === 'done') {
      // The URL should be available in the response
      const imageUrl = file.response?.url || '';

      // Add the new URL to the images array
      if (imageUrl) {
        setFormData(prev => ({
          ...prev,
          images: [...prev.images, imageUrl]
        }));
      }
    }
  };

  const customUpload = async (options: any) => {
    const { onSuccess, onError, file } = options;
    try {
      const url = await handleUpload(file as RcFile);
      // Call onSuccess with the URL to update the Upload component state
      onSuccess({ url });
      // Removed setFormData to prevent duplicate images
      message.success('Image uploaded successfully');
    } catch (error) {
      onError(error);
    }
  };

  const handleRemoveImage = (file: UploadFile) => {
    // Remove from fileList
    const newFileList = fileList.filter(item => item.uid !== file.uid);
    setFileList(newFileList);

    // Remove from formData.images
    if (file.url) {
      setFormData(prev => ({
        ...prev,
        images: prev.images.filter(url => url !== file.url)
      }));
    }

    // Optionally delete from Supabase storage
    // You could extract the path from the URL and delete it
    return true; // Return true to allow removal from UI
  };

  const checkAuth = () => {
    const userString = localStorage.getItem('user');
    if (!userString) {
      message.error('Xidmətləri göndərmək üçün daxil olun');
      onClose();
      return false;
    }

    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    if (!isLoggedIn) {
      message.error('Your session has expired. Please log in again.');
      onClose();
      return false;
    }

    return true;
  };

  async function insertService(serviceData: ServiceFormData): Promise<InsertServiceResult> {
    if (!checkAuth()) return { success: false };

    try {
      // Match exactly the column names in your database
      const dataToInsert: any = {
        provider_id: providerId, // TEMPORARILY COMMENT OUT THIS LINE
        title: serviceData.title,
        description: serviceData.description,
        category: serviceData.category,
        price: serviceData.price,
        location: serviceData.location,
        requirements: serviceData.requirements || [],
        cancellation_policy: serviceData.cancellation_policy,
        faq: serviceData.faq || [],
        tags: serviceData.tags || [],
        website: serviceData.website || '',
        socialMedia: serviceData.socialMedia || {},
        packages: serviceData.packages || [],
        contact_email: serviceData.contact_email,
        contact_phone: `+994${serviceData.contact_phone}` || '',
        business_hours: serviceData.business_hours || [],
        images: serviceData.images || [],
        rating: 0,
        reviews_count: 0,
        availability: serviceData.availability || [],
        promotion_type: serviceData.promotionType || 'normal',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'pending', // Add status field
        promotion_duration: serviceData.promotionDuration || null,
        promotion_price: serviceData.promotion_price || 0,

      };

      const { data, error } = await supabase
        .from('services')
        .insert([dataToInsert])
        .select('id')  // ✅ only request 'id'
        .single();     // ✅ return single object

      if (error) {
        console.error('Database error:', error);
        message.error(`Database error: ${error.message}`);
        throw error;
      }

      console.log("Service inserted successfully:", data); // ✅ ensure data.id is printed

      return { success: true, data };

    } catch (error) {
      console.error('Error inserting service:', error);
      throw error;
    }
  }

  // Add this function to validate step 1 before moving to step 2
  const validateStep1 = async () => {
    try {
      // Validate basic form fields
      const values = await form.validateFields(['title', 'description', 'category', 'price']);

      // ✅ Manually check if at least one image is uploaded
      if (fileList.length === 0) {
        message.error('Zəhmət olmasa, ən azı bir şəkil yükləyin.');
        return;
      }

      // Merge form values into state
      setFormData(prev => ({
        ...prev,
        ...values
      }));

      // Proceed to next step
      setCurrentStep(currentStep + 1);
    } catch (error) {
      console.error("Step 1 validation error:", error);
      setError('Zəhmət olmasa, bütün lazımi sahələri doldurun.');
    }
  };


  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      onValuesChange={handleFormChange}
      className="max-w-4xl mx-auto p-6"
      initialValues={{
        title: formData.title,
        description: formData.description,
        category: formData.category,
        price: formData.price,
        location: formData.location,
        contact_email: formData.contact_email,
        contact_phone: formData.contact_phone,
        website: formData.website,
        socialMedia: formData.socialMedia,
        cancellation_policy: formData.cancellation_policy
      }}
    >

      <div className="flex flex-col gap-6">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
            {error}
          </div>
        )}

        <div className="mb-6">
          <Steps current={currentStep - 1}>
            {steps.map(step => (
              <Step key={step} title={step} />
            ))}
          </Steps>
        </div>

        {/* Step 1: Basic Info */}
        {currentStep === 1 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Form.Item
              label={t('postService.basicInfo.serviceName')}
              name="title"
              rules={[{ required: true }]}
              className="md:col-span-2"
            >
              <Input
                placeholder={t('postService.basicInfo.serviceNamePlaceholder')}
                size="large"
              />
            </Form.Item>

            <Form.Item
              label={t('postService.basicInfo.description')}
              name="description"
              rules={[{ required: true }]}
              className="md:col-span-2"
            >
              <TextArea
                rows={4}
                placeholder={t('postService.basicInfo.descriptionPlaceholder')}
                size="large"
              />
            </Form.Item>

            <Form.Item
              label={t('postService.basicInfo.category')}
              name="category"
              rules={[{ required: true }]}
            >
              <Select size="large" showSearch optionFilterProp="label">
                {CATEGORIES.map((category) => (
                  <Select.OptGroup key={category.name} label={category.name}>
                    {category.subcategories.map((sub) => (
                      <Select.Option key={sub} value={sub} label={`${category.name} → ${sub}`}>
                        {sub}
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              label={t('postService.basicInfo.price')}
              name="price"
              rules={[{ required: true }]}
            >
              <InputNumber
                prefix={<DollarOutlined />}
                min={1}
                size="large"
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item>
              <div className="flex flex-col md:flex-row gap-6 w-full">
                <div className="w-full md:w-w-full flex-shrink-0">
                  <div className="mb-2 font-semibold text-base">Foto qalereya</div>
                  <div className="bg-blue-100 text-blue-900 rounded px-3 py-2 text-sm mb-2">
                    10-a qədər şəkil yükləyə bilərsiniz. Hər bir şəkil 2 KB-dan kiçik olmalıdır.
                  </div>
                  <Upload
                    listType="picture-card"
                    fileList={fileList}
                    onChange={handleFileChange}
                    onRemove={handleRemoveImage}
                    customRequest={customUpload}
                    accept="image/*"
                    multiple
                    maxCount={22}
                    className="mb-2"
                    style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
                  >
                    {fileList.length >= 22 ? null : (
                      <div>
                        {uploading ? <LoadingOutlined /> : <PlusOutlined />}
                        <div style={{ marginTop: 8 }}>Şəkil əlavə et</div>
                      </div>
                    )}
                  </Upload>
                  <div className="text-xs text-gray-500 mt-1">
                    Şəkillər yaxşı keyfiyyətdə olmalıdır.şəkillərin üzərində loqotip və digər yazılar olmamalıdır. Skrinşotlar qəbul olunmur.
                  </div>
                </div>
              </div>
              <br />
              <div className="w-full sm:w-w-full flex-shrink-0">
                <div className="text-sm text-gray-700 mb-1">
                  <span className="font-semibold">Minimum – 1 şəkil</span> (gördüyünüz işləbağlı photo şəkil olmalıdır).
                </div>
                <div className="text-sm text-gray-700 mb-1">
                  <span className="font-semibold">Maksimum – 10 şəkil.</span>
                </div>
                <div className="text-sm text-gray-700">
                  <span className="font-semibold">Optimal ölçü – 1024x768 piksel.</span>
                </div>
              </div>
            </Form.Item>
          </div>
        )}

        {/* Step 2: Packages */}
        {currentStep === 2 && (
          <div className="flex flex-col gap-6">
            {formData.packages.map((pkg, packageIndex) => (
              <Card
                key={packageIndex}
                className="w-full"
                extra={
                  packageIndex > 0 && (
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemovePackage(packageIndex)}
                    />
                  )
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Form.Item
                    label={t('postService.packages.name')}
                    required
                  >
                    <Input
                      value={pkg.name}
                      onChange={(e) => handlePackageChange(packageIndex, 'name', e.target.value)}
                      size="large"
                    />
                  </Form.Item>

                  <Form.Item
                    label={t('postService.packages.price')}
                    required
                  >
                    <InputNumber
                      prefix={<DollarOutlined />}
                      value={pkg.price}
                      min={1}
                      onChange={(value) => handlePackageChange(packageIndex, 'price', value)}
                      size="large"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>

                  <Form.Item
                    label={t('postService.packages.features')}
                    className="md:col-span-2"
                  >
                    <div className="flex flex-col gap-2">
                      {pkg.features.map((feature, featureIndex) => (
                        <div key={featureIndex} className="flex gap-2">
                          <Input
                            value={feature}
                            onChange={(e) => handleFeatureChange(packageIndex, featureIndex, e.target.value)}
                            placeholder={t('postService.features.featurePlaceholder')}
                          />
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleRemoveFeature(packageIndex, featureIndex)}
                          />
                        </div>
                      ))}
                      <Button
                        type="dashed"
                        onClick={() => handleAddFeature(packageIndex)}
                        icon={<PlusOutlined />}
                      >
                        {t('postService.packages.addFeature')}
                      </Button>
                    </div>
                  </Form.Item>
                </div>
              </Card>
            ))}

            <Button
              type="dashed"
              onClick={handleAddPackage}
              icon={<PlusOutlined />}
              className="w-full"
            >
              {t('postService.packages.addPackage')}
            </Button>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-6">
            {/* Tags Section */}
            <Form.Item label={t('postService.basicInfo.tags')}>
              <div className="flex flex-wrap gap-2 mb-2">
                {formData.tags.map(tag => (
                  <Tag
                    key={tag}
                    closable
                    onClose={() => handleRemoveTag(tag)}
                    className="text-base py-1"
                  >
                    {tag}
                  </Tag>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onPressEnter={handleAddTag}
                  placeholder={t('postService.basicInfo.addTag')}
                />
                <Button
                  type="primary"
                  onClick={handleAddTag}
                  icon={<PlusOutlined />}
                >
                  {t('postService.basicInfo.add')}
                </Button>
              </div>
            </Form.Item>

            {/* FAQ Section */}
            <Form.Item label={t('postService.basicInfo.faq')}>
              {formData.faq.map((faq, index) => (
                <Card
                  key={index}
                  className="mb-4"
                  extra={
                    index > 0 && (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleRemoveFAQ(index)}
                      />
                    )
                  }
                >
                  <Form.Item label={t('postService.basicInfo.question')}>
                    <Input
                      value={faq.question}
                      onChange={(e) => handleFAQChange(index, 'question', e.target.value)}
                      placeholder={t('postService.basicInfo.question')}
                    />
                  </Form.Item>
                  <Form.Item label={t('postService.basicInfo.answer')}>
                    <TextArea
                      value={faq.answer}
                      onChange={(e) => handleFAQChange(index, 'answer', e.target.value)}
                      placeholder={t('postService.basicInfo.answer')}
                      rows={3}
                    />
                  </Form.Item>
                </Card>
              ))}
              <Button
                type="dashed"
                onClick={handleAddFAQ}
                block
                icon={<PlusOutlined />}
              >
                {t('postService.basicInfo.addFAQ')}
              </Button>
            </Form.Item>

            {/* Requirements Section */}
            <Form.Item label={t('postService.basicInfo.requirements')}>
              {formData.requirements.map((requirement, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <Input
                    value={requirement}
                    onChange={(e) => handleRequirementChange(index, e.target.value)}
                    placeholder={t('postService.basicInfo.requirementPlaceholder')}
                  />
                  {index > 0 && (
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemoveRequirement(index)}
                    />
                  )}
                </div>
              ))}
              <Button
                type="dashed"
                onClick={handleAddRequirement}
                block
                icon={<PlusOutlined />}
              >
                {t('postService.basicInfo.addRequirement')}
              </Button>
            </Form.Item>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-6">
            {/* Location */}
            <Form.Item
              label={t('postService.basicInfo.location')}
              name="location"
              rules={[{ required: true }]}
            >
              <Input
                placeholder={t('postService.basicInfo.locationPlaceholder')}
                size="large"
              />
            </Form.Item>

            {/* Business Hours */}
            <Form.Item label={t('postService.basicInfo.businessHours')}>
              {formData.business_hours.map((hours, index) => (
                <Card key={index} className="mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14">
                      <span className="font-small">{hours.day}</span>
                    </div>
                    <Form.Item noStyle>
                      <Switch
                        size='small'
                        checked={!hours.closed}
                        onChange={(checked) => {
                          setFormData(prev => ({
                            ...prev,
                            business_hours: prev.business_hours.map((h, i) =>
                              i === index ? { ...h, closed: !checked } : h
                            )
                          }));
                        }}
                      />
                    </Form.Item>
                    {!hours.closed && (
                      <div className="flex flex-col md:flex-row items-center gap-2">
                        <TimePicker
                          format="HH:mm"
                          value={dayjs(hours.open, 'HH:mm')}
                          onChange={(time) => {
                            setFormData(prev => ({
                              ...prev,
                              business_hours: prev.business_hours.map((h, i) =>
                                i === index ? { ...h, open: time?.format('HH:mm') || '09:00' } : h
                              )
                            }));
                          }}
                        />
                        <span>{t('postService.basicInfo.to')}</span>
                        <TimePicker
                          format="HH:mm"
                          value={dayjs(hours.close, 'HH:mm')}
                          onChange={(time) => {
                            setFormData(prev => ({
                              ...prev,
                              business_hours: prev.business_hours.map((h, i) =>
                                i === index ? { ...h, close: time?.format('HH:mm') || '17:00' } : h
                              )
                            }));
                          }}
                        />
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </Form.Item>

            {/* Cancellation Policy */}
            <Form.Item
              label={t('postService.basicInfo.cancellationPolicy')}
              name="cancellation_policy"
            >
              <TextArea
                rows={4}
                placeholder={t('postService.basicInfo.cancellationPolicyPlaceholder')}
                size="large"
              />
            </Form.Item>
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-6">
            {/* Contact Information */}
            <Form.Item
              label={t('postService.contact.email')}
              name="contact_email"
              rules={[
                { required: true },
                { type: 'email' }
              ]}
            >
              <Input
                prefix={<MailOutlined />}
                placeholder="example@email.com"
                size="large"
              />
            </Form.Item>

            <Form.Item
              label={t('postService.contact.phone')}
              name="contact_phone"
              rules={[
                { required: true, message: 'Zəhmət olmasa telefon nömrənizi daxil edin' },
                {
                  validator: (_, value) => {
                    // Accepts only numbers starting with 50, 51, 55, 70, 77, 99, etc. after +994
                    const regex = /^(50|51|55|70|77|99|10|60|12|18|20|23|25|26|36|40|41|43|46|49|60|63|65|66|69|78|88|90|91|93|94|95|96|97|98)\d{7}$/;
                    if (!value) return Promise.resolve();
                    if (value.length !== 9 || !regex.test(value)) {
                      return Promise.reject('Düzgün format: 505556633 (yalnız rəqəmlər, +994 avtomatik əlavə olunur)');
                    }
                    return Promise.resolve();
                  }
                }
              ]}
            >
              <Input
                addonBefore="+994"
                type="tel"
                maxLength={9}
                prefix={<PhoneOutlined />}
                placeholder="Telefon nömrəsi (məs: 505556633)"
                size="large"
                pattern="[0-9]{9}"
                inputMode="numeric"
              />
            </Form.Item>

            <Form.Item
              label={t('postService.contact.website')}
              name="website"
            >
              <Input
                prefix={<GlobalOutlined />}
                placeholder={t('postService.contact.websitePlaceholder')}
                size="large"
              />
            </Form.Item>

            {/* Social Media */}
            <Card title={t('postService.social.title')}>
              <Form.Item
                label="Facebook"
                name={['socialMedia', 'facebook']}
              >
                <Input
                  prefix={<FacebookOutlined />}
                  placeholder={t('postService.social.facebook')}
                  size="large"
                />
              </Form.Item>

              <Form.Item
                label="Instagram"
                name={['socialMedia', 'instagram']}
              >
                <Input
                  prefix={<InstagramOutlined />}
                  placeholder={t('postService.social.instagram')}
                  size="large"
                />
              </Form.Item>

              <Form.Item
                label="LinkedIn"
                name={['socialMedia', 'linkedin']}
              >
                <Input
                  prefix={<LinkedinOutlined />}
                  placeholder={t('postService.social.linkedin')}
                  size="large"
                />
              </Form.Item>
            </Card>
            <Card>
              {/* Promotion Selection Horizontal Group */}
              <div className="flex gap-4 mb-6">
                <div
                  className={`flex-1 rounded-2xl border-2 px-6 py-5 flex flex-col items-center cursor-pointer transition-all ${formData.promotionType === 'normal' ? 'border-gray-300 bg-white shadow' : 'border-gray-200 bg-gray-50'}`}
                  onClick={() => setFormData(prev => ({ ...prev, promotionType: 'normal' }))}
                >
                  <span className="block mb-2">
                    <svg width="32" height="32" fill="none" stroke="#A0A0A0" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
                  </span>
                  <span className="font-bold text-lg">Normal</span>
                  <span className="text-gray-500 text-sm mt-1 text-center">Sizin elan normal olaraq adminlər tərəfindən yoxlanışdan keçərək dönüşsüz ol...</span>
                </div>
                <div
                  className={`flex-1 rounded-2xl border-2 px-6 py-5 flex flex-col items-center cursor-pointer transition-all ${formData.promotionType === 'vip' ? 'border-orange-500 bg-orange-50 shadow' : 'border-orange-200 bg-white'}`}
                  onClick={() => setFormData(prev => ({ ...prev, promotionType: 'vip' }))}
                >
                  <span className="block mb-2">
                    <svg width="32" height="32" fill="orange" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z" /></svg>
                  </span>
                  <span className="font-bold text-lg">VIP</span>
                  <span className="text-gray-500 text-sm mt-1 text-center">Sizin elan saytın ana səhifəsində axtarışda birinci yerə qaldırılması və xüsusi bölmədə göstərilməsi.</span>
                </div>
                <div
                  className={`flex-1 rounded-2xl border-2 px-6 py-5 flex flex-col items-center cursor-pointer transition-all ${formData.promotionType === 'premium' ? 'border-blue-500 bg-blue-50 shadow' : 'border-blue-200 bg-white'}`}
                  onClick={() => setFormData(prev => ({ ...prev, promotionType: 'premium' }))}
                >
                  <span className="block mb-2">
                    <svg width="32" height="32" fill="#2563eb" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z" /></svg>
                  </span>
                  <span className="font-bold text-lg">Premium elan</span>
                  <span className="text-gray-500 text-sm mt-1 text-center">Sizin elan saytın ana səhifəsində xüsusi ayrılmış blokda görünəcək və xidmətin aktivlik müddətinin sonunadək orada qalacaq, Premium elan seçərək nəqliyyat vasitəsini profesional alıcılara əmanət edin.</span>
                </div>
              </div>
            </Card>
            {['vip', 'premium'].includes(formData.promotionType || '') && (
              <Form.Item label="Promosyon müddəti">
                <Select
                  placeholder="Gün sayı seçin"
                  value={formData.promotionDuration}
                  onChange={(value) => setFormData(prev => ({ ...prev, promotionDuration: value }))}
                >
                  {formData.promotionType === 'vip' && (
                    <>
                      <Select.Option value={30}>30 gün – 25₼</Select.Option>
                      <Select.Option value={10}>10 gün – 10₼</Select.Option>
                      <Select.Option value={5}>5 gün – 5₼</Select.Option>
                    </>
                  )}
                  {formData.promotionType === 'premium' && (
                    <>
                      <Select.Option value={30}>30 gün – 45₼</Select.Option>
                      <Select.Option value={15}>15 gün – 30₼</Select.Option>
                      <Select.Option value={5}>5 gün – 10₼</Select.Option>
                    </>
                  )}
                </Select>
              </Form.Item>
            )}
          </div>
        )}

        <Divider />

        <div className="flex justify-between">
          {currentStep > 1 && (
            <Button onClick={() => setCurrentStep(currentStep - 1)}>
              {t('postService.buttons.previous')}
            </Button>
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>
              {t('postService.buttons.cancel')}
            </Button>
            {currentStep === 1 ? (
              <Button
                type="primary"
                onClick={validateStep1}
              >
                {t('postService.buttons.next')}
              </Button>
            ) : currentStep < steps.length ? (
              <Button
                type="primary"
                onClick={() => setCurrentStep(currentStep + 1)}
              >
                {t('postService.buttons.next')}
              </Button>
            ) : (
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
              >
                {t('postService.buttons.post')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Form>
  );
}