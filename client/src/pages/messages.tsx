import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, Send, Smile } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getImageUrl } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Conversation {
  partnerId: string;
  partner: { _id: string; username: string; fullName?: string; avatar?: string; profileImageUrl?: string } | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface Message {
  _id: string;
  fromUserId: string;
  toUserId: string;
  content: string;
  read: boolean;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAvatar(user: Conversation["partner"], size = 40) {
  if (!user) return null;
  const src = user.avatar || user.profileImageUrl;
  if (src) return <img src={src} alt={user.fullName || user.username} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  const initials = (user.fullName || user.username || "?").charAt(0).toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{ width: size, height: size, background: "linear-gradient(135deg, #F86DAD, #FF4FA0)", fontSize: size * 0.4 }}
    >
      {initials}
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConversationItem({ conv, active, onClick }: { conv: Conversation; active: boolean; onClick: () => void }) {
  const name = conv.partner?.fullName || conv.partner?.username || "Unknown";
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
      style={{ background: active ? "#2D2D2D" : "transparent" }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "#1A1A1A"; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <div className="flex-shrink-0">{getAvatar(conv.partner, 40)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-white font-semibold text-sm truncate">{name}</span>
          {conv.lastMessageAt && (
            <span className="text-gray-500 text-xs flex-shrink-0 ml-1">{formatTime(conv.lastMessageAt)}</span>
          )}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-gray-400 text-xs truncate">{conv.lastMessage}</span>
          {conv.unreadCount > 0 && (
            <span className="ml-2 flex-shrink-0 bg-[#FF4199] text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className="max-w-[70%] rounded-2xl px-4 py-2.5 text-sm text-white"
        style={{
          background: isOwn ? "#2D2D2D" : "#272727",
          borderBottomRightRadius: isOwn ? 4 : undefined,
          borderBottomLeftRadius: isOwn ? undefined : 4,
        }}
      >
        <span>{msg.content}</span>
        <div className={`text-[10px] text-gray-500 mt-1 ${isOwn ? "text-right" : "text-left"}`}>
          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [activePartnerId, setActivePartnerId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: convsData, isLoading: convsLoading } = useQuery<{ conversations: Conversation[] }>({
    queryKey: ["/api/messages/conversations"],
    refetchInterval: 5000, // poll every 5s for new messages
  });

  const conversations = convsData?.conversations ?? [];

  const { data: chatData, isLoading: chatLoading } = useQuery<{ messages: Message[]; partner: Conversation["partner"] }>({
    queryKey: ["/api/messages/conversation", activePartnerId],
    enabled: !!activePartnerId,
    refetchInterval: 3000, // poll for new messages in active chat
  });

  const messages = chatData?.messages ?? [];
  const activePartner = chatData?.partner ?? conversations.find(c => c.partnerId === activePartnerId)?.partner ?? null;

  // ── Send message mutation ─────────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId: activePartnerId, content }),
      });
      if (!res.ok) throw new Error("Send failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversation", activePartnerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      setInputText("");
    },
  });

  // ── Auto-scroll to bottom ─────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── User search ───────────────────────────────────────────────────────────────

  useEffect(() => {
    clearTimeout(searchTimeout.current);
    if (!searchQ.trim() || searchQ.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/messages/search-users?q=${encodeURIComponent(searchQ)}`);
        const data = await res.json();
        setSearchResults(data.users ?? []);
      } catch { setSearchResults([]); }
      setIsSearching(false);
    }, 400);
  }, [searchQ]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !activePartnerId || sendMutation.isPending) return;
    sendMutation.mutate(text);
  }, [inputText, activePartnerId, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startConversationWith = (userId: string) => {
    setActivePartnerId(userId);
    setSearchQ("");
    setSearchResults([]);
    queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
  };

  const activeConvName = activePartner?.fullName || activePartner?.username || "";

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="-mx-2 -my-8 md:-mx-8 flex"
      style={{ height: "calc(100vh - 70px)", minHeight: 0, overflow: "hidden" }}
    >
      {/* ── Left: Conversation List ── */}
      <div
        className="flex flex-col border-r flex-shrink-0"
        style={{ width: 220, background: "#151515", borderColor: "#222" }}
      >
        {/* Search */}
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search"
              className="w-full pl-8 pr-3 py-2 rounded text-sm text-white placeholder-gray-500 outline-none"
              style={{ background: "#2D2D2D", border: "none", fontSize: 13 }}
            />
          </div>
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="border-b pb-2" style={{ borderColor: "#222" }}>
            <div className="px-4 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Start chat</div>
            {searchResults.map(u => (
              <div
                key={u._id}
                onClick={() => startConversationWith(u._id)}
                className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-[#2D2D2D] transition-colors"
              >
                {getAvatar(u, 32)}
                <div>
                  <div className="text-white text-xs font-semibold">{u.fullName || u.username}</div>
                  {u.fullName && <div className="text-gray-500 text-[10px]">@{u.username}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {convsLoading && (
            <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
          )}
          {!convsLoading && conversations.length === 0 && !searchResults.length && (
            <div className="p-4 text-center text-gray-600 text-xs">
              Search for a user above to start chatting
            </div>
          )}
          {conversations.map(conv => (
            <ConversationItem
              key={conv.partnerId}
              conv={conv}
              active={activePartnerId === conv.partnerId}
              onClick={() => setActivePartnerId(conv.partnerId)}
            />
          ))}
        </div>
      </div>

      {/* ── Right: Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0" style={{ background: "#0E0E0E" }}>
        {activePartnerId ? (
          <>
            {/* Chat header */}
            <div
              className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0"
              style={{ background: "#151515", borderColor: "#222" }}
            >
              {getAvatar(activePartner, 36)}
              <div>
                <div className="text-white font-semibold text-sm">{activeConvName}</div>
                <div className="text-green-400 text-xs">Online</div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {chatLoading && (
                <div className="text-center text-gray-500 text-sm py-8">Loading messages...</div>
              )}
              {!chatLoading && messages.length === 0 && (
                <div className="text-center text-gray-600 text-sm py-8">
                  No messages yet. Say hello! 👋
                </div>
              )}
              {messages.map(msg => (
                <MessageBubble
                  key={msg._id}
                  msg={msg}
                  isOwn={msg.fromUserId === user?._id || msg.fromUserId === (user as any)?.id}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div
              className="flex-shrink-0 flex items-center gap-3 px-4 py-4"
              style={{ background: "#272727" }}
            >
              <button className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
                <span style={{ fontSize: 24 }}>😀</span>
              </button>

              <div className="flex-1 rounded" style={{ background: "#3A3A3A" }}>
                <input
                  ref={inputRef}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Text here"
                  className="w-full px-4 py-3 bg-transparent text-white placeholder-[#7E7E7E] outline-none text-sm"
                  style={{ border: "none" }}
                  disabled={sendMutation.isPending}
                />
              </div>

              <button
                onClick={handleSend}
                disabled={!inputText.trim() || sendMutation.isPending}
                className="flex-shrink-0 w-14 h-[54px] rounded flex items-center justify-center transition-opacity"
                style={{ background: "#FF4199", opacity: inputText.trim() ? 1 : 0.5 }}
              >
                <Send className="w-5 h-5 text-white" />
              </button>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,65,153,0.1)" }}
            >
              <Send className="w-9 h-9" style={{ color: "#FF4199" }} />
            </div>
            <div className="text-white font-semibold text-lg">Your Messages</div>
            <div className="text-gray-500 text-sm text-center max-w-xs">
              Search for a user on the left to start a conversation
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
