// 문의 접수: 슈퍼베이스에 저장 + 리센드로 지메일 알림
// 비밀 열쇠는 코드에 없고 버셀 설정(환경 변수)에서만 읽어요.
const LIMITS = { name: 50, contact: 100, message: 1000 };
const DAILY_LIMIT = 50;

// 수식 입력 차단: = + - @ 로 시작하면 앞에 ' 를 붙여 글자로 저장
function safe(v) {
  const s = String(v ?? '').trim();
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function esc(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '잘못된 요청이에요.' });

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, NOTIFY_EMAIL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: '서버 설정이 아직 끝나지 않았어요.' });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  // 자동 등록 차단: 숨은 칸이 채워져 있으면 조용히 성공한 척 버림
  if (b.website) return res.status(200).json({ ok: true });

  const name = String(b.name ?? '').trim();
  const contact = String(b.contact ?? '').trim();
  const message = String(b.message ?? '').trim();
  if (!name || !contact || !message) return res.status(400).json({ error: '이름, 연락처, 문의 내용을 모두 적어 주세요.' });
  if (name.length > LIMITS.name || contact.length > LIMITS.contact || message.length > LIMITS.message)
    return res.status(400).json({ error: '글자 수가 너무 많아요.' });

  // 새 형식 비밀 열쇠(sb_secret_...)는 apikey 머리말로만 보내요. 옛 형식(eyJ...)만 Authorization도 필요해요.
  const H = { apikey: SUPABASE_SERVICE_KEY };
  if (SUPABASE_SERVICE_KEY.startsWith('eyJ')) H.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;

  // 하루 접수 한도
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const cnt = await fetch(`${SUPABASE_URL}/rest/v1/inquiries?select=id&created_at=gte.${since}`, {
    headers: { ...H, Prefer: 'count=exact', Range: '0-0' },
  });
  const total = Number((cnt.headers.get('content-range') || '').split('/')[1] || 0);
  if (total >= DAILY_LIMIT) return res.status(429).json({ error: '오늘 접수가 가득 찼어요. 내일 다시 시도해 주세요.' });

  const row = { name: safe(name), contact: safe(contact), message: safe(message), status: '신규' };
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/inquiries`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!ins.ok) return res.status(500).json({ error: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });

  // 알림 메일 (실패해도 문의 저장은 이미 끝났으니 성공 처리)
  if (RESEND_API_KEY && NOTIFY_EMAIL) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: '술술 일본어 <onboarding@resend.dev>',
          to: [NOTIFY_EMAIL],
          subject: `[술술 일본어] 새 문의: ${row.name}`,
          html: `<p><b>이름</b> ${esc(row.name)}</p><p><b>연락처</b> ${esc(row.contact)}</p><p><b>문의 내용</b><br>${esc(row.message).replace(/\n/g, '<br>')}</p>`,
        }),
      });
    } catch (_) {}
  }
  return res.status(200).json({ ok: true });
}
