"use client";

// Main chat area layout, handling voice/chat modes and product sidebar.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronRight,
  MessageCircle,
  Menu,
  ShoppingBag,
  X,
} from "lucide-react";

import LiveKitControls from "./LiveKitControls";
import MessageBubble from "./MessageBubble";
import ProductCards from "./ProductCards";
import ProductCarousel from "./ProductCarousel";
import SoundWave from "./SoundWave";
import TypingIndicator from "./TypingIndicator";
import { Message, Product, Review } from "@/types";

type ViewMode = "voice" | "chat";

interface ChatAreaProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  isConnected: boolean;
  setIsConnected: (value: boolean) => void;
  isTyping: boolean;
  setIsTyping: (value: boolean) => void;
  products: Product[];
  isLoggedIn: boolean;
  isSpeaking: boolean;
  setIsSpeaking: (value: boolean) => void;
  speakingRole: "user" | "agent" | null;
  setSpeakingRole: (role: "user" | "agent" | null) => void;
  token: string | null;
  addMessage: (role: "user" | "assistant", text: string) => void;
  onProductCards: (products: Product[]) => void;
  setVerifyStatus: (status: string) => void;
  setRoomStatus: (status: string) => void;
  setScore: (score: number | null) => void;
  setVerificationResult: (result: {
    status: "VERIFIED" | "REPEAT" | "DENIED" | null;
    score: number | null;
    reason: string | null;
  }) => void;
  isViewingHistory?: boolean;
  onEndChat?: () => void;
  // Mobile: when sidebar (left) is closed, show hamburger button that triggers this
  onOpenMobileSidebar?: () => void;
  // Latest review set from the agent — surfaces in the voice-mode
  // carousel as a slide-up panel below the active product card.
  latestReviews?: {
    productName: string;
    reviews: Review[];
  } | null;
}

