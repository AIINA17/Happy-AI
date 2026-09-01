"use client";

// Login page for user authentication using Supabase.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AuthCard from "@/components/AuthCard";
import ConfirmDialog from "@/components/ConfirmDialog";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [dialog, setDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
    }>({ isOpen: false, title: "", message: "" });

    useEffect(() => {
        const checkSession = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (session) {
                router.replace("/");
            } else {
                setIsLoading(false);
            }
        };

        checkSession();
    }, [router]);

    const handleLogin = async (email: string, password: string) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            setDialog({
                isOpen: true,
                title: "Login gagal",
                message: error.message,
            });
            return;
        }

        // Setelah login sukses, arahkan ke halaman utama
        if (data.session) {
            router.replace("/");
        }
    };

    const handleSignup = async (email: string, password: string) => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });

        if (error) {
            setDialog({
                isOpen: true,
                title: "Signup gagal",
                message: error.message,
            });
            return;
        }

        if (!data.session) {
            setDialog({
                isOpen: true,
                title: "Verifikasi diperlukan",
                message: "Cek email kamu untuk verifikasi akun sebelum login.",
            });
            return;
        }

        // Jika langsung dapat session, masuk ke app
        router.replace("/");
    };

    if (isLoading) {
        return (
            <main className="h-screen bg-background flex items-center justify-center">
                <div className="text-muted-foreground">Loading...</div>
            </main>
        );
    }

    return (
        <main className="h-screen bg-background flex items-center justify-center p-4 relative">
            <AuthCard
                onLogin={handleLogin}
                onSignup={handleSignup}
                onSwitchModeRoute={() => router.push("/signup")}
            />

            <ConfirmDialog
                isOpen={dialog.isOpen}
                type="warning"
                title={dialog.title}
                message={dialog.message}
                confirmText="OK"
                cancelText="Tutup"
                onConfirm={() => setDialog((d) => ({ ...d, isOpen: false }))}
                onCancel={() => setDialog((d) => ({ ...d, isOpen: false }))}
            />
        </main>
    );
}
