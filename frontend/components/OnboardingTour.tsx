"use client";

// First-run setup wizard — walks a new user through the three things
// Happy needs before it can verify them and shop on their behalf: a voice
// enrollment, a face enrollment, and a linked (dummy) e-commerce account.
// Triggered once per user from Sidebar (localStorage flag), and reopenable
// any time from the account menu as "Panduan Awal".

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Mic, PartyPopper, ScanFace, Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import EcommerceAccountLink from "./EcommerceAccountLink";
import FaceEnrollment from "./FaceEnrollment";
import VoiceEnrollment from "./VoiceEnrollment";
import { DEMO_ACCOUNTS, ECOMMERCE_STORES, linkEcommerceAccount } from "@/lib/ecommerceDemo";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    token: string | null;
    userId: string | null;
}

const TOTAL_TASK_STEPS = 3;

type Step = 0 | 1 | 2 | 3 | 4;

const STEP_TITLES: Record<Step, string> = {
    0: "Selamat Datang di Happy",
    1: "Daftarkan Suara",
    2: "Daftarkan Wajah",
    3: "Hubungkan Akun E-commerce",
    4: "Semua Siap!",
};

export default function OnboardingTour({
    isOpen,
    onClose,
    token,
    userId,
}: Props) {
    const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

    const [step, setStep] = useState<Step>(0);
    // Tracks the previous isOpen so we can reset to step 0 whenever the
    // tour is (re)opened — adjusted during render rather than in an effect,
    // per https://react.dev/learn/you-might-not-need-an-effect.
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) setStep(0);
    }
    const [showEnrollmentList, setShowEnrollmentList] = useState(false);
    const [showEcomDialog, setShowEcomDialog] = useState(false);

    const [voiceDone, setVoiceDone] = useState(false);
    const [faceDone, setFaceDone] = useState(false);
    const [ecomDone, setEcomDone] = useState(false);

    const [isLinkingDemo, setIsLinkingDemo] = useState(false);
    const [demoError, setDemoError] = useState<string | null>(null);

    // VoiceEnrollment/FaceEnrollment expect a status-string setter (used
    // elsewhere to drive a status bar); the tour shows its own progress
    // badges instead, so this is a no-op.
    const noopStatus = useCallback(() => {}, []);

    const checkVoice = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch(`${SERVER_URL}/enrollments`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.status === "OK") {
                setVoiceDone((data.enrollments || []).length > 0);
            }
        } catch {
            // Best-effort status check — ignore network errors.
        }
    }, [token, SERVER_URL]);

    const checkFace = useCallback(async () => {
        if (!userId || !token) return;
        try {
            const res = await fetch(`${SERVER_URL}/face/enroll-face/${userId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return;
            const data = await res.json();
            setFaceDone(!!data.enrolled);
        } catch {
            // Best-effort status check — ignore network errors.
        }
    }, [userId, token, SERVER_URL]);

    const checkEcom = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch(`${SERVER_URL}/ecommerce-account`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.status === "OK") {
                const accounts = data.accounts || {};
                setEcomDone(
                    Object.keys(accounts).some((key) => accounts[key]?.linked),
                );
            }
        } catch {
            // Best-effort status check — ignore network errors.
        }
    }, [token, SERVER_URL]);

    // One-click shortcut: link the pre-seeded demo account on EVERY store
    // at once, no manual typing. Opening the full EcommerceAccountLink
    // dialog is still available for a real account on either store.
    const handleQuickDemoLink = async () => {
        if (!token) return;
        setIsLinkingDemo(true);
        setDemoError(null);

        const results = await Promise.all(
            ECOMMERCE_STORES.map(async (store) => {
                const demo = DEMO_ACCOUNTS[store.key];
                if (!demo) return { store, success: true as const };
                const result = await linkEcommerceAccount(
                    SERVER_URL,
                    token,
                    store.key,
                    demo.username,
                    demo.password,
                );
                return { store, ...result };
            }),
        );

        const failed = results.filter((r) => !r.success);
        if (failed.length > 0) {
            setDemoError(
                failed
                    .map((r) => `${r.store.label}: ${"error" in r ? r.error : "gagal"}`)
                    .join(" · "),
            );
        }
        await checkEcom();
        setIsLinkingDemo(false);
    };

    // Poll all three statuses while the tour is open so the badge on the
    // current step flips to "done" right after the user finishes it in
    // the nested dialog (recording audio, scanning a face, saving an
    // e-commerce account) without needing a manual refresh. The checks run
    // inside timer callbacks (including the first one) rather than as
    // direct calls in the effect body, since all three are async functions
    // that end in a setState call.
    useEffect(() => {
        if (!isOpen) return;
        const tick = () => {
            checkVoice();
            checkFace();
            checkEcom();
        };
        const first = setTimeout(tick, 0);
        const id = setInterval(tick, 2500);
        return () => {
            clearTimeout(first);
            clearInterval(id);
        };
    }, [isOpen, checkVoice, checkFace, checkEcom]);

    const goNext = () => setStep((s) => (s < 4 ? ((s + 1) as Step) : s));
    const goBack = () => setStep((s) => (s > 0 ? ((s - 1) as Step) : s));

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        {STEP_TITLES[step]}
                    </DialogTitle>
                    {step > 0 && step < 4 && (
                        <DialogDescription>
                            Langkah {step} dari {TOTAL_TASK_STEPS}
                        </DialogDescription>
                    )}
                </DialogHeader>

                {step > 0 && step < 4 && (
                    <div className="flex gap-1.5 -mt-2">
                        {Array.from({ length: TOTAL_TASK_STEPS }, (_, i) => i + 1).map(
                            (n) => (
                                <div
                                    key={n}
                                    className={`h-1.5 flex-1 rounded-full ${
                                        n <= step ? "bg-primary" : "bg-muted"
                                    }`}
                                />
                            ),
                        )}
                    </div>
                )}

                {step === 0 && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Sebelum mulai belanja bareng Happy, lengkapi dulu
                            3 hal ini biar verifikasi identitas kamu berjalan
                            lancar setiap kali belanja:
                        </p>
                        <ul className="space-y-2 text-sm">
                            <li className="flex items-center gap-2">
                                <Mic size={16} className="text-primary" />
                                Daftarkan suara kamu
                            </li>
                            <li className="flex items-center gap-2">
                                <ScanFace size={16} className="text-primary" />
                                Daftarkan wajah kamu
                            </li>
                            <li className="flex items-center gap-2">
                                <Store size={16} className="text-primary" />
                                Hubungkan akun e-commerce
                            </li>
                        </ul>
                        <p className="text-xs text-muted-foreground">
                            Semua langkah ini bisa dilewati dan diisi nanti
                            lewat menu akun di pojok kiri bawah.
                        </p>
                        <div className="flex justify-between gap-2 pt-2">
                            <Button variant="ghost" onClick={onClose}>
                                Lewati semua
                            </Button>
                            <Button onClick={goNext}>Mulai</Button>
                        </div>
                    </div>
                )}

                {step === 1 && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Rekam suara kamu mengucapkan kalimat yang akan
                            ditampilkan. Ini dipakai untuk verifikasi
                            identitas kamu setiap mulai sesi belanja.
                        </p>
                        <StatusBadge
                            done={voiceDone}
                            doneLabel="Suara sudah terdaftar"
                            pendingLabel="Belum ada suara terdaftar"
                        />
                        <VoiceEnrollment
                            token={token}
                            setVerifyStatus={noopStatus}
                            showEnrollmentList={showEnrollmentList}
                            setShowEnrollmentList={setShowEnrollmentList}
                        />
                        <StepNav onBack={goBack} onNext={goNext} showBack={false} />
                    </div>
                )}

                {step === 2 && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Daftarkan wajah kamu lewat kamera. Happy pakai
                            ini sebagai lapisan verifikasi tambahan di
                            samping suara.
                        </p>
                        <StatusBadge
                            done={faceDone}
                            doneLabel="Wajah sudah terdaftar"
                            pendingLabel="Belum daftar wajah"
                        />
                        <FaceEnrollment userId={userId} setVerifyStatus={noopStatus} />
                        <StepNav onBack={goBack} onNext={goNext} />
                    </div>
                )}

                {step === 3 && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Happy login ke toko-toko dummy ini atas nama kamu
                            setiap transaksi. Gak punya akun? Pakai tombol
                            demo di bawah buat daftar otomatis di kedua toko
                            sekaligus — gak perlu isi apa-apa.
                        </p>
                        <StatusBadge
                            done={ecomDone}
                            doneLabel="Akun e-commerce terhubung"
                            pendingLabel="Belum ada akun terhubung"
                        />
                        {!ecomDone && (
                            <Button
                                className="w-full"
                                onClick={handleQuickDemoLink}
                                disabled={isLinkingDemo}
                            >
                                <Store size={16} />
                                {isLinkingDemo
                                    ? "Menghubungkan..."
                                    : `Tidak punya akun? Pakai demo di ${ECOMMERCE_STORES.map(
                                          (s) => s.label,
                                      ).join(" & ")}`}
                            </Button>
                        )}
                        {demoError && (
                            <p className="text-xs text-destructive">{demoError}</p>
                        )}
                        <Button
                            className="w-full"
                            variant="secondary"
                            onClick={() => setShowEcomDialog(true)}
                        >
                            Isi akun sendiri / toko lain
                        </Button>
                        <EcommerceAccountLink
                            token={token}
                            isOpen={showEcomDialog}
                            onClose={() => setShowEcomDialog(false)}
                        />
                        <StepNav
                            onBack={goBack}
                            onNext={goNext}
                            nextLabel="Selesai"
                        />
                    </div>
                )}

                {step === 4 && (
                    <div className="space-y-4 text-center py-2">
                        <PartyPopper className="mx-auto text-primary" size={32} />
                        <p className="text-sm text-muted-foreground">
                            Kamu siap mulai belanja bareng Happy. Belum
                            sempat lengkapi semua? Tenang, kamu bisa buka
                            panduan ini lagi atau atur satu-satu lewat menu
                            akun di pojok kiri bawah.
                        </p>
                        <ul className="text-sm space-y-1.5 text-left max-w-xs mx-auto">
                            <StatusLine done={voiceDone} label="Suara" />
                            <StatusLine done={faceDone} label="Wajah" />
                            <StatusLine done={ecomDone} label="Akun e-commerce" />
                        </ul>
                        <Button className="w-full" onClick={onClose}>
                            Mulai Belanja
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function StatusBadge({
    done,
    doneLabel,
    pendingLabel,
}: {
    done: boolean;
    doneLabel: string;
    pendingLabel: string;
}) {
    return (
        <Badge variant={done ? "default" : "outline"} className="h-6 px-2.5">
            {done ? <CheckCircle2 size={12} /> : <Circle size={12} />}
            {done ? doneLabel : pendingLabel}
        </Badge>
    );
}

function StatusLine({ done, label }: { done: boolean; label: string }) {
    return (
        <li className="flex items-center gap-2">
            {done ? (
                <CheckCircle2 size={16} className="text-primary" />
            ) : (
                <Circle size={16} className="text-muted-foreground" />
            )}
            <span className={done ? "text-foreground" : "text-muted-foreground"}>
                {label}
            </span>
        </li>
    );
}

function StepNav({
    onBack,
    onNext,
    showBack = true,
    nextLabel = "Lanjut",
}: {
    onBack: () => void;
    onNext: () => void;
    showBack?: boolean;
    nextLabel?: string;
}) {
    return (
        <div className="flex justify-between gap-2 pt-2">
            {showBack ? (
                <Button variant="ghost" onClick={onBack}>
                    Kembali
                </Button>
            ) : (
                <span />
            )}
            <Button onClick={onNext}>{nextLabel}</Button>
        </div>
    );
}
