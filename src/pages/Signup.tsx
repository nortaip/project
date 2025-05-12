import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Form, 
  Input, 
  Button, 
  Steps, 
  Card, 
  Select, 
  DatePicker, 
  Checkbox, 
  Typography, 
  message, 
  Alert, 
  Space,
  Row,
  Col,
  Divider
} from 'antd';
import { 
  UserOutlined, 
  MailOutlined, 
  LockOutlined, 
  PhoneOutlined, 
  HomeOutlined, 
  ShopOutlined, 
  ToolOutlined 
} from '@ant-design/icons';
import { supabase } from '../lib/supabase';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Step } = Steps;
const { Option } = Select;

const SPECIALTIES = [
  'Ev Təmizliyi',
  'Santexnika',
  'Elektrik',
  'Bağçılıq',
  'Şəxsi Təlim',
  'Texniki Dəstək',
  'Heyvan Qayğısı',
];

export function Signup() {
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState('customer');
  const navigate = useNavigate();

  const onFinish = async (values: any) => {
    setLoading(true);
    
    try {
      // Collect all form values - this is critical
      const formValues = form.getFieldsValue(true);
      console.log("Complete form values:", formValues);
      
      // Explicitly check each required field
      if (!formValues.email || !formValues.password || !formValues.name) {
        message.error('Missing required fields');
        setLoading(false);
        return;
      }
      
      // Use Supabase's auth.signUp to create the user
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: formValues.email,
        password: formValues.password,
        options: {
          data: {
            name: formValues.name,
            role: formValues.role || 'customer',
            phone_number: formValues.phone || '',
            address: formValues.address || '',
            birth_date: formValues.birthDate ? formValues.birthDate.format('YYYY-MM-DD') : null,
            company_name: formValues.company || null,
            experience_years: formValues.experience ? parseInt(formValues.experience) : 0,
            specialties: Array.isArray(formValues.specialties) ? formValues.specialties : [],
            status: 'active',
            balance: 0,
            is_verified: false,
            avatar_url: null,
            settings: {}
          }
        }
      });
  
      if (signUpError) {
        console.error('Sign-up error:', signUpError);
        message.error(signUpError.message);
        setLoading(false);
        return;
      }
  
      console.log('User signed up:', signUpData);
  
      // Insert profile data into the profiles table
      const { error: profileInsertError } = await supabase
        .from('profiles')
        .insert([{
          id: signUpData.user?.id, // Use the user ID from the sign-up response
          email: formValues.email,
          name: formValues.name,
          role: formValues.role || 'customer',
          phone_number: formValues.phone || '',
          password_hash: formValues.password,
          address: formValues.address || '',
          birth_date: formValues.birthDate ? formValues.birthDate.format('YYYY-MM-DD') : null,
          company_name: formValues.company || null,
          experience_years: formValues.experience ? parseInt(formValues.experience) : 0,
          specialties: Array.isArray(formValues.specialties) ? formValues.specialties : [],
          status: 'active',
          balance: 0,
          is_verified: false,
          avatar_url: null,
          settings: {}
        }]);
  
      if (profileInsertError) {
        console.error('Profile insertion error:', profileInsertError);
        message.error('Failed to insert profile data.');
        setLoading(false);
        return;
      }
  
      // Success!
      message.success('Account created successfully!');
      
      // Navigate to the desired page after signup
      navigate('/login'); // Change '/dashboard' to your desired route
      
    } catch (err) {
      console.error('Signup error:', err);
      message.error('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const next = async () => {
    try {
      // Validate fields in the current step before proceeding
      await form.validateFields(formSteps[currentStep].fields);
      
      // If current step is the first one, and user selected "provider" role
      if (currentStep === 0) {
        setRole(form.getFieldValue('role'));
      }
      
      setCurrentStep(currentStep + 1);
    } catch (error) {
      console.log('Validation failed:', error);
    }
  };

  const prev = () => {
    setCurrentStep(currentStep - 1);
  };

  // Define the fields for each step
  const formSteps = [
    {
      title: 'Əsas Məlumat',
      fields: ['email', 'password', 'confirmPassword', 'name', 'role'],
      content: (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Zəhmət olmasa emailinizi daxil edin' },
              { type: 'email', message: 'Düzgün email daxil edin' }
            ]}
          >
            <Input 
              prefix={<MailOutlined />} 
              placeholder="Email" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="password"
            rules={[
              { required: true, message: 'Zəhmət olmasa şifrənizi daxil edin' },
              { min: 6, message: 'Şifrə ən azı 6 simvol olmalıdır' }
            ]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="Şifrə" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Zəhmət olmasa şifrəni təsdiqləyin' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Şifrələr uyğun gəlmir'));
                },
              }),
            ]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="Şifrəni təsdiqləyin" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
                  name="name"
            rules={[{ required: true, message: 'Zəhmət olmasa adınızı daxil edin' }]}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder="Tam ad" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item 
            name="role" 
            initialValue="customer"
            rules={[{ required: true, message: 'Hesab növünü seçin' }]}
          >
            <Select size="large" placeholder="Hesab növünü seçin">
              <Option value="customer">Müştəri</Option>
              <Option value="provider">Xidmət Təchizatçısı</Option>
            </Select>
          </Form.Item>
        </Space>
      )
    },
    {
      title: 'Əlaqə Məlumatları',
      fields: ['phone', 'address', 'birthDate'],
      content: (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Form.Item
                    name="phone"
            rules={[{ required: true, message: 'Zəhmət olmasa telefon nömrənizi daxil edin' }]}
          >
            <Input 
              prefix={<PhoneOutlined />} 
              placeholder="Telefon nömrəsi" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
                    name="address"
            rules={[{ required: true, message: 'Zəhmət olmasa ünvanınızı daxil edin' }]}
          >
            <Input 
              prefix={<HomeOutlined />} 
              placeholder="Ünvan" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
                    name="birthDate"
          >
            <DatePicker 
              size="large" 
              placeholder="Doğum tarixi (İstəyə bağlı)" 
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Space>
      )
    },
    {
      title: 'Təchizatçı Məlumatları',
      fields: role === 'provider' ? ['company', 'experience', 'specialties'] : [],
      content: role === 'provider' ? (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Form.Item name="company">
            <Input 
              prefix={<ShopOutlined />} 
              placeholder="Şirkət adı (İstəyə bağlı)" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item 
            name="experience"
            rules={[{ required: true, message: 'Təcrübə ilini daxil edin' }]}
          >
            <Input 
              prefix={<ToolOutlined />} 
              placeholder="Təcrübə ili" 
              type="number" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item 
            name="specialties"
            rules={[{ 
              required: true, 
              message: 'Zəhmət olmasa ən azı bir ixtisas seçin',
              type: 'array',
              min: 1
            }]}
          >
            <Checkbox.Group style={{ width: '100%' }}>
              <Row>
                {SPECIALTIES.map(specialty => (
                  <Col span={12} key={specialty} style={{ marginBottom: 8 }}>
                    <Checkbox value={specialty}>{specialty}</Checkbox>
                  </Col>
                ))}
              </Row>
            </Checkbox.Group>
          </Form.Item>
        </Space>
      ) : (
        <div className="text-center p-6">
          <Alert 
            message="Müştəri Hesabı" 
            description="Siz müştəri hesabı yaradırsınız. Qeydiyyatı tamamlamaq üçün 'Qeydiyyatı tamamla' düyməsini klikləyin."
            type="info" 
            showIcon 
                      />
                    </div>
      )
    }
  ];

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gray-50">
      <Card className="w-full max-w-md">
        <div className="text-center mb-6">
          <Title level={2}>Hesab yaradın</Title>
          <Text type="secondary">
            və ya{' '}
            <Link to="/login" className="text-blue-600 hover:text-blue-500">
              hesabınıza daxil olun
            </Link>
          </Text>
        </div>

        <Steps current={currentStep} className="mb-8">
          {formSteps.map(step => (
            <Step key={step.title} title={step.title} />
          ))}
        </Steps>
        
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          requiredMark={false}
          initialValues={{ role: 'customer' }}
        >
          <div className="form-steps mb-6">
            {formSteps[currentStep].content}
          </div>

          <Divider />
          
          <div className="steps-action flex justify-between">
            {currentStep > 0 && (
              <Button onClick={prev}>
                Əvvəlki
              </Button>
            )}
            {currentStep < formSteps.length - 1 && (
              <Button type="primary" onClick={next}>
                Növbəti
              </Button>
            )}
            {currentStep === formSteps.length - 1 && (
              <Button 
                type="primary" 
                htmlType="submit" 
                loading={loading}
              >
                Qeydiyyatı tamamla
              </Button>
            )}
          </div>
          
        </Form>
      </Card>
    </div>
  );
}