/* ==================== CONFIG ==================== */
// Sesuaikan dengan broker cluster dari Arduino
const BROKER   = 'ede492ef581f4ffdb49be789d64114bb.s1.eu.hivemq.cloud';
const PORT     = 8884; // WebSocket Secure
const TOPIC_PUB = 'smk/iot/sensor';
const TOPIC_SUB = 'smk/iot/control';
const MQTT_USER = 'MarisaUKK';
const MQTT_PASS = 'Marisastecu25';

const MAX_PTS = 30, ALERT_T = 31;

/* ==================== STATE ==================== */
let client = null, logCount = 0, dataCount = 0, startTime = Date.now();
let notifOn = true, lastAlert = false;
let suhuMax = null, suhuMin = null, suhuSum = 0, humidSum = 0, statN = 0;
const sessionData = [];

// Status relay & mode dari ESP32
let relayState = [false, false, false, false];
let autoMode   = false;

/* ==================== DARK MODE ==================== */
const darkBtn = document.getElementById('dark-toggle');
if (localStorage.getItem('theme') === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
  darkBtn.textContent = '☀️ Light Mode';
}
darkBtn.addEventListener('click', () => {
  const d = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', d ? 'light' : 'dark');
  darkBtn.textContent = d ? '🌙 Dark Mode' : '☀️ Light Mode';
  localStorage.setItem('theme', d ? 'light' : 'dark');
  updateChartTheme();
});

/* ==================== CLOCK ==================== */
const DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const MONS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const pad = n => String(n).padStart(2, '0');

function tickClock() {
  const n = new Date();
  document.getElementById('clock-time').innerHTML =
    `${pad(n.getHours())}<span class="colon">:</span>${pad(n.getMinutes())}<span class="colon">:</span>${pad(n.getSeconds())}`;
  document.getElementById('clock-date').textContent =
    `${DAYS[n.getDay()]}, ${n.getDate()} ${MONS[n.getMonth()]} ${n.getFullYear()}`;
  const s = Math.floor((Date.now() - startTime) / 1000);
  document.getElementById('uptime').textContent =
    `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
tickClock(); setInterval(tickClock, 1000);

function nowStr() {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ==================== CHART ==================== */
const ctx = document.getElementById('myChart').getContext('2d');
function gc() {
  const d = document.documentElement.getAttribute('data-theme') === 'dark';
  return { grid: d ? 'rgba(255,200,230,.07)' : 'rgba(230,73,128,.08)', tick: d ? '#d47090' : '#b04070' };
}

const chartData = {
  labels: [],
  datasets: [
    { label: 'Suhu (°C)',      data: [], borderColor: '#e64980', backgroundColor: 'rgba(230,73,128,.12)', tension: .45, fill: true, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#e64980', borderWidth: 2 },
    { label: 'Kelembapan (%)', data: [], borderColor: '#4dabf7', backgroundColor: 'rgba(77,171,247,.10)',  tension: .45, fill: true, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#4dabf7', borderWidth: 2 }
  ]
};

const myChart = new Chart(ctx, {
  type: 'line', data: chartData,
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: gc().tick, font: { family: 'DM Sans', size: 12 }, boxWidth: 12 } },
      tooltip: { backgroundColor: 'rgba(42,0,20,.85)', titleColor: '#ffadd2', bodyColor: '#ffe0ef', padding: 12 }
    },
    scales: {
      x: { ticks: { color: gc().tick, maxRotation: 0, font: { size: 10 } }, grid: { color: gc().grid } },
      y: { ticks: { color: gc().tick, font: { size: 10 } }, grid: { color: gc().grid } }
    },
    animation: { duration: 600, easing: 'easeInOutCubic' }
  }
});

function updateChartTheme() {
  const c = gc();
  myChart.options.scales.x.ticks.color = c.tick; myChart.options.scales.x.grid.color = c.grid;
  myChart.options.scales.y.ticks.color = c.tick; myChart.options.scales.y.grid.color = c.grid;
  myChart.options.plugins.legend.labels.color = c.tick; myChart.update();
}

function pushChart(t, s, h) {
  chartData.labels.push(t);
  chartData.datasets[0].data.push(s);
  chartData.datasets[1].data.push(h);
  if (chartData.labels.length > MAX_PTS) { chartData.labels.shift(); chartData.datasets[0].data.shift(); chartData.datasets[1].data.shift(); }
  myChart.update('active');
}

document.querySelectorAll('.chart-tab').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.chart-tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    myChart.data.datasets[0].hidden = (b.dataset.m === 'humid');
    myChart.data.datasets[1].hidden = (b.dataset.m === 'suhu');
    myChart.update();
  });
});

/* ==================== STATS ==================== */
function updateStats(s, h) {
  statN++; suhuSum += s; humidSum += h;
  if (suhuMax === null || s > suhuMax) suhuMax = s;
  if (suhuMin === null || s < suhuMin) suhuMin = s;
  document.getElementById('stat-max').textContent   = suhuMax.toFixed(1) + '°C';
  document.getElementById('stat-min').textContent   = suhuMin.toFixed(1) + '°C';
  document.getElementById('stat-avg-s').textContent = (suhuSum / statN).toFixed(1) + '°C';
  document.getElementById('stat-avg-h').textContent = (humidSum / statN).toFixed(1) + '%';
}
function resetStats() {
  suhuMax = suhuMin = null; suhuSum = humidSum = statN = 0;
  ['stat-max', 'stat-min', 'stat-avg-s', 'stat-avg-h'].forEach(i => document.getElementById(i).textContent = '—');
}

/* ==================== TOAST ==================== */
function showToast(icon, title, msg) {
  const tc = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span class="toast-icon">${icon}</span><div class="toast-body"><div class="toast-title">${title}</div><div>${msg}</div></div><button class="toast-close" onclick="dismissToast(this.closest('.toast'))">✕</button>`;
  tc.appendChild(t);
  document.getElementById('notif-badge').classList.add('active');
  setTimeout(() => dismissToast(t), 5000);
}
function dismissToast(el) {
  if (!el || !el.parentElement) return;
  el.classList.add('out');
  setTimeout(() => { if (el.parentElement) el.parentElement.removeChild(el); }, 320);
}
document.getElementById('notif-btn').addEventListener('click', () => {
  notifOn = !notifOn;
  document.getElementById('notif-badge').classList.remove('active');
  showToast('🔔', 'Notifikasi', notifOn ? 'Notifikasi aktif.' : 'Notifikasi dimatikan.');
});

