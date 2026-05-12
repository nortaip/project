import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Google / Apple OAuth ilə girəndə user.user_metadata-da gələn email, name,
 * avatar_url, picture sahələrini `profiles` cədvəlinə yazır.
 *
 * Mövcud profil dəyərləri qorunur — yalnız boş sahələr OAuth-dan doldurulur.
 * Email/parol və phone giriş yollarında skip olur (provider yoxlanır).
 */
export async function syncOAuthMetadataToProfile(user: User): Promise<void> {
  try {
    // Yalnız OAuth provayderlər üçün — email/phone üçün skip
    const provider = (user.app_metadata?.provider ?? '').toString();
    if (provider === 'email' || provider === 'phone' || provider === '') return;

    const meta = user.user_metadata ?? {};
    const email = (user.email ?? '').trim();
    const name = String(
      meta.name ?? meta.full_name ?? meta.given_name ?? '',
    ).trim();
    const avatar = String(meta.avatar_url ?? meta.picture ?? '').trim();

    // Mövcud profili oxu
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, email, name, avatar_url')
      .eq('id', user.id)
      .maybeSingle();

    const existingEmail = (existing?.email ?? '').toString().trim();
    const existingName = (existing?.name ?? '').toString().trim();
    const existingAvatar = (existing?.avatar_url ?? '').toString().trim();

    const update: Record<string, string> = {};
    if (email && !existingEmail) update.email = email;
    if (name && !existingName) update.name = name;
    if (avatar && !existingAvatar) update.avatar_url = avatar;

    if (Object.keys(update).length === 0) return;

    if (!existing) {
      // Profil yaranmamışsa, yeni sətir əlavə et
      await supabase.from('profiles').upsert({
        id: user.id,
        role: 'customer',
        ...update,
      });
    } else {
      await supabase.from('profiles').update(update).eq('id', user.id);
    }

    // eslint-disable-next-line no-console
    console.log('✅ OAuth metadata synced to profile:', Object.keys(update));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('⚠ OAuth metadata sync failed (non-fatal):', e);
  }
}
