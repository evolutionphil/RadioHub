import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Send, Circle, CheckCheck, Users, MessageCircle, ArrowLeft } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserInfo {
  _id: string;
  username: string;
  fullName?: string;
  avatar?: string;
  profileImageUrl?: string;
  online?: boolean;
}

interface Conversation {
  partnerId: string;
  partner: UserInfo | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  online?: boolean;
}

interface Message {
  _id: string;
  fromUserId: string;
  toUserId: string;
  content: string;
  read: boolean;
  createdAt: string;
}

interface WsEvent {
  type: string;
  message?: Message;
  sender?: UserInfo;
  fromUser?: UserInfo;
  fromUserId?: string;
  byUserId?: string;
  userId?: string;
  online?: boolean;
  echo?: boolean;
  onlineUsers?: string[];
  preview?: string;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ user, size = 40 }: { user: UserInfo | null; size?: number }) {
  if (!user) {
    return (
      <div
        className="rounded-full flex items-center justify-center bg-gray-800 flex-shrink-0"
        style={{ width: size, height: size }}
      >
        <Users size={size * 0.4} className="text-gray-600" />
      </div>
    );
  }
  const src = user.avatar || user.profileImageUrl;
  const initial = (user.fullName || user.username || "?").charAt(0).toUpperCase();
  const dot = user.online !== undefined && (
    <span
      className="absolute bottom-0 right-0 rounded-full border-2"
      style={{
        width: size * 0.27,
        height: size * 0.27,
        background: user.online ? "#22c55e" : "#4b5563",
        borderColor: "#151515",
      }}
    />
  );

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt={user.fullName || user.username} className="rounded-full object-cover w-full h-full" />
      ) : (
        <div
          className="rounded-full flex items-center justify-center text-white font-bold w-full h-full"
          style={{ background: "linear-gradient(135deg,#F86DAD,#FF4FA0)", fontSize: size * 0.4 }}
        >
          {initial}
        </div>
      )}
      {dot}
    </div>
  );
}

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 604800) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── Conversation Item ────────────────────────────────────────────────────────