/* ==================== LOG ==================== */
function addLog(s, h, cls) {
  const ll = document.getElementById('log-list');
  if (logCount === 0) ll.innerHTML = '';
  logCount++;
  const tags = { green: 'Normal', yellow: 'Hangat', red: 'Panas' };
  const li = document.createElement('li');
  li.innerHTML = `<span class="log-time">${nowStr()}</span><span class="log-data">🌡 <strong>${s}°C</strong> &nbsp;·&nbsp; 💧 <strong>${h}%</strong></span>${cls ? `<span class="log-tag ${cls}">${tags[cls] || ''}</span>` : ''}`;
  ll.prepend(li);
  if (ll.children.length > 60) ll.removeChild(ll.lastChild);
}
function clearLog() {
  document.getElementById('log-list').innerHTML = '<li><span class="log-time">—</span><span class="log-data">Log dihapus.</span></li>';
  logCount = 0;
}

/* ==================== FLASH ==================== */
function flashCard(id) {
  const el = document.getElementById(id);
  el.classList.remove('flash'); void el.offsetWidth;
  el.classList.add('flash');
  el.addEventListener('animationend', () => el.classList.remove('flash'), { once: true });
}

/* ==================== TEMP ==================== */
const tempBadge = document.getElementById('temp-badge'), badgeText = document.getElementById('badge-text');
function applyTemp(s) {
  tempBadge.className = 'temp-badge';
  if (s >= 20 && s <= 25) { tempBadge.classList.add('green');  badgeText.textContent = '20–25°C · Normal'; return 'green'; }
  if (s >= 26 && s <= 30) { tempBadge.classList.add('yellow'); badgeText.textContent = '26–30°C · Hangat'; return 'yellow'; }
  if (s > 30)             { tempBadge.classList.add('red');    badgeText.textContent = '> 30°C · Panas! 🔥'; return 'red'; }
  badgeText.textContent = s + '°C · Di luar rentang'; return null;
}

/* ==================== RELAY UI + MODE LOGIC ==================== */

