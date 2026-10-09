"use client";

// Generic confirmation dialog used for delete, logout, and warning flows.

import { Loader2, LogOut, Trash2, TriangleAlert } from "lucide-react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type DialogType = "delete" | "logout" | "warning";

interface ConfirmDialogProps {
    isOpen: boolean;
    type?: DialogType;
    title: string;
    message: string;
    highlightText?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    isLoading?: boolean;
}

const ICONS: Record<DialogType, React.ReactNode> = {
    delete: <Trash2 />,
    logout: <LogOut />,
    warning: <TriangleAlert />,
};

const CONFIRM_VARIANT: Record<DialogType, "default" | "destructive"> = {
    delete: "destructive",
    logout: "destructive",
    warning: "default",
};

export default function ConfirmDialog({
    isOpen,
    type = "warning",
    title,
    message,
    highlightText,
    confirmText = "Confirm",
    cancelText = "Cancel",
    onConfirm,
    onCancel,
    isLoading = false,
}: ConfirmDialogProps) {
    return (
        <AlertDialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open) onCancel();
            }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogMedia>{ICONS[type]}</AlertDialogMedia>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {message}
                        {highlightText && (
                            <span className="font-semibold text-foreground">
                                {" "}
                                {highlightText}
                            </span>
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLoading} onClick={onCancel}>
                        {cancelText}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        variant={CONFIRM_VARIANT[type]}
                        disabled={isLoading}
                        onClick={(e) => {
                            e.preventDefault();
                            onConfirm();
                        }}>
                        {isLoading ? (
                            <>
                                <Loader2 className="animate-spin" />
                                Loading...
                            </>
                        ) : (
                            confirmText
                        )}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