function ConvItem({ conv, active, onClick }: { conv: Conversation; active: boolean; onClick: () => void }) {
  const name = conv.partner?.fullName || conv.partner?.username || "Unknown";
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-all"
      style={{
        background: active ? "rgba(255,65,153,0.1)" : "transparent",
        borderLeft: active ? "3px solid #FF4199" : "3px solid transparent",
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "#1A1A1A"; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <Avatar user={conv.partner ? { ...conv.partner, online: conv.online } : null} size={40} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-white font-semibold text-sm truncate">{name}</span>
          {conv.lastMessageAt && (
            <span className="text-gray-500 text-[11px] flex-shrink-0 ml-1">{formatTime(conv.lastMessageAt)}</span>
          )}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-gray-400 text-xs truncate">{conv.lastMessage || "—"}</span>
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

// ─── Message Bubble ───────────────────────────────────────────────────────────

function Bubble({ msg, isOwn, isLast }: { msg: Message; isOwn: boolean; isLast: boolean }) {
  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-1.5`}>
      <div
        className="max-w-[70%] rounded-2xl px-4 py-2.5"
        style={{
          background: isOwn ? "#FF4199" : "#2A2A2A",
          borderBottomRightRadius: isOwn ? 4 : undefined,
          borderBottomLeftRadius: isOwn ? undefined : 4,
        }}
      >
        <p className="text-white text-sm leading-relaxed break-words whitespace-pre-wrap">{msg.content}</p>
        <div className={`flex items-center gap-1 mt-1 ${isOwn ? "justify-end" : "justify-start"}`}>
          <span className="text-[10px]" style={{ color: isOwn ? "rgba(255,255,255,0.55)" : "#5a5a6a" }}>
            {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {isOwn && isLast && msg.read && <CheckCheck size={10} className="text-white/50" />}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-2">
      <div className="rounded-2xl px-4 py-3" style={{ background: "#2A2A2A", borderBottomLeftRadius: 4 }}>
        <div className="flex gap-1 items-center h-3">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-gray-400"
              style={{ animation: `chatBounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [input, setInput] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState<UserInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState<Set<string>>(new Set());
  const [localMsgs, setLocalMsgs] = useState<Message[]>([]);
  const [wsOk, setWsOk] = useState(false);
  const [tab, setTab] = useState<"chats" | "contacts">("chats");

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const hbInterval = useRef<ReturnType<typeof setInterval>>();
  const activeIdRef = useRef<string | null>(null);

  // Use a ref for the latest onWsEvent to avoid stale closures in the WS handler
  const onWsEventRef = useRef<(ev: WsEvent) => void>(() => {});

  const myId: string = (user as any)?._id || (user as any)?.id || "";

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // Auto-open conversation from ?partner= URL param (e.g. when clicking a message notification)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const partner = params.get("partner");
    if (partner) setActiveId(partner);
  }, []);

  // When opening a conversation, invalidate notifications (server marks them read on fetch)
  useEffect(() => {
    setLocalMsgs([]);
    // Tell server which conversation we're viewing so it skips notifications for active chats
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chat:active", withUserId: activeId || null }));
    }
    if (activeId) {
      setTimeout(() => qc.invalidateQueries({ queryKey: ["/api/user/notifications"] }), 800);
    }
  }, [activeId, qc]);

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: convsData, isLoading: convsLoading } = useQuery<{ conversations: Conversation[] }>({
    queryKey: ["/api/messages/conversations"],
    staleTime: 0,
    refetchInterval: wsOk ? 30_000 : 8_000,
    retry: 1,
  });

  const { data: contactsData } = useQuery<{ contacts: UserInfo[] }>({
    queryKey: ["/api/messages/contacts"],
    refetchInterval: 60_000,
    retry: 1,
  });

  const { data: chatData, isLoading: chatLoading } = useQuery<{
    messages: Message[];
    partner: UserInfo | null;
    hasMore: boolean;
  }>({
    queryKey: ["/api/messages/conversation", activeId],
    enabled: !!activeId,
    staleTime: 0,
    refetchInterval: wsOk ? false : 5_000,
    retry: 1,
  });

  const convs = convsData?.conversations ?? [];
  const contacts = contactsData?.contacts ?? [];
  const dbMsgs = chatData?.messages ?? [];
  const partner = chatData?.partner ?? convs.find(c => c.partnerId === activeId)?.partner ?? null;

  // Merge DB + local WS messages (deduplicated, chronological)
  const messages = (() => {
    const known = new Set(dbMsgs.map(m => m._id));
    const extra = localMsgs.filter(m => !known.has(m._id));
    return [...dbMsgs, ...extra].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  })();

  // ─── WebSocket event handler (kept in a ref so the WS handler never goes stale) ─

  const onWsEvent = useCallback((ev: WsEvent) => {
    switch (ev.type) {
      case "chat:connected":
        if (ev.onlineUsers) setOnline(new Set(ev.onlineUsers));
        break;

      case "chat:message": {
        if (!ev.message) break;
        const m = ev.message;
        const inActive =
          (m.fromUserId === activeIdRef.current && m.toUserId === myId) ||
          (m.fromUserId === myId && m.toUserId === activeIdRef.current);

        if (inActive) {
          setLocalMsgs(prev => (prev.find(x => x._id === m._id) ? prev : [...prev, m]));
          if (m.fromUserId !== myId) {
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "chat:read", fromUserId: m.fromUserId }));
            }
            qc.invalidateQueries({ queryKey: ["/api/messages/conversation", activeIdRef.current] });
          }
        }

        qc.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
        qc.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
        qc.invalidateQueries({ queryKey: ["/api/user/notifications"] });
        break;
      }

      case "notification:new_message":
        qc.invalidateQueries({ queryKey: ["/api/user/notifications"] });
        break;

      case "chat:typing":
        if (!ev.fromUserId) break;
        setTyping(prev => new Set([...prev, ev.fromUserId!]));
        setTimeout(() => setTyping(prev => { const n = new Set(prev); n.delete(ev.fromUserId!); return n; }), 3_200);
        break;

      case "chat:read":
        if (ev.byUserId) qc.invalidateQueries({ queryKey: ["/api/messages/conversation", ev.byUserId] });
        break;

      case "chat:online_status":
        if (!ev.userId) break;
        setOnline(prev => {
          const n = new Set(prev);
          ev.online ? n.add(ev.userId!) : n.delete(ev.userId!);
          return n;
        });
        break;
    }
  }, [myId, qc]);

  // Keep ref in sync with latest callback (avoids stale closures in WS handler)
  useEffect(() => { onWsEventRef.current = onWsEvent; }, [onWsEvent]);

  // ─── WebSocket ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    let destroyed = false;
    let ws: WebSocket;

    const connect = async () => {
      try {
        // credentials: "include" ensures session cookie is always sent (critical for auth)
        const res = await fetch("/api/messages/ws-ticket", { credentials: "include" });
        if (!res.ok || destroyed) return;
        const { ticket } = await res.json();
        if (destroyed) return;

        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${proto}://${window.location.host}/ws/chat?ticket=${ticket}`);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsOk(true);
          clearInterval(hbInterval.current);
          hbInterval.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "chat:ping" }));
          }, 25_000);
          // Tell server which conversation we're already viewing (in case WS reconnected)
          if (activeIdRef.current) {
            ws.send(JSON.stringify({ type: "chat:active", withUserId: activeIdRef.current }));
          }
        };

        ws.onclose = () => {
          setWsOk(false);
          clearInterval(hbInterval.current);
          if (!destroyed) setTimeout(connect, 3_500);
        };

        ws.onerror = () => ws.close();

        // Always call the latest version of onWsEvent via the ref
        ws.onmessage = ({ data }) => {
          try { onWsEventRef.current(JSON.parse(data)); } catch {}
        };
      } catch {}
    };

    connect();
    return () => {
      destroyed = true;
      clearInterval(hbInterval.current);
      wsRef.current?.close();
    };
  }, [user]);

  const sendWs = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  // ─── Typing indicator send ─────────────────────────────────────────────────

  const emitTyping = () => {
    if (!activeId) return;
    sendWs({ type: "chat:typing", toUserId: activeId });
    clearTimeout(typingTimer.current);
  };

  // ─── Send mutation ─────────────────────────────────────────────────────────

  const sendMut = useMutation({
    mutationFn: (content: string) =>
      // FIX: body must be wrapped in { body: ... } for apiRequest
      apiRequest("POST", "/api/messages/send", { body: { toUserId: activeId, content } }),
    onSuccess: () => {
      setInput("");
      qc.invalidateQueries({ queryKey: ["/api/messages/conversation", activeId] });
      qc.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
    },
    onError: (err: any) => {
      const msg: string = err?.message || "";
      if (msg.toLowerCase().includes("follow")) {
        alert("You can only message people you follow or who follow you.");
      }
    },
  });

  // ─── Auto-scroll ───────────────────────────────────────────────────────────

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, typing.size]);

  // ─── Reset local msgs on conversation switch ───────────────────────────────

  useEffect(() => {
    setLocalMsgs([]);
    if (activeId) sendWs({ type: "chat:read", fromUserId: activeId });
  }, [activeId]);

  // ─── User search ───────────────────────────────────────────────────────────

  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!searchQ.trim() || searchQ.length < 2) { setSearchRes([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/messages/search-users?q=${encodeURIComponent(searchQ)}`, { credentials: "include" });
        const d = await r.json();
        setSearchRes(d.users ?? []);
      } catch { setSearchRes([]); }
      setSearching(false);
    }, 350);
  }, [searchQ]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const doSend = () => {
    const t = input.trim();
    if (!t || !activeId || sendMut.isPending) return;
    sendMut.mutate(t);
  };

  const openConv = (userId: string) => {
    setActiveId(userId);
    setSearchQ("");
    setSearchRes([]);
    setTab("chats");
    setMobileView('chat');
  };

  const partnerOnline = partner ? online.has(partner._id) : false;
  const partnerTyping = activeId ? typing.has(activeId) : false;

  const enrichedConvs = convs.map(c => ({ ...c, online: c.partner ? online.has(c.partner._id) : false }));
  const enrichedContacts = contacts.map(c => ({ ...c, online: online.has(c._id) }));
  const activeName = partner?.fullName || partner?.username || "";

  // ─── Render ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let startX = 0;
    const handleTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (mobileView === 'chat' && e.changedTouches[0].clientX - startX > 100) {
        setMobileView('list');
      }
    };
    document.addEventListener('touchstart', handleTouchStart);
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [mobileView]);

  return (
    <>
      <style>{`
        @keyframes chatBounce {
          0%,80%,100%{transform:translateY(0)}
          40%{transform:translateY(-5px)}
        }
      `}</style>

      <div
        className="-mx-2 -my-8 md:-mx-8 flex pb-12 md:pb-0"
        style={{ height: "calc(100vh - 70px)", overflow: "hidden" }}
      >
        {/* ── Left: conversation list ──
            Mobile: full-width, hidden when chat is open
            Desktop (md+): fixed 260px, always visible  */}
        <div
          className={`flex-col border-r flex-shrink-0 ${mobileView === 'list' ? 'flex' : 'hidden'} md:flex w-full md:w-[260px]`}
          style={{ background: "#151515", borderColor: "#222" }}
        >
          {/* Header */}
          <div className="px-4 pt-4 pb-2 border-b flex-shrink-0" style={{ borderColor: "#222" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-bold text-base">Messages</span>
              <div className="flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: wsOk ? "#22c55e" : "#eab308", animation: wsOk ? "none" : "pulse 1s infinite" }}
                />
                <span className="text-[10px]" style={{ color: wsOk ? "#22c55e" : "#eab308" }}>
                  {wsOk ? "Live" : "Connecting…"}
                </span>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-3">
              {(["chats", "contacts"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="flex-1 py-1.5 rounded text-xs font-semibold capitalize transition-all"
                  style={{ background: tab === t ? "#FF4199" : "#2D2D2D", color: tab === t ? "#fff" : "#9ca3af" }}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
              <input
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Search to chat…"
                className="w-full pl-8 pr-3 py-2 rounded text-xs text-white placeholder-gray-600 outline-none"
                style={{ background: "#2D2D2D", border: "none" }}
              />
            </div>
          </div>

          {/* Search results */}
          {searchRes.length > 0 && (
            <div className="border-b flex-shrink-0" style={{ borderColor: "#222" }}>
              <div className="px-4 py-1.5 text-[9px] text-gray-500 uppercase tracking-widest">
                {searching ? "Searching…" : "Start chat with"}
              </div>
              {searchRes.map(u => (
                <div
                  key={u._id}
                  onClick={() => openConv(u._id)}
                  className="flex items-center gap-2.5 px-4 py-2.5 cursor-pointer hover:bg-[#2D2D2D] transition-colors"
                >
                  <Avatar user={{ ...u, online: online.has(u._id) }} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-xs font-semibold truncate">{u.fullName || u.username}</div>
                    {u.fullName && <div className="text-gray-500 text-[10px]">@{u.username}</div>}
                  </div>
                  {online.has(u._id) && <Circle size={7} className="text-green-400 fill-green-400 flex-shrink-0" />}
                </div>
              ))}
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {tab === "chats" && (
              <>
                {convsLoading && (
                  <div className="flex flex-col gap-2 p-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="w-10 h-10 rounded-full bg-gray-800 flex-shrink-0" />
                        <div className="flex-1"><div className="h-2.5 bg-gray-800 rounded w-20 mb-2" /><div className="h-2 bg-gray-800 rounded w-32" /></div>
                      </div>
                    ))}
                  </div>
                )}
                {!convsLoading && enrichedConvs.length === 0 && !searchRes.length && (
                  <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                    <MessageCircle size={22} className="text-gray-700 mb-2" />
                    <p className="text-gray-600 text-xs">No conversations yet. Follow someone to start chatting.</p>
                  </div>
                )}
                {enrichedConvs.map(c => (
                  <ConvItem key={c.partnerId} conv={c} active={activeId === c.partnerId} onClick={() => openConv(c.partnerId)} />
                ))}
              </>
            )}

            {tab === "contacts" && (
              <>
                {enrichedContacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                    <Users size={22} className="text-gray-700 mb-2" />
                    <p className="text-gray-600 text-xs">Follow or be followed to see contacts here.</p>
                  </div>
                ) : (
                  <div className="py-1">
                    {enrichedContacts.map(c => (
                      <div
                        key={c._id}
                        onClick={() => openConv(c._id)}
                        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#1A1A1A] transition-colors"
                      >
                        <Avatar user={c} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-xs font-semibold truncate">{c.fullName || c.username}</div>
                          <div className="text-gray-600 text-[10px]">@{c.username}</div>
                        </div>
                        {c.online && <Circle size={7} className="text-green-400 fill-green-400 flex-shrink-0" />}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right: chat panel ──
            Mobile: full-width, hidden when list is showing
            Desktop (md+): flex-1, always visible  */}
        <div
          className={`flex-col min-w-0 ${mobileView === 'chat' ? 'flex' : 'hidden'} md:flex flex-1`}
          style={{ background: "#0E0E0E" }}
        >
          {activeId ? (
            <>
              {/* Chat header */}
              <div
                className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0"
                style={{ background: "#151515", borderColor: "#222" }}
              >
                {/* Back button — mobile only */}
                <button
                  onClick={() => setMobileView('list')}
                  className="md:hidden flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 hover:bg-[#2D2D2D] transition-colors"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft size={18} className="text-white" />
                </button>
                <Avatar user={partner ? { ...partner, online: partnerOnline } : null} size={38} />
                <div className="flex-1 min-w-0">
                  <div className="text-white font-semibold text-sm truncate">{activeName}</div>
                  <div
                    className="text-xs transition-colors"
                    style={{ color: partnerTyping ? "#FF4199" : partnerOnline ? "#22c55e" : "#6b7280" }}
                  >
                    {partnerTyping ? "typing…" : partnerOnline ? "Online" : "Offline"}
                  </div>
                </div>
              </div>

              {/* Messages area */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {chatLoading ? (
                  <div className="flex flex-col gap-3">
                    {[80, 140, 60, 110].map((w, i) => (
                      <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
                        <div className="animate-pulse rounded-2xl h-10" style={{ background: "#2A2A2A", width: w }} />
                      </div>
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
                    <MessageCircle size={32} style={{ color: "#FF4199" }} />
                    <p className="text-gray-400 text-sm">Say hello to {activeName}! 👋</p>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <Bubble
                      key={m._id}
                      msg={m}
                      isOwn={m.fromUserId === myId}
                      isLast={i === messages.length - 1}
                    />
                  ))
                )}
                {partnerTyping && <TypingIndicator />}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div
                className="flex-shrink-0 flex items-center gap-2 px-3 py-3 border-t"
                style={{ background: "#151515", borderColor: "#222" }}
              >
                <div className="flex-1 flex items-center rounded-full overflow-hidden" style={{ background: "#2D2D2D" }}>
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={e => { setInput(e.target.value); emitTyping(); }}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } }}
                    placeholder={`Message ${activeName || "…"}`}
                    maxLength={2000}
                    className="flex-1 px-4 py-2.5 bg-transparent text-white text-sm placeholder-gray-600 outline-none"
                  />
                  {input.length > 1800 && (
                    <span className="pr-3 text-[10px]" style={{ color: input.length > 1950 ? "#ef4444" : "#6b7280" }}>
                      {2000 - input.length}
                    </span>
                  )}
                </div>
                <button
                  onClick={doSend}
                  disabled={!input.trim() || sendMut.isPending}
                  className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: input.trim() && !sendMut.isPending ? "#FF4199" : "#2D2D2D",
                    cursor: input.trim() && !sendMut.isPending ? "pointer" : "default",
                  }}
                >
                  <Send size={16} className="text-white" style={{ marginLeft: 2 }} />
                </button>
              </div>
            </>
          ) : (
            /* Desktop empty state — only shown on md+ (mobile always shows list or chat) */
            <div className="flex-1 hidden md:flex flex-col items-center justify-center gap-4 opacity-40">
              <MessageCircle size={48} style={{ color: "#FF4199" }} />
              <div className="text-center">
                <p className="text-white font-semibold text-base">Your Messages</p>
                <p className="text-gray-500 text-sm mt-1">Select a conversation or start a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
