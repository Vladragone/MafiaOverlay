const layout = new URLSearchParams(location.search).get("layout") || "game";
const root = document.querySelector("#scene");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const number = (value) => value == null ? "—" : Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const roleNames = { citizen: "Мирный", civilian: "Мирный", mafia: "Мафия", don: "Дон", sheriff: "Шериф" };
let state = await fetch("/api/state").then((response) => response.json());
let tableData = null;
let tableError = "";
const settings = () => state.sceneSettings?.[layout] || {};

function brand() {
  return `<div class="brand-lockup">${state.tournamentLogo ? `<img src="${state.tournamentLogo}" alt="">` : `<b>T</b>`}<div><small>СПОРТИВНАЯ МАФИЯ</small><strong>${esc(state.event)}</strong></div></div>`;
}
function chrome(label) {
  return `<header>${brand()}<div class="scene-label"><i></i>${label}</div></header>`;
}
function countdown() {
  const target = new Date(state.streamStartsAt || "").getTime();
  if (!Number.isFinite(target)) return "00:00:00";
  const remaining = Math.max(0, target - Date.now());
  return [Math.floor(remaining / 3600000), Math.floor((remaining % 3600000) / 60000), Math.floor((remaining % 60000) / 1000)].map((part) => String(part).padStart(2, "0")).join(":");
}
function renderStarting() {
  const config = settings();
  root.innerHTML = `<section class="fullscreen starting">${brand()}<div class="starting-copy"><span>${esc(config.subtitle || "Прямой эфир")}</span><h1>${esc(config.title || "Скоро начинаем")}</h1><p>${esc(state.tournamentDate || "")}</p></div>${config.showCountdown === false ? "" : `<div class="countdown"><small>ДО НАЧАЛА</small><strong>${countdown()}</strong></div>`}<div class="ticker"><span>10 игроков</span><i></i><span>${esc(state.table)}</span><i></i><span>${state.gamesTotal} игр</span><i></i><span>MGP</span></div></section>`;
}
function renderFrame(kind) {
  const night = kind === "night";
  const config = settings();
  root.innerHTML = `<section class="transparent-frame ${kind}">${chrome(esc(config.subtitle || (night ? "НОЧНАЯ ФАЗА" : "СТУДИЯ")))}<div class="frame-corners"></div>${night ? `<aside class="night-rail"><div class="night-camera-frame"><span>LIVE</span><b>КАМЕРА ВЕДУЩЕГО</b></div><div class="night-info"><small>НОЧНАЯ ФАЗА</small><strong>${esc(config.title || "Ночной комментарий")}</strong><div class="night-axis"><i></i><i></i><i></i></div><footer><span>${esc(state.event)}</span><b>ИГРА ${state.game} / ${state.gamesTotal}</b></footer></div></aside>` : `<div class="lower-third"><small>${esc(config.subtitle || state.event)}</small><strong>${esc(config.title || state.table)}</strong></div>`}</section>`;
}
function tableMessage(title) {
  return `<div class="table-message"><b>${esc(title)}</b><span>${esc(tableError || "Укажите ID турнира и игры в панели управления")}</span></div>`;
}
function participantAvatar(nickname) {
  const normalized = String(nickname || "").trim().toLocaleLowerCase("ru-RU");
  return state.participants?.find((participant) => participant.name?.trim().toLocaleLowerCase("ru-RU") === normalized)?.avatar || "";
}
function leaderSidebar(leader, mode) {
  const nickname = leader?.nickname || leader?.player_nickname || "—";
  const score = mode === "results" ? leader?.total_points : leader?.points;
  const avatar = participantAvatar(nickname);
  return `<aside class="leader-sidebar"><section class="leader-card"><div class="leader-rank">ТОП 1</div><div class="leader-avatar">${avatar ? `<img src="${avatar}" alt="">` : `<span>${esc(nickname.slice(0, 2).toUpperCase())}</span>`}</div><small>${mode === "results" ? "ЛУЧШИЙ РЕЗУЛЬТАТ ИГРЫ" : "ЛИДЕР ТУРНИРА"}</small><strong>${esc(nickname)}</strong><b>${number(score)} <i>баллов</i></b></section><section class="camera-frame"><div><span>LIVE</span><strong>СТУДИЯ</strong></div></section></aside>`;
}
function resultsRows(rows) {
  rows = [...rows].sort((left, right) => Number(right.total_points || 0) - Number(left.total_points || 0) || left.seat_position - right.seat_position);
  return `<table><thead><tr><th>№</th><th>Игрок</th><th>Роль</th><th>Победа</th><th>Судьи</th><th>ЛХ</th><th>CI</th><th>ЖК</th><th>СК</th><th>Итого</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.seat_position}</td><td class="player-name">${esc(row.nickname)}</td><td><span class="role role-${esc(row.role)}">${esc(roleNames[row.role] || row.role || "—")}</span></td><td>${number(row.win_points)}</td><td>${number(row.judge_points)}</td><td>${number(row.best_move_points)}</td><td>${number(row.ci_points)}</td><td class="penalty">${row.yellow_card_penalty ? `−${number(row.yellow_card_penalty)}` : "—"}</td><td class="penalty">${row.gray_card_penalty ? `−${number(row.gray_card_penalty)}` : "—"}</td><td class="total">${number(row.total_points)}</td></tr>`).join("")}</tbody></table>`;
}
function standingsRows(rows) {
  return `<table><thead><tr><th>Место</th><th>Игрок</th><th>Игры</th><th>Победы</th><th>Судьи</th><th>ЛХ</th><th>CI</th><th>Штрафы</th><th>Баллы</th></tr></thead><tbody>${rows.map((row) => `<tr class="rank-${row.rank}"><td><span class="rank">${row.rank}</span></td><td class="player-name">${esc(row.player_nickname)}</td><td>${number(row.games)}</td><td>${number(row.wins)}</td><td>${number(row.judge_points)}</td><td>${number(row.best_move_points)}</td><td>${number(row.ci_points)}</td><td class="penalty">${row.discipline_penalty ? `−${number(row.discipline_penalty)}` : "—"}</td><td class="total">${number(row.points)}</td></tr>`).join("")}</tbody></table>`;
}
function renderResults() {
  const rows = tableData?.rows || [];
  const config = settings();
  const sortedRows = [...rows].sort((left, right) => Number(right.total_points || 0) - Number(left.total_points || 0) || left.seat_position - right.seat_position);
  const leader = sortedRows[0];
  root.innerHTML = `<section class="fullscreen data-screen">${chrome(`ИГРА ${state.game} · РЕЗУЛЬТАТЫ`)}<div class="data-heading"><div><small>${esc(config.subtitle || "Официальный протокол")}</small><h1>${esc(config.title || "Результаты игры")}</h1></div><b>#${esc(state.currentGameId || "—")}</b></div><div class="data-layout"><div class="table-wrap">${rows.length ? resultsRows(rows) : tableMessage("Результаты еще не опубликованы")}</div>${leaderSidebar(leader, "results")}</div><footer><span>mafiaunlimit.ru</span></footer></section>`;
}
function renderStandings() {
  const rows = tableData?.rows || [];
  const config = settings();
  const leader = rows.find((row) => row.rank === 1) || rows[0];
  root.innerHTML = `<section class="fullscreen data-screen standings">${chrome(esc(config.subtitle || "ТУРНИРНАЯ ТАБЛИЦА"))}<div class="data-heading"><div><small>ПОСЛЕ ${state.game} ИГРЫ</small><h1>${esc(config.title || "Текущие места")}</h1></div><b>${rows.length} участников</b></div><div class="data-layout"><div class="table-wrap">${rows.length ? standingsRows(rows) : tableMessage("Турнирная таблица пока пуста")}</div>${leaderSidebar(leader, "standings")}</div><footer><span>mafiaunlimit.ru</span><span>Официальные результаты турнира</span></footer></section>`;
}
function renderVictory(team) {
  const config = settings();
  const mafia = team === "mafia";
  root.innerHTML = `<section class="fullscreen victory victory-${team}">${brand()}<div class="victory-lines"></div><div class="victory-copy"><small>${esc(config.subtitle || "Игра окончена")}</small><h1>${esc(config.title || (mafia ? "Победа мафии" : "Победа мирных"))}</h1></div><div class="victory-side"><b>${mafia ? "М" : "Мир"}</b><span>Игра ${state.game} / ${state.gamesTotal}</span></div></section>`;
}
function renderAnnouncement() {
  const rows = [...(tableData?.rows || [])].sort((left, right) => Number(right.total_points || 0) - Number(left.total_points || 0) || left.seat_position - right.seat_position);
  const config = settings();
  const list = rows.length
    ? rows.map((row, index) => `<div class="announcement-row"><span>${index + 1}</span><strong>${esc(row.nickname)}</strong><b>${number(row.total_points)}</b></div>`).join("")
    : tableMessage("Результаты ещё не опубликованы");
  root.innerHTML = `<section class="announcement-screen"><div class="announcement-camera-label"><span>LIVE</span><strong>${esc(config.subtitle || "Оглашение результатов")}</strong></div><aside class="announcement-panel">${brand()}<div class="announcement-heading"><small>ИГРА ${state.game}</small><h1>${esc(config.title || "Баллы за игру")}</h1></div><div class="announcement-list">${list}</div><footer><span>mafiaunlimit.ru</span><span>#${esc(state.currentGameId || "—")}</span></footer></aside></section>`;
}
function renderTechnical() {
  const config = settings();
  root.innerHTML = `<section class="fullscreen technical">${brand()}<div class="technical-mark"><span></span><span></span><span></span></div><h1>${esc(config.title || "Техническая пауза")}</h1><p>${esc(config.subtitle || "Скоро вернемся в эфир")}</p><small>ТРАНСЛЯЦИЯ ПРОДОЛЖИТСЯ</small></section>`;
}
async function loadTable() {
  if (!["results", "standings", "announcement"].includes(layout)) return;
  try {
    const response = await fetch(layout === "standings" ? "/api/tournament/standings" : "/api/tournament/scores", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Ошибка загрузки");
    tableData = payload;
    tableError = "";
  } catch (error) {
    tableData = null;
    tableError = error.message;
  }
}
async function render() {
  root.className = `scene scene-${layout}`;
  const config = settings();
  root.style.setProperty("--accent", config.accentColor || "#ffdd2d");
  root.style.setProperty("--scene-background", config.backgroundColor || "#0b0b0c");
  root.style.setProperty("--scene-image", "none");
  if (layout === "starting") renderStarting();
  else if (layout === "studio" || layout === "night") renderFrame(layout);
  else if (layout === "results") renderResults();
  else if (layout === "standings") renderStandings();
  else if (layout === "mafia-win") renderVictory("mafia");
  else if (layout === "civilian-win") renderVictory("civilian");
  else if (layout === "announcement") renderAnnouncement();
  else if (layout === "technical") renderTechnical();
  else root.innerHTML = "";
}
await loadTable();
render();
setInterval(() => layout === "starting" && render(), 1000);
setInterval(async () => { await loadTable(); render(); }, Math.max(5, Number(settings().refreshSeconds) || 15) * 1000);
const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`);
socket.addEventListener("message", async (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "reload") return location.reload();
  if (message.type === "state") { state = message.state; await loadTable(); render(); }
});
