import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-6xl font-extrabold text-brand-600 mb-2">404</p>
        <h1 className="text-2xl font-bold text-ink mb-2">Səhifə tapılmadı</h1>
        <p className="text-sm text-muted mb-6">
          Axtardığınız səhifə mövcud deyil və ya köçürülüb.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-5 py-3 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition-colors"
        >
          <Home size={18} /> Ana səhifəyə qayıt
        </Link>
      </div>
    </div>
  );
}
