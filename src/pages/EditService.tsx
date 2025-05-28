import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import {
  Form, Input, Button, Card, Space, message, Typography, InputNumber, Switch, Tag
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

const { Title } = Typography;
const { TextArea } = Input;

interface Package { name: string; price: number; duration: string; features: string[]; }
interface FAQ { question: string; answer: string; }
interface BusinessHour { day: string; open: string; close: string; closed: boolean; }

export default function EditService() {
  const { serviceId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [form] = Form.useForm();
  const [service, setService] = useState<any>(null);
  const [requirements, setRequirements] = useState<string[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [faq, setFaq] = useState<FAQ[]>([]);
  const [businessHours, setBusinessHours] = useState<BusinessHour[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [socialMedia, setSocialMedia] = useState<{ [key: string]: string }>({});
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('id', serviceId)
        .single();

      if (error) return message.error("Xidmət məlumatları alına bilmədi.");
      if (user?.id !== data.provider_id) {
        message.error("Bu xidmətə giriş hüququnuz yoxdur.");
        navigate('/services');
        return;
      }

      setService(data);
      form.setFieldsValue(data);

      setRequirements(parseOrDefault(data.requirements, []));
      setPackages(parseOrDefault(data.packages, []));
      setFaq(parseOrDefault(data.faq, []));
      setBusinessHours(parseOrDefault(data.business_hours, getDefaultBusinessHours()));
      setTags(parseOrDefault(data.tags, []));
      setSocialMedia(parseOrDefault(data.socialMedia, {}));
      setImages(parseOrDefault(data.images, []));
    };
    fetchData();
    // eslint-disable-next-line
  }, [serviceId, user]);

  // Helper to parse
  function parseOrDefault(data: any, def: any) {
    try {
      if (Array.isArray(data) || typeof data === 'object') return data;
      if (!data) return def;
      return JSON.parse(data);
    } catch {
      return def;
    }
  }

  function getDefaultBusinessHours(): BusinessHour[] {
    return [
      { day: 'Bazar ertəsi', open: '09:00', close: '17:00', closed: false },
      { day: 'Çərşənbə axşamı', open: '09:00', close: '17:00', closed: false },
      { day: 'Çərşənbə', open: '09:00', close: '17:00', closed: false },
      { day: 'Cümə axşamı', open: '09:00', close: '17:00', closed: false },
      { day: 'Cümə', open: '09:00', close: '17:00', closed: false },
      { day: 'Şənbə', open: '09:00', close: '17:00', closed: false },
      { day: 'Bazar', open: '09:00', close: '17:00', closed: false },
    ];
  }

  // Submission
  const onFinish = async (fields: any) => {
    const dataToSubmit = {
      ...fields,
      requirements,
      packages,
      faq,
      business_hours: businessHours,
      tags,
      socialMedia,
      images,
    };
    // Fix types for Supabase: stringify where needed
    dataToSubmit.requirements = JSON.stringify(dataToSubmit.requirements);
    dataToSubmit.packages = JSON.stringify(dataToSubmit.packages);
    dataToSubmit.faq = JSON.stringify(dataToSubmit.faq);
    dataToSubmit.business_hours = JSON.stringify(dataToSubmit.business_hours);
    dataToSubmit.socialMedia = JSON.stringify(dataToSubmit.socialMedia);
    dataToSubmit.tags = dataToSubmit.tags; // Already array
    dataToSubmit.images = dataToSubmit.images; // Already array

    const { error } = await supabase
      .from('services')
      .update(dataToSubmit)
      .eq('id', serviceId);

    if (error) {
      message.error('Yenilənmə alınmadı!');
    } else {
      message.success('Xidmət uğurla yeniləndi!');
      navigate(`/book/${serviceId}`);
    }
  };

  // UI Components
  return (
    <div style={{ maxWidth: 900, margin: 'auto', padding: 24 }}>
      <Title level={2}>Xidməti Redaktə Et</Title>
      <Form form={form} layout="vertical" onFinish={onFinish}>

        <Card title="Əsas Məlumat" style={{ marginBottom: 24 }}>
          <Form.Item name="title" label="Başlıq" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Təsvir" rules={[{ required: true }]}>
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="category" label="Kateqoriya">
            <Input />
          </Form.Item>
          <Form.Item name="price" label="Qiymət">
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="location" label="Ünvan">
            <Input />
          </Form.Item>
        </Card>

        <Card title="Tələblər" style={{ marginBottom: 24 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {requirements.map((req, idx) => (
              <Space key={idx} align="start" style={{ width: '100%' }}>
                <Input
                  value={req}
                  style={{ width: '85%' }}
                  onChange={e => {
                    const arr = [...requirements];
                    arr[idx] = e.target.value;
                    setRequirements(arr);
                  }}
                />
                <Button icon={<DeleteOutlined />} onClick={() => setRequirements(requirements.filter((_, i) => i !== idx))} />
              </Space>
            ))}
            <Button icon={<PlusOutlined />} onClick={() => setRequirements([...requirements, ''])}>
              Tələb əlavə et
            </Button>
          </Space>
        </Card>

        <Card title="Paketlər" style={{ marginBottom: 24 }}>
          {packages.map((pkg, idx) => (
            <Space key={idx} direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
              <Space>
                <Input
                  placeholder="Ad"
                  value={pkg.name}
                  onChange={e => {
                    const arr = [...packages];
                    arr[idx].name = e.target.value;
                    setPackages(arr);
                  }}
                />
                <InputNumber
                  placeholder="Qiymət"
                  value={pkg.price}
                  onChange={value => {
                    const arr = [...packages];
                    arr[idx].price = Number(value);
                    setPackages(arr);
                  }}
                />
                <Button icon={<DeleteOutlined />} onClick={() => setPackages(packages.filter((_, i) => i !== idx))} />
              </Space>
              <Input
                placeholder="Xüsusiyyətlər (vergüllə ayırın)"
                value={pkg.features?.join(', ')}
                onChange={e => {
                  const arr = [...packages];
                  arr[idx].features = e.target.value.split(',').map((x: string) => x.trim());
                  setPackages(arr);
                }}
              />
            </Space>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => setPackages([...packages, { name: '', price: 0, duration: '', features: [] }])}>
            Paket əlavə et
          </Button>
        </Card>

        <Card title="İş Saatları" style={{ marginBottom: 24 }}>
          {businessHours.map((hour, idx) => (
            <Space key={idx} style={{ marginBottom: 10 }}>
              <span style={{ width: 110 }}>{hour.day}</span>
              <Switch checked={!hour.closed} onChange={checked => {
                const arr = [...businessHours];
                arr[idx].closed = !checked;
                setBusinessHours(arr);
              }} checkedChildren="Açıq" unCheckedChildren="Bağlı" />
              <Input
                type="time"
                value={hour.open}
                disabled={hour.closed}
                onChange={e => {
                  const arr = [...businessHours];
                  arr[idx].open = e.target.value;
                  setBusinessHours(arr);
                }}
                style={{ width: 100 }}
              />
              <Input
                type="time"
                value={hour.close}
                disabled={hour.closed}
                onChange={e => {
                  const arr = [...businessHours];
                  arr[idx].close = e.target.value;
                  setBusinessHours(arr);
                }}
                style={{ width: 100 }}
              />
            </Space>
          ))}
        </Card>

        <Card title="FAQ (Tez-tez verilən suallar)" style={{ marginBottom: 24 }}>
          {faq.map((item, idx) => (
            <Space key={idx} direction="vertical" style={{ width: '100%', marginBottom: 8 }}>
              <Input
                placeholder="Sual"
                value={item.question}
                onChange={e => {
                  const arr = [...faq];
                  arr[idx].question = e.target.value;
                  setFaq(arr);
                }}
              />
              <Input
                placeholder="Cavab"
                value={item.answer}
                onChange={e => {
                  const arr = [...faq];
                  arr[idx].answer = e.target.value;
                  setFaq(arr);
                }}
              />
              <Button icon={<DeleteOutlined />} onClick={() => setFaq(faq.filter((_, i) => i !== idx))}>Sil</Button>
            </Space>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => setFaq([...faq, { question: '', answer: '' }])}>
            FAQ əlavə et
          </Button>
        </Card>

        <Card title="Taglər" style={{ marginBottom: 24 }}>
          <Space wrap>
            {tags.map((tag, idx) => (
              <Tag closable key={tag + idx} onClose={() => setTags(tags.filter((_, i) => i !== idx))}>
                {tag}
              </Tag>
            ))}
            <Input
              placeholder="Yeni tag"
              style={{ width: 120 }}
              onPressEnter={e => {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v && !tags.includes(v)) setTags([...tags, v]);
                (e.target as HTMLInputElement).value = '';
              }}
            />
          </Space>
        </Card>

        <Card title="Şəkillər" style={{ marginBottom: 24 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {images.map((img, idx) => (
              <Space key={idx} align="center">
                <img src={img} alt="Service" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd' }} />
                <Button danger icon={<DeleteOutlined />} onClick={() => setImages(images.filter((_, i) => i !== idx))}>Sil</Button>
              </Space>
            ))}
            <Input
              placeholder="Yeni şəkil URL əlavə et və Enter bas"
              onPressEnter={e => {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v && !images.includes(v)) setImages([...images, v]);
                (e.target as HTMLInputElement).value = '';
              }}
            />
          </Space>
        </Card>

        <Card title="Sosial Şəbəkələr" style={{ marginBottom: 24 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input
              addonBefore="Instagram"
              value={socialMedia.instagram || ''}
              onChange={e => setSocialMedia({ ...socialMedia, instagram: e.target.value })}
            />
            <Input
              addonBefore="Facebook"
              value={socialMedia.facebook || ''}
              onChange={e => setSocialMedia({ ...socialMedia, facebook: e.target.value })}
            />
            <Input
              addonBefore="LinkedIn"
              value={socialMedia.linkedin || ''}
              onChange={e => setSocialMedia({ ...socialMedia, linkedin: e.target.value })}
            />
          </Space>
        </Card>

        <Card title="Əlavə" style={{ marginBottom: 24 }}>
          <Form.Item name="cancellation_policy" label="Ləğv Qaydası">
            <TextArea rows={2} />
          </Form.Item>
        </Card>

        <Button type="primary" htmlType="submit" block size="large">
          Yadda Saxla
        </Button>
      </Form>
    </div>
  );
}
