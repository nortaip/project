import { useState } from 'react';
import { Modal, Radio, Input, Upload, Space, message, Alert } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useTranslation } from 'react-i18next';
import {
  openDispute,
  addEvidence,
  DISPUTE_REASONS,
  type DisputeReason,
} from '../lib/disputeService';

interface Props {
  open: boolean;
  opportunityId: string;
  onClose: () => void;
  onSuccess?: (disputeId: string) => void;
}

/**
 * Şikayət açma modal.
 * Tələblər (DB tərəfində open_dispute RPC-də yoxlanılır):
 *   - Opportunity status = 'completed'
 *   - 24 saat ərzində
 *   - Çağıran müştəri ya provider
 */
export default function OpenDisputeModal({
  open,
  opportunityId,
  onClose,
  onSuccess,
}: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setReason(null);
    setDescription('');
    setFiles([]);
  };

  const submit = async () => {
    if (!reason) {
      message.warning(t('dispute.reason.label'));
      return;
    }
    if (description.trim().length < 10) {
      message.warning(t('dispute.description.tooShort'));
      return;
    }

    setLoading(true);
    try {
      const res = await openDispute({
        opportunityId,
        reason,
        description,
      });
      const r = res as { ok: boolean; dispute_id?: string; error?: string };

      if (!r.ok) {
        const err = r.error ?? '';
        if (err === 'DISPUTE_WINDOW_EXPIRED') {
          message.error(t('dispute.windowExpired'));
        } else if (err === 'DISPUTE_ALREADY_OPEN') {
          message.error(t('dispute.alreadyOpen'));
        } else {
          message.error(err);
        }
        return;
      }

      const disputeId = r.dispute_id!;

      // Sübutları upload et
      for (const f of files) {
        const file = f.originFileObj;
        if (!file) continue;
        await addEvidence({
          disputeId,
          file,
          fileType: 'image',
        });
      }

      message.success(t('dispute.success'));
      onSuccess?.(disputeId);
      reset();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('dispute.open')}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={submit}
      okText={t('dispute.submit')}
      cancelText={t('common.cancel')}
      okButtonProps={{ danger: true, loading }}
      width={520}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          message={t('dispute.confirmTitle')}
          description={t('dispute.confirmBody')}
          type="warning"
          showIcon
        />

        <div>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>
            {t('dispute.reason.label')}
          </div>
          <Radio.Group value={reason} onChange={(e) => setReason(e.target.value)}>
            <Space direction="vertical">
              {DISPUTE_REASONS.map((r) => (
                <Radio key={r} value={r}>
                  {t(`dispute.reason.${r}`)}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>

        <div>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>
            {t('dispute.description.label')}
          </div>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('dispute.description.hint')}
            rows={4}
            maxLength={1000}
            showCount
          />
        </div>

        <div>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>
            {t('dispute.evidence.label')}
          </div>
          <Upload.Dragger
            accept="image/*"
            multiple
            maxCount={5}
            beforeUpload={() => false}
            fileList={files}
            onChange={({ fileList }) => setFiles(fileList)}
          >
            <p>
              <InboxOutlined />
            </p>
            <p>{t('dispute.evidence.upload')}</p>
            <p style={{ fontSize: 12, color: '#999' }}>
              {t('dispute.evidence.hint')}
            </p>
          </Upload.Dragger>
        </div>
      </Space>
    </Modal>
  );
}
