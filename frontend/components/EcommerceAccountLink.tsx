"use client";

import { useEffect, useState } from "react";
import { Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
    token: string | null;
    isOpen: boolean;
    onClose: () => void;
}

export default function EcommerceAccountLink({ token, isOpen, onClose }: Props) {
    const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

    const [linked, setLinked] = useState(false);
    const [linkedUsername, setLinkedUsername] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = async () => {
        if (!token) return;
        setIsLoading(true);
        try {
            const res = await fetch(`${SERVER_URL}/ecommerce-account`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.status === "OK") {
                setLinked(data.linked);
                setLinkedUsername(data.username);
                setIsEditing(!data.linked);
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

    const handleSave = async () => {
        if (!token) return;
        if (!username.trim() || !password) {
            setError("Username dan password wajib diisi");
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            const res = await fetch(`${SERVER_URL}/ecommerce-account`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ username: username.trim(), password }),
            });
            const data = await res.json();

            if (res.ok && data.status === "OK") {
                setPassword("");
                await fetchStatus();
            } else {
                setError(data.detail || "Gagal menyimpan akun");
            }
        } catch (err) {
            console.error("Save ecommerce account error:", err);
            setError("Terjadi kesalahan, coba lagi.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleUnlink = async () => {
        if (!token) return;
        setIsSaving(true);
        try {
            await fetch(`${SERVER_URL}/ecommerce-account`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            setLinked(false);
            setLinkedUsername(null);
            setIsEditing(true);
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
                </p>

                {isLoading ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">
                        Memuat...
                    </div>
                ) : linked && !isEditing ? (
                    <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-muted">
                            <p className="text-xs text-muted-foreground mb-1">
                                Terhubung sebagai
                            </p>
                            <p className="text-foreground font-medium">
                                {linkedUsername}
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
                            <Input
                                id="ecom-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                type="password"
                                placeholder="Password"
                            />
                        </div>
                        {error && (
                            <p className="text-xs text-destructive">{error}</p>
                        )}
                        <div className="flex gap-2">
                            {linked && (
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
                                {isSaving ? "Menyimpan..." : "Simpan & Hubungkan"}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
