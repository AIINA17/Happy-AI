// Root layout for the Next.js app, configuring fonts and global styles.

import type { Metadata } from "next";
import { Outfit, Space_Grotesk, Geist } from "next/font/google";

import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const outfit = Outfit({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600", "700"],
    variable: "--font-outfit",
});

const spaceGrotesk = Space_Grotesk({
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
    variable: "--font-space",
});

export const metadata: Metadata = {
    title: "Happy - Voice Shopping Assistant",
    description: "Your personal voice-powered shopping assistant",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html
            lang="id"
            className={cn(outfit.variable, spaceGrotesk.variable, "font-sans", geist.variable)}>
            <body className="font-outfit">
                <TooltipProvider>{children}</TooltipProvider>
                <Toaster theme="dark" />
            </body>
        </html>
    );
}
