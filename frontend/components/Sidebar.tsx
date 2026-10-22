"use client";

// Application sidebar with logo, enrollment controls, and recent sessions.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  LogOut,
  MoreVertical,
  Pencil,
  Plus,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { PiUserSoundBold } from "react-icons/pi";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfirmDialog from "./ConfirmDialog";
import EcommerceAccountLink from "./EcommerceAccountLink";
import VoiceEnrollment from "./VoiceEnrollment";
import FaceEnrollment from "./FaceEnrollment";
import FaceVerification from "./FaceVerification";

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
  userId: string | null;
  onLogout: () => void;
  token: string | null;
  setVerifyStatus: (status: string) => void;
  currentSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onNewChat?: () => void;
  refreshKey?: number;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const COLLAPSED_WIDTH = 72;

export default function Sidebar({
  isLoggedIn,
  userEmail,
  userId,
  onLogout,
  token,
  setVerifyStatus,
  currentSessionId,
  onSelectSession,
  onNewChat,
  refreshKey,
  isMobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  const [showEnrollmentList, setShowEnrollmentList] = useState(false);
  const [showEcommerceAccount, setShowEcommerceAccount] = useState(false);
  const [sessions, setSessions] = useState<ConversationSession[]>(
    () => cachedSessions,
  );
  const [loading, setLoading] = useState(!cachedLoaded);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-expand sidebar when opened as mobile overlay — collapsed state
  // (72px icons only) makes no sense in an overlay context.
  useEffect(() => {
    if (isMobileOpen && isCollapsed) {
      setIsCollapsed(false);
    }
  }, [isMobileOpen, isCollapsed]);

  // Swipe-to-close for mobile overlay.
  // Tracks horizontal finger movement; drags sidebar leftward with finger,
  // commits close if user swiped past threshold (60px), snaps back otherwise.
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobileOpen) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isMobileOpen || touchStartXRef.current === null) return;
    const dx = e.touches[0].clientX - touchStartXRef.current;
    const dy = e.touches[0].clientY - (touchStartYRef.current ?? 0);
    // Only engage swipe-to-close if horizontal gesture dominates — otherwise
    // let the user scroll the sidebar list vertically without accidentally
    // closing the overlay.
    if (Math.abs(dx) > Math.abs(dy) && dx < 0) {
      setIsSwiping(true);
      setSwipeOffset(dx);
    }
  };

  const handleTouchEnd = () => {
    if (!isMobileOpen) {
      setSwipeOffset(0);
      setIsSwiping(false);
      touchStartXRef.current = null;
      touchStartYRef.current = null;
      return;
    }
    // Threshold: 60px leftward swipe commits the close
    if (swipeOffset < -60) {
      onCloseMobile?.();
    }
    setSwipeOffset(0);
    setIsSwiping(false);
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    sessionId: string | null;
    sessionLabel: string;
  }>({ isOpen: false, sessionId: null, sessionLabel: "" });
  const [isDeleting, setIsDeleting] = useState(false);

  const sidebarRef = useRef<HTMLElement>(null);

  const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

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
    setShowLogoutDialog(true);
  };

  const confirmLogout = () => {
    setShowLogoutDialog(false);
    cachedSessions = [];
    cachedLoaded = false;
    onLogout();
  };

  const toggleCollapse = () => {
    setIsCollapsed((prev) => !prev);
  };

  const userInitial = userEmail ? userEmail[0].toUpperCase() : "?";

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

      {/* Mobile backdrop (only visible on mobile when sidebar is open) */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden
                     animate-in fade-in duration-200"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        ref={sidebarRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{
          width: `${isCollapsed ? COLLAPSED_WIDTH : 360}px`,
          // Live swipe follow — only applied while actively swiping on mobile.
          // Disables transitions during swipe so sidebar sticks to finger.
          transform: isSwiping ? `translateX(${swipeOffset}px)` : undefined,
          transition: isSwiping ? "none" : undefined,
        }}
        className={`h-screen bg-sidebar flex flex-col border-r border-sidebar-border
                   transition-all duration-300 ease-in-out
                   max-w-[85vw]
                   md:relative md:translate-x-0
                   fixed inset-y-0 left-0 z-50
                   ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        {/* Desktop collapse button - only when expanded */}
        {!isCollapsed && (
          <Button
            onClick={toggleCollapse}
            variant="outline"
            size="icon"
            title="Collapse sidebar"
            className="absolute -right-3 top-6 z-10 rounded-xl bg-sidebar
                       hidden md:flex"
          >
            <ChevronLeft size={14} />
          </Button>
        )}

        {/* Mobile close button - visible only on mobile overlay */}
        {isMobileOpen && (
          <button
            onClick={onCloseMobile}
            title="Close sidebar"
            aria-label="Close sidebar"
            className="md:hidden absolute top-3 right-3 z-10
                       flex items-center justify-center
                       w-9 h-9 rounded-full
                       bg-sidebar-accent/70 hover:bg-sidebar-accent
                       text-sidebar-foreground
                       transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        )}

        {/* Logo Header */}
        <div
          className={`p-4 pb-4 ${isCollapsed ? "flex justify-center mt-4" : ""}`}
        >
          {isCollapsed ? (
            <button
              onClick={toggleCollapse}
              className="cursor-pointer hover:opacity-80 transition-opacity"
              title="Expand sidebar"
            >
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
              <h1 className="font-space text-3xl font-bold text-sidebar-foreground">
                Happy
              </h1>
            </div>
          )}
        </div>

        {/* New Chat Button - Expanded */}
        {!isCollapsed && (
          <div className="px-6 pb-4">
            <Button
              onClick={handleNewChat}
              className="w-full h-auto rounded-xl py-3 shadow-md"
            >
              <Plus size={20} />
              <span>New Chat</span>
            </Button>
          </div>
        )}

        {/* New Chat Button - Collapsed */}
        {isCollapsed && (
          <div className="px-3 pb-4">
            <Button
              onClick={handleNewChat}
              size="icon"
              title="New Chat"
              className="w-full h-auto rounded-xl py-3 shadow-md"
            >
              <Plus size={20} />
            </Button>
          </div>
        )}

        {/* Voice Enrollment Section - Hidden when collapsed */}
        {!isCollapsed && (
          <div className="px-6 pb-6 space-y-3">
            <VoiceEnrollment
              token={token}
              setVerifyStatus={setVerifyStatus}
              showEnrollmentList={showEnrollmentList}
              setShowEnrollmentList={setShowEnrollmentList}
            />
            <FaceEnrollment userId={userId} setVerifyStatus={setVerifyStatus} />
            <FaceVerification userId={userId} setVerifyStatus={setVerifyStatus} />
          </div>
        )}

        {/* Recents Section - Hidden when collapsed */}
        {!isCollapsed && (
          <div className="flex-1 px-6 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Recents
              </h2>
            </div>

            {/* Sessions List */}
            <div className="flex-1 overflow-y-auto space-y-1 pr-2">
              {loading ? (
                <div className="text-muted-foreground text-sm py-4">
                  Loading...
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-muted-foreground text-sm py-4">
                  Belum ada chat
                </div>
              ) : (
                sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={currentSessionId === session.id}
                    onSelect={() => onSelectSession?.(session.id)}
                    onRename={handleRename}
                    onDelete={() => openDeleteDialog(session.id, session.label)}
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
          <div className="p-4 border-t border-sidebar-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`w-full flex items-center gap-3 p-2 rounded-lg
                                       hover:bg-sidebar-accent transition-colors cursor-pointer
                                       ${isCollapsed ? "justify-center" : ""}`}
                >
                  <Avatar>
                    <AvatarFallback>{userInitial}</AvatarFallback>
                  </Avatar>
                  {!isCollapsed && (
                    <span className="flex-1 text-left text-sidebar-foreground text-sm truncate">
                      {userEmail}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuItem
                  onClick={() => setShowEnrollmentList((prev) => !prev)}
                >
                  <PiUserSoundBold />
                  <span>Enrollment List</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowEcommerceAccount(true)}>
                  <Store />
                  <span>Akun E-commerce</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={handleLogoutClick}
                >
                  <LogOut />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
  const [isRenaming, setIsRenaming] = useState(false);
  const [newLabel, setNewLabel] = useState(session.label);
  const inputRef = useRef<HTMLInputElement>(null);

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
          className="w-full px-3 py-2.5 rounded-lg bg-sidebar-accent
                               text-sidebar-foreground text-sm outline-none
                               border border-ring"
        />
      ) : (
        <div
          onClick={onSelect}
          className={`w-full text-left px-3 py-2.5 rounded-lg text-sm cursor-pointer
                               transition-colors flex items-center justify-between group
                               ${
                                 isActive
                                   ? "bg-sidebar-accent text-sidebar-foreground"
                                   : "text-sidebar-foreground hover:bg-sidebar-accent"
                               }`}
        >
          <span className="truncate flex-1 pr-2">{session.label}</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 p-3 rounded hover:bg-sidebar
                                   transition-opacity cursor-pointer"
              >
                <MoreVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setIsRenaming(true);
                }}
              >
                <Pencil />
                <span>Rename</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
