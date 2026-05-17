import { useState } from 'react';
import { Modal, Radio, Input, Space, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const PRESET_REASONS = [
  'foundOther',
  'notNeeded',
  'tooExpensive',
  'providerLate',
  'providerNoShow',
  'other',
] as const;

type Preset = (typeof PRESET_REASONS)[number];

interface Props {
  open: boolean;
  opportunityId: string;
  onClose: () => void;
  onCancelled?: (refundedAmount?: number) => void;
}

/**
 * Sifariş ləğv etmə modal — səbəb seçimi məcburi.
 * DB trigger `CANCELLATION_REASON_REQUIRED` boş səbəbi rədd edir;
 * bu modal UI tərəfdə həmin tələbi icra edir.
 *
 * Accepted/i-am-here/ongoing statusda sifariş ləğv edildikdə
 * `refund_offer_payment` RPC çağrılır, məbləğ qaytarılır.
 */
export default function CancelReasonModal({
  open,
  opportunityId,
  onClose,
  onCancelled,
}: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Preset | null>(null);
  const [otherText, setOtherText] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setSelected(null);
    setOtherText('');
  };

  const resolveReason = (): string | null => {
    if (!selected) return null;
    if (selected === 'other') {
      const trimmed = otherText.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return t(`cancel.reason.${selected}`);
  };

  const submit = async () => {
    const reason = resolveReason();
    if (!reason) {
      message.warning(t('cancel.reasonRequired'));
      return;
    }
    setLoading(true);
    try {
      // 1. Mövcud opportunity status-u yoxla
      const { data: opp } = await supabase
        .from('opportunities')
        .select('status, created_by')
        .eq('id', opportunityId)
        .maybeSingle();

      if (!opp) {
        message.error(t('common.loadingError'));
        return;
      }

      const status = (opp.status ?? '').toString();
      const currentUser = (await supabase.auth.getUser()).data.user?.id;

      // 2. Escrow kilidli statusda və müştəri ləğv edirsə → refund RPC
      if (
        ['accepted', 'i-am-here', 'ongoing'].includes(status) &&
        currentUser === opp.created_by
      ) {
        const { data: acceptedOffer } = await supabase
          .from('opportunities_offers')
          .select('id')
          .eq('opportunity_id', opportunityId)
          .eq('status', 'accepted')
          .maybeSingle();

        if (acceptedOffer) {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc(
            'refund_offer_payment',
            { p_offer_id: acceptedOffer.id, p_reason: reason },
          );
          if (rpcErr) {
            message.error(rpcErr.message);
            return;
          }
          const r = rpcRes as { ok: boolean; refunded_amount?: number; error?: string };
          if (r.ok) {
            const amt = r.refunded_amount ?? 0;
            if (amt > 0) {
              message.success(
                t('cancel.refundSuccess', { amount: amt.toFixed(2) }),
              );
            }
            onCancelled?.(amt);
            reset();
            onClose();
            return;
          }
          message.error(t('cancel.refundFailed'));
          return;
        }
      }

      // 3. Sadə cancel (pending)
      const { error: updErr } = await supabase
        .from('opportunities')
        .update({ status: 'cancelled', cancellation_reason: reason })
        .eq('id', opportunityId);
      if (updErr) {
        if (updErr.message.includes('INVALID_STATUS_TRANSITION')) {
          message.error(t('cancel.invalidTransition'));
        } else {
          message.error(updErr.message);
        }
        return;
      }

      // Pending offer-ləri də cancel et
      await supabase
        .from('opportunities_offers')
        .update({ status: 'cancelled' })
        .eq('opportunity_id', opportunityId)
        .in('status', ['pending', 'accepted']);

      onCancelled?.();
      reset();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('cancel.title')}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={submit}
      okText={t('cancel.confirm')}
      cancelText={t('common.cancel')}
      okButtonProps={{ danger: true, loading }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Radio.Group
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <Space direction="vertical">
            {PRESET_REASONS.map((key) => (
              <Radio key={key} value={key}>
                {t(`cancel.reason.${key}`)}
              </Radio>
            ))}
          </Space>
        </Radio.Group>

        {selected === 'other' && (
          <Input.TextArea
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder={t('cancel.reasonHint')}
            maxLength={200}
            rows={3}
            showCount
          />
        )}
      </Space>
    </Modal>
  );
}
