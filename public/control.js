const $ = (selector) => document.querySelector(selector);
const roleLabels = {
  unknown: "Не назначена",
  civilian: "Мирный",
  mafia: "Мафия",
  don: "Дон",
  sheriff: "Шериф",
};
const statusLabels = {
  alive: "В игре",
  dead: "Убит",
  removed: "Заголосован",
  expelled: "Удалён",
};
let state,
  saveTimer,
  saveInFlight = false,
  saveQueued = false,
  scenes = [],
  currentScene = "";
let activeSceneSetting = "starting";
const sceneSettingMeta = {
  starting: { label: "STARTING SOON", description: "Заставка и обратный отсчет" },
  studio: { label: "STUDIO", description: "Студийная камера" },
  game: { label: "GAME", description: "Дневная игровая фаза" },
  night: { label: "NIGHT", description: "Ночь и комментарий" },
  results: { label: "RESULTS", description: "Результаты игры" },
  standings: { label: "STANDINGS", description: "Таблица турнира" },
  "mafia-win": { label: "ПОБЕДА МАФИИ", description: "Финал игры за чёрную команду" },
  "civilian-win": { label: "ПОБЕДА МИРНЫХ", description: "Финал игры за красную команду" },
  announcement: { label: "ОГЛАШЕНИЕ", description: "Веб-камера и баллы за игру" },
  technical: { label: "TECHNICAL PAUSE", description: "Техническая пауза" },
};
const sceneSettingDefaults = {
  starting: { title: "Скоро начинаем", subtitle: "Прямой эфир", background: "", backgroundColor: "#0b0b0c", accentColor: "#ffdd2d", showCountdown: true },
  studio: { title: "Студия", subtitle: "Между играми", background: "", backgroundColor: "#0b0b0c", accentColor: "#ffdd2d", cameraSource: "Камера ведущего" },
  game: { title: "Игра", subtitle: "Дневная фаза", background: "", backgroundColor: "#0b0b0c", accentColor: "#ffdd2d", gameSource: "Захват экрана", overlayUrl: "/overlay.html" },
  night: { title: "Ночной комментарий", subtitle: "Ночная фаза", background: "", backgroundColor: "#0b0b0c", accentColor: "#ffdd2d", gameSource: "Захват экрана", cameraSource: "Камера ведущего", overlayUrl: "/overlay.html" },
  results: { title: "Результаты игры", subtitle: "Официальный протокол", background: "", backgroundColor: "#0d0e10", accentColor: "#ffdd2d", cameraSource: "Камера ведущего", dataUrl: "https://mafiaunlimit.ru/api/public/tournaments/{tournamentId}/games/{gameId}/scores", refreshSeconds: 15 },
  standings: { title: "Текущие места", subtitle: "Турнирная таблица", background: "", backgroundColor: "#0d0e10", accentColor: "#ffdd2d", cameraSource: "Камера ведущего", dataUrl: "https://mafiaunlimit.ru/api/public/tournaments/{tournamentId}/standings", refreshSeconds: 15 },
  "mafia-win": { title: "Победа мафии", subtitle: "Игра окончена", background: "", backgroundColor: "#090909", accentColor: "#ffdd2d" },
  "civilian-win": { title: "Победа мирных", subtitle: "Игра окончена", background: "", backgroundColor: "#0b0b0c", accentColor: "#ffdd2d" },
  announcement: { title: "Баллы за игру", subtitle: "Оглашение результатов", background: "", backgroundColor: "#0d0e10", accentColor: "#ffdd2d", cameraSource: "Камера ведущего", dataUrl: "https://mafiaunlimit.ru/api/public/tournaments/{tournamentId}/games/{gameId}/scores", refreshSeconds: 15 },
  technical: { title: "Техническая пауза", subtitle: "Скоро вернемся в эфир", background: "", backgroundColor: "#0b0b0c", accentColor: "#ffdd2d" },
};

function ensureSceneSettings() {
  state.sceneSettings ||= {};
  Object.entries(sceneSettingDefaults).forEach(([key, defaults]) => {
    state.sceneSettings[key] = { ...defaults, ...(state.sceneSettings[key] || {}) };
  });
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
const initials = (name) =>
  (name || "?").trim().slice(0, 2).toUpperCase() || "?";
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.remove("show"), 1800);
}
function scheduleSave(immediate = false) {
  $("#syncLabel").textContent = "Сохраняю…";
  saveQueued = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, immediate ? 0 : 120);
}
async function flushSave() {
  if (saveInFlight) return;
  saveInFlight = true;
  try {
    while (saveQueued) {
      saveQueued = false;
      const payload = JSON.stringify(state);
      await request("/api/state", { method: "PUT", body: payload });
    }
    $("#syncLabel").textContent = "Сохранено";
  } catch (error) {
    $("#syncLabel").textContent = "Ошибка";
    toast(error.message);
  } finally {
    saveInFlight = false;
    if (saveQueued) flushSave();
  }
}

