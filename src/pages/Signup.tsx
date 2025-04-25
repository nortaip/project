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
  'Home Cleaning',
  'Plumbing',
  'Electrical',
  'Gardening',
  'Personal Training',
  'Tech Support',
  'Pet Care',
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
      message.success('Account created successfully! Please check your email to verify your account.');
      
      // Navigate to the desired page after signup
      //navigate('/dashboard'); // Change '/dashboard' to your desired route
      
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
      title: 'Basic Info',
      fields: ['email', 'password', 'confirmPassword', 'name', 'role'],
      content: (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Please enter a valid email' }
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
              { required: true, message: 'Please enter your password' },
              { min: 6, message: 'Password must be at least 6 characters' }
            ]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="Password" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Please confirm your password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="Confirm Password" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
                  name="name"
            rules={[{ required: true, message: 'Please enter your name' }]}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder="Full Name" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item 
            name="role" 
            initialValue="customer"
            rules={[{ required: true, message: 'Please select account type' }]}
          >
            <Select size="large" placeholder="Select Account Type">
              <Option value="customer">Customer</Option>
              <Option value="provider">Service Provider</Option>
            </Select>
          </Form.Item>
        </Space>
      )
    },
    {
      title: 'Contact Info',
      fields: ['phone', 'address', 'birthDate'],
      content: (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Form.Item
                    name="phone"
            rules={[{ required: true, message: 'Please enter your phone number' }]}
          >
            <Input 
              prefix={<PhoneOutlined />} 
              placeholder="Phone Number" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
                    name="address"
            rules={[{ required: true, message: 'Please enter your address' }]}
          >
            <Input 
              prefix={<HomeOutlined />} 
              placeholder="Address" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item
                    name="birthDate"
          >
            <DatePicker 
              size="large" 
              placeholder="Birth Date (Optional)" 
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Space>
      )
    },
    {
      title: 'Provider Details',
      fields: role === 'provider' ? ['company', 'experience', 'specialties'] : [],
      content: role === 'provider' ? (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Form.Item name="company">
            <Input 
              prefix={<ShopOutlined />} 
              placeholder="Company Name (Optional)" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item 
            name="experience"
            rules={[{ required: true, message: 'Please enter years of experience' }]}
          >
            <Input 
              prefix={<ToolOutlined />} 
              placeholder="Years of Experience" 
              type="number" 
              size="large"
            />
          </Form.Item>
          
          <Form.Item 
            name="specialties"
            rules={[{ 
              required: true, 
              message: 'Please select at least one specialty',
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
            message="Customer Account" 
            description="You're creating a customer account. Click 'Complete Signup' to finish registration."
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
          <Title level={2}>Create your account</Title>
          <Text type="secondary">
            Or{' '}
            <Link to="/login" className="text-blue-600 hover:text-blue-500">
              sign in to your account
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
                Previous
              </Button>
            )}
            {currentStep < formSteps.length - 1 && (
              <Button type="primary" onClick={next}>
                Next
              </Button>
            )}
            {currentStep === formSteps.length - 1 && (
              <Button 
                type="primary" 
                htmlType="submit" 
                loading={loading}
              >
                Complete Signup
              </Button>
            )}
          </div>
          
        </Form>
      </Card>
    </div>
  );
}