import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, message, Checkbox, Space } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import { supabase } from '../lib/supabase';

const { Title, Text } = Typography;

interface LocationState {
  message?: string;
}

export function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState;

  useEffect(() => {
    // Show success message if redirected from signup
    if (state?.message) {
      message.success(state.message);
    }
  }, [state]);

  const onFinish = async (values: any) => {
    setLoading(true);
    
    try {
      // Use Supabase's auth.signInWithPassword to authenticate the user
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password
      });
      
      if (error) {
        if (error.code === 'email_not_confirmed') {
          message.error('Please confirm your email address before logging in.');
        } else {
          message.error('Invalid email or password');
        }
        setLoading(false);
        return;
      }

      // Store user session in localStorage (simplified)
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('isLoggedIn', 'true');
      
      message.success('Login successful!');
      navigate('/');
      // Refresh the page after login
      window.location.reload();
      
    } catch (err) {
      console.error('Login error:', err);
      message.error('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gray-50">
      <Card className="w-full max-w-md">
        <div className="text-center mb-8">
          <Title level={2}>Sign in to your account</Title>
          <Text type="secondary">
            Or{' '}
            <Link to="/signup" className="text-blue-600 hover:text-blue-500">
              create a new account
            </Link>
          </Text>
        </div>
        
        <Form
          name="login"
          layout="vertical"
          onFinish={onFinish}
          requiredMark={false}
          initialValues={{ remember: true }}
        >
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
              rules={[{ required: true, message: 'Please enter your password' }]}
            >
              <Input.Password 
                prefix={<LockOutlined />} 
                placeholder="Password" 
                size="large"
              />
            </Form.Item>
            
            <Form.Item>
              <div className="flex items-center justify-between">
                <Form.Item name="remember" valuePropName="checked" noStyle>
                  <Checkbox>Remember me</Checkbox>
                </Form.Item>
                
                <Link to="/forgot-password" className="text-sm text-blue-600 hover:text-blue-500">
                  Forgot your password?
                </Link>
              </div>
            </Form.Item>
            
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                size="large"
                block
              >
                Sign in
              </Button>
            </Form.Item>
          </Space>
        </Form>
      </Card>
    </div>
  );
}