function showView(phase = state.phase) {
  state.phase = phase;
  ["setup", "seating", "live"].forEach((name) => {
    $(`#${name}View`).classList.toggle("hidden", name !== phase);
    const step = document.querySelector(`[data-step="${name}"]`);
    step.classList.toggle("active", name === phase);
    step.classList.toggle(
      "done",
      ["setup", "seating", "live"].indexOf(name) <
        ["setup", "seating", "live"].indexOf(phase),
    );
  });
  $("#phaseLabel").textContent = {
    setup: "Подготовка турнира",
    seating: "Рассадка игроков",
    live: `Игра ${state.game} в эфире`,
  }[phase];
  if (phase === "setup") renderSetup();
  if (phase === "seating") renderSeating();
  if (phase === "live") renderLive();
  window.scrollTo(0, 0);
}

function frameOf(person) {
  return person.frame || { scale: 1, x: 0, y: 0 };
}
function frameStyle(person) {
  const frame = frameOf(person);
  return `--avatar-scale:${frame.scale};--avatar-x:${frame.x}%;--avatar-y:${frame.y}%`;
}
function photoMarkup(person, prefix, index) {
  return `<div class="photo">${person.avatar ? `<img src="${person.avatar}" alt="" style="${frameStyle(person)}">` : `<div class="initials">${esc(initials(person.name))}</div>`}<input id="${prefix}-${person.id}" class="photo-input" data-kind="${prefix}" data-index="${index}" type="file" accept="image/png,image/webp"><label class="upload" for="${prefix}-${person.id}">Загрузить PNG</label></div>`;
}
function frameEditor(person, index, scope = "participant") {
  const frame = frameOf(person);
  return `<details class="frame-editor"><summary>Кадрирование</summary><div class="frame-controls"><label class="frame-control">Масштаб<input type="range" min="60" max="220" value="${Math.round(frame.scale * 100)}" data-frame="scale" data-frame-scope="${scope}" data-index="${index}"><output>${Math.round(frame.scale * 100)}%</output></label><label class="frame-control">По X<input type="range" min="-50" max="50" value="${frame.x}" data-frame="x" data-frame-scope="${scope}" data-index="${index}"><output>${frame.x}</output></label><label class="frame-control">По Y<input type="range" min="-50" max="50" value="${frame.y}" data-frame="y" data-frame-scope="${scope}" data-index="${index}"><output>${frame.y}</output></label><button class="frame-reset" type="button" data-reset-frame="${index}" data-frame-scope="${scope}">Сбросить кадр</button></div></details>`;
}
function renderSetup() {
  $("#eventInput").value = state.event;
  $("#tableInput").value = state.table;
  $("#totalInput").value = state.gamesTotal;
  $("#apiBaseInput").value = state.publicApiBase || "https://mafiaunlimit.ru/api";
  $("#tournamentIdInput").value = state.tournamentId || "";
  $("#gameIdInput").value = state.currentGameId || "";
  $("#tournamentDateInput").value = state.tournamentDate || "";
  $("#streamStartsInput").value = (state.streamStartsAt || "").slice(0, 16);
  $("#logoPreview").innerHTML = state.tournamentLogo
    ? `<img src="${state.tournamentLogo}" alt="Логотип">`
    : "Нажмите, чтобы загрузить";
  $("#participantsGrid").innerHTML = state.participants
    .map(
      (person, index) =>
        `<article class="person-card" data-index="${index}"><span class="person-no">${index + 1}</span>${index > 9 ? `<span class="reserve-mark">ЗАПАС</span>` : ""}${photoMarkup(person, "participant", index)}${frameEditor(person, index)}<div class="person-info"><label>Ник игрока<input class="person-name" value="${esc(person.name)}" maxlength="40" placeholder="Введите ник"></label></div></article>`,
    )
    .join("");
  $("#judgesGrid").innerHTML = state.judges
    .map(
      (person, index) =>
        `<article class="judge-card" data-index="${index}">${photoMarkup(person, "judge", index)}<label>Судья ${index + 1}<input class="judge-name" value="${esc(person.name)}" maxlength="30" placeholder="Имя или ник судьи"></label>${state.judges.length > 1 ? `<button class="icon-button remove-judge" data-remove-judge="${index}" title="Удалить">×</button>` : ""}</article>`,
    )
    .join("");
  $("#addJudge").disabled = state.judges.length >= 3;
}

