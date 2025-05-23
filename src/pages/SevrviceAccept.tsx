import React, { useEffect, useState } from 'react';
import { Card, Button, Tag, Image, Collapse, List, Typography, message, Input, Form, Upload } from 'antd';
import { supabase } from '../lib/supabase';
import { CheckOutlined, CloseOutlined, EditOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';

const { Panel } = Collapse;
const { Paragraph } = Typography;
const { TextArea } = Input;

export default function PendingServicesDashboard() {
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  useEffect(() => {
    fetchPendingServices();
  }, []);

  const fetchPendingServices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('services')
      .select('*, provider:provider_id(name, avatar_url)')
      .eq('status', 'pending');

    if (error) {
      message.error('Failed to fetch pending services.');
    } else {
      setServices(data || []);
    }
    setLoading(false);
  };

  const updateStatus = async (id: number, status: 'accepted' | 'rejected') => {
    const { error } = await supabase.from('services').update({ status }).eq('id', id);
    if (error) return message.error('Error updating status');
    message.success(`Marked as ${status}`);
    fetchPendingServices();
  };

  const handleEdit = (service: any) => {
    try {
      setEditingServiceId(service.id);
      setEditForm({
        title: service.title,
        description: service.description,
        images: service.images,
        business_hours: JSON.parse(service.business_hours || '[]'),
        socialMedia: JSON.parse(service.socialMedia || '{}'),
        faq: JSON.parse(service.faq || '[]'),
        requirements: JSON.parse(service.requirements || '[]'),
        tags: service.tags || [],
        packages: JSON.parse(service.packages || '[]'),
      });
    } catch (error) {
      console.error('Failed to parse JSON fields:', error);
      message.error('Invalid data format in one or more fields');
    }
  };

  const handleSave = async (id: number) => {
    try {
      const updatedFields = {
        title: editForm.title,
        description: editForm.description,
        images: editForm.images,
        business_hours: JSON.stringify(editForm.business_hours),
        socialMedia: JSON.stringify(editForm.socialMedia),
        faq: JSON.stringify(editForm.faq),
        requirements: JSON.stringify(editForm.requirements),
        tags: editForm.tags,
        packages: JSON.stringify(editForm.packages),
      };
      const { error } = await supabase.from('services').update(updatedFields).eq('id', id);
      if (error) throw error;
      message.success('Service updated');
      setEditingServiceId(null);
      fetchPendingServices();
    } catch (err) {
      console.error(err);
      message.error('Failed to save changes');
    }
  };

  const handleImageUpload = async ({ file }: any) => {
    const fileExt = file.name.split('.').pop();
    const filePath = `services/${Date.now()}-${file.uid}.${fileExt}`;
    const { data, error } = await supabase.storage.from('service-images').upload(filePath, file);
    if (!error && data) {
      const imageUrl = supabase.storage.from('service-images').getPublicUrl(data.path).data.publicUrl;
      setEditForm((prev: any) => ({ ...prev, images: [...(prev.images || []), imageUrl] }));
    } else {
      message.error('Image upload failed');
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Pending Services</h2>
      {services.map(service => {
        const isEditing = editingServiceId === service.id;
        const packages = JSON.parse(service.packages || '[]');

        return (
          <Card
            key={service.id}
            title={service.title}
            extra={<Tag color="blue">{service.category}</Tag>}
            className="mb-4"
            cover={<Image height={250} style={{ objectFit: 'cover' }} src={service.images[0]} alt={service.title} />}
            actions={[
              <Button type="primary" icon={<CheckOutlined />} onClick={() => updateStatus(service.id, 'accepted')}>Accept</Button>,
              <Button danger icon={<CloseOutlined />} onClick={() => updateStatus(service.id, 'rejected')}>Reject</Button>,
              isEditing ? (
                <Button type="default" icon={<SaveOutlined />} onClick={() => handleSave(service.id)}>Save</Button>
              ) : (
                <Button icon={<EditOutlined />} onClick={() => handleEdit(service)}>Edit</Button>
              )
            ]}
          >
            {isEditing ? (
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label>Title</label>
                  <Input value={editForm.title} onChange={e => setEditForm(prev => ({ ...prev, title: e.target.value }))} />
                </div>
                <div>
                  <label>Description</label>
                  <TextArea value={editForm.description} onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))} />
                </div>
                <div>
                  <label>Upload Image</label>
                  <Upload customRequest={handleImageUpload} showUploadList={false}>
                    <Button icon={<UploadOutlined />}>Upload Image</Button>
                  </Upload>
                  <div className="mt-2">
                    {editForm.images?.map((img: string, index: number) => (
                      <Image key={index} src={img} height={80} style={{ marginRight: 8 }} />
                    ))}
                  </div>
                </div>
                <div>
                  <label>Business Hours</label>
                  <TextArea
                    rows={4}
                    value={JSON.stringify(editForm.business_hours, null, 2)}
                    onChange={(e) => {
                      try {
                        setEditForm(prev => ({ ...prev, business_hours: JSON.parse(e.target.value) }));
                      } catch {
                        message.error('Invalid JSON for Business Hours');
                      }
                    }}
                  />
                </div>
                <div>
                  <label>Social Media</label>
                  <TextArea
                    rows={2}
                    value={JSON.stringify(editForm.socialMedia, null, 2)}
                    onChange={(e) => {
                      try {
                        setEditForm(prev => ({ ...prev, socialMedia: JSON.parse(e.target.value) }));
                      } catch {
                        message.error('Invalid JSON for Social Media');
                      }
                    }}
                  />
                </div>
                <div>
                  <label>FAQ</label>
                  <TextArea
                    rows={4}
                    value={JSON.stringify(editForm.faq, null, 2)}
                    onChange={(e) => {
                      try {
                        setEditForm(prev => ({ ...prev, faq: JSON.parse(e.target.value) }));
                      } catch {
                        message.error('Invalid JSON for FAQ');
                      }
                    }}
                  />
                </div>
                <div>
                  <label>Requirements</label>
                  <TextArea
                    rows={2}
                    value={JSON.stringify(editForm.requirements, null, 2)}
                    onChange={(e) => {
                      try {
                        setEditForm(prev => ({ ...prev, requirements: JSON.parse(e.target.value) }));
                      } catch {
                        message.error('Invalid JSON for Requirements');
                      }
                    }}
                  />
                </div>
                <div>
                  <label>Tags</label>
                  <TextArea
                    rows={2}
                    value={JSON.stringify(editForm.tags, null, 2)}
                    onChange={(e) => {
                      try {
                        setEditForm(prev => ({ ...prev, tags: JSON.parse(e.target.value) }));
                      } catch {
                        message.error('Invalid JSON for Tags');
                      }
                    }}
                  />
                </div>
                <div>
                  <label>Packages</label>
                  <TextArea
                    rows={4}
                    value={JSON.stringify(editForm.packages, null, 2)}
                    onChange={(e) => {
                      try {
                        setEditForm(prev => ({ ...prev, packages: JSON.parse(e.target.value) }));
                      } catch {
                        message.error('Invalid JSON for Packages');
                      }
                    }}
                  />
                </div>
              </div>
            ) : (
              <>
                <Paragraph><strong>Description:</strong> {service.description}</Paragraph>
                <Paragraph><strong>Price:</strong> {service.price} AZN</Paragraph>
                <Paragraph><strong>Location:</strong> {service.location}</Paragraph>
                <Paragraph><strong>Email:</strong> {service.contact_email}</Paragraph>
                <Paragraph><strong>Phone:</strong> {service.contact_phone}</Paragraph>
                <Paragraph><strong>Website:</strong> {service.website}</Paragraph>
                <Paragraph><strong>Provider:</strong> {service.provider?.name}</Paragraph>

                <Collapse ghost>
                  <Panel header="Packages" key={''}>
                    {packages.map((p: any, index: number) => (
                      <Card key={index} size="small" className="mb-2">
                        <Paragraph><strong>Name:</strong> {p.name}</Paragraph>
                        <Paragraph><strong>Price:</strong> {p.price} AZN</Paragraph>
                        <Paragraph><strong>Features:</strong> {(p.features || []).join(', ')}</Paragraph>
                      </Card>
                    ))}
                  </Panel>
                </Collapse>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}