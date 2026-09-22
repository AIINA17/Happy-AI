"use client";

import {
    useState,
    useEffect,
    useRef,
    useCallback,
    useMemo,
    useSyncExternalStore,
} from "react";
import { MdModeEdit, MdDelete } from "react-icons/md";
import { PiMicrophoneStage } from "react-icons/pi";
import { IoEllipsisVertical } from "react-icons/io5";
import { FaRegCircleStop } from "react-icons/fa6";
import SoundWave from "./SoundWave";
import ConfirmDialog from "./ConfirmDialog";

const ENROLLMENT_TEXTS = [
    "Halo Happy, tolong carikan aku produk laptop yang cocok untuk gaming dengan harga di bawah 10 juta.",
    "Halo Happy, aku mau beli smartphone baru. Tolong rekomendasikan yang kameranya bagus dan harganya terjangkau.",
    "Halo Happy, tolong verifikasi suaraku untuk login ke aplikasi.",
];

const RECORDING_DURATION = 10;

interface VoiceProfile {
    id: string;
    label: string;
    created_at: string;
}

interface EnrollmentsStoreState {
    enrollments: VoiceProfile[];
    loaded: boolean;
    loading: boolean;
    tokenKey: string | null;
}

const INITIAL_ENROLLMENTS_STORE_STATE: EnrollmentsStoreState = {
    enrollments: [],
    loaded: false,
    loading: false,
    tokenKey: null,
};

let enrollmentsStoreState: EnrollmentsStoreState = {
    ...INITIAL_ENROLLMENTS_STORE_STATE,
};

const enrollmentsStoreListeners = new Set<() => void>();

function emitEnrollmentsStoreChange() {
    for (const listener of enrollmentsStoreListeners) listener();
}

function subscribeEnrollmentsStore(listener: () => void) {
    enrollmentsStoreListeners.add(listener);
    return () => enrollmentsStoreListeners.delete(listener);
}

function getEnrollmentsStoreSnapshot() {
    return enrollmentsStoreState;
}

function getEnrollmentsStoreServerSnapshot() {
    return INITIAL_ENROLLMENTS_STORE_STATE;
}

function setEnrollmentsStoreState(
    updater:
        | EnrollmentsStoreState
        | ((prev: EnrollmentsStoreState) => EnrollmentsStoreState),
) {
    enrollmentsStoreState =
        typeof updater === "function"
            ? (
                  updater as (
                      prev: EnrollmentsStoreState,
                  ) => EnrollmentsStoreState
              )(enrollmentsStoreState)
            : updater;
    emitEnrollmentsStoreChange();
}

async function refreshEnrollmentsStore(params: {
    token: string;
    enrollmentsUrl: string;
    signal?: AbortSignal;
}) {
    const { token, enrollmentsUrl, signal } = params;

    setEnrollmentsStoreState((prev) => ({
        ...prev,
        loading: true,
        tokenKey: token,
    }));

    try {
        const res = await fetch(enrollmentsUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal,
        });

        const result = await res.json().catch(() => null);

        if (res.ok && result?.status === "OK") {
            setEnrollmentsStoreState((prev) => ({
                ...prev,
                enrollments: result.enrollments || [],
                loaded: true,
            }));
        } else {
            if (!res.ok) {
                console.error(
                    "[VoiceEnrollment] Fetch enrollments failed:",
                    res.status,
                    result,
                );
            }
            setEnrollmentsStoreState((prev) => ({
                ...prev,
                loaded: true,
            }));
        }
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        throw err;
    } finally {
        setEnrollmentsStoreState((prev) => ({
            ...prev,
            loading: false,
        }));
    }
}

interface Props {
    token: string | null;
    setVerifyStatus: (status: string) => void;
    showEnrollmentList: boolean;
    setShowEnrollmentList: (show: boolean) => void;
}

