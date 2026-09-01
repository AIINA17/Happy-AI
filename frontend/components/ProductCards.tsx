"use client";

// Grid of product cards linking to the external e-commerce site.

import Image from "next/image";
import Link from "next/link";
import { MessageSquareText, Package } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Product } from "@/types";

interface ProductCardsProps {
    products: Product[];
}

export default function ProductCards({ products }: ProductCardsProps) {
    if (!products || products.length === 0) return null;

    const uniqueProducts = Array.from(
        new Map(products.map((p) => [p.id, p])).values(),
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
                    <Link
                        key={product.id}
                        href={`https://dummy-ecommerce-tau.vercel.app/product/${product.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block">
                        <Card className="py-0 gap-0 overflow-hidden hover:shadow-md transition-all hover:scale-[1.02] cursor-pointer">
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
                            </div>

                            {/* Content */}
                            <div className="p-3">
                                {product.category && (
                                    <Badge variant="secondary" className="mb-2">
                                        {product.category}
                                    </Badge>
                                )}

                                <h3 className="text-sm font-semibold text-foreground mb-2 line-clamp-2 leading-tight">
                                    {product.name}
                                </h3>

                                <div className="flex items-baseline gap-1.5 mb-2">
                                    <span className="text-base font-bold text-foreground">
                                        {formatPrice(product.price)}
                                    </span>
                                </div>

                                {product.stock !== undefined && (
                                    <div className="flex items-center gap-1.5">
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
                            </div>
                        </Card>
                    </Link>
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