function trimTransparentImage(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let left = canvas.width,
        top = canvas.height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3] > 12) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      if (right < 0) return resolve(dataUrl);
      const width = right - left + 1,
        height = bottom - top + 1;
      const padding = Math.round(Math.max(width, height) * 0.035);
      left = Math.max(0, left - padding);
      top = Math.max(0, top - padding);
      right = Math.min(canvas.width - 1, right + padding);
      bottom = Math.min(canvas.height - 1, bottom + padding);
      const cropWidth = right - left + 1,
        cropHeight = bottom - top + 1;
      if (cropWidth > canvas.width * 0.94 && cropHeight > canvas.height * 0.94)
        return resolve(dataUrl);
      const cropped = document.createElement("canvas");
      cropped.width = cropWidth;
      cropped.height = cropHeight;
      cropped
        .getContext("2d")
        .drawImage(
          canvas,
          left,
          top,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight,
        );
      resolve(cropped.toDataURL("image/png"));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}
function readImage(input, person, onDone = renderSetup) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2_500_000) return toast("Файл больше 2,5 МБ");
  const reader = new FileReader();
  reader.onload = async () => {
    person.avatar = await trimTransparentImage(reader.result);
    person.avatarTrimmed = true;
    person.frame = { scale: 1, x: 0, y: 0 };
    onDone();
    scheduleSave();
  };
  reader.readAsDataURL(file);
}
async function normalizeStoredAvatars() {
  let changed = false;
  for (const participant of state.participants) {
    if (!participant.avatar || participant.avatarTrimmed) continue;
    participant.avatar = await trimTransparentImage(participant.avatar);
    participant.avatarTrimmed = true;
    participant.frame = { scale: 1, x: 0, y: 0 };
    const player = state.players.find(
      (item) => item.participantId === participant.id,
    );
    if (player) {
      player.avatar = participant.avatar;
      player.avatarTrimmed = true;
      player.frame = { ...participant.frame };
    }
    changed = true;
  }
  if (changed) scheduleSave(true);
}
$("#setupView").addEventListener("input", (event) => {
  if (event.target.id === "eventInput") state.event = event.target.value;
  if (event.target.id === "tableInput") state.table = event.target.value;
  if (event.target.id === "totalInput")
    state.gamesTotal = Math.max(1, Number(event.target.value) || 1);
  if (event.target.id === "apiBaseInput")
    state.publicApiBase = event.target.value.trim();
  if (event.target.id === "tournamentIdInput")
    state.tournamentId = event.target.value.replace(/\D/g, "");
  if (event.target.id === "gameIdInput")
    state.currentGameId = event.target.value.replace(/\D/g, "");
  if (event.target.id === "tournamentDateInput")
    state.tournamentDate = event.target.value;
  if (event.target.id === "streamStartsInput")
    state.streamStartsAt = event.target.value;
  if (event.target.matches(".person-name"))
    state.participants[
      Number(event.target.closest("[data-index]").dataset.index)
    ].name = event.target.value;
  if (event.target.matches(".judge-name"))
    state.judges[
      Number(event.target.closest("[data-index]").dataset.index)
    ].name = event.target.value;
  if (event.target.matches("[data-frame]")) {
    const person = state.participants[Number(event.target.dataset.index)];
    person.frame ||= { scale: 1, x: 0, y: 0 };
    person.frame[event.target.dataset.frame] =
      event.target.dataset.frame === "scale"
        ? Number(event.target.value) / 100
        : Number(event.target.value);
    event.target.nextElementSibling.value =
      event.target.dataset.frame === "scale"
        ? `${event.target.value}%`
        : event.target.value;
    const image = event.target
      .closest(".person-card")
      .querySelector(".photo img");
    if (image) image.style.cssText = frameStyle(person);
  }
  scheduleSave();
});
$("#setupView").addEventListener("change", (event) => {
  if (event.target.id === "logoInput") {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2_500_000) return toast("Логотип больше 2,5 МБ");
    const reader = new FileReader();
    reader.onload = () => {
      state.tournamentLogo = reader.result;
      renderSetup();
      scheduleSave();
    };
    reader.readAsDataURL(file);
    return;
  }
  if (!event.target.matches(".photo-input")) return;
  const index = Number(event.target.dataset.index);
  readImage(
    event.target,
    event.target.dataset.kind === "participant"
      ? state.participants[index]
      : state.judges[index],
  );
});
$("#setupView").addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-judge]");
  if (remove) {
    state.judges.splice(Number(remove.dataset.removeJudge), 1);
    renderSetup();
    scheduleSave();
  }
  const reset = event.target.closest("[data-reset-frame]");
  if (reset) {
    state.participants[Number(reset.dataset.resetFrame)].frame = {
      scale: 1,
      x: 0,
      y: 0,
    };
    renderSetup();
    scheduleSave();
  }
});
$("#addJudge").addEventListener("click", () => {
  if (state.judges.length >= 3) return;
  state.judges.push({ id: crypto.randomUUID(), name: "", avatar: "" });
  renderSetup();
  scheduleSave();
});
$("#toSeating").addEventListener("click", () => {
  const missingPlayers = state.participants.some(
    (person) => !person.name.trim(),
  );
  const missingJudges = state.judges.some((person) => !person.name.trim());
  if (!state.event.trim())
    return ($("#setupError").textContent = "Введите название турнира");
  if (missingPlayers)
    return ($("#setupError").textContent = "Заполните ники всех 12 участников");
  if (missingJudges)
    return ($("#setupError").textContent = "Заполните имена всех судей");
  $("#setupError").textContent = "";
  if (!Array.isArray(state.seats) || state.seats.length !== 10)
    state.seats = state.participants.slice(0, 10).map((p) => p.id);
  state.phase = "seating";
  scheduleSave(true);
  showView();
});

