import { useState, useCallback, useEffect } from "react";

interface UserData {
  email: string;
  name: string;
  plan: string;
  company?: string;
  website?: string;
  createdAt: string;
  lastLoginAt?: string;
}

interface KeyData {
  id: string;
  keyPrefix: string;
  name: string;
  appName?: string;
  plan: string;
  status: string;
  usage: {
    todayCount: number;
    monthCount: number;
    totalCount: number;
    lastUsedAt?: string;
  };
  limits: {
    rateLimitPerMin: number;
    dailyQuota: number;
    monthlyQuota: number;
  };
  createdAt: string;
  expiresAt?: string;
}

export default function ApiUserPage() {
  const [view, setView] = useState<"login" | "register" | "dashboard">("login");
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("api-user-token");
    return null;
  });
  const [user, setUser] = useState<UserData | null>(null);
  const [keys, setKeys] = useState<KeyData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKeyRaw, setNewKeyRaw] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPassword2, setRegPassword2] = useState("");
  const [regCompany, setRegCompany] = useState("");
  const [regWebsite, setRegWebsite] = useState("");

  const [newAppName, setNewAppName] = useState("");
  const [newAppUrl, setNewAppUrl] = useState("");
  const [newUsageReason, setNewUsageReason] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const saveToken = useCallback((t: string) => {
    setToken(t);
    localStorage.setItem("api-user-token", t);
  }, []);

  const logout = useCallback(() => {
    if (token) {
      fetch("/api/api-keys/user/logout", { method: "POST", headers: { "X-API-User-Token": token } });
    }
    setToken(null);
    setUser(null);
    setKeys([]);
    localStorage.removeItem("api-user-token");
    setView("login");
  }, [token]);

  const fetchUserData = useCallback(async (t: string) => {
    try {
      const res = await fetch("/api/api-keys/user/me", {
        headers: { "X-API-User-Token": t },
      });
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          return;
        }
        throw new Error("Failed to load");
      }
      const data = await res.json();
      setUser(data.user);
      setKeys(data.keys);
      setView("dashboard");
    } catch {
      logout();
    }
  }, [logout]);

  useEffect(() => {
    if (token) fetchUserData(token);
  }, [token, fetchUserData]);

  useEffect(() => {
    document.title = "Developer Portal - MegaRadio API";
  }, []);

  const handleLogin = useCallback(async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setError("Email and password required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/api-keys/user/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
      } else {
        saveToken(data.token);
        setUser(data.user);
        await fetchUserData(data.token);
      }
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }, [loginEmail, loginPassword, saveToken, fetchUserData]);

  const handleRegister = useCallback(async () => {
    if (!regName.trim() || !regEmail.trim() || !regPassword.trim()) {
      setError("Name, email, and password are required");
      return;
    }
    if (regPassword !== regPassword2) {
      setError("Passwords do not match");
      return;
    }
    if (regPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/api-keys/user/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: regEmail, password: regPassword, name: regName, company: regCompany, website: regWebsite }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Registration failed");
      } else {
        saveToken(data.token);
        setNewKeyRaw(data.apiKey);
        await fetchUserData(data.token);
      }
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }, [regName, regEmail, regPassword, regPassword2, regCompany, regWebsite, saveToken, fetchUserData]);

  const handleCreateKey = useCallback(async () => {
    if (!token) return;
    setCreatingKey(true);
    setError(null);
    try {
      const res = await fetch("/api/api-keys/user/create-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-User-Token": token },
        body: JSON.stringify({ appName: newAppName, appUrl: newAppUrl, usageReason: newUsageReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create key");
      } else {
        setNewKeyRaw(data.apiKey);
        setShowCreateForm(false);
        setNewAppName("");
        setNewAppUrl("");
        setNewUsageReason("");
        await fetchUserData(token);
      }
    } catch {
      setError("Network error");
    }
    setCreatingKey(false);
  }, [token, newAppName, newAppUrl, newUsageReason, fetchUserData]);

  const handleRevokeKey = useCallback(async (keyId: string) => {
    if (!token) return;
    try {
      const res = await fetch("/api/api-keys/user/revoke-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-User-Token": token },
        body: JSON.stringify({ keyId }),
      });
      if (res.ok) {
        await fetchUserData(token);
      }
    } catch {}
  }, [token, fetchUserData]);

  const copyKey = useCallback((key: string) => {
    navigator.clipboard.writeText(key);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  }, []);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 14px", background: "#f8fafc", border: "1px solid #e2e8f0",
    borderRadius: 8, color: "#0f172a", fontSize: 14, outline: "none", boxSizing: "border-box",
  };
  const btnPrimary: React.CSSProperties = {
    padding: "10px 24px", background: "#3b82f6", color: "#fff", border: "none",
    borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 14, width: "100%",
  };

  if (view !== "dashboard") {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
        <div style={{ width: "100%", maxWidth: 440, padding: 24 }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <span style={{ fontSize: 40 }}>📻</span>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: "8px 0 4px" }}>MegaRadio API</h1>
            <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>Developer Portal</p>
          </div>

          <div style={{ background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
            <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
              <button
                onClick={() => { setView("login"); setError(null); }}
                style={{
                  flex: 1, padding: "10px", border: "none", borderBottom: view === "login" ? "3px solid #3b82f6" : "3px solid transparent",
                  background: "transparent", fontWeight: view === "login" ? 700 : 500,
                  color: view === "login" ? "#0f172a" : "#94a3b8", cursor: "pointer", fontSize: 14,
                }}
              >
                Login
              </button>
              <button
                onClick={() => { setView("register"); setError(null); }}
                style={{
                  flex: 1, padding: "10px", border: "none", borderBottom: view === "register" ? "3px solid #3b82f6" : "3px solid transparent",
                  background: "transparent", fontWeight: view === "register" ? 700 : 500,
                  color: view === "register" ? "#0f172a" : "#94a3b8", cursor: "pointer", fontSize: 14,
                }}
              >
                Register
              </button>
            </div>

            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
                {error}
              </div>
            )}

            {view === "login" && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Email</label>
                  <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                </div>
                <div style={{ marginBottom: 24 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Password</label>
                  <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Your password" style={inputStyle} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                </div>
                <button onClick={handleLogin} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
                  {loading ? "Logging in..." : "Login"}
                </button>
              </div>
            )}

            {view === "register" && (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Full Name *</label>
                  <input type="text" value={regName} onChange={e => setRegName(e.target.value)} placeholder="John Doe" style={inputStyle} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Email *</label>
                  <input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} />
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Password *</label>
                    <input type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} placeholder="Min 6 chars" style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Confirm *</label>
                    <input type="password" value={regPassword2} onChange={e => setRegPassword2(e.target.value)} placeholder="Repeat" style={inputStyle} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Company</label>
                    <input type="text" value={regCompany} onChange={e => setRegCompany(e.target.value)} placeholder="Optional" style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Website</label>
                    <input type="text" value={regWebsite} onChange={e => setRegWebsite(e.target.value)} placeholder="Optional" style={inputStyle} />
                  </div>
                </div>
                <button onClick={handleRegister} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, marginTop: 8 }}>
                  {loading ? "Creating account..." : "Create Account & Get API Key"}
                </button>
                <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 12, lineHeight: 1.6 }}>
                  Free plan includes 60 req/min, 1K/day, 10K/month. Upgrade to Pro anytime.
                </p>
              </div>
            )}
          </div>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <a href="/api-docs" style={{ fontSize: 13, color: "#3b82f6", textDecoration: "none" }}>&larr; Back to API Documentation</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <header style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 28 }}>📻</span>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>MegaRadio Developer Portal</h1>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{user?.email}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: user?.plan === "pro" ? "#dcfce7" : "#eff6ff",
            color: user?.plan === "pro" ? "#166534" : "#1d4ed8",
          }}>
            {user?.plan?.toUpperCase()} PLAN
          </span>
          <a href="/api-docs" style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}>API Docs</a>
          <button onClick={logout} style={{ padding: "6px 14px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#475569" }}>
            Logout
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 20px" }}>
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
            {error}
            <button onClick={() => setError(null)} style={{ float: "right", background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontWeight: 700 }}>x</button>
          </div>
        )}

        {newKeyRaw && (
          <div style={{ background: "#f0fdf4", border: "2px solid #22c55e", borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>&#9989;</span>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#166534", margin: 0 }}>Your New API Key</h3>
            </div>
            <p style={{ fontSize: 12, color: "#166534", margin: "0 0 12px", lineHeight: 1.6 }}>
              Save this key now! It will not be shown again for security reasons.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ flex: 1, padding: "10px 14px", background: "#fff", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 14, fontFamily: "monospace", color: "#0f172a", wordBreak: "break-all" }}>
                {newKeyRaw}
              </code>
              <button
                onClick={() => copyKey(newKeyRaw)}
                style={{ padding: "10px 16px", background: "#22c55e", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
              >
                {keyCopied ? "Copied!" : "Copy"}
              </button>
            </div>
            <button onClick={() => setNewKeyRaw(null)} style={{ marginTop: 12, padding: "6px 14px", background: "transparent", border: "1px solid #bbf7d0", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#166534" }}>
              I've saved my key
            </button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>ACTIVE KEYS</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{keys.filter(k => k.status === 'active').length}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>of 3 maximum</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>TODAY USAGE</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{keys.reduce((s, k) => s + (k.usage?.todayCount || 0), 0)}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>requests today</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>MONTH USAGE</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{keys.reduce((s, k) => s + (k.usage?.monthCount || 0), 0)}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>requests this month</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>TOTAL ALL TIME</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{keys.reduce((s, k) => s + (k.usage?.totalCount || 0), 0)}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>total requests</div>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>API Keys</h2>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              style={{ padding: "8px 16px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
              disabled={keys.filter(k => k.status === 'active').length >= 3}
            >
              + New Key
            </button>
          </div>

          {showCreateForm && (
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>App Name</label>
                  <input type="text" value={newAppName} onChange={e => setNewAppName(e.target.value)} placeholder="My App" style={{ ...inputStyle, fontSize: 12, padding: "8px 10px" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>App URL</label>
                  <input type="text" value={newAppUrl} onChange={e => setNewAppUrl(e.target.value)} placeholder="https://myapp.com" style={{ ...inputStyle, fontSize: 12, padding: "8px 10px" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Usage Reason</label>
                  <input type="text" value={newUsageReason} onChange={e => setNewUsageReason(e.target.value)} placeholder="Mobile app, website..." style={{ ...inputStyle, fontSize: 12, padding: "8px 10px" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleCreateKey} disabled={creatingKey} style={{ padding: "8px 20px", background: "#22c55e", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                  {creatingKey ? "Creating..." : "Create Key"}
                </button>
                <button onClick={() => setShowCreateForm(false)} style={{ padding: "8px 14px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#475569" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {keys.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
              <p style={{ fontSize: 14 }}>No API keys yet. Click "+ New Key" to create one.</p>
            </div>
          ) : (
            <div>
              {keys.map(k => (
                <div key={k.id} style={{ padding: "16px 20px", borderBottom: "1px solid #f8fafc", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <code style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", fontFamily: "monospace" }}>{k.keyPrefix}...</code>
                      <span style={{
                        padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700,
                        background: k.status === 'active' ? "#dcfce7" : k.status === 'revoked' ? "#fef2f2" : "#fef3c7",
                        color: k.status === 'active' ? "#166534" : k.status === 'revoked' ? "#dc2626" : "#b45309",
                      }}>
                        {k.status.toUpperCase()}
                      </span>
                      <span style={{
                        padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                        background: k.plan === 'pro' ? "#dcfce7" : "#eff6ff",
                        color: k.plan === 'pro' ? "#166534" : "#1d4ed8",
                      }}>
                        {k.plan.toUpperCase()}
                      </span>
                    </div>
                    {k.appName && <div style={{ fontSize: 12, color: "#64748b" }}>{k.appName}</div>}
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                      Created {new Date(k.createdAt).toLocaleDateString()}
                      {k.usage?.lastUsedAt && ` | Last used ${new Date(k.usage.lastUsedAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      Today: <strong>{k.usage?.todayCount || 0}</strong>/{k.limits?.dailyQuota}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      Month: <strong>{k.usage?.monthCount || 0}</strong>/{k.limits?.monthlyQuota}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <div style={{
                        height: 4, borderRadius: 2, background: "#f1f5f9", overflow: "hidden",
                      }}>
                        <div style={{
                          height: "100%", borderRadius: 2,
                          width: `${Math.min(100, ((k.usage?.todayCount || 0) / k.limits?.dailyQuota) * 100)}%`,
                          background: ((k.usage?.todayCount || 0) / k.limits?.dailyQuota) > 0.8 ? "#ef4444" : "#22c55e",
                        }} />
                      </div>
                    </div>
                  </div>
                  {k.status === 'active' && (
                    <button
                      onClick={() => handleRevokeKey(k.id)}
                      style={{ padding: "6px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, cursor: "pointer", fontSize: 11, color: "#dc2626", fontWeight: 600 }}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 12px" }}>Your Plan: {user?.plan?.toUpperCase()}</h3>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 2 }}>
              {user?.plan === 'free' ? (
                <>
                  <div>60 requests/minute</div>
                  <div>1,000 requests/day</div>
                  <div>10,000 requests/month</div>
                  <div>Max 3 API keys</div>
                </>
              ) : (
                <>
                  <div>300 requests/minute</div>
                  <div>10,000 requests/day</div>
                  <div>100,000 requests/month</div>
                  <div>Max 3 API keys</div>
                  <div>Priority support</div>
                </>
              )}
            </div>
            {user?.plan === 'free' && (
              <div style={{ marginTop: 16, padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>Upgrade to Pro</h4>
                <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px", lineHeight: 1.6 }}>
                  5x higher limits, priority support, and more. Contact us to upgrade.
                </p>
                <a
                  href="mailto:api@themegaradio.com?subject=API%20Pro%20Plan%20Upgrade"
                  style={{ padding: "8px 16px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, textDecoration: "none", display: "inline-block" }}
                >
                  Contact for Pro
                </a>
              </div>
            )}
          </div>

          <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 12px" }}>Quick Start</h3>
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 8px" }}>Add your API key to requests:</p>
              <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 6, fontSize: 11, fontFamily: "monospace", overflow: "auto", border: "1px solid #e2e8f0", color: "#0f172a", margin: "0 0 12px" }}>
{`curl -H "X-API-Key: mr_your_key" \\
  https://themegaradio.com/api/stations`}
              </pre>
              <p style={{ margin: "0 0 8px" }}>Or use Authorization header:</p>
              <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 6, fontSize: 11, fontFamily: "monospace", overflow: "auto", border: "1px solid #e2e8f0", color: "#0f172a", margin: 0 }}>
{`fetch("/api/stations", {
  headers: {
    "Authorization": "Bearer mr_your_key"
  }
})`}
              </pre>
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 32, padding: "20px 0", color: "#94a3b8", fontSize: 12 }}>
          MegaRadio Developer Portal &middot; <a href="/api-docs" style={{ color: "#3b82f6", textDecoration: "none" }}>API Documentation</a>
        </div>
      </div>
    </div>
  );
}
