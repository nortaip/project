import { useEffect, useState } from 'react';
import { Card, Tag, Empty, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  listMyDisputes,
  type Dispute,
  type DisputeStatus,
} from '../lib/disputeService';

const STATUS_COLOR: Record<DisputeStatus, string> = {
  open: 'orange',
  under_review: 'blue',
  resolved_customer: 'green',
  resolved_provider: 'green',
  cancelled: 'default',
};

export default function MyDisputesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listMyDisputes().then((res) => {
      if (!cancelled) {
        setItems(res);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <Typography.Title level={3}>{t('dispute.myDisputes')}</Typography.Title>

      {items.length === 0 ? (
        <Empty description={t('dispute.empty')} />
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <Card
              key={d.id}
              hoverable
              onClick={() => navigate(`/disputes/${d.id}`)}
              size="small"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="font-semibold text-base">
                    {t(`dispute.reason.${d.reason}`)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(d.created_at).toLocaleString()}
                  </div>
                </div>
                <Tag color={STATUS_COLOR[d.status]}>
                  {t(`dispute.status.${d.status}`)}
                </Tag>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
