import { useState } from 'react';
import { Star, X } from 'lucide-react';
import { Button, Card, Field, Textarea } from '../components/ui';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (rating: number, comment: string) => void;
}

export default function ReviewModal({ isOpen, onClose, onSubmit }: ReviewModalProps) {
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    onSubmit(rating, comment);
    setRating(5);
    setComment('');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <Card
        variant="elevated"
        padding="lg"
        className="w-full max-w-md relative"
        // @ts-expect-error pass-through
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-surface-bg hover:bg-brand-50 flex items-center justify-center text-muted hover:text-brand-600 transition-colors"
          aria-label="Bağla"
        >
          <X size={18} />
        </button>

        <h2 className="text-xl font-extrabold text-ink mb-1">Xidməti dəyərləndir</h2>
        <p className="text-sm text-muted mb-5">Provayder haqqında rəyini paylaş</p>

        {/* Stars */}
        <div className="mb-5">
          <div className="text-xs uppercase font-bold tracking-wide text-muted mb-2">
            Reytinq
          </div>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((s) => {
              const filled = s <= (hoverRating || rating);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRating(s)}
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="transition-transform hover:scale-110"
                  aria-label={`${s} ulduz`}
                >
                  <Star
                    size={32}
                    className={
                      filled ? 'fill-warning text-warning' : 'text-border'
                    }
                  />
                </button>
              );
            })}
            <span className="ml-3 text-sm font-bold text-ink-soft">
              {rating}/5
            </span>
          </div>
        </div>

        <Field label="Rəyiniz">
          <Textarea
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Xidmət haqqında düşüncələrinizi yazın..."
          />
        </Field>

        <div className="mt-2 flex flex-col-reverse sm:flex-row gap-3">
          <Button variant="outline" size="lg" onClick={onClose} fullWidth>
            Ləğv et
          </Button>
          <Button variant="primary" size="lg" onClick={handleSubmit} fullWidth>
            Təsdiqlə
          </Button>
        </div>
      </Card>
    </div>
  );
}
