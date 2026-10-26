// The Fall in Maple: tester report relay (Vercel function, same site as the game).
// The game POSTs {note, kind, who, shot (jpeg data URL), state, at} to /api/report.
// Stores the screenshot and save on the `reports` branch of the private source repo,
// then opens an issue labelled `tester-report` there.
// Vercel env vars: GITHUB_TOKEN (fine-grained: Issues + Contents RW on the source repo), REPO.
const MAX_BODY = 4_000_000;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export function OPTIONS() { return new Response(null, { headers: cors }); }
export function GET() { return json({ ok: true, repo: process.env.REPO || null, token: !!process.env.GITHUB_TOKEN }, 200, cors); }
export async function POST(req) {
    if (!process.env.GITHUB_TOKEN || !process.env.REPO) return json({ error: 'relay not configured' }, 503, cors);
    const len = +(req.headers.get('content-length') || 0);
    if (len > MAX_BODY) return json({ error: 'report too large' }, 413, cors);
    let r;
    try { r = await req.json(); } catch { return json({ error: 'bad json' }, 400, cors); }
    const note = String(r.note || '').trim().slice(0, 4000);
    if (!note) return json({ error: 'empty note' }, 400, cors);
    const kind = ['bug', 'looks', 'stuck', 'idea'].includes(r.kind) ? r.kind : 'bug';
    const who = String(r.who || '').slice(0, 60);
    const st = r.state && typeof r.state === 'object' ? r.state : {};

    const gh = (path, opts = {}) => fetch(`https://api.github.com/repos/${process.env.REPO}${path}`, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'maple-report-relay',
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });

    try {
      await ensureBranch(gh, 'reports');
      const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
      let shotLink = '';
      if (typeof r.shot === 'string' && r.shot.startsWith('data:image/jpeg;base64,')) {
        const b64 = r.shot.slice('data:image/jpeg;base64,'.length);
        const put = await gh(`/contents/reports/${id}.jpg`, { method: 'PUT', body: JSON.stringify({ message: `report ${id} screenshot`, content: b64, branch: 'reports' }) });
        if (put.ok) shotLink = `https://github.com/${process.env.REPO}/blob/reports/reports/${id}.jpg?raw=true`;
      }
      let saveLink = '';
      if (typeof st.save === 'string' && st.save.length < 400_000) {
        const put = await gh(`/contents/reports/${id}.save.json`, { method: 'PUT', body: JSON.stringify({ message: `report ${id} save`, content: b64utf8(st.save), branch: 'reports' }) });
        if (put.ok) saveLink = `https://github.com/${process.env.REPO}/blob/reports/reports/${id}.save.json`;
      }
      const meta = { ...st }; delete meta.save;
      const kindName = { bug: "Something's broken", looks: 'Looks wrong', stuck: 'Stuck / confused', idea: 'Idea' }[kind];
      const title = `[${kind}] ${note.split('\n')[0].slice(0, 70)}`;
      const body = [
        `**${kindName}**${who ? ` from **${who}**` : ''}`,
        '',
        note,
        '',
        shotLink ? `![screenshot](${shotLink})` : '_(no screenshot)_',
        '',
        '| | |', '|---|---|',
        ...['build', 'day', 'time', 'mode', 'street', 'district', 'room', 'pos', 'goal', 'cam', 'money', 'grounded', 'screen', 'ua']
          .filter(k => meta[k] !== undefined && meta[k] !== '')
          .map(k => `| ${k} | ${String(Array.isArray(meta[k]) ? meta[k].join(', ') : meta[k]).replace(/\|/g, '/')} |`),
        '',
        saveLink ? `Tester's save at the moment of the report: [${id}.save.json](${saveLink})` : '',
        meta.errors && meta.errors.length ? '\nRecent errors:\n```\n' + meta.errors.join('\n') + '\n```' : '',
        '',
        `<!-- report-id: ${id} -->`,
      ].join('\n');
      const iss = await gh('/issues', { method: 'POST', body: JSON.stringify({ title, body, labels: ['tester-report', kind] }) });
      if (!iss.ok) return json({ error: 'github ' + iss.status }, 502, cors);
      const j = await iss.json();
      return json({ issue: j.number }, 200, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, cors);
    }
}

async function ensureBranch(gh, name) {
  const ref = await gh(`/git/ref/heads/${name}`);
  if (ref.ok) return;
  const repo = await (await gh('')).json();
  const base = await (await gh(`/git/ref/heads/${repo.default_branch}`)).json();
  await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${name}`, sha: base.object.sha }) });
}
function b64utf8(s) { const bytes = new TextEncoder().encode(s); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); }
function json(o, status, headers) { return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }
