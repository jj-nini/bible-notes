import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Email + password sign-in. Sign-ups are disabled in Supabase; the account is created in the dashboard. */
export function Login({ supabase }: { supabase: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("이메일이나 비밀번호가 맞지 않습니다.");
    setBusy(false);
  };

  return (
    <div className="login wrap">
      <form className="login-card" onSubmit={submit}>
        <h1 className="brand">말씀 노트</h1>
        <p className="sub">개인용 앱입니다. 등록된 계정으로 로그인하세요.</p>
        <label htmlFor="email">이메일</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">비밀번호</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="error">{error}</p>}
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? "로그인 중…" : "로그인"}</button>
      </form>
    </div>
  );
}
