// 관리자용: 로그인 → 문의 목록 → 상태 변경/삭제
// 관리자 비밀번호는 코드에 없고 버셀 설정(ADMIN_PASSWORD)에만 있어요.
import crypto from 'node:crypto';

const STATUSES = ['신규', '상담중', '완료'];
const SESSION_HOURS = 12;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sign = (key, v) => crypto.createHmac('sha256', key).update(v).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function cookieValue(req) {
  const m = /(?:^|;\s*)admin=([^;]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : '';
}
function isLoggedIn(req, key) {
  const [exp, sig] = cookieValue(req).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, sign(key, exp));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_PASSWORD)
    return res.status(500).json({ error: '관리자 설정이 아직 끝나지 않았어요.' });
  const key = SUPABASE_SERVICE_KEY + '|' + ADMIN_PASSWORD;

  const b = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : {};
  const action = req.method === 'GET' ? 'list' : b.action;

  if (action === 'login') {
    await sleep(1200); // 비밀번호 무작위 대입을 느리게 만들어요
    if (!same(String(b.password ?? ''), ADMIN_PASSWORD)) return res.status(401).json({ error: '비밀번호가 맞지 않아요.' });
    const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
    res.setHeader('Set-Cookie', `admin=${exp}.${sign(key, exp)}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${SESSION_HOURS * 3600}`);
    return res.status(200).json({ ok: true });
  }
  if (action === 'logout') {
    res.setHeader('Set-Cookie', 'admin=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0');
    return res.status(200).json({ ok: true });
  }

  if (!isLoggedIn(req, key)) return res.status(401).json({ error: '로그인이 필요해요.' });

  const H = { apikey: SUPABASE_SERVICE_KEY };
  if (SUPABASE_SERVICE_KEY.startsWith('eyJ')) H.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;
  const base = `${SUPABASE_URL}/rest/v1/inquiries`;

  if (action === 'list') {
    const r = await fetch(`${base}?select=id,created_at,name,contact,message,status&order=id.desc&limit=500`, { headers: H });
    if (!r.ok) return res.status(500).json({ error: '목록을 불러오지 못했어요.' });
    return res.status(200).json({ rows: await r.json() });
  }

  const id = Number(b.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: '잘못된 요청이에요.' });

  if (action === 'status') {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: '잘못된 상태예요.' });
    const r = await fetch(`${base}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: b.status }),
    });
    return r.ok ? res.status(200).json({ ok: true }) : res.status(500).json({ error: '상태를 바꾸지 못했어요.' });
  }
  if (action === 'delete') {
    const r = await fetch(`${base}?id=eq.${id}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' } });
    return r.ok ? res.status(200).json({ ok: true }) : res.status(500).json({ error: '삭제하지 못했어요.' });
  }
  return res.status(400).json({ error: '잘못된 요청이에요.' });
}