// Tabel range AUTO MODE (sesuai Arduino)
const AUTO_RANGES = [
  { min: 20,  max: 25.9, label: '20–25.9°C' },
  { min: 26,  max: 30.9, label: '26–30.9°C' },
  { min: 31,  max: 35.9, label: '31–35.9°C' },
  { min: 36,  max: 999,  label: '≥ 36°C'    },
];

// Suhu terakhir untuk highlight range table
let lastSuhu = null;

function updateRelayUI() {
  const rangeTable = document.getElementById('auto-range-table');
  const infoBox    = document.getElementById('mode-info-box');
  const infoText   = document.getElementById('mode-info-text');

  // --- Tombol mode ---
  const btnManual = document.getElementById('btn-mode-manual');
  const btnAuto   = document.getElementById('btn-mode-auto');
  if (btnManual && btnAuto) {
    btnManual.classList.toggle('active', !autoMode);
    btnAuto.classList.toggle('active',   autoMode);
    // disable jika belum konek
    const connected = client && client.isConnected();
    btnManual.disabled = !connected;
    btnAuto.disabled   = !connected;
  }

  // --- Mode pill (header) ---
  const pill = document.getElementById('mode-pill');
  if (autoMode) {
    pill.className   = 'mode-pill auto';
    pill.textContent = '⚡ AUTO MODE';
  } else {
    pill.className   = 'mode-pill manual';
    pill.textContent = '🖐 MANUAL MODE';
  }

  // --- Info box ---
  if (autoMode) {
    infoBox.classList.add('auto-active');
    infoText.textContent = 'Mode Auto aktif: relay dikontrol otomatis oleh ESP32 berdasarkan suhu. Toggle dinonaktifkan dari web.';
    rangeTable.style.display = 'block';
  } else {
    infoBox.classList.remove('auto-active');
    infoText.textContent = 'Mode Manual: klik toggle relay untuk menghidupkan/mematikan relay secara bebas dari web.';
    rangeTable.style.display = 'none';
  }

  // --- Range table highlight ---
  for (let i = 0; i < 4; i++) {
    const row   = document.getElementById(`range-row-${i}`);
    const badge = document.getElementById(`range-badge-${i}`);
    if (!row || !badge) continue;
    const inRange = lastSuhu !== null && lastSuhu >= AUTO_RANGES[i].min && lastSuhu <= AUTO_RANGES[i].max;
    row.classList.toggle('active-range', inRange);
    if (lastSuhu === null) {
      badge.textContent = '—';
      badge.className   = 'range-badge';
    } else if (inRange) {
      badge.textContent = '✅ Aktif';
      badge.className   = 'range-badge active-badge';
    } else {
      badge.textContent = 'Standby';
      badge.className   = 'range-badge standby-badge';
    }
  }

  // --- Relay cards ---
  for (let i = 0; i < 4; i++) {
    const card = document.getElementById(`relay-card-${i}`);
    const led  = document.getElementById(`relay-led-${i}`);
    const stat = document.getElementById(`relay-status-${i}`);
    if (!card) continue;

    if (relayState[i]) {
      card.classList.add('on');
      card.classList.remove('disabled');
    } else {
      card.classList.remove('on');
    }

    // Glow animasi hanya saat auto & relay on
    if (autoMode && relayState[i]) {
      card.classList.add('auto-active');
    } else {
      card.classList.remove('auto-active');
    }

    if (autoMode) {
      card.classList.add('disabled');
      led.style.cursor = 'not-allowed';
    } else {
      card.classList.remove('disabled');
      led.style.cursor = 'pointer';
    }

    stat.textContent = relayState[i] ? '● AKTIF' : '○ Mati';
  }

  // --- Bulk buttons ---
  document.getElementById('btn-all-on').disabled  = autoMode;
  document.getElementById('btn-all-off').disabled = autoMode;
}

