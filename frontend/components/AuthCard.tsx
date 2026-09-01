"use client";

// Card-style authentication form used for login and signup.

import { FormEvent, useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AuthCardProps {
    onLogin: (email: string, password: string) => Promise<void>;
    onSignup: (email: string, password: string) => Promise<void>;
    initialMode?: "login" | "signup";
    onSwitchModeRoute?: (target: "login" | "signup") => void;
}

export default function AuthCard({
    onLogin,
    onSignup,
    initialMode = "login",
    onSwitchModeRoute,
}: AuthCardProps) {
    const [mode, setMode] = useState<"login" | "signup">(initialMode);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            if (mode === "login") {
                await onLogin(email, password);
            } else {
                await onSignup(email, password);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const switchMode = () => {
        const target = mode === "login" ? "signup" : "login";

        if (onSwitchModeRoute) {
            onSwitchModeRoute(target);
            return;
        }

        setMode(target);
        setEmail("");
        setPassword("");
    };

    return (
        <div className="w-full max-w-md animate-fadeIn">
            <div className="flex items-center justify-center gap-3 mb-8">
                <Image
                    src="/icons/Happy_Polos.png"
                    alt="Happy"
                    width={48}
                    height={48}
                    className="object-contain"
                />
                <h1 className="font-outfit text-4xl font-bold text-primary">
                    Happy
                </h1>
            </div>

            <Card className="shadow-2xl">
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor="auth-email">Email</Label>
                            <Input
                                id="auth-email"
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                required
                                className="h-12 rounded-xl px-4 text-base"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="auth-password">Password</Label>
                            <div className="relative">
                                <Input
                                    id="auth-password"
                                    type={showPassword ? "text" : "password"}
                                    autoComplete={
                                        mode === "login"
                                            ? "current-password"
                                            : "new-password"
                                    }
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                    placeholder="••••••••"
                                    required
                                    minLength={6}
                                    className="h-12 rounded-xl px-4 pr-12 text-base"
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowPassword(!showPassword)
                                    }
                                    className="absolute right-4 top-1/2 -translate-y-1/2
                                    text-muted-foreground hover:text-foreground
                                    transition-colors cursor-pointer">
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <div className="text-center text-sm">
                            <span className="text-muted-foreground">
                                {mode === "login"
                                    ? "Don't have an account yet? "
                                    : "Already have an account? "}
                            </span>
                            <button
                                type="button"
                                onClick={switchMode}
                                className="text-primary hover:underline font-medium cursor-pointer">
                                {mode === "login" ? "Sign up" : "Sign in"}
                            </button>
                        </div>

                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="w-full h-12 rounded-full text-base font-semibold">
                            {isLoading
                                ? "Loading..."
                                : mode === "login"
                                  ? "Login"
                                  : "Sign up"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
