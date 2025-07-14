import requests
import json
import time
import random

SUPABASE_EDGE_FUNCTION = 'https://fvvxtnjfjtqrhpecsvpd.supabase.co/functions/v1/get-opportunities'
SOFT10_API_URL = 'https://api.soft10.az/v1/message/send-text'
SOFT10_API_KEY = '25f98fc742c9eddff1672eade1af90e86b35f1bbfb32835e8f0cd79afc312274'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

categories = [
    "Avtomobil təmiri",
    "Aşbaz",
    "İT, Biznes xidmətləri",
    "Baytar",
    "Ev işləri",
    "Avtomobil xidmətləri",
    "Mebel və İnteryer",
    "Gözəllik və Sağlamlıq",
    "Şəxsi Məşqçi",
    "Məişət texnikası",
    "Reklam və Dizayn",
    "Təmir və Tikinti",
    "Mühasibat"
]

message_variants = [
    'Salam! Sizin üçün yeni bir xidmət fürsəti var: "%s". "%s" kateqoriyasında yeni sifariş əlavə olunub. İndi daxil olub fürsəti qaçırmayın: https://ellit.az/profile/opportunities 🚀',
    'Hey! "%s" xidmətinə dair yeni bir sifariş var (%s). Özünüzü sınamaq üçün fürsəti qaçırmayın: https://ellit.az/profile/opportunities 😊',
    'Dostumuz, "%s" kateqoriyasında təzə sifariş gəldi! Kateqoriya: %s. Təfərrüatlar üçün: https://ellit.az/profile/opportunities 👍'
]

sent_phones = set()

for category_label in categories:
    # Prepare request payload
    post_data = {"category_label": category_label}
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    try:
        r = requests.post(SUPABASE_EDGE_FUNCTION, headers=headers, json=post_data, timeout=20)
        data = r.json()
    except Exception as e:
        print(f"{category_label} üçün sorğu xətası: {e}")
        continue

    if not data.get('opportunity') or not data.get('phones'):
        print(f"{category_label} üçün bu gün yeni fürsət və ya profil yoxdur")
        continue

    title = data['opportunity'].get('title', '')
    opportunity_id = data['opportunity'].get('id', '')
    phones = data['phones']

    for phone in phones:
        if phone in sent_phones:
            print(f"SKIP: {phone} nömrəsinə artıq SMS göndərilib, keçilir...")
            continue

        # Pick a random message variant
        msg = random.choice(message_variants) % (title, category_label)
        print(f"GÖNDƏRİLİR: {phone} -> {msg}")

        payload = {
            "to": phone,
            "options": {"message": msg}
        }
        sms_headers = {
            "accept": "application/json",
            "x-api-key": SOFT10_API_KEY,
            "Content-Type": "application/json"
        }

        try:
            sms_resp = requests.post(SOFT10_API_URL, headers=sms_headers, json=payload, timeout=10)
            print(f"SMS kod: {sms_resp.status_code}, cavab: {sms_resp.text}")
        except Exception as e:
            print(f"{phone} üçün SMS göndərilə bilmədi: {e}")

        sent_phones.add(phone)
        time.sleep(random.uniform(10, 15))  # Wait 1.5–3 seconds between SMS

print("Tamamlandı.")