function renderSeating() {
  $("#seatingGame").textContent = state.game;
  $("#tableGameNumber").textContent = state.game;
  $("#startGame").textContent = `Начать игру ${state.game}`;
  const chosen = new Set(state.seats.filter(Boolean));
  $("#seatMap").innerHTML = Array.from(
    { length: 10 },
    (_, index) =>
      `<label class="seat"><span class="seat-head"><b class="seat-no">${index + 1}</b><span>Место ${index + 1}</span></span><select data-seat="${index}"><option value="">Не выбран</option>${state.participants.map((person) => `<option value="${person.id}" ${state.seats[index] === person.id ? "selected" : ""} ${chosen.has(person.id) && state.seats[index] !== person.id ? "disabled" : ""}>${esc(person.name)}</option>`).join("")}</select></label>`,
  ).join("");
  const reserves = state.participants.filter(
    (person) => !chosen.has(person.id),
  );
  $("#reserveList").innerHTML = reserves.length
    ? reserves
        .map(
          (person) =>
            `<div class="reserve-person"><span>${esc(initials(person.name))}</span>${esc(person.name)}</div>`,
        )
        .join("")
    : `<div class="empty">Все участники за столом</div>`;
}
$("#seatMap").addEventListener("change", (event) => {
  if (!event.target.matches("[data-seat]")) return;
  state.seats[Number(event.target.dataset.seat)] = event.target.value || null;
  renderSeating();
  scheduleSave();
});
$("#backToSetup").addEventListener("click", () => {
  state.phase = "setup";
  scheduleSave();
  showView();
});
$("#startGame").addEventListener("click", () => {
  const selected = state.seats.filter(Boolean);
  if (selected.length !== 10 || new Set(selected).size !== 10)
    return ($("#seatingError").textContent = "Выберите 10 разных игроков");
  $("#seatingError").textContent = "";
  state.players = state.seats.map((id, index) => {
    const person = state.participants.find((item) => item.id === id);
    return {
      id: crypto.randomUUID(),
      participantId: person.id,
      number: index + 1,
      name: person.name,
      avatar: person.avatar,
      color: person.color,
      frame: { ...frameOf(person) },
      role: "unknown",
      status: "alive",
      penalties: { yellow: false, red: false, gray: 0 },
      nominated: false,
      bestMove: false,
    };
  });
  state.gameLog = {
    bestMove: [null, null, null],
    nights: [{ shot: null, donCheck: null, sheriffCheck: null }],
    days: [{ vote: null }],
    nominationOrder: [],
  };
  state.activePlayerId = null;
  state.overlayVisible = false;
  state.phase = "live";
  scheduleSave(true);
  showView();
});

function renderLive() {
  $("#liveEvent").textContent = `${state.event} · ${state.table}`;
  $("#liveGame").textContent = `${state.game} / ${state.gamesTotal}`;
  const toggle = $("#overlayToggle");
  toggle.classList.toggle("visible", state.overlayVisible);
  toggle.querySelector("span").textContent = state.overlayVisible
    ? "Скрыть оверлей"
    : "Показать оверлей";
  $("#nextGame").classList.toggle("hidden", state.game >= state.gamesTotal);
  $("#nextGame").textContent = `Подготовить игру ${state.game + 1} →`;
  renderGameLog();
  renderPlayers();
  renderScenes();
}

