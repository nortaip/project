import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Row,
  Col,
  Divider
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  PhoneOutlined,
  HomeOutlined,
  ShopOutlined,
  ToolOutlined,
  GoogleOutlined,
  MailOutlined
} from '@ant-design/icons';
import { supabase } from '../lib/supabase';
import InputMask from "react-input-mask";
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
  'Digər'
];

export function Signup() {
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState('customer');
  const navigate = useNavigate();

  const insertProfileData = async (userId: string, values: any, isOAuth = false) => {
    let profileData: any = {
      id: userId,
      role: values.role || 'customer',
      status: 'active',
      balance: 0,
      is_verified: false,
      avatar_url: null,
      settings: {}
    };

    if (isOAuth) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        profileData.email = user.email || null;
        profileData.name = user.user_metadata?.full_name || user.user_metadata?.name || null;
      }
      profileData.phone_number = null;
      profileData.address = null;
      profileData.birth_date = null;
      profileData.company_name = null;
      profileData.experience_years = 0;
      profileData.specialties = [];
    } else {
      profileData.email = values.email || null;
      profileData.name = values.name;
      profileData.phone_number = values.phone_number ? values.phone_number.replace(/\D/g, '') : null;
      profileData.address = values.address || null;
      profileData.birth_date = values.birthDate ? values.birthDate.format('YYYY-MM-DD') : null;
      profileData.company_name = values.company || null;
      profileData.experience_years = values.experience ? parseInt(values.experience) : 0;
      profileData.specialties = Array.isArray(values.specialties) ? values.specialties : [];
    }

    const { error: profileInsertError } = await supabase
      .from('profiles')
      .upsert([profileData], { onConflict: 'id' });

    if (profileInsertError) {
      throw new Error('Hesab yaradıldı, lakin profil məlumatları əlavə edilərkən xəta baş verdi.');
    }
  };

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      let rawPhoneNumber = String(values.phone_number).replace(/\D/g, '');
      if (rawPhoneNumber.length !== 12 || !rawPhoneNumber.startsWith('994')) {
        message.error('Telefon nömrəsini düzgün daxil edin. Məsələn: +994501234567');
        setLoading(false);
        return;
      }

      const formattedPhone = `+${rawPhoneNumber}`;
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        phone: formattedPhone,
        password: values.password,
        options: {
          data: {
            name: values.name,
            role: values.role || 'customer',
            address: values.address || '',
            birth_date: values.birthDate ? values.birthDate.format('YYYY-MM-DD') : null,
            company_name: values.company || null,
            experience_years: values.experience ? parseInt(values.experience) : 0,
            specialties: values.specialties || [],
            email: values.email || null
          },
        }
      });

      if (signUpError) {
        message.error('Qeydiyyat xətası: ' + signUpError.message);
        setLoading(false);
        return;
      }

      if (signUpData.user) {
        await insertProfileData(signUpData.user.id, values, false);
        message.success('Hesab yaradıldı!');
        navigate('/login', { state: { message: 'Zəhmət olmasa daxil olun.' } });
      }
    } catch (err: any) {
      message.error(err.message || 'Xəta baş verdi');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) {
        message.error('Google ilə giriş alınmadı: ' + error.message);
      }
    } catch (err: any) {
      message.error('Xəta: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user?.app_metadata.provider === 'google') {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', session.user.id)
          .single();

        if (error && error.code === 'PGRST116') {
          try {
            await insertProfileData(session.user.id, { role: 'customer' }, true);
            message.success('Google ilə qeydiyyat uğurla tamamlandı!');
            navigate('/dashboard');
          } catch (err: any) {
            message.error(err.message || 'Profil əlavə edilərkən xəta baş verdi.');
          }
        }
      }
    });

    return () => {
      authListener.unsubscribe();
    };
  }, []);

  return (
    <Row justify="center" style={{ marginTop: 40 }}>
      <Col xs={22} sm={20} md={16} lg={12} xl={10}>
        <Card>
          <Title level={3}>Qeydiyyat</Title>
          <Form form={form} layout="vertical" onFinish={onFinish}>
            <Form.Item name="name" label="Ad Soyad" rules={[{ required: true, message: 'Zəhmət olmasa adınızı daxil edin' }]}>
              <Input prefix={<UserOutlined />} placeholder="Adınız və soyadınız" />
            </Form.Item>

            <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Etibarlı email daxil edin' }]}>
              <Input prefix={<MailOutlined />} placeholder="nümunə@mail.com" />
            </Form.Item>

            <Form.Item name="phone_number" label="Telefon nömrəsi" rules={[{ required: true, message: 'Telefon nömrəsi vacibdir' }]}>
              <InputMask mask="+994(99)9999999" maskChar={null}>
                {(inputProps: any) => <Input {...inputProps} prefix={<PhoneOutlined />} placeholder="+994(50)1234567" />}
              </InputMask>
            </Form.Item>

            <Form.Item name="password" label="Parol" rules={[{ required: true, message: 'Parol vacibdir' }, { min: 6, message: 'Parol minimum 6 simvol olmalıdır' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="••••••" />
            </Form.Item>

            <Form.Item name="birthDate" label="Doğum Tarixi">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item name="address" label="Ünvan">
              <Input prefix={<HomeOutlined />} placeholder="Ünvanınızı daxil edin" />
            </Form.Item>

            <Form.Item name="company" label="Şirkət (əgər varsa)">
              <Input prefix={<ShopOutlined />} placeholder="Şirkət adı (əgər varsa)" />
            </Form.Item>

            <Form.Item name="experience" label="Təcrübə (il)">
              <Input type="number" prefix={<ToolOutlined />} placeholder="Təcrübə müddəti" />
            </Form.Item>

            <Form.Item name="specialties" label="İxtisaslar">
              <Select mode="multiple" placeholder="İxtisas seçin">
                {SPECIALTIES.map(s => <Option key={s} value={s}>{s}</Option>)}
              </Select>
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Qeydiyyatdan keç
              </Button>
            </Form.Item>

            <Divider>və ya</Divider>

            <Button icon={<GoogleOutlined />} onClick={handleGoogleSignIn} block loading={loading}>
              Google ilə qeydiyyat
            </Button>
          </Form>
        </Card>
      </Col>
    </Row>
  );
}
