import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, Clock, X } from 'lucide-react';
import { message } from 'antd';
import { supabase } from '../lib/supabase';
import { Button, Card } from './ui';

interface PendingInvite {
  token: string;
  intended_role: 'member' | 'dispatcher';
  brigade_id: string;
  brigade_name: string;
  brigade_logo: string | null;
  invited_at: string;
  expires_at: string;
}

const ROLE_LABEL: Record<string, string> = {
  member: 'İşçi',
  dispatcher: 'Dispatcher',
};

/**
 * Cari user-in pending brigade invite-larını göstərir.
 * Email/phone match olunan invite-lər avtomatik tapılır
 * (`my_pending_brigade_invites` RPC).
 */
export default function PendingInvites({ onChange }: { onChange?: () => void }) {
  const navigate = useNavigate();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('my_pending_brigade_invites');
      if (error) throw error;
      setInvites((data ?? []) as PendingInvite[]);
    } catch (e) {
      console.error('Failed to load invites:', e);
    } finally {
      setLoading(false);
    }
  };

  const accept = async (token: string) => {
    setActingOn(token);
    try {
      const { data, error } = await supabase.rpc('accept_brigade_invite', {
        p_token: token,
      });
      if (error) throw error;
      message.success('Dəvət qəbul edildi');
      const brigadeId = (data as { brigade_id?: string })?.brigade_id;
      await load();
      onChange?.();
      if (brigadeId) navigate(`/brigades/${brigadeId}`);
    } catch (e) {
      message.error(`Xəta: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActingOn(null);
    }
  };

  const decline = async (token: string) => {
    if (!confirm('Bu dəvəti rədd etmək istəyirsən?')) return;
    setActingOn(token);
    try {
      const { error } = await supabase.rpc('decline_brigade_invite', {
        p_token: token,
      });
      if (error) throw error;
      message.success('Rədd edildi');
      await load();
      onChange?.();
    } catch (e) {
      message.error(`Xəta: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActingOn(null);
    }
  };

  if (loading || invites.length === 0) return null;

  return (
    <Card variant="elevated" padding="md" className="mb-6 border-brand-200 bg-brand-50/30">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center">
          <Building2 size={18} />
        </span>
        <div>
          <h3 className="font-extrabold text-ink">
            Sizə {invites.length} pending dəvət var
          </h3>
          <p className="text-xs text-muted">
            Şirkətlər sizi komandaya qatılmağa dəvət edir
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {invites.map((inv) => (
          <div
            key={inv.token}
            className="bg-white rounded-2xl border border-border p-3 flex items-center gap-3"
          >
            {inv.brigade_logo ? (
              <img
                src={inv.brigade_logo}
                alt={inv.brigade_name}
                className="w-12 h-12 rounded-xl object-cover shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                <Building2 size={22} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-ink truncate">
                {inv.brigade_name}
              </p>
              <p className="text-xs text-muted">
                <span className="font-semibold">{ROLE_LABEL[inv.intended_role]}</span>
                <span className="mx-1.5">·</span>
                <Clock size={11} className="inline" />{' '}
                {new Date(inv.expires_at).toLocaleDateString('az', {
                  day: '2-digit',
                  month: 'short',
                })}
                -ə qədər
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                disabled={actingOn !== null}
                onClick={() => decline(inv.token)}
                className="text-danger hover:bg-red-50"
                aria-label="Rədd et"
              >
                <X size={16} />
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={actingOn === inv.token}
                disabled={actingOn !== null}
                onClick={() => accept(inv.token)}
                leftIcon={<Check size={16} />}
              >
                Qəbul et
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