export default function ChatArea({
  messages,
  isConnected,
  setIsConnected,
  isTyping,
  setIsTyping,
  products,
  isSpeaking,
  setIsSpeaking,
  token,
  addMessage,
  onProductCards,
  setVerifyStatus,
  setRoomStatus,
  setScore,
  setVerificationResult,
  isViewingHistory = false,
  onEndChat,
  onOpenMobileSidebar,
  latestReviews,
}: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("voice");
  const [isProductSidebarOpen, setIsProductSidebarOpen] = useState(true);
  const [isMobileProductsOpen, setIsMobileProductsOpen] = useState(false);

  const isHistoryMode =
    isViewingHistory || (messages.length > 0 && !isConnected);

  // "Active session split" = voice session is live AND we're not viewing
  // a saved transcript. On desktop (md+) we show the carousel in the
  // center and chat as a side panel at the same time — focus on the
  // voice-first UX while still giving the user access to the written
  // conversation. Mobile keeps the single-view toggle (space-constrained).
  const isActiveSession = isConnected && !isHistoryMode;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (viewMode === "chat" || isHistoryMode) {
      scrollToBottom();
    }
  }, [messages, isTyping, viewMode, isHistoryMode]);

  const hasProducts = products.length > 0;

  return (
    <div className="flex-1 flex h-screen bg-background overflow-hidden relative">
      {/* ====== Mobile Floating Buttons (visible only on mobile) ====== */}
      {onOpenMobileSidebar && (
        <button
          onClick={onOpenMobileSidebar}
          aria-label="Open sidebar"
          className="md:hidden fixed top-3 left-3 z-30
                               flex items-center justify-center
                               w-10 h-10 rounded-full
                               bg-background/80 backdrop-blur-md
                               border border-border/50
                               shadow-md hover:bg-background
                               transition-colors cursor-pointer"
        >
          <Menu size={18} className="text-foreground" />
        </button>
      )}
      {hasProducts && !isActiveSession && (
        <button
          onClick={() => setIsMobileProductsOpen(true)}
          aria-label="Open products"
          className="md:hidden fixed top-3 right-3 z-30
                               flex items-center justify-center gap-1.5
                               h-10 px-3 rounded-full
                               bg-primary/90 text-primary-foreground backdrop-blur-md
                               shadow-md hover:bg-primary
                               transition-colors cursor-pointer"
        >
          <ShoppingBag size={16} />
          <span className="text-xs font-semibold">{products.length}</span>
        </button>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Scrollable content */}
        <div className="flex-1 overflow-hidden">
          {isHistoryMode ? (
            <HistoryModeView
              messages={messages}
              isTyping={isTyping}
              messagesEndRef={messagesEndRef}
            />
          ) : isActiveSession ? (
            <>
              {/* Mobile layout */}
              <div className="md:hidden h-full">
                {viewMode === "voice" ? (
                  <VoiceModeView
                    isSpeaking={isSpeaking}
                    products={products}
                    latestReviews={latestReviews}
                  />
                ) : (
                  <ChatModeView
                    messages={messages}
                    isTyping={isTyping}
                    messagesEndRef={messagesEndRef}
                  />
                )}
              </div>

              <div className="hidden md:flex h-full">
                <div className="flex-1 min-w-0">
                  {/* Desktop split: don't shrink the carousel card for
                      reviews — reviews already show in the chat side panel
                      below (via MessageBubble + ReviewCards). This keeps
                      the product photos nice and large. */}
                  <VoiceModeView
                    isSpeaking={isSpeaking}
                    products={products}
                    latestReviews={null}
                  />
                </div>
                <aside
                  className="w-80 lg:w-96 border-l border-border/40
                             flex flex-col bg-background/40
                             min-h-0"
                >
                  <div
                    className="px-4 py-2.5 border-b border-border/40
                               text-xs font-semibold uppercase
                               tracking-wide text-muted-foreground
                               shrink-0"
                  >
                    Live transcript
                  </div>
                  {/* overflow-y-auto on the wrapper — ChatModeView itself
                      doesn't manage scroll, so without this the long chat
                      history gets clipped by the outer overflow-hidden. */}
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <ChatModeView
                      messages={messages}
                      isTyping={isTyping}
                      messagesEndRef={messagesEndRef}
                    />
                  </div>
                </aside>
              </div>
            </>
          ) : viewMode === "voice" ? (
            <VoiceModeView
              isSpeaking={isSpeaking}
              products={products}
              latestReviews={latestReviews}
            />
          ) : (
            <ChatModeView
              messages={messages}
              isTyping={isTyping}
              messagesEndRef={messagesEndRef}
            />
          )}
        </div>

        {!isHistoryMode && (
          <div
            className="px-4 py-3 flex flex-col items-center gap-2
                                    border-t border-border/40 bg-background/60 backdrop-blur-sm"
          >
            <LiveKitControls
              token={token}
              setIsConnected={setIsConnected}
              setRoomStatus={setRoomStatus}
              setVerifyStatus={setVerifyStatus}
              setScore={setScore}
              setVerificationResult={setVerificationResult}
              setIsAgentSpeaking={setIsSpeaking}
              addMessage={addMessage}
              onProductCards={onProductCards}
              setIsTyping={setIsTyping}
              onEndChat={onEndChat}
              showPillControls={true}
              isChatMode={viewMode === "chat"}
              onToggleChatMode={() =>
                setViewMode((m) => (m === "chat" ? "voice" : "chat"))
              }
            />
          </div>
        )}
      </div>

      {/* ProductSidebar only renders OUTSIDE active session. During active
          session the products are front-and-center in the carousel, so this
          sidebar would be redundant. */}
      {!isActiveSession && (
        <ProductSidebar
          products={products}
          isOpen={isProductSidebarOpen}
          onToggle={() => setIsProductSidebarOpen((prev) => !prev)}
          isMobileOpen={isMobileProductsOpen}
          onCloseMobile={() => setIsMobileProductsOpen(false)}
        />
      )}
    </div>
  );
}

