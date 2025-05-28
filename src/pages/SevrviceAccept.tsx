import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Image,
  Input,
  Upload,
  message,
  Modal,
  Typography,
  Collapse,
  Spin,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { supabase } from '../lib/supabase';
import { Tag } from 'lucide-react';

const { TextArea } = Input;
const { Paragraph } = Typography;
const { Panel } = Collapse;

export default function PendingServicesDashboard() {
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<any>({});
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('services')
      .select('*, provider:provider_id(name, avatar_url)')
      .eq('status', 'pending');
    if (error) message.error('Fetch failed');
    else setServices(data || []);
    setLoading(false);
  };

  const startEdit = (service: any) => {
    setEditingId(service.id);
    setForm({
      ...service,
      faq: safeParse(service.faq),
      requirements: safeParse(service.requirements),
      tags: service.tags || [],
      packages: safeParse(service.packages),
      business_hours: safeParse(service.business_hours),
      socialMedia: safeParse(service.socialMedia),
    });
  };

  const safeParse = (str: string) => {
    try {
      return JSON.parse(str);
    } catch {
      return Array.isArray(str) ? [] : {};
    }
  };

  const saveEdit = async () => {
    const { id, provider, ...rest } = form;
    const update = {
      ...rest,
      faq: JSON.stringify(rest.faq),
      requirements: JSON.stringify(rest.requirements),
      packages: JSON.stringify(rest.packages),
      tags: rest.tags,
      socialMedia: JSON.stringify(rest.socialMedia),
      business_hours: JSON.stringify(rest.business_hours),
    };
    const { error } = await supabase.from('services').update(update).eq('id', id);
    if (error) message.error('Update failed');
    else {
      message.success('Saved');
      setEditingId(null);
      fetchServices();
    }
  };

  const handleAccept = async (id: number) => {
    const { error } = await supabase.from('services').update({ status: 'accepted' }).eq('id', id);
    if (error) message.error('Approve failed');
    else {
      message.success('Approved');
      fetchServices();
    }
  };

  const handleReject = (id: number) => {
    Modal.confirm({
      title: 'Reject this service?',
      onOk: async () => {
        const { error } = await supabase.from('services').update({ status: 'rejected' }).eq('id', id);
        if (error) message.error('Reject failed');
        else {
          message.success('Rejected');
          fetchServices();
        }
      },
    });
  };

  const handleUpload = async ({ file }: any) => {
    setUploading(true);
    const path = `services/${Date.now()}-${file.uid}.${file.name.split('.').pop()}`;
    const { data, error } = await supabase.storage.from('service-images').upload(path, file);
    setUploading(false);
    if (!error && data) {
      const url = supabase.storage.from('service-images').getPublicUrl(data.path).data.publicUrl;
      setForm((prev: any) => ({ ...prev, images: [...(prev.images || []), url] }));
    } else {
      message.error('Upload failed');
    }
  };

  if (loading) return <Spin tip="Loading..." className="mt-20" />;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h2 className="text-2xl font-semibold mb-6">Pending Services</h2>

      {services.map(service => {
        const isEditing = editingId === service.id;
        const data = isEditing ? form : service;

        return (
          <Card
            key={service.id}
            className="mb-6 shadow-md"
            title={<span className="text-xl font-semibold">{service.title}</span>}
            extra={<strong>{service.category}</strong>}
            cover={
              <Image
                height={240}
                style={{ objectFit: 'cover' }}
                src={data.images?.[0]}
                fallback="https://via.placeholder.com/300"
              />
            }
            actions={
              isEditing
                ? [
                  <Button icon={<SaveOutlined />} onClick={saveEdit}>Save</Button>,
                  <Button onClick={() => setEditingId(null)}>Cancel</Button>,
                ]
                : [
                  <Button icon={<CheckOutlined />} type="primary" onClick={() => handleAccept(service.id)}>Accept</Button>,
                  <Button danger icon={<CloseOutlined />} onClick={() => handleReject(service.id)}>Reject</Button>,
                  <Button icon={<EditOutlined />} onClick={() => startEdit(service)}>Edit</Button>,
                ]
            }
          >
            <Paragraph><strong>Price:</strong> {data.price} AZN</Paragraph>
            <Paragraph><strong>Email:</strong> {data.contact_email}</Paragraph>
            <Paragraph><strong>Phone:</strong> {data.contact_phone}</Paragraph>
            <Paragraph><strong>Location:</strong> {data.location || '—'}</Paragraph>
            <Paragraph><strong>Website:</strong> {data.website || '—'}</Paragraph>
            <Paragraph><strong>Provider:</strong> {data.provider?.name || '—'}</Paragraph>
            <Paragraph><strong>Description:</strong> {data.description}</Paragraph>

            <Paragraph><strong>Business Hours:</strong></Paragraph>
            <ul style={{ paddingLeft: 16 }}>
              {(safeParse(data.business_hours) || []).map((h: any, i: number) => (
                <li key={i}>
                  {h.day}: {h.closed ? 'Closed' : `${h.open} - ${h.close}`}
                </li>
              ))}
            </ul>

            {data.tags?.length > 0 && (
              <>
                <Paragraph><strong>Tags:</strong></Paragraph>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {data.tags.map((tag: string, i: number) => (
                    <Tag key={i} color="blue">{tag}</Tag>
                  ))}
                </div>
              </>
            )}

            {data.requirements && safeParse(data.requirements).length > 0 && (
              <>
                <Paragraph><strong>Requirements:</strong></Paragraph>
                <ul style={{ paddingLeft: 16 }}>
                  {safeParse(data.requirements).map((req: string, i: number) => (
                    <li key={i}>{req}</li>
                  ))}
                </ul>
              </>
            )}

            {data.faq && safeParse(data.faq).length > 0 && (
              <>
                <Paragraph><strong>FAQ:</strong></Paragraph>
                <ul style={{ paddingLeft: 16 }}>
                  {safeParse(data.faq).map((faq: any, i: number) => (
                    <li key={i}><strong>Q:</strong> {faq.question} <br /><strong>A:</strong> {faq.answer}</li>
                  ))}
                </ul>
              </>
            )}

            {data.packages && safeParse(data.packages).length > 0 && (
              <>
                <Paragraph><strong>Packages:</strong></Paragraph>
                <ul style={{ paddingLeft: 16 }}>
                  {safeParse(data.packages).map((pkg: any, i: number) => (
                    <li key={i}>
                      <strong>{pkg.name}</strong> — {pkg.duration} — {pkg.price} AZN
                      <br />
                      <em>Features:</em> {pkg.features?.join(', ') || '—'}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {isEditing && (
              <Collapse className="mt-4" defaultActiveKey={['1']}>
                <Panel header="Edit Service Fields" key="1">
                  <div className="grid gap-4">
                    <div>
                      <label><strong>Title</strong></label>
                      <Input
                        value={form.title}
                        onChange={(e) => setForm((p: any) => ({ ...p, title: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label><strong>Description</strong></label>
                      <TextArea
                        rows={3}
                        value={form.description}
                        onChange={(e) => setForm((p: any) => ({ ...p, description: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label><strong>Price (AZN)</strong></label>
                      <Input
                        type="number"
                        value={form.price}
                        onChange={(e) => setForm((p: any) => ({ ...p, price: parseFloat(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <label><strong>Location</strong></label>
                      <Input
                        value={form.location}
                        onChange={(e) => setForm((p: any) => ({ ...p, location: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label><strong>Website</strong></label>
                      <Input
                        value={form.website}
                        onChange={(e) => setForm((p: any) => ({ ...p, website: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label><strong>Contact Email</strong></label>
                      <Input
                        value={form.contact_email}
                        onChange={(e) => setForm((p: any) => ({ ...p, contact_email: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label><strong>Contact Phone</strong></label>
                      <Input
                        value={form.contact_phone}
                        onChange={(e) => setForm((p: any) => ({ ...p, contact_phone: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label><strong>Upload Images</strong></label>
                      <Upload customRequest={handleUpload} showUploadList={false}>
                        <Button icon={<UploadOutlined />} loading={uploading}>Upload Image</Button>
                      </Upload>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {form.images?.map((img: string, i: number) => (
                          <Image key={i} src={img} width={80} />
                        ))}
                      </div>
                    </div>

                    <div>
                      <label><strong>Tags</strong></label>
                      <Input
                        placeholder="Comma separated"
                        value={form.tags?.join(', ')}
                        onChange={(e) =>
                          setForm((prev: any) => ({
                            ...prev,
                            tags: e.target.value.split(',').map((tag) => tag.trim()),
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label><strong>Requirements</strong></label>
                      {form.requirements?.map((req: string, index: number) => (
                        <Input
                          key={index}
                          value={req}
                          onChange={(e) => {
                            const updated = [...form.requirements];
                            updated[index] = e.target.value;
                            setForm((prev: any) => ({ ...prev, requirements: updated }));
                          }}
                          className="mb-1"
                        />
                      ))}
                      <Button
                        type="dashed"
                        onClick={() =>
                          setForm((prev: any) => ({
                            ...prev,
                            requirements: [...prev.requirements, ''],
                          }))
                        }
                      >
                        Add Requirement
                      </Button>
                    </div>

                    <div>
                      <label><strong>FAQ</strong></label>
                      {form.faq?.map((faq: any, index: number) => (
                        <div key={index} className="mb-2">
                          <Input
                            placeholder="Question"
                            value={faq.question}
                            onChange={(e) => {
                              const updated = [...form.faq];
                              updated[index].question = e.target.value;
                              setForm((prev: any) => ({ ...prev, faq: updated }));
                            }}
                            className="mb-1"
                          />
                          <Input
                            placeholder="Answer"
                            value={faq.answer}
                            onChange={(e) => {
                              const updated = [...form.faq];
                              updated[index].answer = e.target.value;
                              setForm((prev: any) => ({ ...prev, faq: updated }));
                            }}
                          />
                        </div>
                      ))}
                      <Button
                        type="dashed"
                        onClick={() =>
                          setForm((prev: any) => ({
                            ...prev,
                            faq: [...prev.faq, { question: '', answer: '' }],
                          }))
                        }
                        style={{ marginTop: 8 }}
                      >
                        Add FAQ
                      </Button>
                    </div>

                    <div>
                      <label><strong>Packages</strong></label>
                      {form.packages?.map((pkg: any, index: number) => (
                        <div key={index} className="mb-3 border p-2 rounded">
                          <Input
                            placeholder="Name"
                            value={pkg.name}
                            onChange={(e) => {
                              const updated = [...form.packages];
                              updated[index].name = e.target.value;
                              setForm((prev: any) => ({ ...prev, packages: updated }));
                            }}
                            className="mb-1"
                          />
                          <Input
                            placeholder="Duration"
                            value={pkg.duration}
                            onChange={(e) => {
                              const updated = [...form.packages];
                              updated[index].duration = e.target.value;
                              setForm((prev: any) => ({ ...prev, packages: updated }));
                            }}
                            className="mb-1"
                          />
                          <Input
                            type="number"
                            placeholder="Price"
                            value={pkg.price}
                            onChange={(e) => {
                              const updated = [...form.packages];
                              updated[index].price = parseFloat(e.target.value);
                              setForm((prev: any) => ({ ...prev, packages: updated }));
                            }}
                            className="mb-1"
                          />
                          <TextArea
                            placeholder="Features (comma separated)"
                            value={pkg.features?.join(', ') || ''}
                            onChange={(e) => {
                              const updated = [...form.packages];
                              updated[index].features = e.target.value.split(',').map(f => f.trim());
                              setForm((prev: any) => ({ ...prev, packages: updated }));
                            }}
                          />
                        </div>
                      ))}
                      <Button
                        type="dashed"
                        onClick={() =>
                          setForm((prev: any) => ({
                            ...prev,
                            packages: [
                              ...prev.packages,
                              { name: '', price: 0, duration: '', features: [] },
                            ],
                          }))
                        }
                      >
                        Add Package
                      </Button>
                    </div>

                    <div>
                      <label><strong>Business Hours</strong></label>
                      {form.business_hours?.map((hour: any, index: number) => (
                        <div key={index} className="flex items-center gap-2 mb-2">
                          <strong style={{ minWidth: 80 }}>{hour.day}</strong>
                          <Input
                            placeholder="Open"
                            value={hour.open}
                            onChange={(e) => {
                              const updated = [...form.business_hours];
                              updated[index].open = e.target.value;
                              setForm((prev: any) => ({ ...prev, business_hours: updated }));
                            }}
                            style={{ width: 100 }}
                          />
                          <Input
                            placeholder="Close"
                            value={hour.close}
                            onChange={(e) => {
                              const updated = [...form.business_hours];
                              updated[index].close = e.target.value;
                              setForm((prev: any) => ({ ...prev, business_hours: updated }));
                            }}
                            style={{ width: 100 }}
                          />
                          <label>
                            <input
                              type="checkbox"
                              checked={hour.closed}
                              onChange={(e) => {
                                const updated = [...form.business_hours];
                                updated[index].closed = e.target.checked;
                                setForm((prev: any) => ({ ...prev, business_hours: updated }));
                              }}
                            />
                            Closed
                          </label>
                        </div>
                      ))}
                    </div>
                    <div>
                      <label><strong>Social Media</strong></label>
                      <Input
                        placeholder="Facebook URL"
                        value={form.socialMedia?.facebook || ''}
                        onChange={(e) =>
                          setForm((prev: any) => ({
                            ...prev,
                            socialMedia: { ...prev.socialMedia, facebook: e.target.value },
                          }))
                        }
                        className="mb-1"
                      />
                      <Input
                        placeholder="Instagram URL"
                        value={form.socialMedia?.instagram || ''}
                        onChange={(e) =>
                          setForm((prev: any) => ({
                            ...prev,
                            socialMedia: { ...prev.socialMedia, instagram: e.target.value },
                          }))
                        }
                        className="mb-1"
                      />
                      <Input
                        placeholder="LinkedIn URL"
                        value={form.socialMedia?.linkedin || ''}
                        onChange={(e) =>
                          setForm((prev: any) => ({
                            ...prev,
                            socialMedia: { ...prev.socialMedia, linkedin: e.target.value },
                          }))
                        }
                      />
                    </div>

                  </div>
                </Panel>
              </Collapse>
            )}

          </Card>

        );
      })}

    </div>
  );
}
