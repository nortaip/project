import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Tag, Spin, Typography, Empty, Image } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  getDispute,
  getEvidenceUrl,
  type Dispute,
  type DisputeStatus,
  type DisputeAttachment,
} from '../lib/disputeService';

const STATUS_COLOR: Record<DisputeStatus, string> = {
  open: 'orange',
  under_review: 'blue',
  resolved_customer: 'green',
  resolved_provider: 'green',
  cancelled: 'default',
};

export default function DisputeDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getDispute(id).then((d) => {
      if (!cancelled) {
        setDispute(d);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Spin size="large" />
      </div>
    );
  }

  if (!dispute) {
    return <Empty description={t('errors.notFound')} />;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <Typography.Title level={3}>{t('dispute.title')}</Typography.Title>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <Tag color={STATUS_COLOR[dispute.status]} style={{ fontSize: 13, padding: '4px 10px' }}>
            {t(`dispute.status.${dispute.status}`)}
          </Tag>
          <span className="text-xs text-gray-500">
            {new Date(dispute.created_at).toLocaleString()}
          </span>
        </div>

        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1 font-semibold">
            {t('dispute.reason.label')}
          </div>
          <div className="text-base font-semibold">
            {t(`dispute.reason.${dispute.reason}`)}
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-500 mb-1 font-semibold">
            {t('dispute.description.label')}
          </div>
          <div className="whitespace-pre-wrap text-sm">
            {dispute.description}
          </div>
        </div>

        {dispute.resolution_notes && (
          <Card type="inner" className="mt-4" title="Admin">
            {dispute.resolution_notes}
          </Card>
        )}
      </Card>

      {dispute.attachments && dispute.attachments.length > 0 && (
        <Card title={t('dispute.evidence.label')}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {dispute.attachments.map((a) => (
              <EvidenceThumb key={a.id} attachment={a} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function EvidenceThumb({ attachment }: { attachment: DisputeAttachment }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEvidenceUrl(attachment.file_path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.file_path]);

  if (!url) {
    return (
      <div className="aspect-square bg-gray-100 rounded flex items-center justify-center">
        <Spin />
      </div>
    );
  }

  return (
    <Image
      src={url}
      className="rounded object-cover"
      style={{ aspectRatio: 1 }}
    />
  );
}