export default function VoiceEnrollment({
    token,
    setVerifyStatus,
    showEnrollmentList,
    setShowEnrollmentList,
}: Props) {
    const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;
    const MAX_ENROLLMENTS = 3;

    const apiBaseUrl = useMemo(() => {
        const raw = SERVER_URL?.trim();
        if (!raw) return null;
        const normalized = raw.replace(/\/+$/, "");
        if (normalized.startsWith("/")) {
            if (typeof window === "undefined") return null;
            return `${window.location.origin}${normalized}`;
        }

        try {
            // Validate absolute URL
            new URL(normalized);
            return normalized;
        } catch {
            return null;
        }
    }, [SERVER_URL]);

    const buildApiUrl = useCallback(
        (path: string) => {
            if (!apiBaseUrl) return null;
            const normalizedPath = path.startsWith("/") ? path : `/${path}`;
            return `${apiBaseUrl}${normalizedPath}`;
        },
        [apiBaseUrl],
    );

    const logFetchHint = useCallback(
        (endpoint: string, err: unknown) => {
            if (typeof window !== "undefined" && apiBaseUrl) {
                try {
                    const apiUrl = new URL(apiBaseUrl);
                    if (
                        window.location.protocol === "https:" &&
                        apiUrl.protocol === "http:"
                    ) {
                        console.error(
                            `[VoiceEnrollment] Mixed content: page is HTTPS but API is HTTP. '${endpoint}' request will be blocked by the browser. Set NEXT_PUBLIC_SERVER_URL to an https:// URL or serve the site over http:// during dev.`,
                            err,
                        );
                        return;
                    }

                    if (apiUrl.hostname === "backend") {
                        console.error(
                            `[VoiceEnrollment] API hostname is 'backend' (Docker service name). Browsers usually can't resolve that. Set NEXT_PUBLIC_SERVER_URL to something reachable from the browser, e.g. 'http://localhost:8000'.`,
                            err,
                        );
                        return;
                    }
                } catch {
                    // ignore
                }
            }

            console.error(
                `[VoiceEnrollment] Failed to fetch '${endpoint}'. Check NEXT_PUBLIC_SERVER_URL (must be reachable from the browser) and backend CORS settings.`,
                err,
            );
        },
        [apiBaseUrl],
    );

    const enrollmentsStore = useSyncExternalStore(
        subscribeEnrollmentsStore,
        getEnrollmentsStoreSnapshot,
        getEnrollmentsStoreServerSnapshot,
    );

    const [label, setLabel] = useState("");
    const [isRecording, setIsRecording] = useState(false);
    const enrolledVoices =
        token && enrollmentsStore.tokenKey === token
            ? enrollmentsStore.enrollments
            : [];
    const [countdown, setCountdown] = useState(RECORDING_DURATION);
    const [currentTextIndex, setCurrentTextIndex] = useState(0);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingLabel, setEditingLabel] = useState("");
    const [deleteDialog, setDeleteDialog] = useState<{
        isOpen: boolean;
        voiceId: string | null;
        voiceLabel: string;
    }>({ isOpen: false, voiceId: null, voiceLabel: "" });
    const [isDeleting, setIsDeleting] = useState(false);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const editInputRef = useRef<HTMLInputElement | null>(null);

    /* =========================
        FETCH ENROLLMENTS
    ========================== */

    const fetchEnrolledVoices = useCallback(
        async (opts?: { signal?: AbortSignal }) => {
            if (!token) return;

            const url = buildApiUrl("/enrollments");
            if (!url) {
                console.error(
                    "[VoiceEnrollment] NEXT_PUBLIC_SERVER_URL is missing/invalid; skipping enrollments fetch.",
                );
                return;
            }

            try {
                await refreshEnrollmentsStore({
                    token,
                    enrollmentsUrl: url,
                    signal: opts?.signal,
                });
            } catch (err) {
                logFetchHint("/enrollments", err);
            }
        },
        [token, buildApiUrl, logFetchHint],
    );

    useEffect(() => {
        if (!token) return;
        const controller = new AbortController();
        void fetchEnrolledVoices({ signal: controller.signal });
        return () => controller.abort();
    }, [token, fetchEnrolledVoices]);

    /* =========================
        RECORDING
    ========================== */

    const stopEnroll = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (recorderRef.current?.state === "recording") {
            recorderRef.current.stop();
        }
    };

    const startEnroll = async () => {
        if (!token) return alert("Login dulu sebelum enroll");
        if (!label.trim()) return alert("Masukkan nama terlebih dahulu");
        if (enrolledVoices.length >= MAX_ENROLLMENTS)
            return alert("Maksimal 3 enrollment");

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });

            streamRef.current = stream;

            const recorder = new MediaRecorder(stream, {
                mimeType: "audio/webm;codecs=opus",
            });

            recorderRef.current = recorder;
            const chunks: Blob[] = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());
                setIsRecording(false);
                setCountdown(RECORDING_DURATION);

                const blob = new Blob(chunks, {
                    type: "audio/webm;codecs=opus",
                });

                await uploadEnrollment(blob);
            };

            recorder.start();
            setIsRecording(true);
            setVerifyStatus("Recording...");

            timerRef.current = setInterval(() => {
                setCountdown((prev) => {
                    if (prev <= 1) {
                        stopEnroll();
                        return RECORDING_DURATION;
                    }
                    return prev - 1;
                });
            }, 1000);
        } catch (err) {
            console.error(err);
            alert("Mic access failed");
        }
    };

    /* =========================
        UPLOAD
    ========================== */

    const uploadEnrollment = async (blob: Blob) => {
        if (!token) return;

        const url = buildApiUrl("/enroll-voice");
        if (!url) {
            alert(
                "Server URL belum dikonfigurasi. Set NEXT_PUBLIC_SERVER_URL (contoh: http://localhost:8000) di frontend/web/.env",
            );
            return;
        }

        setVerifyStatus("Uploading enrollment...");

        const form = new FormData();
        form.append("label", label);
        form.append("audio", blob, "enroll.webm");

        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: form,
            });

            const result = await res.json();

            if (result.status === "OK") {
                setVerifyStatus("Enrollment successful!");
                setLabel("");
                setCurrentTextIndex(
                    (prev) => (prev + 1) % ENROLLMENT_TEXTS.length,
                );
                setShowEnrollmentList(true);
                await fetchEnrolledVoices();
            } else {
                alert(result.detail || "Enrollment gagal");
            }
        } catch (err) {
            logFetchHint("/enroll-voice", err);
        }
    };

    /* =========================
        DELETE
    ========================== */

    const openDeleteDialog = (voiceId: string, voiceLabel: string) => {
        setDeleteDialog({ isOpen: true, voiceId, voiceLabel });
    };

    const handleDeleteVoice = async () => {
        if (!token || !deleteDialog.voiceId) return;

        const url = buildApiUrl(`/enrollments/${deleteDialog.voiceId}`);
        if (!url) {
            alert(
                "Server URL belum dikonfigurasi. Set NEXT_PUBLIC_SERVER_URL (contoh: http://localhost:8000) di frontend/web/.env",
            );
            return;
        }

        setIsDeleting(true);
        try {
            const res = await fetch(url, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });

            const result = await res.json();

            if (result.status === "OK") {
                await fetchEnrolledVoices();
            } else {
                alert(result.detail || "Delete failed");
            }
        } catch (err) {
            logFetchHint("/enrollments/:id", err);
        } finally {
            setIsDeleting(false);
            setDeleteDialog({ isOpen: false, voiceId: null, voiceLabel: "" });
        }
    };

    /* =========================
       RENAME
    ========================== */

    const handleRenameVoice = async (voiceId: string, newLabel: string) => {
        if (!token || !newLabel.trim()) return;

        const url = buildApiUrl(`/speakers/${voiceId}/label`);
        if (!url) {
            alert(
                "Server URL belum dikonfigurasi. Set NEXT_PUBLIC_SERVER_URL (contoh: http://localhost:8000) di frontend/web/.env",
            );
            return;
        }

        try {
            const res = await fetch(url, {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ label: newLabel.trim() }),
            });

            const result = await res.json();

            if (result.status === "OK") {
                await fetchEnrolledVoices();
                setEditingId(null);
            } else {
                alert(result.detail || "Rename failed");
            }
        } catch (err) {
            logFetchHint("/speakers/:id/label", err);
        }
    };

    return (
        <>
            {/* Delete Enrollment Confirmation Dialog */}
            <ConfirmDialog
                isOpen={deleteDialog.isOpen}
                type="delete"
                title="Delete Voice Profile?"
                message="This will delete voice profile"
                highlightText={deleteDialog.voiceLabel}
                confirmText="Delete"
                cancelText="Cancel"
                onConfirm={handleDeleteVoice}
                onCancel={() =>
                    setDeleteDialog({
                        isOpen: false,
                        voiceId: null,
                        voiceLabel: "",
                    })
                }
                isLoading={isDeleting}
            />

            {/* Main Sidebar Content */}
            <div className="space-y-3">
                <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Label / Nama Speaker"
                    disabled={isRecording}
                    className="w-full px-4 py-3 rounded-lg bg-(--input-bg) 
                               text-(--text-primary) text-sm
                               placeholder:text-(--text-white-50)
                               border-none outline-none
                               focus:ring-2 focus:ring-(--accent-primary)/50
                               disabled:opacity-50"
                />

                <button
                    onClick={startEnroll}
                    disabled={
                        enrolledVoices.length >= MAX_ENROLLMENTS || isRecording
                    }
                    className="w-full px-4 py-3 rounded-xl flex items-center justify-center gap-2 
                               bg-(--accent-primary) text-white font-medium
                               hover:brightness-110 active:scale-[0.98]
                               disabled:opacity-50 disabled:cursor-not-allowed
                               transition-all">
                    <PiMicrophoneStage size={18} />
                    <span>Enroll Voice</span>
                </button>

                {/* Enrollment List */}
                {showEnrollmentList && !isRecording && (
                    <div className="p-4 rounded-xl bg-(--bg-card) border border-(--border-color)/20">
                        {enrolledVoices.length > 0 ? (
                            enrolledVoices.map((voice) => (
                                <VoiceItem
                                    key={voice.id}
                                    voice={voice}
                                    isEditing={editingId === voice.id}
                                    editingLabel={editingLabel}
                                    onStartEdit={() => {
                                        setEditingId(voice.id);
                                        setEditingLabel(voice.label);
                                    }}
                                    onCancelEdit={() => setEditingId(null)}
                                    onChangeLabel={setEditingLabel}
                                    onSaveEdit={() =>
                                        handleRenameVoice(
                                            voice.id,
                                            editingLabel,
                                        )
                                    }
                                    onDelete={() =>
                                        openDeleteDialog(voice.id, voice.label)
                                    }
                                    inputRef={editInputRef}
                                />
                            ))
                        ) : (
                            <p className="text-sm text-(--text-muted) text-center py-2">
                                Belum ada voice enrollment
                            </p>
                        )}

                        {enrolledVoices.length < MAX_ENROLLMENTS && (
                            <button
                                onClick={startEnroll}
                                disabled={isRecording}
                                className="w-full mt-3 px-4 py-2.5 rounded-lg 
                                           bg-(--accent-link) text-white text-sm font-medium
                                           hover:brightness-110 transition-all
                                           disabled:opacity-30 disabled:cursor-not-allowed">
                                Add new
                            </button>
                        )}

                        {enrolledVoices.length >= MAX_ENROLLMENTS && (
                            <p className="text-xs text-(--text-muted) mt-3 text-center">
                                You have reached the maximum number of
                                enrollments. Please delete an existing one to
                                add new.
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* ========== RECORDING POPUP MODAL ========== */}
            {isRecording && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    {/* Backdrop blur */}
                    <div
                        className="absolute inset-0 bg-black/70 backdrop-blur-md"
                        onClick={stopEnroll}
                    />

                    {/* Modal Content */}
                    <div
                        className="relative z-10 w-full max-w-lg mx-4 p-8 rounded-2xl 
                                    bg-(--bg-primary) shadow-2xl animate-fadeIn text-center">
                        {/* Countdown Timer */}
                        <div className="text-2xl font-mono text-(--text-primary) mb-8">
                            00:{countdown.toString().padStart(2, "0")}
                        </div>

                        {/* Sound Wave */}
                        <div className="flex justify-center mb-8">
                            <SoundWave />
                        </div>

                        {/* Text to Read */}
                        <div className="mb-8">
                            <p className="text-lg text-(--text-secondary) mb-2">
                                Text:
                            </p>
                            <p className="text-xl text-(--text-primary) leading-relaxed font-medium">
                                {ENROLLMENT_TEXTS[currentTextIndex]}
                            </p>
                        </div>

                        {/* Stop Button */}
                        <button
                            onClick={stopEnroll}
                            className="w-full max-w-xs mx-auto px-6 py-3 rounded-xl 
                                       bg-(--accent-primary) text-white font-medium
                                       hover:brightness-110 active:scale-[0.98]
                                       transition-all flex items-center justify-center gap-2">
                            <FaRegCircleStop size={18} />
                            <span>Stop Enroll</span>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

interface VoiceItemProps {
    voice: VoiceProfile;
    isEditing: boolean;
    editingLabel: string;
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onChangeLabel: (value: string) => void;
    onSaveEdit: () => void;
    onDelete: () => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
}

function VoiceItem({
    voice,
    isEditing,
    editingLabel,
    onStartEdit,
    onCancelEdit,
    onChangeLabel,
    onSaveEdit,
    onDelete,
    inputRef,
}: VoiceItemProps) {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const renameRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                menuRef.current &&
                !menuRef.current.contains(event.target as Node)
            ) {
                setShowMenu(false);
            }
        };

        if (showMenu) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [showMenu]);

    useEffect(() => {
        if (!isEditing) return;

        const handleClickOutside = (event: MouseEvent) => {
            if (
                renameRef.current &&
                !renameRef.current.contains(event.target as Node)
            ) {
                onCancelEdit();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isEditing, onCancelEdit]);

    if (isEditing) {
        return (
            <div ref={renameRef} className="py-2 space-y-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={editingLabel}
                    onChange={(e) => onChangeLabel(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") onSaveEdit();
                        if (e.key === "Escape") onCancelEdit();
                    }}
                    className="w-full px-3 py-2 rounded-lg
                            bg-(--bg-tertiary)
                            text-(--text-primary) text-sm
                            border border-(--accent-primary)/60
                            focus:ring-2 focus:ring-(--accent-primary)/40
                            outline-none"
                />

                <div className="flex justify-end gap-2">
                    <button
                        onClick={onCancelEdit}
                        className="px-3 py-1.5 text-xs font-medium
                                bg-white/10 hover:bg-white/20
                                text-(--text-secondary) rounded-lg transition">
                        Cancel
                    </button>

                    <button
                        onClick={onSaveEdit}
                        disabled={!editingLabel.trim()}
                        className="px-3 py-1.5 text-xs font-medium
                                bg-(--accent-primary) hover:brightness-110
                                disabled:opacity-40 disabled:cursor-not-allowed
                                text-white rounded-lg transition">
                        Save
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex justify-between items-center py-2">
            <span className="text(--text-primary text-sm">{voice.label}</span>

            <div className="relative">
                <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-1 rounded hover:bg(--bg-tertiary transition-colors">
                    <IoEllipsisVertical className="text(--text-muted" />
                </button>

                {showMenu && (
                    <div
                        ref={menuRef}
                        className="absolute right-0 top-full mt-2 w-36
                                bg(--bg-tertiary
                                border border(--border-color/20
                                rounded-xl
                                shadow-xl
                                overflow-hidden
                                z-50 animate-fadeIn">
                        <button
                            onClick={() => {
                                onStartEdit();
                                setShowMenu(false);
                            }}
                            className="w-full px-4 py-3 flex items-center gap-3
                                    text-sm text(--text-primary
                                    hover:bg(--bg-card
                                    transition-colors">
                            <MdModeEdit className="w-4 h-4 text(--text-secondary)" />
                            <span>Rename</span>
                        </button>

                        <button
                            onClick={() => {
                                onDelete();
                                setShowMenu(false);
                            }}
                            className="w-full px-4 py-3 flex items-center gap-3
                                        text-sm text-red-400
                                        hover:bg-red-500/15
                                        transition-colors">
                            <MdDelete className="w-4 h-4 text-red-400" />
                            <span>Delete</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
