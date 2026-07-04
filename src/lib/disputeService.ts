// ════════════════════════════════════════════════════════════
//  Dispute (şikayət) servisi — Faza 2 web qarşılığı.
//  Backing: supabase/disputes.sql (mobile + DB).
// ════════════════════════════════════════════════════════════

import { supabase } from './supabase';

export type DisputeReason =
  | 'work_not_done'
  | 'poor_quality'
  | 'damage'
  | 'no_show'
  | 'overcharged'
  | 'rude_behavior'
  | 'theft'
  | 'other';

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'resolved_customer'
  | 'resolved_provider'
  | 'cancelled';

export interface Dispute {
  id: string;
  opportunity_id: string;
  offer_id: string;
  raised_by: string;
  against_user: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  resolution_notes?: string;
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
  updated_at: string;
  attachments?: DisputeAttachment[];
}

export interface DisputeAttachment {
  id: string;
  file_path: string;
  file_type: 'image' | 'video' | 'doc';
  size_bytes?: number;
  uploaded_by: string;
  created_at: string;
}

export type RpcResult<T = unknown> =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string; [key: string]: unknown }
  | T;

export const DISPUTE_REASONS: DisputeReason[] = [
  'work_not_done',
  'poor_quality',
  'damage',
  'no_show',
  'overcharged',
  'rude_behavior',
  'theft',
  'other',
];

const BUCKET = 'dispute-evidence';

// ──────── OPEN ──────────────────────────────────────────────

export async function openDispute(params: {
  opportunityId: string;
  reason: DisputeReason;
  description: string;
}): Promise<RpcResult> {
  try {
    const { data, error } = await supabase.rpc('open_dispute', {
      p_opportunity_id: params.opportunityId,
      p_reason: params.reason,
      p_description: params.description.trim(),
    });
    if (error) return { ok: false, error: error.message };
    return (data ?? { ok: false, error: 'NO_RESPONSE' }) as RpcResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ──────── EVIDENCE ──────────────────────────────────────────

export async function addEvidence(params: {
  disputeId: string;
  file: File;
  fileType: 'image' | 'video' | 'doc';
}): Promise<RpcResult> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return { ok: false, error: 'NOT_AUTHENTICATED' };

  const ts = Date.now();
  const safeName = params.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${params.disputeId}/${userId}/${ts}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, params.file);
  if (upErr) return { ok: false, error: `UPLOAD_FAILED: ${upErr.message}` };

  const { data, error } = await supabase.rpc('add_dispute_evidence', {
    p_dispute_id: params.disputeId,
    p_file_path: path,
    p_file_type: params.fileType,
    p_size_bytes: params.file.size,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: true }) as RpcResult;
}

export async function getEvidenceUrl(filePath: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(filePath, 3600);
    if (error) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

// ──────── LIST / DETAIL ─────────────────────────────────────

export async function listMyDisputes(): Promise<Dispute[]> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from('disputes')
    .select(
      'id, opportunity_id, offer_id, raised_by, against_user, reason, description, status, resolution_notes, resolved_at, created_at, updated_at',
    )
    .or(`raised_by.eq.${userId},against_user.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as Dispute[];
}

export async function getDispute(disputeId: string): Promise<Dispute | null> {
  const { data: d, error } = await supabase
    .from('disputes')
    .select()
    .eq('id', disputeId)
    .maybeSingle();
  if (error || !d) return null;

  const { data: atts } = await supabase
    .from('dispute_attachments')
    .select('id, file_path, file_type, size_bytes, uploaded_by, created_at')
    .eq('dispute_id', disputeId)
    .order('created_at', { ascending: true });

  return { ...(d as Dispute), attachments: (atts ?? []) as DisputeAttachment[] };
}

export async function hasActiveDispute(opportunityId: string): Promise<boolean> {
  const { data } = await supabase
    .from('disputes')
    .select('id')
    .eq('opportunity_id', opportunityId)
    .in('status', ['open', 'under_review'])
    .maybeSingle();
  return !!data;
}

// ──────── HELPERS ───────────────────────────────────────────

export function isWithinDisputeWindow(completedAt: string | null | undefined): boolean {
  if (!completedAt) return false;
  const completed = new Date(completedAt).getTime();
  const now = Date.now();
  const hoursSince = (now - completed) / (1000 * 60 * 60);
  return hoursSince >= 0 && hoursSince < 24;
}

export function remainingDisputeMinutes(completedAt: string | null | undefined): number {
  if (!completedAt) return 0;
  const deadline = new Date(completedAt).getTime() + 24 * 60 * 60 * 1000;
  const diff = deadline - Date.now();
  return diff <= 0 ? 0 : Math.floor(diff / (1000 * 60));
}
