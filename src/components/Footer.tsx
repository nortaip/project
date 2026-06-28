import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Facebook,
  Instagram,
  Mail,
  MapPin,
  Phone,
  Send,
  Zap,
} from 'lucide-react';

interface FooterProps {
  className?: string;
}

const POPULAR_CITIES = [
  'Bakı',
  'Sumqayıt',
  'Gəncə',
  'Mingəçevir',
  'Lənkəran',
  'Şəki',
  'Naxçıvan',
  'Şirvan',
  'Xırdalan',
  'Quba',
];

const MORE_CITIES = [
  'Qəbələ', 'Xaçmaz', 'Qusar', 'İsmayıllı', 'Zaqatala', 'Ağcabədi', 'Ağdam', 'Ağdaş',
  'Ağstafa', 'Ağsu', 'Astara', 'Balakən', 'Beyləqan', 'Bərdə', 'Biləsuvar', 'Cəlilabad',
  'Daşkəsən', 'Füzuli', 'Gədəbəy', 'Goranboy', 'Göyçay', 'Göygöl', 'Hacıqabul', 'İmişli',
  'Kürdəmir', 'Lerik', 'Masallı', 'Naftalan', 'Neftçala', 'Oğuz', 'Ordubad', 'Qax',
  'Qazax', 'Qobustan', 'Saatlı', 'Sabirabad', 'Şabran', 'Salyan', 'Şamaxı', 'Samux',
  'Şəmkir', 'Şərur', 'Siyəzən', 'Tərtər', 'Tovuz', 'Ucar', 'Xızı', 'Yardımlı',
  'Yevlax', 'Zərdab',
];

export const Footer = ({ className: _className = '' }: FooterProps) => {
  void _className;
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [showAllCities, setShowAllCities] = useState(false);
  const year = new Date().getFullYear();

  const handleSubscribe = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    // TODO: actual newsletter signup endpoint
    setSubscribed(true);
    setEmail('');
    setTimeout(() => setSubscribed(false), 4000);
  };

  return (
    <footer className="relative bg-ink text-white/80 overflow-hidden">
      {/* Decorative gradient orbs */}
      <div aria-hidden className="pointer-events-none absolute -top-20 left-1/4 w-72 h-72 rounded-full bg-brand-600/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 right-1/4 w-96 h-96 rounded-full bg-accent-500/10 blur-3xl" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-6">
        {/* Main columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-8 lg:gap-6 mb-10">
          {/* Brand */}
          <div className="lg:col-span-4">
            <Link to="/" className="inline-flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-brand-gradient flex items-center justify-center shadow-brand-soft">
                <Zap size={20} fill="white" className="text-white" />
              </div>
              <span className="text-xl font-extrabold tracking-tight text-white">
                Ellit<span className="text-accent-300">.az</span>
              </span>
            </Link>
            <p className="text-sm text-white/70 leading-relaxed mb-5 max-w-sm">
              {t('footer.tagline')}
            </p>

            {/* Social */}
            <div className="flex items-center gap-2">
              <SocialLink
                href="https://www.facebook.com/profile.php?id=61575849291278"
                label="Facebook"
                icon={<Facebook size={16} />}
              />
              <SocialLink
                href="https://www.instagram.com/ellit.az/"
                label="Instagram"
                icon={<Instagram size={16} />}
              />
              <SocialLink
                href="mailto:support@ellit.az"
                label="Email"
                icon={<Mail size={16} />}
              />
              <SocialLink
                href="tel:+994709390106"
                label="Phone"
                icon={<Phone size={16} />}
              />
            </div>
          </div>

          {/* Quick links */}
          <div className="lg:col-span-2">
            <FooterColTitle>{t('footer.quickLinks')}</FooterColTitle>
            <ul className="space-y-2">
              <li><FooterLink to="/services">{t('footer.services')}</FooterLink></li>
              <li><FooterLink to="/providers">{t('footer.providers')}</FooterLink></li>
              <li><FooterLink to="/brigades">{t('footer.brigades')}</FooterLink></li>
              <li><FooterLink to="/about">{t('footer.about')}</FooterLink></li>
            </ul>
          </div>

          {/* Support */}
          <div className="lg:col-span-2">
            <FooterColTitle>{t('footer.support')}</FooterColTitle>
            <ul className="space-y-2">
              <li>
                <a
                  href="mailto:support@ellit.az"
                  className="text-sm text-white/70 hover:text-white inline-flex items-center gap-1.5 transition-colors"
                >
                  <Mail size={12} />
                  support@ellit.az
                </a>
              </li>
              <li>
                <a
                  href="tel:+994709390106"
                  className="text-sm text-white/70 hover:text-white inline-flex items-center gap-1.5 transition-colors"
                >
                  <Phone size={12} />
                  +994 70 939 01 06
                </a>
              </li>
              <li><FooterLink to="/privacy">{t('footer.privacy')}</FooterLink></li>
              <li><FooterLink to="/about">{t('footer.faq')}</FooterLink></li>
            </ul>
          </div>

          {/* Newsletter */}
          <div className="lg:col-span-4">
            <FooterColTitle>{t('footer.newsletter.title')}</FooterColTitle>
            <p className="text-sm text-white/70 mb-3 leading-relaxed">
              {t('footer.newsletter.body')}
            </p>
            <form onSubmit={handleSubscribe} className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('footer.newsletter.placeholder')}
                  className="flex-1 h-11 px-4 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-brand-400 focus:bg-white/15 transition-colors"
                />
                <button
                  type="submit"
                  className="h-11 px-4 rounded-xl bg-brand-gradient text-white font-bold text-sm inline-flex items-center justify-center gap-1.5 shadow-brand-soft hover:shadow-brand transition-shadow"
                  aria-label={t('footer.newsletter.subscribe')}
                >
                  <Send size={14} />
                  <span className="hidden sm:inline">{t('footer.newsletter.subscribe')}</span>
                </button>
              </div>
              {subscribed && (
                <p className="text-xs text-success font-bold animate-fade-in">
                  ✓ {t('footer.newsletter.subscribed')}
                </p>
              )}
            </form>

            {/* App download */}
            <div className="mt-6">
              <FooterColTitle>{t('footer.downloadApp')}</FooterColTitle>
              <div className="flex gap-2 flex-wrap">
                <AppStoreBadge
                  href="https://apps.apple.com/az/app/ellit-az/id6770102709"
                  store="App Store"
                />
                <AppStoreBadge
                  href="https://play.google.com/store/apps/details?id=asifdev.ellit_booking"
                  store="Google Play"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Cities */}
        <div className="border-t border-white/10 pt-8 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold uppercase tracking-wide text-white/60 inline-flex items-center gap-2">
              <MapPin size={14} />
              {t('footer.popularCities')}
            </h4>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {POPULAR_CITIES.map((city) => (
              <CityChip key={city} city={city} />
            ))}
            {showAllCities &&
              MORE_CITIES.map((city) => <CityChip key={city} city={city} />)}
          </div>
          <button
            type="button"
            onClick={() => setShowAllCities((v) => !v)}
            className="mt-3 text-xs font-bold text-brand-300 hover:text-brand-200 inline-flex items-center gap-1 transition-colors"
          >
            {showAllCities ? t('footer.showLess') : t('footer.showMore')}
            <ArrowRight size={12} className={showAllCities ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
        </div>

        {/* Bottom */}
        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/50">
          <p>{t('footer.rights', { year })}</p>
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 text-center">
            <p className="inline-flex items-center gap-1">
              {t('footer.madeIn')}
            </p>
            <span className="hidden sm:inline text-white/20">•</span>
            <p className="font-semibold text-white/60">Developt by Asif</p>
          </div>
        </div>
      </div>
    </footer>
  );
};