interface ProductSidebarProps {
  products: Product[];
  isOpen: boolean;
  onToggle: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

function ProductSidebar({
  products,
  isOpen,
  onToggle,
  isMobileOpen = false,
  onCloseMobile,
}: ProductSidebarProps) {
  const hasProducts = products.length > 0;

  // Swipe-to-close for mobile overlay. The products sidebar opens from the
  // RIGHT so the "close" gesture is a RIGHTWARD swipe (positive dx).
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
    // Only engage swipe if horizontal + rightward
    if (Math.abs(dx) > Math.abs(dy) && dx > 0) {
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
    if (swipeOffset > 60) {
      onCloseMobile?.();
    }
    setSwipeOffset(0);
    setIsSwiping(false);
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  if (!hasProducts) return null;

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden
                               animate-in fade-in duration-200"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <div className="relative flex md:relative">
        {/* Sidebar Content — on desktop, collapsed state shrinks the sidebar
            to a 72px icon strip (mirroring the left Sidebar's COLLAPSED_WIDTH),
            instead of hiding it entirely. On mobile it still slides off-screen
            as an overlay. */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          style={{
            transform: isSwiping ? `translateX(${swipeOffset}px)` : undefined,
            transition: isSwiping ? "none" : undefined,
          }}
          className={`
                  flex flex-col border-l border-sidebar-border bg-sidebar
                  transition-all duration-300 ease-in-out
                  w-[min(360px,90vw)]
                  md:w-80
                  fixed inset-y-0 right-0 z-50
                  md:relative md:z-auto md:inset-auto md:translate-x-0
                  ${isMobileOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"}
                  ${isOpen ? "md:w-80 md:opacity-100" : "md:w-[72px] md:opacity-100"}
                `}
        >
          {isOpen ? (
            <>
              {/* Expanded header */}
              <button
                onClick={() => {
                  if (isMobileOpen && onCloseMobile) {
                    onCloseMobile();
                  } else {
                    onToggle();
                  }
                }}
                className="w-full p-4 border-b border-sidebar-border
                              flex items-center justify-between
                              hover:bg-sidebar-accent transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-sidebar-foreground">
                  <ShoppingBag size={18} className="text-primary" />
                  <span>{products.length} Produk</span>
                </div>
                <ChevronRight
                  size={16}
                  className="text-muted-foreground hidden md:block"
                />
                <X size={16} className="text-muted-foreground md:hidden" />
              </button>

              {/* Products list */}
              <div className="flex-1 overflow-y-auto p-3">
                <ProductCards products={products} />
              </div>
            </>
          ) : (
            /* Desktop collapsed strip (72px). Shows a ShoppingBag icon
               at the top with the product count as a small badge below,
               clickable to re-expand. Visually mirrors the left Sidebar's
               collapsed layout (icon-top, flex spacer, action at bottom). */
            <div className="hidden md:flex flex-col items-center w-full h-full py-4">
              <button
                onClick={onToggle}
                title="Expand products"
                aria-label="Expand products"
                className="flex flex-col items-center gap-1 cursor-pointer
                             hover:opacity-80 transition-opacity"
              >
                <div
                  className="w-10 h-10 rounded-xl bg-primary/10
                               flex items-center justify-center"
                >
                  <ShoppingBag size={20} className="text-primary" />
                </div>
                <span className="text-xs font-semibold text-sidebar-foreground">
                  {products.length}
                </span>
              </button>
              <div className="flex-1" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

interface VoiceModeViewProps {
  isSpeaking: boolean;
  products: Product[];
  latestReviews?: {
    productName: string;
    reviews: Review[];
  } | null;
}

function VoiceModeView({
  isSpeaking,
  products,
  latestReviews,
}: VoiceModeViewProps) {
  const hasProducts = products && products.length > 0;

  if (hasProducts) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center p-4
                            relative overflow-hidden"
      >
        <div
          aria-hidden="true"
          className="absolute w-[480px] h-[480px] rounded-full
                               bg-primary/5 blur-3xl pointer-events-none"
        />

        <ProductCarousel
          products={products}
          reviewsForProduct={latestReviews}
        />

        {isSpeaking && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2
                                    flex items-center gap-2
                                    bg-background/70 backdrop-blur-sm
                                    rounded-full px-3 py-1 border border-border/40"
          >
            <SoundWave />
            <span className="text-xs text-muted-foreground">
              Happy sedang bicara…
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <h1 className="font-outfit text-5xl font-bold text-primary mb-4">
        Happy
      </h1>

      <p className="font-space text-xl text-foreground mb-8">
        Your personal shopping assistant
      </p>

      <div className="relative w-56 h-56 mb-6">
        <Image
          src="/icons/Happy_Warna.png"
          alt="Happy Mascot"
          fill
          className="object-contain"
          sizes="(max-width: 768px) 100vw, 224px"
          priority
        />
      </div>

      {isSpeaking && (
        <div className="mb-6">
          <SoundWave />
        </div>
      )}
    </div>
  );
}

interface ChatModeViewProps {
  messages: Message[];
  isTyping: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

function ChatModeView({
  messages,
  isTyping,
  messagesEndRef,
}: ChatModeViewProps) {
  if (messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <MessageCircle size={64} className="text-muted-foreground mb-4" />
        <p className="text-muted-foreground text-lg">Belum ada pesan</p>
        <p className="text-muted-foreground text-sm mt-2">
          Mulai percakapan dengan menekan tombol mic
        </p>
      </div>
    );
  }

  return (
    <div className="w-full px-6 py-4 space-y-4">
      {messages.map((msg, idx) => (
        <MessageBubble key={idx} message={msg} />
      ))}

      {isTyping && <TypingIndicator />}

      <div ref={messagesEndRef} />
    </div>
  );
}

interface HistoryModeViewProps {
  messages: Message[];
  isTyping: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

function HistoryModeView({
  messages,
  isTyping,
  messagesEndRef,
}: HistoryModeViewProps) {
  return (
    <div className="h-full flex flex-col">
      {/* History Header */}
      <div className="p-4 border-b border-border bg-sidebar">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageCircle size={16} />
          <span>Chat History</span>
          <span className="text-muted-foreground/70">
            • {messages.length} pesan
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="w-full px-6 py-4 space-y-4">
          {messages.map((msg, idx) => (
            <MessageBubble key={idx} message={msg} />
          ))}

          {isTyping && <TypingIndicator />}

          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