function logOptions(value) {
  return `<option value="" ${value == null ? "selected" : ""}>—</option><option value="none" ${value === "none" ? "selected" : ""}>× Нет события</option>${state.players.map((player) => `<option value="${player.id}" ${value === player.id ? "selected" : ""}>${player.number}. ${esc(player.name)}</option>`).join("")}`;
}
function bestMoveScore() {
  const black = state.gameLog.bestMove.filter((id) => {
    const player = state.players.find((item) => item.id === id);
    return player && ["mafia", "don"].includes(player.role);
  }).length;
  return black === 3 ? "1.0" : black === 2 ? "0.5" : "0";
}
function renderGameLog() {
  if (!state.gameLog)
    state.gameLog = {
      bestMove: [null, null, null],
      nights: [{ shot: null, donCheck: null, sheriffCheck: null }],
      days: [{ vote: null }],
    };
  const log = state.gameLog;
  log.nominationOrder ||= [];
  $("#gameLogControl").innerHTML =
    `<div class="log-editor"><section class="log-block"><div class="log-block-head"><strong>Лучший ход</strong><div class="log-score"><span>Доп. балл</span><b>${bestMoveScore()}</b></div></div><div class="log-row"><label>ЛХ</label>${log.bestMove.map((value, index) => `<select data-log="bestMove" data-index="${index}">${logOptions(value)}</select>`).join("")}</div></section><section class="log-block"><div class="log-block-head"><strong>Ночи</strong><button class="mini-add" data-add="night">+ Ночь</button></div>${log.nights.map((night, index) => `<div class="log-row single"><label>Отстрел ${index + 1}</label><select data-log="night" data-field="shot" data-index="${index}">${logOptions(night.shot)}</select></div><div class="log-row single"><label>Дон ${index + 1}</label><select data-log="night" data-field="donCheck" data-index="${index}">${logOptions(night.donCheck)}</select></div><div class="log-row single"><label>Шериф ${index + 1}</label><select data-log="night" data-field="sheriffCheck" data-index="${index}">${logOptions(night.sheriffCheck)}</select></div>`).join("")}</section><section class="log-block"><div class="log-block-head"><strong>Дни</strong><button class="mini-add" data-add="day">+ День</button></div>${log.days.map((day, index) => `<div class="log-row single"><label>Голос ${index + 1}</label><select data-log="day" data-field="vote" data-index="${index}">${logOptions(day.vote)}</select></div>`).join("")}</section></div>`;
}
$("#gameLogControl").addEventListener("change", (event) => {
  const select = event.target.closest("[data-log]");
  if (!select) return;
  const value = select.value || null,
    index = Number(select.dataset.index);
  if (select.dataset.log === "bestMove") state.gameLog.bestMove[index] = value;
  if (select.dataset.log === "night")
    state.gameLog.nights[index][select.dataset.field] = value;
  if (select.dataset.log === "day")
    state.gameLog.days[index][select.dataset.field] = value;
  renderGameLog();
  scheduleSave();
});
$("#gameLogControl").addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]");
  if (!add) return;
  if (add.dataset.add === "night")
    state.gameLog.nights.push({
      shot: null,
      donCheck: null,
      sheriffCheck: null,
    });
  if (add.dataset.add === "day") state.gameLog.days.push({ vote: null });
  renderGameLog();
  scheduleSave();
});
function renderPlayers() {
  const alive = state.players.filter(
    (p) => !["dead", "removed", "expelled"].includes(p.status),
  ).length;
  $("#aliveCounter").textContent = `${alive} из 10 в игре`;
  $("#playersGrid").innerHTML = state.players
    .map((player, index) => {
      const penalties = player.penalties || {
        yellow: false,
        red: false,
        gray: 0,
      };
      return `<article class="player-card ${player.status}" data-id="${player.id}">${photoMarkup(player, "live", index)}<span class="status">${statusLabels[player.status]}</span>${frameEditor(player, index, "live")}<div class="player-body"><input class="player-name" value="${esc(player.name)}" disabled><div class="role-row"><select class="role-select">${Object.entries(
        roleLabels,
      )
        .map(
          ([value, label]) =>
            `<option value="${value}" ${player.role === value ? "selected" : ""}>${label}</option>`,
        )
        .join(
          "",
        )}</select><button class="role-chip ${["civilian", "sheriff"].includes(player.role) ? "red" : ["mafia", "don"].includes(player.role) ? "black" : ""}" data-action="cycle-role">${player.role === "unknown" ? "—" : roleLabels[player.role]}</button></div><div class="card-actions"><button data-action="toggle-yellow" class="penalty-control ${penalties.red ? "penalty-red" : "penalty-yellow"} ${penalties.yellow || penalties.red ? "active" : ""}" title="${penalties.red ? "Снять красную карточку" : penalties.yellow ? "Заменить жёлтую на красную" : "Жёлтая карточка"}"><span class="penalty-swatch"></span></button><button data-action="gray-minus" class="gray-step" title="Убрать серую карточку" ${penalties.gray < 1 ? "disabled" : ""}>−</button><button data-action="gray-plus" class="penalty-control penalty-gray ${penalties.gray ? "active" : ""}" title="Добавить серую карточку"><span class="penalty-swatch"></span><b>${penalties.gray || "+"}</b></button><button data-action="nominate" class="${player.nominated ? "active" : ""}" title="Выставлен">↑</button><button data-action="kill" class="danger ${player.status === "dead" ? "active" : ""}" title="Убит"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path></svg></button><button data-action="vote-out" class="danger ${player.status === "removed" ? "active" : ""}" title="Заголосован"><svg viewBox="0 0 24 24"><path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"></path></svg></button><button data-action="expel" class="danger ${player.status === "expelled" ? "active" : ""}" title="Удалён"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"></path></svg></button></div></div></article>`;
    })
    .join("");
}
const livePlayer = (element) =>
  state.players.find(
    (player) => player.id === element.closest(".player-card").dataset.id,
  );
