"use client";

// Signup page for creating a new user account.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AuthCard from "@/components/AuthCard";
import { supabase } from "@/lib/supabase";

export default function SignupPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);

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
            // Error feedback is handled via the login page flow.
            return;
        }

        if (data.session) {
            router.replace("/");
        }
    };

    if (isLoading) {
        return (
            <main className="h-screen bg-background flex items-center justify-center">
                <div className="text-muted-foreground">Loading...</div>
            </main>
        );
    }

    return (
        <main className="h-screen bg-background flex items-center justify-center p-4">
            <AuthCard
                onLogin={async () => {}}
                onSignup={handleSignup}
                initialMode="signup"
                onSwitchModeRoute={() => router.push("/login")}
            />
        </main>
    );
}
