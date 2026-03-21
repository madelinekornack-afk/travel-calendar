// Weekly calendar email — runs via GitHub Actions every Monday 7am PST
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const SUPABASE_URL = 'https://lcfnmxufyipclcfpteqz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjZm5teHVmeWlwY2xjZnB0ZXF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODc1NjEsImV4cCI6MjA4Nzk2MzU2MX0.r-QcVdtX7gTVrKY3ue2OmMm13Nvh2rhvAN2nQ-Uhjv4';

// Testing: just Madeline. Add 'pondrejack@gmail.com' when ready
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

function getTripsForDay(dateStr, trips) {
  return trips.filter(trip => {
    const start = trip.start_date.split('T')[0];
    const end = trip.end_date.split('T')[0];
    return dateStr >= start && dateStr <= end;
  });
}

function buildEmailHTML(trips) {
  const monday = getMonday();
  const weeksToShow = 5;
  const endDate = new Date(monday);
  endDate.setDate(endDate.getDate() + weeksToShow * 7 - 1);

  const dateRange = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const todayStr = toDateStr(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })));

  let weeksHtml = '';

  for (let week = 0; week < weeksToShow; week++) {
    const weekStart = new Date(monday);
    weekStart.setDate(weekStart.getDate() + week * 7);

    const weekDays = [];
    for (let d = 0; d < 7; d++) {
      const wd = new Date(weekStart);
      wd.setDate(wd.getDate() + d);
      weekDays.push({ date: wd, str: toDateStr(wd) });
    }

    // Assign consistent slot positions for trips this week
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

    // Build slot map: each trip gets a fixed row index
    const slotRows = [];
    const tripSlot = {};
    weekTrips.forEach(trip => {
      const start = trip.start_date.split('T')[0];
      const end = trip.end_date.split('T')[0];
      let s = weekDays.findIndex(d => d.str >= start);
      if (s === -1) s = 0;
      let e = 6;
      for (let i = 6; i >= 0; i--) { if (weekDays[i].str <= end) { e = i; break; } }
      let row = 0;
      while (true) {
        if (!slotRows[row]) { slotRows[row] = []; break; }
        if (!slotRows[row].some(b => s <= b.e && e >= b.s)) break;
        row++;
      }
      slotRows[row] = slotRows[row] || [];
      slotRows[row].push({ s, e });
      tripSlot[trip.id] = row;
    });
    const totalSlots = slotRows.length;

    // Single row per week — badges inside each cell, 80px height
    weeksHtml += '<tr>';
    for (let d = 0; d < 7; d++) {
      const { date, str } = weekDays[d];
      const dayNum = date.getDate();
      const isToday = str === todayStr;
      const thisMonth = date.getMonth();
      const bg = isToday ? '#fef3c7' : (thisMonth % 2 === 0 ? '#ffffff' : '#f5f3f0');
      const border = isToday ? '2px solid #f59e0b' : '1px solid #e0e0e0';
      const monthLabel = dayNum === 1 ? `<span style="font-size:9px;font-weight:700;color:#667eea;">${date.toLocaleDateString('en-US',{month:'short'}).toUpperCase()}</span> ` : '';

      const dayTrips = getTripsForDay(str, trips);

      // Build slots array — empty slots get a transparent placeholder
      const slots = new Array(totalSlots).fill(null);
      dayTrips.forEach(trip => {
        const row = tripSlot[trip.id];
        if (row !== undefined) slots[row] = trip;
      });

      let badgesHtml = '';
      slots.forEach((trip, slotIdx) => {
        if (!trip) {
          // Empty placeholder to maintain alignment
          badgesHtml += `<div style="height:20px;margin-top:3px;">&nbsp;</div>`;
          return;
        }
        const color = getColor(trip.created_by);
        const tripStart = trip.start_date.split('T')[0];
        const tripEnd = trip.end_date.split('T')[0];
        const isFirst = str === tripStart || (str === weekDays[0].str && tripStart < weekDays[0].str);
        const isLast = str === tripEnd || (str === weekDays[6].str && tripEnd > weekDays[6].str);
        const isSingleDay = tripStart === tripEnd;

        // Split trip name across days so text flows continuously
        const charsPerDay = 14;
        let label;
        if (isSingleDay) {
          label = trip.name;
        } else {
          const tripStartDate = new Date(tripStart.replace(/-/g, '/'));
          const thisDate = new Date(str.replace(/-/g, '/'));
          const dayIndex = Math.round((thisDate - tripStartDate) / (1000*60*60*24));
          // If trip started before this week, adjust dayIndex
          const weekStartStr = weekDays[0].str;
          let adjustedIndex = dayIndex;
          if (tripStart < weekStartStr) {
            const weekStartDate = new Date(weekStartStr.replace(/-/g, '/'));
            adjustedIndex = Math.round((thisDate - weekStartDate) / (1000*60*60*24));
            // Skip chars that would have shown before this week
            const preWeekDays = Math.round((weekStartDate - tripStartDate) / (1000*60*60*24));
            adjustedIndex = preWeekDays + adjustedIndex;
          }
          const startChar = adjustedIndex * charsPerDay;
          if (startChar < trip.name.length) {
            label = trip.name.substring(startChar, startChar + charsPerDay);
          } else {
            label = '&nbsp;';
          }
        }
        const pLeft = isFirst || isSingleDay ? '5px' : '0';
        const pRight = isLast || isSingleDay ? '5px' : '0';
        const rTL = isFirst || isSingleDay ? '4px' : '0';
        const rBL = isFirst || isSingleDay ? '4px' : '0';
        const rTR = isLast || isSingleDay ? '4px' : '0';
        const rBR = isLast || isSingleDay ? '4px' : '0';
        // Overflow into neighboring cell by 1px to cover the cell border
        const mLeft = isFirst || isSingleDay ? '0' : '-1px';
        const mRight = isLast || isSingleDay ? '0' : '-1px';

        const overflow = isLast || isSingleDay ? 'text-overflow:ellipsis;' : '';
        badgesHtml += `<div style="background:${color};color:#fff;font-size:10px;font-weight:600;padding:3px ${pRight} 3px ${pLeft};border-radius:${rTL} ${rTR} ${rBR} ${rBL};margin-top:3px;margin-left:${mLeft};margin-right:${mRight};white-space:nowrap;overflow:hidden;${overflow}position:relative;z-index:1;">${label}</div>`;
      });

      weeksHtml += `<td style="background:${bg};border:${border};padding:4px 0;vertical-align:top;height:80px;font-size:13px;font-weight:600;color:#333;width:14.28%;overflow:visible;">
        <div style="padding:0 5px;">${monthLabel}${dayNum}</div>
        ${badgesHtml}
      </td>`;
    }
    weeksHtml += '</tr>';
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:20px 0;">
<tr><td align="center">
<table width="800" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">

  <tr><td style="background:linear-gradient(135deg,#667eea,#764ba2);padding:16px 24px;color:#fff;">
    <h1 style="margin:0;font-size:20px;">💕 Maddy & Phil In Love Calendar</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">Weekly update — ${dateRange}</p>
  </td></tr>

  <tr><td style="padding:16px;">
    <!-- Full calendar grid -->
    <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-collapse:collapse;">
      <tr>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d =>
        `<td style="text-align:center;font-weight:700;color:#666;font-size:12px;padding:8px 0;width:14.28%;">${d}</td>`
      ).join('')}</tr>
      ${weeksHtml}
    </table>

    <!-- Legend -->
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

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const subject = `💕 Weekly Calendar — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  for (const recipient of RECIPIENTS) {
    await transporter.sendMail({
      from: `"Maddy & Phil Calendar" <${process.env.GMAIL_USER}>`,
      to: recipient,
      subject,
      html: emailHTML,
    });
    console.log(`Email sent to ${recipient}`);
  }
}

main();