// Toggle relay individual → publish ke MQTT (hanya MANUAL)
function toggleRelay(i) {
  if (autoMode) {
    showToast('⚡', 'Auto Mode Aktif', 'Nonaktifkan Auto Mode dulu untuk mengontrol relay secara manual.');
    return;
  }
  if (!client || !client.isConnected()) {
    showToast('⚠️', 'Belum Terhubung', 'Hubungkan ke MQTT terlebih dahulu.');
    return;
  }
  const cmd = relayState[i] ? `R${i + 1}_OFF` : `R${i + 1}_ON`;
  const msg = new Paho.MQTT.Message(cmd);
  msg.destinationName = TOPIC_SUB;
  client.send(msg);
  showToast('🔁', `Relay ${i + 1}`, `Perintah ${cmd} dikirim ke ESP32.`);
}

// Publish perintah mode ke ESP32
function publishMode(isAuto) {
  if (!client || !client.isConnected()) {
    showToast('⚠️', 'Belum Terhubung', 'Hubungkan ke MQTT terlebih dahulu.');
    return;
  }
  const cmd = isAuto ? 'AUTO_ON' : 'AUTO_OFF';
  const msg = new Paho.MQTT.Message(cmd);
  msg.destinationName = TOPIC_SUB;
  client.send(msg);
  // Update state lokal langsung (konfirmasi akhir dari ESP32 via payload)
  autoMode = isAuto;
  updateRelayUI();
  showToast(
    isAuto ? '⚡' : '🖐',
    isAuto ? 'Auto Mode' : 'Manual Mode',
    isAuto
      ? 'Perintah AUTO_ON dikirim. Relay akan dikontrol ESP32 secara otomatis.'
      : 'Perintah AUTO_OFF dikirim. Anda bisa kontrol relay dari web.'
  );
}

// Event listener tombol mode
document.getElementById('btn-mode-manual').addEventListener('click', () => {
  if (!autoMode) return; // sudah manual
  publishMode(false);
});
document.getElementById('btn-mode-auto').addEventListener('click', () => {
  if (autoMode) return; // sudah auto
  publishMode(true);
});

// ALL ON / ALL OFF
document.getElementById('btn-all-on').addEventListener('click', () => {
  if (!client || !client.isConnected()) return;
  const msg = new Paho.MQTT.Message('ALL_ON');
  msg.destinationName = TOPIC_SUB;
  client.send(msg);
  showToast('✅', 'Semua Relay', 'Perintah ALL_ON dikirim.');
});
document.getElementById('btn-all-off').addEventListener('click', () => {
  if (!client || !client.isConnected()) return;
  const msg = new Paho.MQTT.Message('ALL_OFF');
  msg.destinationName = TOPIC_SUB;
  client.send(msg);
  showToast('🔴', 'Semua Relay', 'Perintah ALL_OFF dikirim.');
});

/* ==================== CONNECTION ==================== */
function setConn(on) {
  document.getElementById('btn-connect').disabled    = on;
  document.getElementById('btn-disconnect').disabled = !on;
  document.getElementById('status-dot').className    = 'dot ' + (on ? 'connected' : 'disconnected');
  document.getElementById('status-text').textContent = on
    ? `Terhubung ke ${BROKER} · ${TOPIC_PUB}`
    : 'Terputus dari broker';
  // refresh UI tombol mode sesuai status koneksi
  updateRelayUI();
}

