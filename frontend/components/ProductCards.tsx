"use client";

// Grid of product cards linking to the external e-commerce site.

import Image from "next/image";
import { ExternalLink, MapPin, MessageSquareText, Package } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Product } from "@/types";

interface ProductCardsProps {
  products: Product[];
}

export default function ProductCards({ products }: ProductCardsProps) {
  if (!products || products.length === 0) return null;

    // Keyed by source+id, not just id — two different stores can hand out
    // the same numeric product id for unrelated products.
    const uniqueProducts = Array.from(
        new Map(products.map((p) => [`${p.source ?? ""}-${p.id}`, p])).values(),
    );

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(price);
  };

    return (
        <div className="w-full">
            {/* Header */}
            <div className="mb-3">
                <div className="flex items-center gap-2 text-md font-medium text-foreground">
                    <Package className="w-5 h-5" />
                    <span>{uniqueProducts.length} Product(s) Found</span>
                </div>
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-2 gap-3">
                {uniqueProducts.map((product) => (
                    <Card
                        key={`${product.source ?? ""}-${product.id}`}
                        className="py-0 gap-0 overflow-hidden hover:shadow-md transition-all">
                        {/* Image */}
                        <div className="relative aspect-square bg-muted overflow-hidden">
                            {product.image_url ? (
                                <Image
                                    src={product.image_url}
                                    alt={product.name}
                                    fill
                                    className="object-cover"
                                    sizes="(max-width: 768px) 50vw, 25vw"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                    <Package className="w-12 h-12" strokeWidth={1} />
                                </div>
                            )}
                            {product.source_label && (
                                <Badge className="absolute top-2 left-2" variant="default">
                                    {product.source_label}
                                </Badge>
                            )}
                        </div>

                        {/* Content */}
                        <div className="p-3 flex flex-col">
                            {product.category && (
                                <Badge variant="secondary" className="mb-2 w-fit">
                                    {product.category}
                                </Badge>
                            )}

                            <h3 className="text-sm font-semibold text-foreground mb-2 line-clamp-2 leading-tight">
                                {product.name}
                            </h3>

                            {product.store && (
                                <div className="flex items-start gap-1 mb-2 text-[0.7rem]">
                                    <MapPin className="w-3 h-3 flex-shrink-0 mt-0.5 text-muted-foreground" />
                                    <div className="min-w-0 flex-1 leading-tight">
                                        <div className="truncate text-foreground font-medium">
                                            {product.store.name}
                                        </div>
                                        {product.store.city && (
                                            <div className="truncate text-muted-foreground">
                                                {product.store.city}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex items-baseline gap-1.5 mb-2">
                                <span className="text-base font-bold text-foreground">
                                    {formatPrice(product.price)}
                                </span>
                            </div>

                            {product.stock !== undefined && (
                                <div className="flex items-center gap-1.5 mb-3">
                                    {product.stock > 0 ? (
                                        <>
                                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                            <span className="text-[0.7rem] text-green-500 font-medium">
                                                Tersedia
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                            <span className="text-[0.7rem] text-red-500 font-medium">
                                                Habis
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* CTA — explicit link to the external e-commerce
                                product page. Previously the whole card was a
                                Link; now the button is the only click target
                                so the user intent is obvious. */}
                            {product.link ? (
                                <a
                                    href={product.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full inline-flex items-center justify-center
                                               gap-1.5 h-9 rounded-md
                                               bg-primary text-primary-foreground
                                               text-xs font-semibold
                                               hover:bg-primary/90 active:scale-[0.98]
                                               transition-all cursor-pointer">
                                    <span>Lihat di Toko</span>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                            ) : (
                                <button
                                    disabled
                                    className="w-full inline-flex items-center justify-center
                                               gap-1.5 h-9 rounded-md
                                               bg-muted text-muted-foreground
                                               text-xs font-semibold cursor-not-allowed">
                                    Link tidak tersedia
                                </button>
                            )}
                        </div>
                    </Card>
                ))}
            </div>

            {/* Footer hint */}
            <div className="mt-3 text-xs text-muted-foreground italic flex items-center gap-1">
                <MessageSquareText className="w-4 h-4" />
                Ask for product details or request to add to cart
            </div>
        </div>
    );
}
