"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    MapPin,
    Package,
    Star,
} from "lucide-react";

import { Product, Review } from "@/types";
import ReviewCards from "./ReviewCards";

interface ProductCarouselProps {
    products: Product[];
    activeIndex?: number;
    onActiveChange?: (index: number) => void;
    // When the agent displays reviews for a product, we pass them here so
    // the active card can animate up/shrink to make room for the reviews
    // panel. Match is by product name.
    reviewsForProduct?: {
        productName: string;
        reviews: Review[];
    } | null;
}

export default function ProductCarousel({
    products,
    activeIndex: controlledIndex,
    onActiveChange,
    reviewsForProduct,
}: ProductCarouselProps) {
    const [internalIndex, setInternalIndex] = useState(0);
    const activeIndex = controlledIndex ?? internalIndex;

    // Reset to first card whenever the product list identity changes
    const prevIdsRef = useRef<string>("");
    useEffect(() => {
        const ids = products.map((p) => p.id).join(",");
        if (ids !== prevIdsRef.current) {
            prevIdsRef.current = ids;
            setInternalIndex(0);
            onActiveChange?.(0);
        }
    }, [products, onActiveChange]);

    const setActive = useCallback(
        (next: number) => {
            const clamped = Math.max(0, Math.min(products.length - 1, next));
            if (controlledIndex === undefined) setInternalIndex(clamped);
            onActiveChange?.(clamped);
        },
        [products.length, controlledIndex, onActiveChange],
    );

    const goPrev = () => setActive(activeIndex - 1);
    const goNext = () => setActive(activeIndex + 1);

    // ================= SWIPE =================
    const touchStartXRef = useRef<number | null>(null);
    const touchStartYRef = useRef<number | null>(null);
    const [dragOffset, setDragOffset] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartXRef.current = e.touches[0].clientX;
        touchStartYRef.current = e.touches[0].clientY;
    };
    const handleTouchMove = (e: React.TouchEvent) => {
        if (touchStartXRef.current === null) return;
        const dx = e.touches[0].clientX - touchStartXRef.current;
        const dy = e.touches[0].clientY - (touchStartYRef.current ?? 0);
        if (Math.abs(dx) > Math.abs(dy)) {
            setIsDragging(true);
            setDragOffset(dx);
        }
    };
    const handleTouchEnd = () => {
        if (Math.abs(dragOffset) > 60) {
            if (dragOffset < 0) goNext();
            else goPrev();
        }
        setDragOffset(0);
        setIsDragging(false);
        touchStartXRef.current = null;
        touchStartYRef.current = null;
    };

    // ================= KEYBOARD =================
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") goPrev();
            else if (e.key === "ArrowRight") goNext();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeIndex, products.length]);

    if (!products || products.length === 0) return null;

    // Check whether we have fresh reviews that match the ACTIVE product's
    // name. When yes, we animate the card smaller/higher to open space for
    // the reviews panel below.
    const activeProduct = products[activeIndex];
    const showReviewsPanel =
        !!reviewsForProduct &&
        reviewsForProduct.reviews.length > 0 &&
        activeProduct &&
        reviewsForProduct.productName.toLowerCase().includes(
            activeProduct.name.toLowerCase().slice(0, 15),
        );

    return (
        <div
            className="relative w-full h-full flex flex-col items-center justify-center select-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}>
            {/* Prev chevron (always visible so laptop users don't need to swipe) */}
            {activeIndex > 0 && (
                <button
                    onClick={goPrev}
                    aria-label="Previous product"
                    className="absolute left-1 sm:left-2 md:left-6 z-40
                               w-11 h-11 rounded-full
                               bg-foreground text-background
                               shadow-xl flex items-center justify-center
                               hover:scale-110 active:scale-95
                               transition-all cursor-pointer">
                    <ChevronLeft size={22} />
                </button>
            )}

            {/* Next chevron (always visible) */}
            {activeIndex < products.length - 1 && (
                <button
                    onClick={goNext}
                    aria-label="Next product"
                    className="absolute right-1 sm:right-2 md:right-6 z-40
                               w-11 h-11 rounded-full
                               bg-foreground text-background
                               shadow-xl flex items-center justify-center
                               hover:scale-110 active:scale-95
                               transition-all cursor-pointer">
                    <ChevronRight size={22} />
                </button>
            )}

            {/* Card stack — shrinks SLIGHTLY when reviews panel is open so
                product photos stay large and readable. Minor scale-down keeps
                visual hierarchy clear without hiding the image. */}
            <div
                className={`relative w-full max-w-[340px]
                           transition-all duration-500 ease-out
                           ${
                               showReviewsPanel
                                   ? "h-[460px] -translate-y-2 scale-[0.95]"
                                   : "h-[520px] translate-y-0 scale-100"
                           }`}>
                {products.map((product, idx) => {
                    const distance = idx - activeIndex;
                    const absDist = Math.abs(distance);
                    // Only render the active card plus one on each side.
                    // Previously we drew up to 2 neighbors on each side with
                    // opacity 0.35, which read as "ghost cards" bleeding
                    // through the active one when the user swiped. Dropping
                    // to +/-1 keeps the "peek" preview effect without the
                    // readable text underneath the active card.
                    if (absDist > 1) return null;

                    const isActive = distance === 0;

                    // Base card transform. 42% (was 28) pushes neighbors
                    // further off-center so the active card stands alone
                    // instead of visually overlapping with its siblings.
                    let translateX = distance * 42; // percentage of card width
                    const scale = 1 - absDist * 0.1;
                    // Non-active cards are now much more faded so their
                    // text/image stop bleeding through the foreground card.
                    // 0.08 is low enough that peripheral card text/image
                    // doesn't read through as "ghost cards" bleeding into
                    // the active one (user complaint: "produk card masih
                    // ngebekas pas digeser"). We also push them further
                    // out (translateX multiplier below) to further reduce
                    // perceived overlap.
                    const opacity = isActive ? 1 : 0.08;
                    const zIndex = 20 - absDist;

                    // Follow drag on the active card
                    if (isActive && isDragging) {
                        translateX = dragOffset / 3; // divide by 3 for subtle drag
                    }

                    return (
                        <div
                            // Composite key: same numeric id can appear
                            // across stores (Toko Oren id=30 + Toko Hijau
                            // id=30), which triggered a React "duplicate
                            // key" warning. Scope by (source, id).
                            key={`${product.source ?? ""}-${product.id}`}
                            className="absolute inset-0 transition-all duration-300 ease-out"
                            style={{
                                transform: `translateX(${translateX}${isActive && isDragging ? "px" : "%"}) scale(${scale})`,
                                opacity,
                                zIndex,
                                transition: isActive && isDragging
                                    ? "none"
                                    : "transform 0.35s ease-out, opacity 0.35s ease-out",
                            }}>
                            <ProductCard
                                product={product}
                                isActive={isActive}
                                index={idx}
                                total={products.length}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Dots indicator */}
            {products.length > 1 && !showReviewsPanel && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-30">
                    {products.map((_, idx) => (
                        <button
                            key={idx}
                            onClick={() => setActive(idx)}
                            aria-label={`Go to product ${idx + 1}`}
                            className={`h-1.5 rounded-full transition-all cursor-pointer
                                ${
                                    idx === activeIndex
                                        ? "w-6 bg-primary"
                                        : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground"
                                }`}
                        />
                    ))}
                </div>
            )}

            {/* Reviews panel — slides in from below when agent displays
                reviews for the active product. Compact height so the product
                card (with its photo) still gets the majority of screen
                real-estate. */}
            {showReviewsPanel && reviewsForProduct && (
                <div
                    className="w-full max-w-[420px] px-4 mt-3
                               animate-in slide-in-from-bottom-4 fade-in duration-500
                               max-h-[180px] overflow-y-auto
                               rounded-xl bg-background/60 backdrop-blur-sm">
                    <ReviewCards
                        productName={reviewsForProduct.productName}
                        reviews={reviewsForProduct.reviews}
                    />
                </div>
            )}
        </div>
    );
}

/* ================= PRODUCT CARD ================= */

function ProductCard({
    product,
    isActive,
    index,
    total,
}: {
    product: Product;
    isActive: boolean;
    index: number;
    total: number;
}) {
    // Image gallery: use `images` array if provided by backend, else fall
    // back to the single `image_url` so this still works with legacy data.
    const images = (() => {
        const list = (product as Product & { images?: string[] }).images;
        if (Array.isArray(list) && list.length > 0) return list;
        if (product.image_url) return [product.image_url];
        return [];
    })();

    const [currentImage, setCurrentImage] = useState(0);
    const [isHovering, setIsHovering] = useState(false);
    // Track which product this component is currently showing so we can
    // reset currentImage back to 0 during RENDER (not inside an effect)
    // when the product swaps. Doing the reset inside useEffect causes
    // "setState in effect" lint error and triggers a cascading render.
    const prevProductIdRef = useRef(product.id);
    if (prevProductIdRef.current !== product.id) {
        prevProductIdRef.current = product.id;
        setCurrentImage(0);
    }

    // Auto-rotate images every 1 second (only when active & more than one image)
    useEffect(() => {
        if (!isActive) return;
        if (images.length <= 1) return;
        if (isHovering) return; // pause rotation while user is interacting
        const id = setInterval(() => {
            setCurrentImage((prev) => (prev + 1) % images.length);
        }, 1000);
        return () => clearInterval(id);
    }, [isActive, images.length, isHovering]);

    const nextImage = () =>
        setCurrentImage((prev) => (prev + 1) % Math.max(1, images.length));
    const prevImage = () =>
        setCurrentImage(
            (prev) => (prev - 1 + images.length) % Math.max(1, images.length),
        );

    // Image swipe
    const imageTouchStartX = useRef<number | null>(null);
    const handleImageTouchStart = (e: React.TouchEvent) => {
        e.stopPropagation(); // don't trigger card swipe
        imageTouchStartX.current = e.touches[0].clientX;
    };
    const handleImageTouchEnd = (e: React.TouchEvent) => {
        if (imageTouchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - imageTouchStartX.current;
        if (Math.abs(dx) > 40) {
            if (dx < 0) nextImage();
            else prevImage();
        }
        imageTouchStartX.current = null;
    };

    const price = Number(product.price) || 0;
    const formattedPrice = new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
    }).format(price);

    return (
        <div
            className="h-full w-full rounded-3xl bg-card
                       border border-border/60 shadow-2xl shadow-black/40
                       overflow-hidden flex flex-col">
            {/* Header mini */}
            <div className="px-5 pt-4 pb-1 flex items-center justify-between">
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    E-Commerce
                </div>
                <div className="text-[0.65rem] text-muted-foreground font-medium">
                    {index + 1} / {total}
                </div>
            </div>

            {/* Image area */}
            <div
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                onTouchStart={handleImageTouchStart}
                onTouchEnd={handleImageTouchEnd}
                className="relative mx-5 mt-2 aspect-square rounded-2xl
                           bg-muted overflow-hidden group">
                {images.length > 0 ? (
                    <>
                        {images.map((src, i) => (
                            <Image
                                key={`${src}-${i}`}
                                src={src}
                                alt={`${product.name} ${i + 1}`}
                                fill
                                className={`object-cover transition-opacity duration-500
                                    ${i === currentImage ? "opacity-100" : "opacity-0"}`}
                                sizes="(max-width: 640px) 280px, 320px"
                                priority={i === 0 && isActive}
                            />
                        ))}

                        {/* Prev/Next image buttons (only on hover or when touched) */}
                        {images.length > 1 && (
                            <>
                                <button
                                    onClick={prevImage}
                                    aria-label="Previous image"
                                    className="absolute left-1.5 top-1/2 -translate-y-1/2
                                               w-7 h-7 rounded-full bg-black/40
                                               backdrop-blur-sm text-white
                                               opacity-0 group-hover:opacity-100
                                               transition-opacity cursor-pointer
                                               flex items-center justify-center">
                                    <ChevronLeft size={14} />
                                </button>
                                <button
                                    onClick={nextImage}
                                    aria-label="Next image"
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2
                                               w-7 h-7 rounded-full bg-black/40
                                               backdrop-blur-sm text-white
                                               opacity-0 group-hover:opacity-100
                                               transition-opacity cursor-pointer
                                               flex items-center justify-center">
                                    <ChevronRight size={14} />
                                </button>

                                {/* Image dots indicator */}
                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2
                                                flex gap-1">
                                    {images.map((_, i) => (
                                        <div
                                            key={i}
                                            className={`h-1 rounded-full transition-all
                                                ${
                                                    i === currentImage
                                                        ? "w-4 bg-white"
                                                        : "w-1 bg-white/50"
                                                }`}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Package size={48} strokeWidth={1} />
                    </div>
                )}
            </div>

            {/* Info list */}
            <div className="flex-1 px-6 pt-4 pb-5 flex flex-col gap-2.5 text-sm">
                {/* Name */}
                <div className="flex items-start gap-2">
                    <span className="text-muted-foreground mt-1">•</span>
                    <span className="font-semibold text-foreground leading-tight line-clamp-2">
                        {product.name}
                    </span>
                </div>

                {/* Category */}
                {product.category && (
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground text-xs">
                            {product.category}
                        </span>
                    </div>
                )}

                {/* Price */}
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span className="font-bold text-foreground text-base">
                        {formattedPrice}
                    </span>
                </div>

                {/* Store */}
                {product.store && (
                    <div className="flex items-start gap-2">
                        <span className="text-muted-foreground mt-0.5">•</span>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-foreground text-xs">
                                {product.store.name}
                            </div>
                            {product.store.city && (
                                <div className="flex items-center gap-1 text-muted-foreground text-[0.7rem] mt-0.5">
                                    <MapPin size={10} />
                                    {product.store.city}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Rating + Stock */}
                <div className="flex items-center gap-3 pt-1">
                    {typeof product.rating === "number" && product.rating > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Star
                                size={12}
                                className="fill-yellow-400 text-yellow-400"
                            />
                            <span>{product.rating.toFixed(1)}</span>
                        </div>
                    )}
                    {typeof product.stock === "number" && (
                        <div
                            className={`flex items-center gap-1 text-xs
                                ${product.stock > 0 ? "text-emerald-500" : "text-rose-500"}`}>
                            <span
                                className={`w-1.5 h-1.5 rounded-full
                                    ${product.stock > 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                            />
                            {product.stock > 0 ? "Tersedia" : "Habis"}
                        </div>
                    )}
                </div>

                {/* CTA — direct link to the external e-commerce product
                    page. Only visible on the active (focused) card to avoid
                    the stacked, out-of-focus cards behind it bleeding tap
                    targets. */}
                {isActive && (
                    <div className="pt-2 mt-auto">
                        {product.link ? (
                            <a
                                href={product.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full inline-flex items-center justify-center
                                           gap-2 h-10 rounded-xl
                                           bg-primary text-primary-foreground
                                           text-sm font-semibold
                                           hover:bg-primary/90 active:scale-[0.98]
                                           transition-all cursor-pointer
                                           shadow-md">
                                <span>Lihat di Toko</span>
                                <ExternalLink size={14} />
                            </a>
                        ) : (
                            <button
                                disabled
                                className="w-full inline-flex items-center justify-center
                                           gap-2 h-10 rounded-xl
                                           bg-muted text-muted-foreground
                                           text-sm font-semibold cursor-not-allowed">
                                Link tidak tersedia
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

               