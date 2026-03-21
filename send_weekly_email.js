// Weekly calendar email — runs via GitHub Actions every Monday 7am PST
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://lcfnmxufyipclcfpteqz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjZm5teHVmeWlwY2xjZnB0ZXF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODc1NjEsImV4cCI6MjA4Nzk2MzU2MX0.r-QcVdtX7gTVrKY3ue2OmMm13Nvh2rhvAN2nQ-Uhjv4';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Note: Resend free tier only sends to account owner email until a domain is verified
// Once verified, add 'pondrejack@gmail.com' back
const RECIPIENTS = ['madelinekornack@gmail.com'];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getMonday() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.getFullYear(), now.getMonth(), diff);
}

function getColor(who) {
  if (who === 'madeline') return '#e8815c';
  if (who === 'fiance') return '#4a90a4';
  return '#9a7bb5'; // both
}

function buildEmailHTML(trips) {
  const monday = getMonday();
  const weeksToShow = 5;
  const endDate = new Date(monday);
  endDate.setDate(endDate.getDate() + weeksToShow * 7 - 1);

  const dateRange = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const todayStr = toDateStr(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })));

  let calendarRows = '';

  for (let week = 0; week < weeksToShow; week++) {
    const weekStart = new Date(monday);
    weekStart.setDate(weekStart.getDate() + week * 7);

    const weekDays = [];
    for (let d = 0; d < 7; d++) {
      const wd = new Date(weekStart);
      wd.setDate(wd.getDate() + d);
      weekDays.push({ date: wd, str: toDateStr(wd) });
    }

    // Find trips this week
    const seenIds = new Set();
    const weekTrips = [];
    weekDays.forEach(({ str }) => {
      trips.forEach(trip => {
        const start = trip.start_date.split('T')[0];
        const end = trip.end_date.split('T')[0];
        if (str >= start && str <= end && !seenIds.has(trip.id)) {
          seenIds.add(trip.id);
          weekTrips.push(trip);
        }
      });
    });

    weekTrips.sort((a, b) => {
      const cmp = a.start_date.split('T')[0].localeCompare(b.start_date.split('T')[0]);
      return cmp !== 0 ? cmp : b.end_date.split('T')[0].localeCompare(a.end_date.split('T')[0]);
    });

    // Stack trips into rows
    const barRows = [];
    const positions = [];
    weekTrips.forEach(trip => {
      const start = trip.start_date.split('T')[0];
      const end = trip.end_date.split('T')[0];
      let s = weekDays.findIndex(d => d.str >= start);
      if (s === -1) s = 0;
      let e = 6;
      for (let i = 6; i >= 0; i--) { if (weekDays[i].str <= end) { e = i; break; } }

      let row = 0;
      while (true) {
        if (!barRows[row]) { barRows[row] = []; break; }
        if (!barRows[row].some(b => s <= b.e && e >= b.s)) break;
        row++;
      }
      barRows[row] = barRows[row] || [];
      barRows[row].push({ s, e });
      positions.push({ trip, s, e, row });
    });

    // Day number row
    calendarRows += '<tr>';
    for (let d = 0; d < 7; d++) {
      const { date, str } = weekDays[d];
      const dayNum = date.getDate();
      const isToday = str === todayStr;
      const thisMonth = date.getMonth();
      const bg = isToday ? '#fef3c7' : (thisMonth % 2 === 0 ? '#ffffff' : '#f5f3f0');
      const border = isToday ? '2px solid #f59e0b' : '1px solid #e0e0e0';
      const monthLabel = dayNum === 1 ? `<span style="font-size:9px;font-weight:700;color:#667eea;">${date.toLocaleDateString('en-US',{month:'short'}).toUpperCase()}</span> ` : '';

      calendarRows += `<td style="background:${bg};border:${border};border-radius:4px;padding:4px;vertical-align:top;height:${20 + barRows.length * 26}px;font-size:12px;font-weight:600;color:#333;">
        ${monthLabel}${dayNum}
      </td>`;
    }
    calendarRows += '</tr>';

    // Trip bar rows
    for (let r = 0; r < barRows.length; r++) {
      const rowTrips = positions.filter(p => p.row === r).sort((a, b) => a.s - b.s);
      calendarRows += '<tr>';
      let col = 0;
      for (const tp of rowTrips) {
        if (tp.s > col) {
          calendarRows += `<td colspan="${tp.s - col}"></td>`;
        }
        const span = tp.e - tp.s + 1;
        const color = getColor(tp.trip.created_by);
        calendarRows += `<td colspan="${span}" style="padding:1px 2px;">
          <div style="background:${color};color:#fff;font-size:11px;font-weight:600;padding:4px 6px;border-radius:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,0.15);">
            ${tp.trip.name}
          </div>
        </td>`;
        col = tp.e + 1;
      }
      if (col < 7) calendarRows += `<td colspan="${7 - col}"></td>`;
      calendarRows += '</tr>';
    }
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:20px 0;">
<tr><td align="center">
<table width="700" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">

  <tr><td style="background:linear-gradient(135deg,#667eea,#764ba2);padding:16px 24px;color:#fff;">
    <h1 style="margin:0;font-size:20px;">💕 Maddy & Phil In Love Calendar</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">Weekly update — ${dateRange}</p>
  </td></tr>

  <tr><td style="padding:16px;">
    <table width="100%" cellpadding="0" cellspacing="2" style="table-layout:fixed;">
      <tr>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d =>
        `<td style="text-align:center;font-weight:700;color:#666;font-size:12px;padding:6px 0;">${d}</td>`
      ).join('')}</tr>
      ${calendarRows}
    </table>

    <table cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr>
        <td style="padding-right:16px;"><span style="display:inline-block;width:12px;height:12px;background:#e8815c;border-radius:3px;vertical-align:middle;margin-right:4px;"></span><span style="font-size:12px;color:#555;vertical-align:middle;">Madeline</span></td>
        <td style="padding-right:16px;"><span style="display:inline-block;width:12px;height:12px;background:#4a90a4;border-radius:3px;vertical-align:middle;margin-right:4px;"></span><span style="font-size:12px;color:#555;vertical-align:middle;">Phil</span></td>
        <td><span style="display:inline-block;width:12px;height:12px;background:#9a7bb5;border-radius:3px;vertical-align:middle;margin-right:4px;"></span><span style="font-size:12px;color:#555;vertical-align:middle;">Both</span></td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:12px 24px;text-align:center;color:#999;font-size:11px;border-top:1px solid #eee;">
    <a href="https://madelinekornack-afk.github.io/travel-calendar/" style="color:#667eea;text-decoration:none;">View full calendar →</a>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

async function main() {
  const { data: trips, error } = await supabase
    .from('trips')
    .select('*')
    .order('start_date', { ascending: true });

  if (error) { console.error('Error fetching trips:', error); process.exit(1); }

  const emailHTML = buildEmailHTML(trips);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Maddy & Phil Calendar <onboarding@resend.dev>',
      to: RECIPIENTS,
      subject: `💕 Weekly Calendar — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      html: emailHTML,
    }),
  });

  const result = await res.json();
  if (!res.ok) { console.error('Resend error:', result); process.exit(1); }
  console.log('Email sent successfully:', result.id);
}

main();
