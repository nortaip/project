import React, { useEffect, useState } from 'react';
import { Card, Button, Tag, Image, Collapse, List, Typography, message } from 'antd';
import { supabase } from '../lib/supabase';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';

const { Panel } = Collapse;
const { Paragraph } = Typography;

export default function PendingServicesDashboard() {
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

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

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Pending Services</h2>
      {services.map(service => {
        const businessHours = JSON.parse(service.business_hours || '[]');
        const packages = JSON.parse(service.packages || '[]');
        const socialMedia = JSON.parse(service.socialMedia || '{}');
        const faq = JSON.parse(service.faq || '[]');
        const requirements = JSON.parse(service.requirements || '[]');
        const tags = service.tags || [];

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
            ]}
          >
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

              <Panel header="Business Hours" key={''}>
                <List
                  size="small"
                  dataSource={businessHours}
                  renderItem={(h: any) => (
                    <List.Item>{h.day}: {h.closed ? 'Closed' : `${h.open} - ${h.close}`}</List.Item>
                  )}
                />
              </Panel>

              <Panel header="Social Media" key={''}>
                <List size="small">
                  <List.Item>Facebook: {socialMedia.facebook}</List.Item>
                  <List.Item>Instagram: {socialMedia.instagram}</List.Item>
                  <List.Item>LinkedIn: {socialMedia.linkedin}</List.Item>
                </List>
              </Panel>

              <Panel header="FAQ" key={''}>
                {faq.map((f: any, idx: number) => (
                  <Paragraph key={idx}><strong>{f.question}:</strong> {f.answer}</Paragraph>
                ))}
              </Panel>

              <Panel header="Requirements" key={''}>
                <List size="small" dataSource={requirements} renderItem={(item: string) => <List.Item>{item}</List.Item>} />
              </Panel>

              <Panel header="Tags" key={''}>
                {tags.map((tag: string, idx: number) => (
                  <Tag key={idx}>{tag}</Tag>
                ))}
              </Panel>
            </Collapse>
          </Card>
        );
      })}
    </div>
  );
}
