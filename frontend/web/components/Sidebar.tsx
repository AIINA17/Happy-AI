"use client";

// Application sidebar with logo, enrollment controls, and recent sessions.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { MdDelete, MdModeEdit } from "react-icons/md";
import {
    IoAdd,
    IoChevronBack,
    IoEllipsisVertical,
    IoMenu,
} from "react-icons/io5";
import { LuLogOut } from "react-icons/lu";
import { PiUserSoundBold } from "react-icons/pi";
import { FaStore } from "react-icons/fa6";

import ConfirmDialog from "./ConfirmDialog";
import EcommerceAccountLink from "./EcommerceAccountLink";
import VoiceEnrollment from "./VoiceEnrollment";

interface ConversationSession {
    id: string;
    label: string;
    created_at: string;
}

let cachedSessions: ConversationSession[] = [];
let cachedLoaded = false;

interface SidebarProps {
    isLoggedIn: boolean;
    userEmail: string;
    onLogout: () => void;
    token: string | null;
    setVerifyStatus: (status: string) => void;
    currentSessionId?: string | null;
    onSelectSession?: (sessionId: string) => void;
    onNewChat?: () => void;
    refreshKey?: number;
}

const COLLAPSED_WIDTH = 72;

export default function Sidebar({
    isLoggedIn,
    userEmail,
    onLogout,
    token,
    setVerifyStatus,
    currentSessionId,
    onSelectSession,
    onNewChat,
    refreshKey,
}: SidebarProps) {
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showEnrollmentList, setShowEnrollmentList] = useState(false);
    const [showEcommerceAccount, setShowEcommerceAccount] = useState(false);
    const [sessions, setSessions] = useState<ConversationSession[]>(
        () => cachedSessions,
    );
    const [loading, setLoading] = useState(!cachedLoaded);
    const [isCollapsed, setIsCollapsed] = useState(false);

    const [showLogoutDialog, setShowLogoutDialog] = useState(false);
    const [deleteDialog, setDeleteDialog] = useState<{
        isOpen: boolean;
        sessionId: string | null;
        sessionLabel: string;
    }>({ isOpen: false, sessionId: null, sessionLabel: "" });
    const [isDeleting, setIsDeleting] = useState(false);

    const menuRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLElement>(null);

    const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                menuRef.current &&
                !menuRef.current.contains(event.target as Node)
            ) {
                setShowUserMenu(false);
            }
        };

        if (showUserMenu) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [showUserMenu]);

    const loadSessions = useCallback(async () => {
        if (!token) return;

        setLoading(true);
        try {
            const res = await fetch(`${SERVER_URL}/logs/sessions`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const data = await res.json();

            if (data.status === "OK") {
                const newSessions: ConversationSession[] = data.sessions || [];
                setSessions(newSessions);
                cachedSessions = newSessions;
                cachedLoaded = true;
            }
        } catch (error) {
            console.error("Error fetching sessions:", error);
        } finally {
            setLoading(false);
        }
    }, [SERVER_URL, token]);

    useEffect(() => {
        if (!isLoggedIn || !token) return;
        if (cachedLoaded && cachedSessions.length > 0) {
            setSessions(cachedSessions);
            setLoading(false);
            return;
        }

        loadSessions();
    }, [isLoggedIn, token, loadSessions]);

    // Explicit refresh trigger from parent (e.g., when a call is ended)
    useEffect(() => {
        if (!isLoggedIn || !token) return;
        if (refreshKey === undefined) return;
        loadSessions();
    }, [refreshKey, isLoggedIn, token, loadSessions]);

    const handleNewChat = () => {
        onNewChat?.();
        loadSessions();
    };

    const handleRename = async (sessionId: string, newLabel: string) => {
        if (!token) return;

        try {
            const res = await fetch(
                `${SERVER_URL}/conversation-sessions/${sessionId}/label`,
                {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ label: newLabel }),
                },
            );

            const data = await res.json();

            if (data.status === "OK") {
                setSessions((prev) => {
                    const updated = prev.map((session) =>
                        session.id === sessionId
                            ? { ...session, label: newLabel }
                            : session,
                    );
                    cachedSessions = updated;
                    return updated;
                });
            }
        } catch (error) {
            console.error("Error renaming session:", error);
        }
    };

    const openDeleteDialog = (sessionId: string, sessionLabel: string) => {
        setDeleteDialog({
            isOpen: true,
            sessionId,
            sessionLabel,
        });
    };

    const handleDelete = async () => {
        if (!token || !deleteDialog.sessionId) return;

        setIsDeleting(true);
        try {
            const res = await fetch(
                `${SERVER_URL}/conversation-sessions/${deleteDialog.sessionId}`,
                {
                    method: "DELETE",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                },
            );

            const data = await res.json();

            if (res.ok && data.status === "OK") {
                setSessions((prev) => {
                    const updated = prev.filter(
                        (session) => session.id !== deleteDialog.sessionId,
                    );
                    cachedSessions = updated;
                    return updated;
                });

                if (currentSessionId === deleteDialog.sessionId) {
                    onNewChat?.();
                }

                setDeleteDialog({
                    isOpen: false,
                    sessionId: null,
                    sessionLabel: "",
                });
            } else {
                console.error("Delete failed:", data);
                alert(data.detail || "Gagal menghapus chat");
            }
        } catch (error) {
            console.error("Error deleting session:", error);
            alert("Terjadi kesalahan saat menghapus chat");
        } finally {
            setIsDeleting(false);
        }
    };

    // Handle logout with dialog
    const handleLogoutClick = () => {
        setShowUserMenu(false);
        setShowLogoutDialog(true);
    };

    const confirmLogout = () => {
        setShowLogoutDialog(false);
        cachedSessions = [];
        cachedLoaded = false;
        onLogout();
    };

    const handleEnrollmentListClick = () => {
        setShowUserMenu(false);
        setShowEnrollmentList((prev) => !prev);
    };

    const handleEcommerceAccountClick = () => {
        setShowUserMenu(false);
        setShowEcommerceAccount(true);
    };

    const toggleCollapse = () => {
        setIsCollapsed((prev) => !prev);
    };

    return (
        <>
            <ConfirmDialog
                isOpen={deleteDialog.isOpen}
                type="delete"
                title="Delete Chat?"
                message="This will delete"
                highlightText={deleteDialog.sessionLabel}
                confirmText="Delete"
                cancelText="Cancel"
                onConfirm={handleDelete}
                onCancel={() =>
                    setDeleteDialog({
                        isOpen: false,
                        sessionId: null,
                        sessionLabel: "",
                    })
                }
                isLoading={isDeleting}
            />

            {/* Logout Confirmation Dialog */}
            <ConfirmDialog
                isOpen={showLogoutDialog}
                type="logout"
                title="Log Out"
                message="Are you sure you want to log out?"
                confirmText="Log Out"
                cancelText="Cancel"
                onConfirm={confirmLogout}
                onCancel={() => setShowLogoutDialog(false)}
            />

            <EcommerceAccountLink
                token={token}
                isOpen={showEcommerceAccount}
                onClose={() => setShowEcommerceAccount(false)}
            />

            <aside
                ref={sidebarRef}
                style={{ width: isCollapsed ? COLLAPSED_WIDTH : "360px" }}
                className="h-screen bg-(--bg-secondary) flex flex-col border-r border-(--border-color)/20 
                           transition-[width] duration-300 ease-in-out relative">
                {/* Collapse Button - Hanya muncul saat expanded */}
                {!isCollapsed && (
                    <button
                        onClick={toggleCollapse}
                        className="absolute -right-3 top-6 z-10 w-10 h-10 rounded-xl 
                                   bg-(--bg-tertiary) border border-(--border-color)/30
                                   flex items-center justify-center
                                   hover:bg-(--bg-card) transition-colors cursor-pointer
                                   text-(--text-muted) hover:text-(--text-primary)"
                        title="Collapse sidebar">
                        <IoChevronBack size={14} />
                    </button>
                )}

                {/* Logo Header */}
                <div
                    className={`p-4 pb-4 ${isCollapsed ? "flex justify-center mt-4" : ""}`}>
                    {isCollapsed ? (
                        <button
                            onClick={toggleCollapse}
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                            title="Expand sidebar">
                            <Image
                                src="/icons/Happy_Warna.png"
                                alt="Happy"
                                width={32}
                                height={32}
                                style={{ width: "40px", height: "40px" }}
                                className="object-contain"
                            />
                        </button>
                    ) : (
                        <div className="flex items-center gap-3">
                            <Image
                                src="/icons/Happy_Warna.png"
                                alt="Happy"
                                width={32}
                                height={32}
                                style={{ width: "40px", height: "40px" }}
                                className="object-contain"
                            />
                            <h1 className="font-space text-3xl font-bold text-(--text-primary)">
                                Happy
                            </h1>
                        </div>
                    )}
                </div>

                {/* New Chat Button - Expanded */}
                {!isCollapsed && (
                    <div className="px-6 pb-4">
                        <button
                            onClick={handleNewChat}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 
                                       rounded-xl bg-(--accent-primary) text-white font-medium
                                       hover:brightness-110 active:scale-[0.98] transition-all
                                       cursor-pointer shadow-md">
                            <IoAdd size={20} />
                            <span>New Chat</span>
                        </button>
                    </div>
                )}

                {/* New Chat Button - Collapsed */}
                {isCollapsed && (
                    <div className="px-3 pb-4">
                        <button
                            onClick={handleNewChat}
                            className="w-full flex items-center justify-center p-3
                                       rounded-xl bg-(--accent-primary) text-white
                                       hover:brightness-110 active:scale-[0.98] transition-all
                                       cursor-pointer shadow-md"
                            title="New Chat">
                            <IoAdd size={20} />
                        </button>
                    </div>
                )}

                {/* Voice Enrollment Section - Hidden when collapsed */}
                {!isCollapsed && (
                    <div className="px-6 pb-6">
                        <VoiceEnrollment
                            token={token}
                            setVerifyStatus={setVerifyStatus}
                            showEnrollmentList={showEnrollmentList}
                            setShowEnrollmentList={setShowEnrollmentList}
                        />
                    </div>
                )}

                {/* Recents Section - Hidden when collapsed */}
                {!isCollapsed && (
                    <div className="flex-1 px-6 overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-medium text-(--text-secondary)">
                                Recents
                            </h2>
                        </div>

                        {/* Sessions List */}
                        <div className="flex-1 overflow-y-auto space-y-1 pr-2">
                            {loading ? (
                                <div className="text-(--text-muted) text-sm py-4">
                                    Loading...
                                </div>
                            ) : sessions.length === 0 ? (
                                <div className="text-(--text-muted) text-sm py-4">
                                    Belum ada chat
                                </div>
                            ) : (
                                sessions.map((session) => (
                                    <SessionItem
                                        key={session.id}
                                        session={session}
                                        isActive={
                                            currentSessionId === session.id
                                        }
                                        onSelect={() =>
                                            onSelectSession?.(session.id)
                                        }
                                        onRename={handleRename}
                                        onDelete={() =>
                                            openDeleteDialog(
                                                session.id,
                                                session.label,
                                            )
                                        }
                                    />
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* Spacer when collapsed */}
                {isCollapsed && <div className="flex-1" />}

                {/* User Section - Bottom */}
                {isLoggedIn && (
                    <div
                        className="relative p-4 border-t border-(--border-color)/20"
                        ref={menuRef}>
                        {/* User Menu Popup */}
                        {showUserMenu && (
                            <div
                                className={`absolute bottom-full mb-2 bg-(--bg-tertiary) 
                                            rounded-lg shadow-lg overflow-hidden animate-fadeIn
                                            border border-(--border-color)/20
                                            ${isCollapsed ? "left-2 w-48" : "left-4 right-4"}`}>
                                {/* Enrollment List - TOGGLE */}
                                <button
                                    onClick={handleEnrollmentListClick}
                                    className="w-full px-4 py-3 flex items-center gap-3 text-(--text-secondary)
                                               hover:bg-(--bg-card) transition-colors cursor-pointer">
                                    <PiUserSoundBold />
                                    <span className="text-sm">
                                        Enrollment List
                                    </span>
                                </button>

                                {/* Ecommerce Account Link */}
                                <button
                                    onClick={handleEcommerceAccountClick}
                                    className="w-full px-4 py-3 flex items-center gap-3 text-(--text-secondary)
                                               hover:bg-(--bg-card) transition-colors cursor-pointer">
                                    <FaStore />
                                    <span className="text-sm">
                                        Akun E-commerce
                                    </span>
                                </button>

                                {/* Log out - Opens dialog */}
                                <button
                                    onClick={handleLogoutClick}
                                    className="w-full px-4 py-4 flex items-center gap-3 text-(--text-secondary)
                                               hover:bg-(--bg-card) transition-colors cursor-pointer">
                                    <LuLogOut />
                                    <span className="text-sm">Log out</span>
                                </button>
                            </div>
                        )}

                        {/* User Info Button */}
                        <button
                            onClick={() => setShowUserMenu(!showUserMenu)}
                            className={`w-full flex items-center gap-3 p-2 rounded-lg 
                                       hover:bg-(--bg-tertiary) transition-colors cursor-pointer
                                       ${isCollapsed ? "justify-center" : ""}`}>
                            <div className="w-10 h-10 rounded-full bg-(--bg-tertiary) flex items-center justify-center shrink-0">
                                <span className="text-lg">👤</span>
                            </div>
                            {!isCollapsed && (
                                <>
                                    <span className="flex-1 text-left text-(--text-primary) text-sm truncate">
                                        {userEmail}
                                    </span>
                                    <IoMenu className="w-5 h-5 mx-2 shrink-0" />
                                </>
                            )}
                        </button>
                    </div>
                )}
            </aside>
        </>
    );
}

/* ============================================
   SESSION ITEM WITH DROPDOWN
   ============================================ */

interface SessionItemProps {
    session: ConversationSession;
    isActive: boolean;
    onSelect: () => void;
    onRename: (sessionId: string, newLabel: string) => void;
    onDelete: () => void; // Changed: no params, parent handles it
}

function SessionItem({
    session,
    isActive,
    onSelect,
    onRename,
    onDelete,
}: SessionItemProps) {
    const [showMenu, setShowMenu] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [newLabel, setNewLabel] = useState(session.label);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

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
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, [showMenu]);

    useEffect(() => {
        if (isRenaming && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming]);

    const handleRenameSubmit = () => {
        if (newLabel.trim() && newLabel !== session.label) {
            onRename(session.id, newLabel.trim());
        } else {
            setNewLabel(session.label);
        }
        setIsRenaming(false);
    };

    const handleDeleteClick = () => {
        setShowMenu(false);
        onDelete(); // Opens dialog in parent
    };

    return (
        <div className="relative group">
            {isRenaming ? (
                <input
                    ref={inputRef}
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onBlur={handleRenameSubmit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameSubmit();
                        if (e.key === "Escape") {
                            setNewLabel(session.label);
                            setIsRenaming(false);
                        }
                    }}
                    className="w-full px-3 py-2.5 rounded-lg bg-(--bg-tertiary) 
                               text-(--text-primary) text-sm outline-none
                               border border-(--accent-primary)"
                />
            ) : (
                <div
                    onClick={onSelect}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm cursor-pointer
                               transition-colors flex items-center justify-between group
                               ${
                                   isActive
                                       ? "bg-(--bg-tertiary) text-(--text-primary)"
                                       : "text-(--text-primary) hover:bg-(--bg-tertiary)"
                               }`}>
                    <span className="truncate flex-1 pr-2">
                        {session.label}
                    </span>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMenu(!showMenu);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-3 rounded hover:bg-(--bg-card)
                                   transition-opacity cursor-pointer">
                        <IoEllipsisVertical />
                    </button>
                </div>
            )}

            {showMenu && (
                <div
                    ref={menuRef}
                    className="absolute right-0 top-full mt-1 w-40 bg-(--bg-tertiary) 
                               rounded-lg shadow-lg overflow-hidden z-50 animate-fadeIn
                               border border-(--border-color)/20">
                    <button
                        onClick={() => {
                            setIsRenaming(true);
                            setShowMenu(false);
                        }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-(--text-primary)
                                   hover:bg-(--bg-card) transition-colors cursor-pointer">
                        <MdModeEdit />
                        <span>Rename</span>
                    </button>
                    <button
                        onClick={handleDeleteClick}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-red-400
                                   hover:bg-red-500/10 transition-colors cursor-pointer">
                        <MdDelete />
                        <span>Delete</span>
                    </button>
                </div>
            )}
        </div>
    );
}
