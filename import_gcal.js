// Copies flights and hotel stays from Madeline's Google Calendar into the
// Personal calendar. Gmail puts bookings on Google Calendar; this reads the
// calendar's private iCal feed (secret GCAL_ICS_URL) every few hours.
// Each event is copied once: if she edits or deletes the copy, it stays that way.
const SUPABASE_URL = 'https://lcfnmxufyipclcfpteqz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjZm5teHVmeWlwY2xjZnB0ZXF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODc1NjEsImV4cCI6MjA4Nzk2MzU2MX0.r-QcVdtX7gTVrKY3ue2OmMm13Nvh2rhvAN2nQ-Uhjv4';
const HOME_TZ = 'America/Los_Angeles';
const IS_TRAVEL = /\bflight\b|^stay at\b|\bhotel\b|\bairbnb\b|\bcheck[- ]?in\b/i;

function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const p = Object.fromEntries(params.map(x => x.split('=')));
      ev[name] = { value: line.slice(i + 1), ...p };
    }
  }
  return events;
}

const unescape = s => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

// { date: 'YYYY-MM-DD', time: '7:05am' | null, allDay }
function parseWhen(prop) {
  if (!prop) return null;
  const v = prop.value;
  const date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  if (prop.VALUE === 'DATE' || v.length === 8) return { date, time: null, allDay: true };
  let h = +v.slice(9, 11), m = v.slice(11, 13), d = date, tz = '';
  if (v.endsWith('Z')) {
    const utc = new Date(`${date}T${v.slice(9, 11)}:${m}:00Z`);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: HOME_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(utc).map(x => [x.type, x.value]));
    d = `${parts.year}-${parts.month}-${parts.day}`; h = +parts.hour; m = parts.minute; tz = ' PT';
  }
  const time = `${h % 12 || 12}:${m}${h < 12 ? 'am' : 'pm'}${tz}`;
  return { date: d, time, allDay: false };
}

function toTrip(ev) {
  const summary = unescape(ev.SUMMARY?.value || '');
  if (!IS_TRAVEL.test(summary) || ev.RRULE || ev.STATUS?.value === 'CANCELLED') return null;
  const start = parseWhen(ev.DTSTART);
  if (!start) return null;
  const endRaw = parseWhen(ev.DTEND) || start;
  const flight = /\bflight\b/i.test(summary);
  let end = endRaw.date;
  // An all-day DTEND is the day after. Stays keep it: that's checkout day.
  if (flight && endRaw.allDay && end > start.date) {
    const d = new Date(end + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
    end = d.toISOString().slice(0, 10);
  }
  const name = `${flight ? '✈️' : '🏨'} ${summary}${flight && start.time ? ' · ' + start.time : ''}`;
  return { uid: ev.UID?.value, name, start_date: start.date, end_date: end < start.date ? start.date : end };
}

async function main() {
  const url = process.env.GCAL_ICS_URL, key = process.env.TRIP_KEY;
  if (!url || !key) { console.log('GCAL_ICS_URL or TRIP_KEY not set; nothing to do.'); return; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Calendar feed returned ${res.status}`);
  const events = parseIcs(await res.text());

  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const trips = events.map(toTrip).filter(t => t && t.uid && t.end_date >= since);
  console.log(`${events.length} events in feed, ${trips.length} upcoming flights/hotels.`);
  if (!trips.length) return;

  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { 'x-trip-key': key } } });
  const { data: seen, error: seenErr } = await db.from('gcal_imports').select('uid').in('uid', trips.map(t => t.uid));
  if (seenErr) throw seenErr;
  const seenSet = new Set(seen.map(r => r.uid));

  for (const { uid, ...trip } of trips.filter(t => !seenSet.has(t.uid))) {
    const { data, error } = await db.from('trips')
      .insert({ ...trip, created_by: 'madeline', calendar: 'personal' }).select('id').single();
    if (error) throw error;
    const { error: logErr } = await db.from('gcal_imports').insert({ uid, trip_id: data.id });
    if (logErr) throw logErr;
    console.log(`Added: ${trip.name} (${trip.start_date} – ${trip.end_date})`);
  }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { parseIcs, toTrip };
