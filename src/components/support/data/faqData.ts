import {
  ShoppingBag,
  CreditCard,
  Fingerprint,
  Briefcase,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';

export type SupportCategoryKey =
  | 'order'
  | 'payment'
  | 'kyc'
  | 'provider'
  | 'general';

export type SupportUserRole = 'customer' | 'provider';
export type Lang = 'az' | 'ru' | 'en';

export interface SupportCategory {
  key: SupportCategoryKey;
  icon: LucideIcon;
  color: string;
  bg: string;
  border: string;
  title: Record<Lang, string>;
  subtitle: Record<Lang, string>;
  providerOnly?: boolean;
  faqs: SupportFAQ[];
}

export interface SupportFAQ {
  q: Record<Lang, string>;
  a: Record<Lang, string>;
}

export const SUPPORT_CATEGORIES: SupportCategory[] = [
  {
    key: 'order',
    icon: ShoppingBag,
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    title: { az: 'Sifariş', ru: 'Заказ', en: 'Order' },
    subtitle: {
      az: 'Sifariş statusu, ləğv, redaktə',
      ru: 'Статус заказа, отмена, изменение',
      en: 'Order status, cancellation, editing',
    },
    faqs: [
      {
        q: {
          az: 'Sifarişi necə ləğv edə bilərəm?',
          ru: 'Как отменить заказ?',
          en: 'How can I cancel my order?',
        },
        a: {
          az: 'Sifariş kartını açın → "Ləğv et" düyməsi. Provayder yola çıxıbsa, ləğv mümkün deyil — bu halda dəstəklə əlaqə saxlayın.',
          ru: 'Откройте карточку заказа → кнопка «Отменить». Если исполнитель уже в пути, отмена невозможна — свяжитесь с поддержкой.',
          en: 'Open the order card → "Cancel" button. If the provider is already en route, cancellation is not possible — contact support.',
        },
      },
      {
        q: {
          az: 'Sifariş tamamlandı, amma "Tamamlanıb" görünmür',
          ru: 'Заказ выполнен, но не отмечен «Завершён»',
          en: 'Order completed but not marked "Done"',
        },
        a: {
          az: 'Provayder işi bitirdikdən sonra sübut yükləməlidir (foto/sənəd). Admin yoxlamadan sonra status "Tamamlanıb" olur. Adətən 1-2 saat çəkir.',
          ru: 'После завершения работы исполнитель должен загрузить доказательство (фото/документ). После проверки админом статус становится «Завершён». Обычно занимает 1-2 часа.',
          en: 'After finishing, the provider must upload evidence (photo/document). After admin review, the status becomes "Done". Usually takes 1-2 hours.',
        },
      },
      {
        q: {
          az: 'Provayder gəlmədi, nə edim?',
          ru: 'Исполнитель не пришёл, что делать?',
          en: 'The provider did not arrive, what to do?',
        },
        a: {
          az: 'Sifarişi ləğv edin və yeni provayderdən təklif gözləyin. Eyni zamanda dəstəklə əlaqə saxlayın ki, provayderə qarşı tədbir görək.',
          ru: 'Отмените заказ и ждите предложение от нового исполнителя. Также сообщите в поддержку для принятия мер.',
          en: 'Cancel the order and await a new provider offer. Also contact support so we can take action against the provider.',
        },
      },
    ],
  },
  {
    key: 'payment',
    icon: CreditCard,
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    title: { az: 'Ödəniş', ru: 'Оплата', en: 'Payment' },
    subtitle: {
      az: 'Balans, qaytarma, komissiya',
      ru: 'Баланс, возврат, комиссия',
      en: 'Balance, refund, commission',
    },
    faqs: [
      {
        q: {
          az: 'Pul niyə geri qayıtmadı?',
          ru: 'Почему деньги не вернулись?',
          en: 'Why was the refund not returned?',
        },
        a: {
          az: 'Ləğv tipindən asılıdır: provayder qəbul etməmişdən əvvəl ləğv → tam qaytarma 1-3 iş günündə. Provayder qəbul etdikdən sonra ləğv → komissiya tutulur.',
          ru: 'Зависит от типа отмены: до принятия исполнителем → полный возврат за 1-3 рабочих дня. После принятия → удерживается комиссия.',
          en: 'Depends on cancellation type: before provider accepted → full refund in 1-3 business days. After accepted → commission is deducted.',
        },
      },
      {
        q: {
          az: 'Balansa pul yüklədim, hesabımda görünmür',
          ru: 'Пополнил баланс, но не вижу на счёте',
          en: 'I topped up but it is not on my balance',
        },
        a: {
          az: 'Adətən 1-5 dəqiqə çəkir. 15 dəqiqədən çox keçibsə, ödəniş çekini (PDF/screenshot) bizə göndərin.',
          ru: 'Обычно 1-5 минут. Если прошло более 15 минут — пришлите чек оплаты (PDF/скриншот).',
          en: 'Usually 1-5 minutes. If more than 15 minutes have passed, send us the payment receipt (PDF/screenshot).',
        },
      },
      {
        q: {
          az: 'Komissiya neçə faizdir?',
          ru: 'Какая комиссия?',
          en: 'What is the commission?',
        },
        a: {
          az: 'Müştəri üçün: 0% (ödəniş bilavasitə provayderə gedir). Provayder üçün: təklif qəbul edəndə 5%, iş bitəndə 5% — cəmi 10%.',
          ru: 'Для клиента: 0%. Для исполнителя: 5% при принятии + 5% при завершении — итого 10%.',
          en: 'For customer: 0%. For provider: 5% on accept + 5% on completion — total 10%.',
        },
      },
    ],
  },
  {
    key: 'kyc',
    icon: Fingerprint,
    color: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    title: { az: 'KYC', ru: 'KYC', en: 'KYC' },
    subtitle: {
      az: 'Şəxsiyyət yoxlama, sənədlər',
      ru: 'Проверка личности, документы',
      en: 'Identity verification, documents',
    },
    faqs: [
      {
        q: {
          az: 'KYC nə qədər çəkir?',
          ru: 'Сколько занимает KYC?',
          en: 'How long does KYC take?',
        },
        a: {
          az: 'Adətən 24 saat. Bayram günlərində 48 saata qədər ola bilər. Admin tərəfindən əl ilə yoxlanılır.',
          ru: 'Обычно 24 часа. В праздничные дни до 48 часов. Проверяется админом вручную.',
          en: 'Usually 24 hours. Up to 48h on holidays. Manually reviewed by admin.',
        },
      },
      {
        q: {
          az: 'KYC rədd edildi, niyə?',
          ru: 'KYC отклонён, почему?',
          en: 'KYC was rejected, why?',
        },
        a: {
          az: 'Adətən: foto keyfiyyəti aşağıdır, sənəd dövrü bitib, və ya ad uyğun gəlmir. Yenidən cəhd edin və yaxşı işıqlandırma ilə şəkil çəkin.',
          ru: 'Обычно: низкое качество фото, истёк срок документа или несовпадение имени. Попробуйте снова при хорошем освещении.',
          en: 'Usually: low photo quality, expired document, or name mismatch. Try again with good lighting.',
        },
      },
      {
        q: {
          az: 'Hansı sənədlər lazımdır?',
          ru: 'Какие нужны документы?',
          en: 'Which documents are needed?',
        },
        a: {
          az: 'Şəxsiyyət vəsiqəsi (hər iki tərəf) və ya pasport. Provayderlər üçün əlavə: əgər tələb olunursa peşə sertifikatı.',
          ru: 'Удостоверение личности (обе стороны) или паспорт. Для исполнителей дополнительно: профессиональный сертификат при необходимости.',
          en: 'ID card (both sides) or passport. For providers also: professional certificate if required.',
        },
      },
    ],
  },
  {
    key: 'provider',
    icon: Briefcase,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    providerOnly: true,
    title: { az: 'Provayder işi', ru: 'Работа исполнителя', en: 'Provider work' },
    subtitle: {
      az: 'Sifariş qəbulu, ödəniş, profil',
      ru: 'Приём заказов, выплаты, профиль',
      en: 'Accepting orders, payouts, profile',
    },
    faqs: [
      {
        q: {
          az: 'Niyə fürsətlər görünmür?',
          ru: 'Почему не вижу возможности?',
          en: 'Why are opportunities not showing?',
        },
        a: {
          az: 'Profiliniz tam dolduruldumu? KYC təsdiqlənibmi? Aktiv kateqoriyalar seçilibmi? Bütün bunlar həyata keçirilməyibsə, sifarişlər göstərilmir.',
          ru: 'Заполнен ли профиль полностью? Прошли ли KYC? Выбраны ли активные категории? Без этого заказы не показываются.',
          en: 'Is your profile complete? KYC verified? Active categories selected? Without these, orders are not shown.',
        },
      },
      {
        q: {
          az: 'Pul nə vaxt çıxarıla bilər?',
          ru: 'Когда можно вывести деньги?',
          en: 'When can I withdraw money?',
        },
        a: {
          az: 'İş tamamlandıqdan və admin yoxladıqdan sonra balansa düşür (1-2 saat). Sonra istənilən vaxt nağdlaşdırma sorğusu göndərə bilərsiniz.',
          ru: 'После завершения работы и проверки админом средства поступают на баланс (1-2 часа). Затем в любое время можно подать заявку на вывод.',
          en: 'After work completion and admin review, funds appear in your balance (1-2 hours). You may then request withdrawal at any time.',
        },
      },
      {
        q: {
          az: 'Müştəri qəbul etmir, nə edim?',
          ru: 'Клиент не принимает, что делать?',
          en: 'Customer is not accepting, what to do?',
        },
        a: {
          az: 'İşi tamamladığınızı bildirdiyiniz halda, sübut yükləyin (foto/sənəd). Admin yoxlayıb avtomatik təsdiq edəcək — müştərinin qəbul etməsi lazım deyil.',
          ru: 'Если работа выполнена, загрузите доказательство (фото/документ). Админ проверит и подтвердит автоматически — согласие клиента не требуется.',
          en: 'If the job is done, upload evidence (photo/document). Admin will verify and auto-approve — customer acceptance not required.',
        },
      },
    ],
  },
  {
    key: 'general',
    icon: HelpCircle,
    color: 'text-slate-700',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    title: { az: 'Digər', ru: 'Другое', en: 'Other' },
    subtitle: {
      az: 'Hesab, parol, ümumi suallar',
      ru: 'Аккаунт, пароль, общие вопросы',
      en: 'Account, password, general questions',
    },
    faqs: [
      {
        q: {
          az: 'Parolumu unutmuşam',
          ru: 'Забыл пароль',
          en: 'I forgot my password',
        },
        a: {
          az: 'Giriş səhifəsində "Parolu unutmuşam" linkindən istifadə edin. Email-ə bərpa linki gələcək (5 dəq müddətli).',
          ru: 'На странице входа используйте ссылку «Забыл пароль». На email придёт ссылка для восстановления (действует 5 мин).',
          en: 'Use the "Forgot password" link on the login page. A recovery link will be sent to your email (valid 5 min).',
        },
      },
      {
        q: {
          az: 'Hesabımı necə silə bilərəm?',
          ru: 'Как удалить аккаунт?',
          en: 'How do I delete my account?',
        },
        a: {
          az: 'Profil → Parametrlər → "Hesabı sil". Aktiv sifarişləriniz varsa silmək mümkün deyil — əvvəlcə onları bitirin.',
          ru: 'Профиль → Настройки → «Удалить аккаунт». Если есть активные заказы — сначала завершите их.',
          en: 'Profile → Settings → "Delete account". If you have active orders, finish them first.',
        },
      },
    ],
  },
];

export function getCategory(key: SupportCategoryKey): SupportCategory | undefined {
  return SUPPORT_CATEGORIES.find((c) => c.key === key);
}