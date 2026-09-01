"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MoreVertical, Pencil, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import SoundWave from "./SoundWave";
import ConfirmDialog from "./ConfirmDialog";

const ENROLLMENT_TEXTS = [
  "Kami putra dan putri Indonesia, mengaku bertumpah darah yang satu, tanah air Indonesia.",
  "Kami putra dan putri Indonesia, mengaku berbangsa yang satu, bangsa Indonesia.",
  "Kami putra dan putri Indonesia, menjunjung bahasa persatuan, bahasa Indonesia.",
];

const RECORDING_DURATION = 10;

interface VoiceProfile {
  id: string;
  label: string;
  created_at: string;
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

  const [label, setLabel] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [enrolledVoices, setEnrolledVoices] = useState<VoiceProfile[]>([]);
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

  const fetchEnrolledVoices = useCallback(async () => {
    if (!token) return;

    try {
      const res = await fetch(`${SERVER_URL}/enrollments`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const result = await res.json();

      if (result.status === "OK") {
        setEnrolledVoices(result.enrollments || []);
      }
    } catch (err) {
      console.error("Fetch enrollments error:", err);
    }
  }, [token, SERVER_URL]);

  useEffect(() => {
    if (!token) return;

    let isMounted = true;

    (async () => {
      try {
        const res = await fetch(`${SERVER_URL}/enrollments`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const result = await res.json();

        if (isMounted && result.status === "OK") {
          setEnrolledVoices(result.enrollments || []);
        }
      } catch (err) {
        console.error("Initial fetch error:", err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [token, SERVER_URL]);

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

    setVerifyStatus("Uploading enrollment...");

    const form = new FormData();
    form.append("label", label);
    form.append("audio", blob, "enroll.webm");

    try {
      const res = await fetch(`${SERVER_URL}/enroll-voice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const result = await res.json();

      if (result.status === "OK") {
        setVerifyStatus("Enrollment successful!");
        setLabel("");
        setCurrentTextIndex((prev) => (prev + 1) % ENROLLMENT_TEXTS.length);
        setShowEnrollmentList(true);
        await fetchEnrolledVoices();
      } else {
        alert(result.detail || "Enrollment gagal");
      }
    } catch (err) {
      console.error("Upload error:", err);
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

    setIsDeleting(true);
    try {
      const res = await fetch(
        `${SERVER_URL}/enrollments/${deleteDialog.voiceId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const result = await res.json();

      if (result.status === "OK") {
        await fetchEnrolledVoices();
      } else {
        alert(result.detail || "Delete failed");
      }
    } catch (err) {
      console.error("Delete error:", err);
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

    try {
      const res = await fetch(`${SERVER_URL}/speakers/${voiceId}/label`, {
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
      console.error("Rename error:", err);
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
          setDeleteDialog({ isOpen: false, voiceId: null, voiceLabel: "" })
        }
        isLoading={isDeleting}
      />

      {/* Recording Modal */}
      <Dialog
        open={isRecording}
        onOpenChange={(open) => !open && stopEnroll()}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-lg text-center">
          <DialogHeader className="sr-only">
            <DialogTitle>Voice Enrollment Recording</DialogTitle>
          </DialogHeader>

          <div className="text-2xl font-mono text-foreground mb-4">
            00:{countdown.toString().padStart(2, "0")}
          </div>

          <div className="flex justify-center mb-4">
            <SoundWave />
          </div>

          <div className="mb-4">
            <p className="text-base text-muted-foreground mb-2">Text:</p>
            <p className="text-lg text-foreground leading-relaxed font-medium">
              {ENROLLMENT_TEXTS[currentTextIndex]}
            </p>
          </div>

          <Button
            onClick={stopEnroll}
            variant="destructive"
            className="w-full max-w-xs mx-auto">
            <Square size={16} />
            <span>Stop Enroll</span>
          </Button>
        </DialogContent>
      </Dialog>

      {/* Main Sidebar Content */}
      <div className="space-y-3">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label / Nama Speaker"
          disabled={isRecording}
          className="h-11 rounded-lg"
        />

        <Button
          onClick={startEnroll}
          disabled={enrolledVoices.length >= MAX_ENROLLMENTS || isRecording}
          className="w-full h-auto rounded-xl py-3">
          <Mic size={18} />
          <span>Enroll Voice</span>
        </Button>

        {/* Enrollment List */}
        {showEnrollmentList && !isRecording && (
          <div className="p-4 rounded-xl bg-card border border-border/20">
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
                  onSaveEdit={() => handleRenameVoice(voice.id, editingLabel)}
                  onDelete={() => openDeleteDialog(voice.id, voice.label)}
                  inputRef={editInputRef}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                Belum ada voice enrollment
              </p>
            )}

            {enrolledVoices.length < MAX_ENROLLMENTS && (
              <Button
                onClick={startEnroll}
                disabled={isRecording}
                variant="secondary"
                className="w-full mt-3">
                Add new
              </Button>
            )}

            {enrolledVoices.length >= MAX_ENROLLMENTS && (
              <p className="text-xs text-muted-foreground mt-3 text-center">
                You have reached the maximum number of enrollments. Please
                delete an existing one to add new.
              </p>
            )}
          </div>
        )}
      </div>
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
  const renameRef = useRef<HTMLDivElement | null>(null);

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
        <Input
          ref={inputRef}
          type="text"
          value={editingLabel}
          onChange={(e) => onChangeLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSaveEdit();
            if (e.key === "Escape") onCancelEdit();
          }}
          className="h-10"
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancelEdit}>
            Cancel
          </Button>

          <Button
            size="sm"
            onClick={onSaveEdit}
            disabled={!editingLabel.trim()}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-foreground text-sm">{voice.label}</span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-1 rounded hover:bg-muted transition-colors cursor-pointer">
            <MoreVertical size={16} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={onStartEdit}>
            <Pencil />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
