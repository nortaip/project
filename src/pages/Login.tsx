import { useEffect, useState } from 'react';
import { Button, Card, Typography, message, Divider, Form, Input, Checkbox, Space } from 'antd';
import { GoogleOutlined, LoginOutlined, MailOutlined, LockOutlined } from '@ant-design/icons';
import { supabase } from '../lib/supabase';
import { Link, useNavigate, useLocation } from 'react-router-dom';

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
    if (state?.message) {
      message.success(state.message);
    }
  }, [state]);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });

      if (error) {
        if (error.code === 'email_not_confirmed') {
          message.error('Zəhmət olmasa e-poçtunuzu təsdiqləyin');
        } else {
          message.error('Mail və ya parol yanlışdır');
        }
        return;
      }

      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('isLoggedIn', 'true');

      message.success('Giriş uğurludur!');
      navigate('/');
      window.location.reload();
    } catch (err) {
      console.error('Login error:', err);
      message.error('Gözlənilməz xəta baş verdi');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
    });
    if (error) message.error('Google ilə giriş mümkün olmadı');
    setLoading(false);
  };

  const handleSAMLLogin = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure', // or 'saml' depending on your setup
    });
    if (error) message.error('SAML ilə giriş mümkün olmadı');
    setLoading(false);
  };

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        localStorage.setItem('user', JSON.stringify(session.user));
        localStorage.setItem('isLoggedIn', 'true');
        navigate('/');
        window.location.reload();
      }
    };
    checkSession();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <Card className="w-full max-w-md shadow-lg">
        <div className="text-center mb-6">
          <Title level={3}>Xoş gəlmisiniz</Title>
          <Text type="secondary">Daxil olmaq üçün metodu seçin</Text>
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
                { required: true, message: 'Maili qeyd edin' },
                { type: 'email', message: 'Düzgün email qeyd edin' }
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
              rules={[{ required: true, message: 'Parolu qeyd edin' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Parol"
                size="large"
              />
            </Form.Item>

            <Form.Item>
              <div className="flex items-center justify-between">
                <Form.Item name="remember" valuePropName="checked" noStyle>
                  <Checkbox>Məni xatırla</Checkbox>
                </Form.Item>
                <Link to="/forgot-password" className="text-sm text-blue-600 hover:text-blue-500">
                  Parolu unutdun?
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
                Giriş et
              </Button>
            </Form.Item>
          </Space>
        </Form>
{/* 
        <Divider plain>və ya</Divider>

        <Button
          icon={<GoogleOutlined />}
          type="primary"
          size="large"
          block
          loading={loading}
          onClick={handleGoogleLogin}
        >
          Google ilə daxil ol
        </Button>

        <Button
          icon={<LoginOutlined />}
          type="default"
          size="large"
          block
          loading={loading}
          onClick={handleSAMLLogin}
          className="mt-2"
        >
          Email (SAML SSO) ilə daxil ol
        </Button> */}

        <div className="text-center mt-6">
          <Text type="secondary">
            Hesabınız yoxdur?{' '}
            <Link to="/signup" className="text-blue-600 hover:text-blue-500">
              Qeydiyyat
            </Link>
          </Text>
        </div>
      </Card>
    </div>
  );
}