// ── Sub-components ────────────────────────────────────────────────────

function FooterColTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-sm font-extrabold uppercase tracking-wide text-white mb-3">
      {children}
    </h4>
  );
}

function FooterLink({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="text-sm text-white/70 hover:text-white transition-colors inline-block"
    >
      {children}
    </Link>
  );
}

function SocialLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  const isExternal = href.startsWith('http');
  return (
    <a
      href={href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      aria-label={label}
      className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/15 hover:text-white flex items-center justify-center transition-colors"
    >
      {icon}
    </a>
  );
}

function CityChip({ city }: { city: string }) {
  return (
    <Link
      to={`/services?location=${encodeURIComponent(city)}`}
      className="px-3 py-1 rounded-md bg-white/5 hover:bg-brand-600 text-xs text-white/70 hover:text-white border border-white/10 hover:border-brand-600 transition-all"
    >
      {city}
    </Link>
  );
}

function AppStoreBadge({
  href,
  store,
}: {
  href: string;
  store: 'App Store' | 'Google Play';
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 hover:border-white/20 transition-all"
      aria-label={store}
    >
      {store === 'App Store' ? (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" className="text-white">
          <path d="M17.564 12.79c-.024-2.41 1.97-3.564 2.06-3.62-1.124-1.643-2.873-1.868-3.494-1.894-1.486-.151-2.903.876-3.658.876-.756 0-1.92-.854-3.157-.83-1.624.024-3.122.943-3.957 2.394-1.687 2.928-.43 7.262 1.21 9.638.804 1.166 1.762 2.474 3.02 2.428 1.214-.05 1.673-.785 3.143-.785 1.469 0 1.881.785 3.157.76 1.305-.024 2.131-1.186 2.927-2.357.92-1.353 1.297-2.66 1.32-2.728-.029-.013-2.534-.973-2.57-3.882zM15.13 5.33c.668-.81 1.12-1.93.996-3.05-.962.04-2.13.642-2.82 1.45-.62.71-1.16 1.85-1.014 2.94 1.073.083 2.17-.546 2.838-1.34z" />
        </svg>
      ) : (
        <svg width={18} height={18} viewBox="0 0 512 512" aria-hidden>
          <path fill="#34A853" d="M325.3 234.3 104.6 13.5l257.4 148.2-36.7 72.6z" />
          <path fill="#FBBC04" d="m467.3 271.2-79.3 45.7-43.5-43.5 43.5-43.5 79.3 45.5c8 4.6 8 16.3 0 21z" />
          <path fill="#EA4335" d="M104.6 498.5 325.3 277.7l36.7 72.6-257.4 148.2z" />
          <path fill="#4285F4" d="M104.6 13.5c-3.7 0-7 1.4-9.5 4-2.7 2.6-4.1 6-4.1 9.7v457.6c0 3.7 1.4 7.1 4.1 9.7 2.5 2.6 5.8 4 9.5 4l263.6-242.5L104.6 13.5z" />
        </svg>
      )}
      <div className="text-left leading-tight">
        <div className="text-[9px] text-white/60 font-medium">
          {store === 'App Store' ? 'Download on the' : 'Get it on'}
        </div>
        <div className="text-xs font-extrabold text-white">{store}</div>
      </div>
    </a>
  );
}
