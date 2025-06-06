import React, { useState } from "react";

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (rating: number, comment: string) => void;
}

// --- Star Rating Component (New) ---
interface StarRatingProps {
  rating: number;
  onRatingChange: (newRating: number) => void;
  maxStars?: number;
}

const StarRating: React.FC<StarRatingProps> = ({ rating, onRatingChange, maxStars = 5 }) => {
  return (
    <div className="flex items-center space-x-1">
      {[...Array(maxStars)].map((_, index) => {
        const starValue = index + 1;
        return (
          <button
            key={starValue}
            type="button"
            className={`text-3xl transition-colors duration-200 ${
              starValue <= rating ? "text-yellow-400" : "text-gray-300 hover:text-yellow-300"
            }`}
            onClick={() => onRatingChange(starValue)}
            aria-label={`${starValue} star rating`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
};
// --- End Star Rating Component ---


const ReviewModal: React.FC<ReviewModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  if (!isOpen) return null;

  const handleSubmit = () => {
    onSubmit(rating, comment);
    // Optionally reset state after submission if you want the modal to be fresh on next open
    setRating(5);
    setComment("");
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-50 p-4">
      <div className="bg-white rounded-xl p-8 w-full max-w-lg shadow-2xl transform transition-all scale-100 opacity-100">
        <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Xidmətə Reytinq Verin</h2>

        <div className="mb-6">
          <label htmlFor="rating" className="block text-gray-700 font-medium text-lg mb-2 text-center">
            Reytinqiniz
          </label>
          <div className="flex justify-center">
            <StarRating rating={rating} onRatingChange={setRating} />
          </div>
          {/* Optional: if you prefer the number input alongside stars or instead of */}
          {/* <input
            id="rating"
            type="number"
            min={1}
            max={5}
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 text-lg"
          /> */}
        </div>

        <div className="mb-8">
          <label htmlFor="comment" className="block text-gray-700 font-medium text-lg mb-2">
            Rəyiniz
          </label>
          <textarea
            id="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 text-base resize-y min-h-[100px]"
            rows={4}
            placeholder="Xidmət haqqında düşüncələrinizi yazın..."
          ></textarea>
        </div>

        <div className="flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-3 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-75"
          >
            Ləğv et
          </button>
          <button
            onClick={handleSubmit}
            className="w-full sm:w-auto px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white"
          >
            Təsdiqlə
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReviewModal;