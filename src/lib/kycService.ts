// ════════════════════════════════════════════════════════════
//  KYC (Provider Verification) servisi — Faza 3 web qarşılığı.
//  Backing: supabase/kyc.sql.
// ════════════════════════════════════════════════════════════

import { supabase } from './supabase';

export type KycStatus =
  | 'not_submitted'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'resubmit_required';

export type DocumentType = 'id_front' | 'id_back' | 'selfie';

export interface KycVerification {
  id: string;
  provider_id: string;
  id_front_path: string;
  id_back_path: string;
  selfie_path: string;
  full_name_on_id?: string;
  id_number?: string;
  birth_date?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejection_reason?: string;
  admin_notes?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

const BUCKET = 'kyc-documents';

// ──────── STATUS ────────────────────────────────────────────

export async function getStatus(): Promise<KycStatus> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return 'not_submitted';

  const { data } = await supabase
    .from('profiles')
    .select('verification_status, is_verified')
    .eq('id', userId)
    .maybeSingle();

  return ((data?.verification_status as KycStatus) ?? 'not_submitted');
}

export async function isVerified(): Promise<boolean> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return false;
  const { data } = await supabase
    .from('profiles')
    .select('is_verified')
    .eq('id', userId)
    .maybeSingle();
  return !!data?.is_verified;
}

export async function getLatestVerification(): Promise<KycVerification | null> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('provider_verifications')
    .select()
    .eq('provider_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as KycVerification;
}

// ──────── UPLOAD ────────────────────────────────────────────

export async function uploadDocument(params: {
  file: File;
  type: DocumentType;
}): Promise<string | null> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return null;

  const ts = Date.now();
  const ext = params.file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${userId}/${ts}_${params.type}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, params.file, { upsert: false });

  if (error) {
    console.error('KYC upload failed', error);
    return null;
  }
  return path;
}

// ──────── SUBMIT ────────────────────────────────────────────

export interface SubmitParams {
  idFrontPath: string;
  idBackPath: string;
  selfiePath: string;
  fullName?: string;
  idNumber?: string;
  birthDate?: string; // YYYY-MM-DD
}

export async function submit(p: SubmitParams) {
  try {
    const { data, error } = await supabase.rpc('submit_kyc', {
      p_id_front_path: p.idFrontPath,
      p_id_back_path: p.idBackPath,
      p_selfie_path: p.selfiePath,
      ...(p.fullName ? { p_full_name: p.fullName } : {}),
      ...(p.idNumber ? { p_id_number: p.idNumber } : {}),
      ...(p.birthDate ? { p_birth_date: p.birthDate } : {}),
    });
    if (error) return { ok: false, error: error.message };
    return data ?? { ok: false, error: 'NO_RESPONSE' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