/* ==================== EXPORT ==================== */
document.getElementById('btn-export').addEventListener('click', () => {
  if (!sessionData.length) { showToast('⚠️', 'Tidak Ada Data', 'Belum ada data untuk diekspor.'); return; }
  let csv = 'Waktu,Suhu (°C),Kelembapan (%)\n';
  sessionData.forEach(r => csv += `${r.t},${r.s},${r.h}\n`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `IoT_Monitoring_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast('📥', 'Export Berhasil', `${sessionData.length} baris data diunduh.`);
});

document.getElementById('btn-clear').addEventListener('click', () => {
  chartData.labels = []; chartData.datasets[0].data = []; chartData.datasets[1].data = [];
  myChart.update(); sessionData.length = 0; dataCount = 0;
  document.getElementById('data-count').textContent = '0';
  document.getElementById('last-update').textContent = 'Data direset.';
  resetStats(); clearLog();
  showToast('🗑️', 'Data Direset', 'Semua grafik, log, dan statistik dihapus.');
});

/* ==================== MQTT ==================== */
function mqttConnect() {
  const id = 'web_iot_' + Math.random().toString(16).slice(2, 10);
  try {
    client = new Paho.MQTT.Client(BROKER, PORT, '/mqtt', id);
  } catch (e) {
    alert('Gagal buat client MQTT: ' + e.message); return;
  }

  client.onConnectionLost = (r) => {
    setConn(false);
    showToast('⚠️', 'Koneksi Terputus', r.errorMessage || 'Cek koneksi internet Anda.');
  };

  client.onMessageArrived = (msg) => {
    try {
      const raw  = JSON.parse(msg.payloadString);

      // ---- baca sensor ----
      // payload Arduino: { "temp":xx, "humi":xx, "ldr":x, "mode":"AUTO|MANUAL", "r":[1,0,1,0] }
      const suhu  = parseFloat(raw.temp  ?? raw.suhu        ?? raw.temperature ?? 0);
      const humid = parseFloat(raw.humi  ?? raw.kelembapan  ?? raw.humidity    ?? 0);
      const ldr   = raw.ldr  !== undefined ? parseInt(raw.ldr) : null;
      const sf = suhu.toFixed(1), hf = humid.toFixed(1), t = nowStr();

      // ---- relay & mode dari ESP32 ----
      if (Array.isArray(raw.r) && raw.r.length === 4) {
        relayState = raw.r.map(v => !!parseInt(v));
      }
      if (raw.mode !== undefined) {
        autoMode = raw.mode === 'AUTO';
      }
      // simpan suhu terakhir untuk highlight range table
      lastSuhu = suhu;
      updateRelayUI();

      // ---- update tampilan sensor ----
      document.getElementById('val-suhu').innerHTML  = `${sf}<span class="card-unit">°C</span>`;
      document.getElementById('val-humid').innerHTML = `${hf}<span class="card-unit">%</span>`;

      document.getElementById('humid-bar').style.width = Math.min(humid, 100) + '%';
      document.getElementById('humid-label').textContent =
        humid < 40 ? '🏜️ Kering' : humid <= 70 ? '✅ Nyaman' : '🌊 Lembap Tinggi';

      // ---- LDR ----
      if (ldr !== null) {
        const ldrBadge = document.getElementById('ldr-badge');
        ldrBadge.className = 'ldr-badge ' + (ldr === 1 ? 'terang' : 'gelap');
        ldrBadge.innerHTML = ldr === 1
          ? '<span>☀️</span><span id="ldr-text">Terang (LDR Aktif)</span>'
          : '<span>🌑</span><span id="ldr-text">Gelap (LDR Off)</span>';
      }

      const cls = applyTemp(suhu);
      flashCard('card-suhu'); flashCard('card-humid');

      dataCount++;
      document.getElementById('data-count').textContent = dataCount;
      document.getElementById('last-update').textContent = `Terakhir diperbarui: ${t}`;

      pushChart(t, sf, hf);
      updateStats(suhu, humid);
      addLog(sf, hf, cls);
      sessionData.push({ t, s: sf, h: hf });

      if (notifOn && suhu > ALERT_T && !lastAlert) {
        showToast('🔥', 'Peringatan Suhu!', `Suhu mencapai ${sf}°C — di atas batas aman!`);
        lastAlert = true;
      }
      if (suhu <= ALERT_T) lastAlert = false;

    } catch (e) { console.warn('Pesan tidak valid:', msg.payloadString); }
  };

  document.getElementById('status-text').textContent = 'Sedang menghubungkan...';
  document.getElementById('status-dot').className = 'dot';

  client.connect({
    useSSL: true,
    timeout: 10,
    userName: MQTT_USER,
    password: MQTT_PASS,
    onSuccess: () => {
      setConn(true);
      client.subscribe(TOPIC_PUB);
      showToast('✅', 'Terhubung!', `Broker: ${BROKER} · Topic: ${TOPIC_PUB}`);
    },
    onFailure: (e) => {
      setConn(false);
      showToast('❌', 'Gagal Konek', e.errorMessage || 'Periksa koneksi internet Anda.');
    }
  });
}

function mqttDisconnect() {
  if (client && client.isConnected()) client.disconnect();
  setConn(false);
  showToast('⏏️', 'Terputus', 'Koneksi MQTT diputus secara manual.');
}

document.getElementById('btn-connect').addEventListener('click', mqttConnect);
document.getElementById('btn-disconnect').addEventListener('click', mqttDisconnect);

// Init relay UI saat load
updateRelayUI();
