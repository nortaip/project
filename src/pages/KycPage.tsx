import { useEffect, useState } from 'react';
import {
  Card,
  Button,
  Upload,
  Input,
  DatePicker,
  Form,
  Tag,
  Alert,
  Spin,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
  getStatus,
  getLatestVerification,
  uploadDocument,
  submit,
  type KycStatus,
  type KycVerification,
  type DocumentType,
} from '../lib/kycService';

interface BadgeInfo {
  color: string;
  icon: React.ReactNode;
  label: string;
}

function getBadgeInfo(s: KycStatus, t: (k: string) => string): BadgeInfo {
  switch (s) {
    case 'approved':
      return {
        color: 'green',
        icon: <CheckCircleOutlined />,
        label: t('kyc.badge.verified'),
      };
    case 'pending':
      return {
        color: 'orange',
        icon: <ClockCircleOutlined />,
        label: t('kyc.badge.pending'),
      };
    case 'rejected':
    case 'resubmit_required':
      return {
        color: 'red',
        icon: <CloseCircleOutlined />,
        label: t('kyc.badge.rejected'),
      };
    default:
      return {
        color: 'default',
        icon: <SafetyCertificateOutlined />,
        label: t('kyc.badge.notSubmitted'),
      };
  }
}

export default function KycPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<KycStatus>('not_submitted');
  const [verification, setVerification] = useState<KycVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [files, setFiles] = useState<Record<DocumentType, File | null>>({
    id_front: null,
    id_back: null,
    selfie: null,
  });
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    const [s, v] = await Promise.all([getStatus(), getLatestVerification()]);
    setStatus(s);
    setVerification(v);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (!files.id_front || !files.id_back || !files.selfie) {
      message.warning(t('kyc.form.requireAll'));
      return;
    }
    setSubmitting(true);
    try {
      const [frontPath, backPath, selfiePath] = await Promise.all([
        uploadDocument({ file: files.id_front, type: 'id_front' }),
        uploadDocument({ file: files.id_back, type: 'id_back' }),
        uploadDocument({ file: files.selfie, type: 'selfie' }),
      ]);

      if (!frontPath || !backPath || !selfiePath) {
        message.error(t('errors.generic'));
        return;
      }

      const res = await submit({
        idFrontPath: frontPath,
        idBackPath: backPath,
        selfiePath: selfiePath,
        fullName: values.fullName,
        idNumber: values.idNumber,
        birthDate: values.birthDate
          ? dayjs(values.birthDate).format('YYYY-MM-DD')
          : undefined,
      });

      const r = res as { ok: boolean; error?: string };
      if (r.ok) {
        message.success(t('kyc.form.success'));
        await load();
        setFiles({ id_front: null, id_back: null, selfie: null });
        form.resetFields();
      } else {
        message.error(r.error ?? t('errors.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Spin size="large" />
      </div>
    );
  }

  const badge = getBadgeInfo(status, t);
  const canSubmit =
    status === 'not_submitted' ||
    status === 'rejected' ||
    status === 'resubmit_required';

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('kyc.title')}
        </Typography.Title>
        <Tag color={badge.color} icon={badge.icon}>
          {badge.label}
        </Tag>
      </div>

      <Card>
        <Typography.Title level={5}>
          {status === 'approved'
            ? t('kyc.status.approvedTitle')
            : status === 'pending'
              ? t('kyc.status.pendingTitle')
              : status === 'rejected'
                ? t('kyc.status.rejectedTitle')
                : t('kyc.status.notSubmittedTitle')}
        </Typography.Title>
        <Typography.Text type="secondary">
          {status === 'approved'
            ? t('kyc.status.approvedBody')
            : status === 'pending'
              ? t('kyc.status.pendingBody')
              : status === 'rejected'
                ? t('kyc.status.rejectedBody')
                : t('kyc.status.notSubmittedBody')}
        </Typography.Text>

        {verification?.rejection_reason && status === 'rejected' && (
          <Alert
            type="error"
            className="mt-3"
            message={verification.rejection_reason}
          />
        )}
      </Card>

      {canSubmit && (
        <Card title={t('kyc.title')}>
          <Form layout="vertical" form={form} onFinish={handleSubmit}>
            <Alert
              type="info"
              showIcon
              className="mb-4"
              message={t('kyc.form.consentTitle')}
              description={t('kyc.form.consentBody')}
            />

            {(['id_front', 'id_back', 'selfie'] as DocumentType[]).map((type) => (
              <Form.Item
                key={type}
                label={t(`kyc.form.${type === 'id_front' ? 'idFront' : type === 'id_back' ? 'idBack' : 'selfie'}`)}
              >
                <Upload
                  accept="image/*"
                  maxCount={1}
                  beforeUpload={(file) => {
                    setFiles((p) => ({ ...p, [type]: file }));
                    return false;
                  }}
                  onRemove={() => {
                    setFiles((p) => ({ ...p, [type]: null }));
                  }}
                  listType="picture"
                >
                  <Button icon={<UploadOutlined />}>
                    {t('kyc.form.uploadHint')}
                  </Button>
                </Upload>
              </Form.Item>
            ))}

            <Form.Item
              name="fullName"
              label={t('kyc.form.fullName')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <Input placeholder={t('kyc.form.fullName')} />
            </Form.Item>

            <Form.Item name="idNumber" label={t('kyc.form.idNumber')}>
              <Input placeholder={t('kyc.form.idNumber')} />
            </Form.Item>

            <Form.Item name="birthDate" label={t('kyc.form.birthDate')}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              block
              size="large"
            >
              {status === 'not_submitted' ? t('kyc.form.submit') : t('kyc.resubmit')}
            </Button>
          </Form>
        </Card>
      )}
    </div>
  );
}
