import { useState, useEffect } from "react";
import { Info, X } from "lucide-react"; // X iconunu da əlavə edək
import { motion, AnimatePresence } from "framer-motion";

export const OpportunitiesInfoBanner = () => {
  const [visible, setVisible] = useState(true);

  // Bu vacib bildiriş olduğu üçün avtomatik bağlama funksiyasını silmək məsləhətdir.
  // İstifadəçi özü bağlamalıdır ki, mesajı oxuduğundan əmin olaq.
  // Əgər yenə də avtomatik bağlamaq istəyirsinizsə, aşağıdakı kodu aktivləşdirə bilərsiniz.
  
  useEffect(() => {
    const timeout = setTimeout(() => setVisible(false), 10000); // 10 saniyədən sonra bağlanır
    return () => clearTimeout(timeout);
  }, []);
  

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -60, opacity: 0, scale: 0.8 }} // Yuxarıdan gəlsin, kiçik başlasın
        animate={{ y: 0, opacity: 1, scale: 1 }} // Normal ölçüsünə gəlsin
        exit={{ y: -60, opacity: 0, scale: 0.8 }} // Yuxarı gedərək yoxa çıxsın
        transition={{
          type: "spring",
          stiffness: 150, // Daha "yaylı" effekt
          damping: 15, // Çox sıçramasın
          duration: 0.6,
        }}
        className="fixed top-0 left-0 w-full flex justify-center z-50 px-4 md:px-0" // Responsive padding
      >
        <div
          className="
            flex items-center gap-4
            bg-gradient-to-r from-purple-100 via-blue-100 to-green-100 // Daha yumşaq gradient
            border border-blue-200 text-blue-900
            px-6 py-4 rounded-b-3xl // Daha yuvarlaq künclər
            shadow-2xl // Daha dərin kölgə
            font-semibold
            max-w-xl text-center md:text-left // Mərkəzləşdirilmiş mətn və max-width
            relative // X düyməsi üçün
            overflow-hidden // Animasiyalar kənara çıxmasın
            group // Hover effekti üçün
          "
          style={{
            // Custom pulse animation for a subtle glow, instead of the default `animate-pulse`
            // which can be too aggressive for a static banner.
            animation: "subtle-glow 3s infinite alternate cubic-bezier(0.4, 0, 0.6, 1)",
          }}
        >
          {/* Custom pulse glow */}
          <style>
            {`
              @keyframes subtle-glow {
                0% { box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1), 0 0 0px rgba(79, 70, 229, 0.2); }
                100% { box-shadow: 0 12px 25px rgba(0, 0, 0, 0.15), 0 0 15px rgba(79, 70, 229, 0.4); }
              }
              /* Custom bounce for the icon */
              @keyframes gentle-bounce {
                0%, 100% {
                  transform: translateY(-5%);
                  animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
                }
                50% {
                  transform: translateY(0);
                  animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
                }
              }
              .animate-gentle-bounce {
                animation: gentle-bounce 2s infinite; // Daha yavaş və zərif sıçrama
              }
            `}
          </style>

          {/* Background overlay for hover shine */}
          <span className="
            absolute inset-0
            bg-gradient-to-r from-transparent via-white to-transparent
            opacity-0 group-hover:opacity-10
            transition-opacity duration-300
            transform -skew-x-12 scale-x-150
          "></span>

          <Info className="h-7 w-7 text-blue-500 flex-shrink-0 animate-gentle-bounce" /> {/* Daha böyük icon */}

          <div className="flex flex-col items-center sm:items-start flex-grow">
            <p className="text-base leading-relaxed">
              Fürsətlər sizə <b className="text-blue-700">müştərilər</b> tərəfindən gəlir və etdiyiniz{" "}
              <b className="text-blue-700">təkliflər</b> müştəri tərəfindən dəyərləndirilir.{" "}
              <br className="hidden sm:inline" /> {/* Mətnin dağılmaması üçün */}
              <span className="font-extrabold text-blue-800 text-lg block mt-1">
                Təklifi buna nəzərə alaraq verin!
              </span>
            </p>
          </div>

          <button
            onClick={() => setVisible(false)}
            className="
              absolute top-2 right-2
              text-blue-500 hover:text-blue-700
              transition-all duration-200
              rounded-full p-1
              hover:bg-blue-100
              focus:outline-none focus:ring-2 focus:ring-blue-300
            "
            aria-label="Bildirişi Bağla"
          >
            <X className="h-5 w-5" /> {/* Daha səliqəli X ikonu */}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};