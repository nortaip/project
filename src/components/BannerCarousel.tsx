import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../lib/supabase';

interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  link_url: string | null;
}

function isExternal(url: string) {
  return /^https?:\/\//i.test(url);
}

/**
 * Ana səhifə reklam karuseli — admin paneldən idarə olunan aktiv bannerlər.
 * Banner yoxdursa heç nə render olunmur (layout-a təsir etmir).
 */
export default function BannerCarousel() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('banners')
        .select('id,title,subtitle,image_url,link_url,is_active,sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      setBanners((data as Banner[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-rotate
  useEffect(() => {
    if (banners.length <= 1) return;
    timer.current = setInterval(() => {
      setIndex((i) => (i + 1) % banners.length);
    }, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [banners.length]);

  if (banners.length === 0) return null;

  const active = banners[index];

  const card = (
    <AnimatePresence mode="wait">
      <motion.div
        key={active.id}
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }}
        transition={{ duration: 0.4 }}
        className="relative w-full aspect-[16/6] sm:aspect-[16/5] rounded-3xl overflow-hidden bg-surface-alt shadow-card"
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${active.image_url})` }}
        />
        {(active.title || active.subtitle) && (
          <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent" />
        )}
        <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-10 max-w-xl">
          {active.title && (
            <h3 className="text-white text-xl sm:text-3xl font-extrabold leading-tight drop-shadow">
              {active.title}
            </h3>
          )}
          {active.subtitle && (
            <p className="mt-2 text-white/90 text-sm sm:text-base font-medium drop-shadow max-w-md">
              {active.subtitle}
            </p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
      {active.link_url ? (
        isExternal(active.link_url) ? (
          <a href={active.link_url} target="_blank" rel="noopener noreferrer" className="block">
            {card}
          </a>
        ) : (
          <Link to={active.link_url} className="block">
            {card}
          </Link>
        )
      ) : (
        card
      )}

      {/* Dots */}
      {banners.length > 1 && (
        <div className="flex justify-center gap-2 mt-3">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              aria-label={`Banner ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`h-2 rounded-full transition-all ${
                i === index ? 'w-6 bg-brand-600' : 'w-2 bg-border hover:bg-brand-300'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
