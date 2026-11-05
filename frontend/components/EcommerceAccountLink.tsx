"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEMO_ACCOUNTS, ECOMMERCE_STORES as STORES, linkEcommerceAccount } from "@/lib/ecommerceDemo";

interface Props {
    token: string | null;
    isOpen: boolean;
    onClose: () => void;
}

interface AccountStatus {
    label: string;
    linked: boolean;
    username: string | null;
}

export default function EcommerceAccountLink({
    token,
    isOpen,
    onClose,
}: Props) {
    const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

    const [source, setSource] = useState<(typeof STORES)[number]["key"]>(STORES[0].key);
    const [accounts, setAccounts] = useState<Record<string, AccountStatus>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const current = accounts[source];

    const fetchStatus = async () => {
        if (!token) return;
        setIsLoading(true);
        try {
            const res = await fetch(`${SERVER_URL}/ecommerce-account`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.status === "OK") {
                setAccounts(data.accounts);
            }
        } catch (err) {
            console.error("Fetch ecommerce account error:", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchStatus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, token]);

    useEffect(() => {
        setIsEditing(!current?.linked);
        setError(null);
        setUsername("");
        setPassword("");
        setShowPassword(false);
    }, [source, current?.linked]);

    const saveAccount = async (u: string, p: string) => {
        if (!token) return;
        setIsSaving(true);
        setError(null);
        const result = await linkEcommerceAccount(SERVER_URL, token, source, u, p);
        if (result.success) {
            setPassword("");
            await fetchStatus();
        } else {
            setError(result.error);
        }
        setIsSaving(false);
    };

    const handleSave = () => {
        if (!username.trim() || !password) {
            setError("Username dan password wajib diisi");
            return;
        }
        saveAccount(username, password);
    };

    // One-click shortcut for users who don't have a real account on this
    // store — uses the pre-seeded demo credentials directly, no typing
    // required.
    const handleUseDemoAccount = () => {
        const demo = DEMO_ACCOUNTS[source];
        if (!demo) return;
        setUsername(demo.username);
        setPassword(demo.password);
        saveAccount(demo.username, demo.password);
    };

    const handleUnlink = async () => {
        if (!token) return;
        setIsSaving(true);
        try {
            await fetch(`${SERVER_URL}/ecommerce-account?source=${source}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            await fetchStatus();
            setUsername("");
        } catch (err) {
            console.error("Unlink ecommerce account error:", err);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <Store className="text-primary" size={18} />
                        Akun E-commerce
                    </DialogTitle>
                </DialogHeader>

                <p className="text-sm text-muted-foreground -mt-2">
                    Happy login pakai akun ini setiap kali suara kamu berhasil
                    diverifikasi — bukan akun bersama, ini akun kamu sendiri.
                    Tiap toko punya akunnya masing-masing.
                </p>

                <div className="flex gap-2">
                    {STORES.map((store) => (
                        <Button
                            key={store.key}
                            size="sm"
                            variant={
                                source === store.key ? "default" : "secondary"
                            }
                            className="flex-1"
                            onClick={() => setSource(store.key)}>
                            {store.label}
                            {accounts[store.key]?.linked ? " ✓" : ""}
                        </Button>
                    ))}
                </div>

                {isLoading ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">
                        Memuat...
                    </div>
                ) : current?.linked && !isEditing ? (
                    <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-muted">
                            <p className="text-xs text-muted-foreground mb-1">
                                Terhubung sebagai
                            </p>
                            <p className="text-foreground font-medium">
                                {current.username}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                className="flex-1"
                                onClick={() => setIsEditing(true)}>
                                Ganti akun
                            </Button>
                            <Button
                                variant="destructive"
                                className="flex-1"
                                onClick={handleUnlink}
                                disabled={isSaving}>
                                Putuskan
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {!current?.linked && (
                            <div className="rounded-lg border border-dashed border-border bg-muted/50 p-3 space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    Gak punya akun di{" "}
                                    {STORES.find((s) => s.key === source)?.label}?
                                    Pakai akun demo yang udah disiapkan — gak perlu isi apa-apa.
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    onClick={handleUseDemoAccount}
                                    disabled={isSaving}
                                >
                                    {isSaving
                                        ? "Menghubungkan..."
                                        : `Tidak punya akun? Pakai demo (${DEMO_ACCOUNTS[source]?.username})`}
                                </Button>
                            </div>
                        )}
                        <div className="relative py-1">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-border" />
                            </div>
                            <div className="relative flex justify-center text-xs">
                                <span className="bg-background px-2 text-muted-foreground">
                                    atau isi akun sendiri
                                </span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="ecom-username">
                                Username e-commerce
                            </Label>
                            <Input
                                id="ecom-username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Username e-commerce"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="ecom-password">Password</Label>
                            <div className="relative">
                                <Input
                                    id="ecom-password"
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                    type={
                                        showPassword ? "text" : "password"
                                    }
                                    placeholder="Password"
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowPassword(!showPassword)
                                    }
                                    aria-label={
                                        showPassword
                                            ? "Sembunyikan password"
                                            : "Tampilkan password"
                                    }
                                    className="absolute right-3 top-1/2 -translate-y-1/2
                                    text-muted-foreground hover:text-foreground
                                    transition-colors cursor-pointer">
                                    {showPassword ? (
                                        <EyeOff size={16} />
                                    ) : (
                                        <Eye size={16} />
                                    )}
                                </button>
                            </div>
                        </div>
                        {error && (
                            <p className="text-xs text-destructive">{error}</p>
                        )}
                        <div className="flex gap-2">
                            {current?.linked && (
                                <Button
                                    variant="secondary"
                                    className="flex-1"
                                    onClick={() => {
                                        setIsEditing(false);
                                        setError(null);
                                    }}>
                                    Batal
                                </Button>
                            )}
                            <Button
                                className="flex-1"
                                onClick={handleSave}
                                disabled={isSaving}>
                                {isSaving
                                    ? "Menyimpan..."
                                    : "Simpan & Hubungkan"}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
