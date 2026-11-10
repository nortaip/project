"""Supabase-uyğun giriş qatı.

Veb (supabase-js) və mobil (supabase_flutter) klientlər Supabase-in HTTP
protokolları ilə danışır. Bu paket həmin protokolları Python backend-də
təqdim edir ki, klientlərdə yalnız server ünvanı dəyişsin:

    /rest/v1/<cədvəl>        cədvəl sorğuları — PostgreSQL RLS altında   (rest.py)
    /rest/v1/rpc/<ad>        RPC-lər — Python servisləri                (rpc*.py)
    /auth/v1/*               giriş/qeydiyyat/token                      (gotrue.py)
    /storage/v1/*            fayllar                                    (storage.py)
    /realtime/v1/websocket   canlı dəyişikliklər                        (realtime.py)
    /functions/v1/<ad>       keçmiş edge function-lar                   (functions.py)

Supabase xidmətinin özü ilə heç bir əlaqə yoxdur.
"""
