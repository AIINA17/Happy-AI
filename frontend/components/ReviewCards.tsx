"use client";

import { Star, User } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Review } from "@/types";

interface ReviewCardsProps {
  productName: string;
  reviews: Review[];
}

export default function ReviewCards({
  productName,
  reviews,
}: ReviewCardsProps) {
  if (!reviews || reviews.length === 0) return null;

  const avgRating =
    reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`w-3 h-3 ${
              n <= rating
                ? "fill-yellow-400 text-yellow-400"
                : "fill-muted text-muted-foreground"
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="mt-3 w-full">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-foreground">
          💬 Review untuk <span className="font-semibold">{productName}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
          <span className="font-semibold text-foreground">
            {avgRating.toFixed(1)}
          </span>
          <span>({reviews.length})</span>
        </div>
      </div>

      {/* Reviews list */}
      <div className="flex flex-col gap-2">
        {reviews.map((review) => (
          <Card key={review.id} className="p-3 gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <User className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <span className="text-xs font-medium text-foreground truncate">
                  {review.reviewer_name || "Anonim"}
                </span>
              </div>
              {renderStars(review.rating)}
            </div>

            <p className="text-sm text-foreground leading-relaxed">
              {review.comment}
            </p>

            {review.created_at && (
              <div className="text-[0.65rem] text-muted-foreground">
                {formatDate(review.created_at)}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
