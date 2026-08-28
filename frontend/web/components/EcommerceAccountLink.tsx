"use client";

import { useEffect, useState } from "react";
import { MdClose } from "react-icons/md";
import { FaStore } from "react-icons/fa6";

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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-md"
                onClick={onClose}
            />

            <div className="relative z-10 w-full max-w-md mx-4 p-6 rounded-2xl bg-(--bg-primary) shadow-2xl animate-fadeIn">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-(--text-primary)">
                        <FaStore className="text-(--accent-primary)" />
                        <h2 className="text-lg font-semibold">Akun E-commerce</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-(--bg-tertiary) text-(--text-muted) cursor-pointer">
                        <MdClose size={18} />
                    </button>
                </div>

                <p className="text-sm text-(--text-secondary) mb-4">
                    Happy login pakai akun ini setiap kali suara kamu berhasil
                    diverifikasi — bukan akun bersama, ini akun kamu sendiri.
                </p>

                {isLoading ? (
                    <div className="text-sm text-(--text-muted) py-4 text-center">
                        Memuat...
                    </div>
                ) : linked && !isEditing ? (
                    <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-(--bg-card) border border-(--border-color)/20">
                            <p className="text-xs text-(--text-muted) mb-1">
                                Terhubung sebagai
                            </p>
                            <p className="text-(--text-primary) font-medium">
                                {linkedUsername}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setIsEditing(true)}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-(--bg-tertiary) text-(--text-primary) text-sm hover:brightness-110 transition-all cursor-pointer">
                                Ganti akun
                            </button>
                            <button
                                onClick={handleUnlink}
                                disabled={isSaving}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/15 text-red-400 text-sm hover:bg-red-500/25 transition-all disabled:opacity-50 cursor-pointer">
                                Putuskan
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <input
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Username e-commerce"
                            className="w-full px-4 py-3 rounded-lg bg-(--input-bg) text-(--text-primary) text-sm placeholder:text-(--text-white-50) border-none outline-none focus:ring-2 focus:ring-(--accent-primary)/50"
                        />
                        <input
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            type="password"
                            placeholder="Password"
                            className="w-full px-4 py-3 rounded-lg bg-(--input-bg) text-(--text-primary) text-sm placeholder:text-(--text-white-50) border-none outline-none focus:ring-2 focus:ring-(--accent-primary)/50"
                        />
                        {error && (
                            <p className="text-xs text-red-400">{error}</p>
                        )}
                        <div className="flex gap-2">
                            {linked && (
                                <button
                                    onClick={() => {
                                        setIsEditing(false);
                                        setError(null);
                                    }}
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-(--bg-tertiary) text-(--text-primary) text-sm hover:brightness-110 transition-all cursor-pointer">
                                    Batal
                                </button>
                            )}
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-(--accent-primary) text-white text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer">
                                {isSaving ? "Menyimpan..." : "Simpan & Hubungkan"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
