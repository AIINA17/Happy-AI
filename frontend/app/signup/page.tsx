"use client";

// Signup page for creating a new user account.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AuthCard from "@/components/AuthCard";
import ConfirmDialog from "@/components/ConfirmDialog";
import { supabase } from "@/lib/supabase";

export default function SignupPage() {
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
                onLogin={async () => {}}
                onSignup={handleSignup}
                initialMode="signup"
                onSwitchModeRoute={() => router.push("/login")}
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