$("#playersGrid").addEventListener("input", (event) => {
  if (!event.target.matches("[data-frame]")) return;
  const player = state.players[Number(event.target.dataset.index)];
  player.frame ||= { scale: 1, x: 0, y: 0 };
  player.frame[event.target.dataset.frame] =
    event.target.dataset.frame === "scale"
      ? Number(event.target.value) / 100
      : Number(event.target.value);
  event.target.nextElementSibling.value =
    event.target.dataset.frame === "scale"
      ? `${event.target.value}%`
      : event.target.value;
  const image = event.target
    .closest(".player-card")
    .querySelector(".photo img");
  if (image) image.style.cssText = frameStyle(player);
  const participant = state.participants.find(
    (item) => item.id === player.participantId,
  );
  if (participant) participant.frame = { ...player.frame };
  scheduleSave();
});
$("#playersGrid").addEventListener("change", (event) => {
  if (event.target.matches(".role-select")) {
    livePlayer(event.target).role = event.target.value;
    renderPlayers();
    renderGameLog();
    scheduleSave();
  }
  if (event.target.matches(".photo-input")) {
    const player = livePlayer(event.target);
    readImage(event.target, player, () => {
      const person = state.participants.find(
        (item) => item.id === player.participantId,
      );
      if (person) person.avatar = player.avatar;
      renderPlayers();
    });
  }
});
$("#playersGrid").addEventListener("click", (event) => {
  const reset = event.target.closest("[data-reset-frame]");
  if (reset) {
    const player = state.players[Number(reset.dataset.resetFrame)];
    player.frame = { scale: 1, x: 0, y: 0 };
    const participant = state.participants.find(
      (item) => item.id === player.participantId,
    );
    if (participant) participant.frame = { ...player.frame };
    renderPlayers();
    scheduleSave();
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const player = livePlayer(button),
    action = button.dataset.action;
  player.penalties ||= { yellow: false, red: false, gray: 0 };
  if (action === "toggle-yellow") {
    if (player.penalties.red) {
      player.penalties.red = false;
      player.penalties.yellow = false;
    } else if (player.penalties.yellow) {
      player.penalties.yellow = false;
      player.penalties.red = true;
    } else {
      player.penalties.yellow = true;
      player.penalties.red = false;
    }
  }
  if (action === "gray-plus") player.penalties.gray += 1;
  if (action === "gray-minus")
    player.penalties.gray = Math.max(0, player.penalties.gray - 1);
  if (action === "nominate") {
    state.gameLog.nominationOrder ||= [];
    player.nominated = !player.nominated;
    state.gameLog.nominationOrder = state.gameLog.nominationOrder.filter((id) => id !== player.id);
    if (player.nominated) state.gameLog.nominationOrder.push(player.id);
  }
  if (action === "kill")
    player.status = player.status === "dead" ? "alive" : "dead";
  if (action === "vote-out")
    player.status = player.status === "removed" ? "alive" : "removed";
  if (action === "expel")
    player.status = player.status === "expelled" ? "alive" : "expelled";
  if (action === "cycle-role") {
    const roles = Object.keys(roleLabels);
    player.role = roles[(roles.indexOf(player.role) + 1) % roles.length];
    renderGameLog();
  }
  renderPlayers();
  scheduleSave();
});
$("#overlayToggle").addEventListener("click", () => {
  state.overlayVisible = !state.overlayVisible;
  renderLive();
  scheduleSave();
});
$("#resetNominations").addEventListener("click", () => {
  state.players.forEach((player) => {
    player.nominated = false;
  });
  state.gameLog.nominationOrder = [];
  renderPlayers();
  scheduleSave();
  toast("Выставления сброшены");
});
$("#editSeating").addEventListener("click", () => {
  state.overlayVisible = false;
  state.phase = "seating";
  scheduleSave();
  showView();
});
$("#nextGame").addEventListener("click", () => {
  if (state.game >= state.gamesTotal) return;
  state.overlayVisible = false;
  state.game += 1;
  state.phase = "seating";
  scheduleSave(true);
  showView();
});

function restartTournamentProgress() {
  state.game = 1;
  state.currentGameId = "";
  state.activePlayerId = null;
  state.overlayVisible = false;
  state.revealRoles = true;
  state.gameLog = {
    bestMove: [null, null, null],
    nights: [{ shot: null, donCheck: null, sheriffCheck: null }],
    days: [{ vote: null }],
    nominationOrder: [],
  };
  state.players = (state.seats || []).map((participantId, index) => {
    const person = state.participants.find((item) => item.id === participantId);
    return {
      id: crypto.randomUUID(),
      participantId,
      number: index + 1,
      name: person?.name || `Игрок ${index + 1}`,
      avatar: person?.avatar || "",
      color: person?.color || "#777777",
      frame: { ...frameOf(person || {}) },
      role: "unknown",
      status: "alive",
      penalties: { yellow: false, red: false, gray: 0 },
      fouls: 0,
      nominated: false,
      bestMove: false,
    };
  });
  state.phase = "seating";
  scheduleSave(true);
  $("#restartTournamentDialog").close();
  showView();
  toast("Турнир начат заново");
}

$("#restartTournament").addEventListener("click", () => $("#restartTournamentDialog").showModal());
$("#restartTournamentSeating").addEventListener("click", () => $("#restartTournamentDialog").showModal());
$("#closeRestartTournament").addEventListener("click", () => $("#restartTournamentDialog").close());
$("#cancelRestartTournament").addEventListener("click", () => $("#restartTournamentDialog").close());
$("#confirmRestartTournament").addEventListener("click", restartTournamentProgress);

function renderScenes() {
  $("#sceneList").innerHTML = scenes.length
    ? scenes
        .map(
          (name) =>
            `<button class="scene-button ${name === currentScene ? "active" : ""}" data-scene="${esc(name)}">${esc(name)}</button>`,
        )
        .join("")
    : `<div class="empty">Подключите OBS, чтобы переключать сцены</div>`;
}
$("#sceneList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-scene]");
  if (!button) return;
  try {
    const result = await request("/api/obs/scene", {
      method: "POST",
      body: JSON.stringify({ sceneName: button.dataset.scene }),
    });
    currentScene = result.currentScene;
    renderScenes();
  } catch (error) {
    toast(error.message);
  }
});
async function loadScenes() {
  try {
    const result = await request("/api/obs/scenes");
    scenes = result.scenes;
    currentScene = result.currentScene;
    renderScenes();
  } catch (error) {
    toast(error.message);
  }
}
$("#refreshScenes").addEventListener("click", loadScenes);
$("#setupScenes").addEventListener("click", async () => {
  const button = $("#setupScenes");
  button.disabled = true;
  try {
    const result = await request("/api/obs/setup-scenes", {
      method: "POST",
      body: JSON.stringify({
        gameSourceName: $("#obsGameSource").value.trim(),
        cameraSourceName: $("#obsCameraSource").value.trim(),
      }),
    });
    scenes = result.scenes;
    currentScene = result.currentScene;
    renderScenes();
    toast("Сцены созданы в OBS");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

function settingInput(label, key, value, options = {}) {
  const type = options.type || "text";
  const hint = options.hint ? `<small>${options.hint}</small>` : "";
  return `<label class="scene-field ${options.wide ? "wide" : ""}">${label}<input data-scene-setting="${key}" type="${type}" value="${esc(value)}" ${options.min ? `min="${options.min}"` : ""} ${options.max ? `max="${options.max}"` : ""}>${hint}</label>`;
}

function renderSceneSettings() {
  ensureSceneSettings();
  const settings = state.sceneSettings[activeSceneSetting];
  $("#sceneSettingsTabs").innerHTML = Object.entries(sceneSettingMeta).map(([key, meta]) => `<button type="button" data-scene-tab="${key}" class="${key === activeSceneSetting ? "active" : ""}"><strong>${meta.label}</strong><span>${meta.description}</span></button>`).join("");
  let specific = "";
  if (activeSceneSetting === "starting") specific = `
    ${settingInput("Дата турнира", "tournamentDate", state.tournamentDate || "")}
    ${settingInput("Дата и время начала", "streamStartsAt", (state.streamStartsAt || "").slice(0, 16), { type: "datetime-local" })}
    <label class="scene-check wide"><input data-scene-setting="showCountdown" type="checkbox" ${settings.showCountdown ? "checked" : ""}><span>Показывать обратный отсчет</span></label>`;
  if (activeSceneSetting === "studio") specific = settingInput("Источник камеры в OBS", "cameraSource", settings.cameraSource, { wide: true, hint: "Название должно полностью совпадать с источником в OBS." });
  if (["game", "night"].includes(activeSceneSetting)) specific += settingInput("Источник игрового видео", "gameSource", settings.gameSource, { wide: true });
  if (activeSceneSetting === "night") specific += settingInput("Источник камеры комментатора", "cameraSource", settings.cameraSource, { wide: true });
  if (["game", "night"].includes(activeSceneSetting)) specific += settingInput("Ссылка на игровой оверлей", "overlayUrl", settings.overlayUrl, { wide: true, hint: "Можно указать локальный путь /overlay.html или полную ссылку." });
  if (["results", "standings", "announcement"].includes(activeSceneSetting)) specific = `
    ${settingInput("ID турнира", "tournamentId", state.tournamentId || "", { type: "number", min: 1 })}
    ${activeSceneSetting !== "standings" ? settingInput("ID игры", "currentGameId", state.currentGameId || "", { type: "number", min: 1 }) : ""}
    ${settingInput("Источник вебки в OBS", "cameraSource", settings.cameraSource, { wide: true, hint: activeSceneSetting === "announcement" ? "Камера будет показана крупно слева от таблицы баллов." : "Этот источник будет показан справа под карточкой лидера." })}
    ${settingInput("Обновлять каждые, секунд", "refreshSeconds", settings.refreshSeconds, { type: "number", min: 5, max: 300 })}
    <div class="scene-api-address wide"><span>Адрес формируется автоматически</span><code>${esc(activeSceneSetting === "standings" ? `https://mafiaunlimit.ru/api/public/tournaments/${state.tournamentId || "…"}/standings` : `https://mafiaunlimit.ru/api/public/tournaments/${state.tournamentId || "…"}/games/${state.currentGameId || "…"}/scores`)}</code></div>`;
  $("#sceneSettingsFields").innerHTML = `<div class="scene-fields">
    ${settingInput("Заголовок", "title", settings.title, { wide: true })}
    ${settingInput("Подпись", "subtitle", settings.subtitle, { wide: true })}
    ${settingInput("Цвет фона", "backgroundColor", settings.backgroundColor, { type: "color" })}
    ${settingInput("Акцент", "accentColor", settings.accentColor, { type: "color" })}
    <div class="scene-background-status wide"><span>Фирменный черно-желтый фон формируется автоматически</span></div>
    ${specific}
  </div>`;
  const previewUrl = `/scene.html?layout=${activeSceneSetting}`;
  $("#scenePreview").src = `${previewUrl}&preview=${Date.now()}`;
  $("#openScenePreview").href = previewUrl;
}

function updateSceneSetting(input) {
  const settings = state.sceneSettings[activeSceneSetting];
  const key = input.dataset.sceneSetting;
  if (["tournamentDate", "streamStartsAt", "tournamentId", "currentGameId"].includes(key))
    state[key] = ["tournamentId", "currentGameId"].includes(key) ? input.value.replace(/\D/g, "") : input.value;
  else settings[key] = input.type === "checkbox" ? input.checked : input.type === "number" ? Math.max(5, Number(input.value) || 15) : input.value;
  scheduleSave();
  clearTimeout(renderSceneSettings.timer);
  renderSceneSettings.timer = setTimeout(() => { $("#scenePreview").src = `/scene.html?layout=${activeSceneSetting}&preview=${Date.now()}`; }, 350);
}

$("#sceneSettingsButton").addEventListener("click", () => {
  ensureSceneSettings();
  renderSceneSettings();
  $("#sceneSettingsDialog").showModal();
});
$("#closeSceneSettings").addEventListener("click", () => $("#sceneSettingsDialog").close());
$("#saveSceneSettings").addEventListener("click", async () => {
  scheduleSave(true);
  $("#sceneSettingsDialog").close();
  toast("Настройки сцен сохранены");
});
$("#sceneSettingsTabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-scene-tab]");
  if (!tab) return;
  activeSceneSetting = tab.dataset.sceneTab;
  renderSceneSettings();
});
$("#sceneSettingsFields").addEventListener("input", (event) => {
  if (event.target.matches("[data-scene-setting]")) updateSceneSetting(event.target);
});
$("#resetSceneSettings").addEventListener("click", () => {
  state.sceneSettings[activeSceneSetting] = { ...sceneSettingDefaults[activeSceneSetting] };
  renderSceneSettings();
  scheduleSave(true);
  toast("Настройки сцены сброшены");
});
$("#obsButton").addEventListener("click", () => $("#obsDialog").showModal());
$("#closeObsDialog").addEventListener("click", () => $("#obsDialog").close());
$("#cancelObsDialog").addEventListener("click", () => $("#obsDialog").close());
$("#obsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#connectObs");
  button.disabled = true;
  try {
    const result = await request("/api/obs/connect", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
    });
    scenes = result.scenes;
    currentScene = result.currentScene;
    $("#obsButton").classList.add("connected");
    $("#obsDialog").close();
    renderScenes();
  } catch (error) {
    $("#obsError").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#overlayUrl").textContent = `${location.origin}/overlay.html`;
state = await request("/api/state");
await normalizeStoredAvatars();
showView();
const socket = new WebSocket(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`,
);
socket.addEventListener(
  "open",
  () => ($("#syncLabel").textContent = "Сохранено"),
);
socket.addEventListener(
  "close",
  () => ($("#syncLabel").textContent = "Связь потеряна"),
);
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "reload") location.reload();
});
try {
  const status = await request("/api/obs/status");
  if (status.connected) {
    $("#obsButton").classList.add("connected");
    await loadScenes();
  }
} catch {}
