import { useState, useEffect } from 'react';
import dayjs from 'dayjs';

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
  InboxOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { UploadFile, UploadProps, RcFile } from 'antd/es/upload/interface';
import ImgCrop from 'antd-img-crop';

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

const CATEGORIES = [
  'Home Cleaning',
  'Plumbing',
  'Electrical',
  'Gardening',
  'Personal Training',
  'Tech Support',
  'Pet Care',
  'Building',
  'Other',
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
    category: CATEGORIES[0],
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

  const handleSubmit = async () => {
    try {
      // Get all form values
      const values = await form.validateFields();

      // Make sure we have the title and description
      console.log("Form values:", values); // Add this for debugging

      // Update formData with form values
      const updatedFormData = {
        ...formData,
        ...values,
        // Explicitly ensure title and description are set
        title: values.title || formData.title,
        description: values.description || formData.description,
        // Ensure nested objects are properly merged
        socialMedia: {
          ...formData.socialMedia,
          ...(values.socialMedia || {})
        }
      };

      console.log("Updated form data:", updatedFormData); // Add this for debugging

      setFormData(updatedFormData);
      setLoading(true);
      setError(null);

      const result = await insertService(updatedFormData);
      if (result.success) {
        await onSubmit(updatedFormData);
        onClose();
      }
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) {
        // Form validation error
        console.error("Form validation error:", error); // Add this for debugging
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
      const { data, error } = await supabase.storage
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

      // Add the image URL to the form data
      setFormData(prev => ({
        ...prev,
        images: [...prev.images, url]
      }));

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

  async function insertService(serviceData: ServiceFormData) {
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'pending' // Add status field
      };

      console.log("Attempting to insert service without provider_id:", dataToInsert);

      const { data, error } = await supabase
        .from('services')
        .insert([dataToInsert]);

      if (error) {
        console.error('Database error:', error);
        message.error(`Database error: ${error.message}`);
        throw error;
      }

      console.log("Service inserted successfully");
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
              <Select size="large">
                {CATEGORIES.map((category) => (
                  <Select.Option key={category} value={category}>
                    {t(`services.categories.${getCategoryKey(category)}`)}
                  </Select.Option>
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

            <Form.Item
              label={t('postService.basicInfo.serviceImages')}
              className="md:col-span-2"
              rules={[
                {
                  required: true,
                  message: 'Şəkil əlavə edilməlidir', // e.g. "Please upload at least one image"
                },
              ]}
            >
              <Upload
                listType="picture-card"
                fileList={fileList}
                onChange={handleFileChange}
                onRemove={handleRemoveImage}
                customRequest={customUpload}
                accept="image/*"
                multiple
                maxCount={6}
              >
                {fileList.length >= 6 ? null : (
                  <div>
                    {uploading ? <LoadingOutlined /> : <PlusOutlined />}
                    <div style={{ marginTop: 8 }}>
                      {t('postService.basicInfo.uploadImages')}
                    </div>
                  </div>
                )}
              </Upload>
              <div className="text-sm text-gray-500 mt-2">
                {t('postService.basicInfo.imageLimit', { max: 6 })}
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