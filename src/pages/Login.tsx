import { useEffect, useState } from 'react';
import { Button, Card, Typography, message, Form, Input, Checkbox, Space, Radio } from 'antd';
import { PhoneOutlined, LockOutlined, LoginOutlined, MailOutlined } from '@ant-design/icons';
import { supabase } from '../lib/supabase';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import InputMask from "react-input-mask";

const { Title, Text } = Typography;

interface LocationState {
  message?: string;
}

export function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState;
  const [form] = Form.useForm();

  // Default login method: phone
  const [loginMethod, setLoginMethod] = useState<'phone' | 'email'>('phone');

  useEffect(() => {
    if (state?.message) {
      message.success(state.message);
    }
  }, [state]);

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

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      let authParams: any = {
        password: values.password,
      };

      if (loginMethod === 'phone') {
        const formattedPhoneNumber = values.phone_number.replace(/\D/g, '');
        const finalPhoneNumber = formattedPhoneNumber.startsWith('+') ? formattedPhoneNumber : `+${formattedPhoneNumber}`;
        authParams.phone = finalPhoneNumber;
      } else if (loginMethod === 'email') {
        authParams.email = values.email;
      }

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword(authParams);

      if (authError) {
        message.error(authError.message.includes('Invalid login credentials') ? 'Telefon nömrəsi/email və ya parol yanlışdır.' : `Giriş xətası: ${authError.message}`);
      } else if (authData.user && authData.session) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('name, phone_number, avatar_url')
          .eq('id', authData.user.id)
          .single();

        let userSessionData = { ...authData.user };

        if (profileError) {
          console.error('Profil məlumatları yüklənərkən xəta:', profileError);
          message.warning('Giriş uğurludur, lakin profil məlumatları tam yüklənmədi.');
        } else if (profileData) {
          userSessionData = {
            ...authData.user,
            user_metadata: {
              name: profileData.name || null,
              phone_number: profileData.phone_number || authData.user.phone,
              avatar_url: profileData.avatar_url || null,
            }
          };
        } else {
          console.warn('Bu istifadəçi ID-si üçün profil tapılmadı:', authData.user.id);
        }

        localStorage.setItem('user', JSON.stringify(userSessionData));
        localStorage.setItem('isLoggedIn', 'true');

        message.success('Giriş uğurludur!');
        navigate('/');
        window.location.reload();
      } else {
        message.error('Gözlənilməz giriş xətası.');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      message.error('Gözlənilməz xəta baş verdi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4 font-sans relative overflow-hidden">
      <div className="absolute top-0 left-0 w-48 h-48 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
      <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-0 left-1/4 w-48 h-48 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>

      <Card className="w-full max-w-lg rounded-3xl shadow-2xl p-8 relative z-10 border border-gray-100" bordered={false}>
        <div className="text-center mb-8">
          <LoginOutlined style={{ fontSize: '48px', color: '#6366F1' }} className="mb-4" />
          <Title level={2} className="text-gray-800">Xoş gəlmisiniz!</Title>
          <Text type="secondary" className="text-lg">Daxil olmaq üçün telefon nömrənizi və ya email ünvanınızı və parolu daxil edin</Text>
        </div>

        {/* Login method seçimi */}
        <Radio.Group
          onChange={e => {
            setLoginMethod(e.target.value);
            // Forma sahələrini təmizlə
            form.resetFields();
          }}
          value={loginMethod}
          className="mb-6 flex justify-center gap-6"
        >
          <Radio.Button value="phone">Telefon</Radio.Button>
          <Radio.Button value="email">Email</Radio.Button>
        </Radio.Group>

        <Form
          name="phone_email_login"
          layout="vertical"
          onFinish={onFinish}
          requiredMark={false}
          form={form}
          initialValues={{ remember: true }}
        >
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {loginMethod === 'phone' && (
              <Form.Item
                name="phone_number"
                rules={[
                  { required: true, message: 'Telefon nömrəsini qeyd edin!' },
                  () => ({
                    validator(_, value) {
                      const raw = value ? value.replace(/\D/g, '') : '';
                      if (!value || (raw.length === 12 && value.startsWith('+994'))) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('Telefon nömrəsi düzgün formatda deyil: +994XXXXXXXXX'));
                    },
                  }),
                ]}
              >
                <InputMask
                  mask="+994999999999"
                  maskChar="_"
                  alwaysShowMask={true}
                  value={form.getFieldValue('phone_number')}
                  onChange={(e) => form.setFieldsValue({ phone_number: e.target.value })}
                >
                  {(inputProps: any) => (
                    <Input
                      {...inputProps}
                      prefix={<PhoneOutlined />}
                      placeholder="+994XXXXXXXXX"
                      size="large"
                      className="rounded-lg"
                    />
                  )}
                </InputMask>
              </Form.Item>
            )}

            {loginMethod === 'email' && (
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: 'Email ünvanını qeyd edin!' },
                  { type: 'email', message: 'Email düzgün formatda deyil!' },
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  placeholder="Email ünvanı"
                  size="large"
                  className="rounded-lg"
                />
              </Form.Item>
            )}

            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Parolu qeyd edin!' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Parol"
                size="large"
                className="rounded-lg"
              />
            </Form.Item>

            <Form.Item>
              <div className="flex items-center justify-between">
                <Form.Item name="remember" valuePropName="checked" noStyle>
                  <Checkbox className="text-gray-600">Məni xatırla</Checkbox>
                </Form.Item>
                <Link to="/forgot-password" className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors duration-200">
                  Parolu unutdun?
                </Link>
              </div>
            </Form.Item>

            <Form.Item className="mt-6">
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                size="large"
                block
                className="rounded-lg h-12 text-lg font-semibold"
              >
                Giriş et
              </Button>
            </Form.Item>
          </Space>
        </Form>

        <div className="text-center mt-8 pt-4 border-t border-gray-200">
          <Text type="secondary" className="text-md">
            Hesabınız yoxdur?{' '}
            <Link to="/signup" className="text-indigo-600 hover:text-indigo-800 transition-colors duration-200 font-medium">
              Qeydiyyat
            </Link>
          </Text>
        </div>
      </Card>
    </div>
  );
}
