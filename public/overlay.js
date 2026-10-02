const root = document.querySelector("#overlay");
const roleLetters = { mafia: "М", don: "Д", sheriff: "Ш" };
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>'\"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '\"': "&quot;",
      })[char],
  );
const initials = (name) => name.trim().slice(0, 2).toUpperCase() || "?";
let currentState = null;
let animationToken = 0;

function eventToken(value, state) {
  if (value === "none") return `<span class="event-token no-event">×</span>`;
  const player = state.players.find((item) => item.id === value);
  if (!player)
    return `<span class="event-token empty-token" aria-hidden="true"></span>`;
  const role = player.role || "unknown";
  const mark =
    role === "don"
      ? `<i class="token-mark don-card-hat" aria-label="Дон"></i>`
      : role === "sheriff"
        ? `<i class="token-mark sheriff-mark" aria-label="Шериф">★</i>`
        : "";
  return `<span class="event-token token-${role}"><b>${player.number}</b>${mark}</span>`;
}

function gameLogMarkup(state) {
  const log = state.gameLog || {
    bestMove: [null, null, null],
    nights: [],
    days: [],
  };
  const icons = {
    shot: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path><circle cx="12" cy="12" r="1.5"></circle></svg>`,
    don: `<i class="don-hat" aria-hidden="true"></i>`,
    sheriff: `<span aria-hidden="true">★</span>`,
    vote: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"></path></svg>`,
  };
  const nominationOrder = log.nominationOrder || [];
  const nominated = nominationOrder
    .map((id) => state.players.find((player) => player.id === id))
    .filter((player) => player?.nominated);
  state.players.forEach((player) => {
    if (player.nominated && !nominated.includes(player)) nominated.push(player);
  });
  const nominatedMarkup = nominated.length
    ? `<div class="nominated"><strong>Выставлены:</strong><div class="event-values">${nominated.map((player) => eventToken(player.id, state)).join("")}</div></div>`
    : "";
  const row = (icon, label, values) =>
    `<div class="event-row"><span class="event-icon ${icon}" aria-label="${label}">${icons[icon]}</span><span class="event-line"></span><div class="event-values">${values.map((value) => eventToken(value, state)).join("")}</div></div>`;
  return `<section class="game-log"><div class="best-move"><strong>ЛХ</strong><span class="event-line"></span><div class="event-values">${log.bestMove.map((value) => eventToken(value, state)).join("")}</div>${nominatedMarkup}</div><div class="round-caption">${log.nights.map((_, index) => `<span>${index + 1}</span>`).join("")}</div>${row(
    "shot",
    "Отстрел",
    log.nights.map((item) => item.shot),
  )}${row(
    "don",
    "Проверка дона",
    log.nights.map((item) => item.donCheck),
  )}${row(
    "sheriff",
    "Проверка шерифа",
    log.nights.map((item) => item.sheriffCheck),
  )}${row(
    "vote",
    "Голосование",
    log.days.map((item) => item.vote),
  )}</section>`;
}

function playerMarkup(player, animationClass = "", index = 0) {
  const role = player.role || "unknown";
  const letter = roleLetters[role];
  const frame = player.frame || { scale: 1, x: 0, y: 0 };
  const penalties = player.penalties || {
    yellow: player.penaltyCard === "yellow",
    red: player.penaltyCard === "red",
    gray: player.penaltyCard === "gray" ? 1 : 0,
  };
  const nameLength = Array.from(player.name || "").length;
  const nameClass =
    nameLength > 16 ? "very-long" : nameLength > 10 ? "long" : "";
  const exitX = index % 2 ? `${90 + index * 8}px` : `${-90 - index * 8}px`;
  const exitRotate =
    index % 2 ? `${2 + index * 0.3}deg` : `${-2 - index * 0.3}deg`;
  return `<div class="player role-${role} ${player.status} ${animationClass}" data-id="${player.id}" style="--exit-x:${exitX};--exit-rotate:${exitRotate};--delay:${index * 24}ms">
    <div class="role-light"></div>
    ${player.avatar ? `<img class="portrait" src="${player.avatar}" alt="" style="--avatar-scale:${frame.scale};--avatar-x:${frame.x}%;--avatar-y:${frame.y}%">` : `<div class="placeholder">${escapeHtml(initials(player.name))}</div>`}
    ${letter ? `<span class="role-letter">${letter}</span>` : ""}
    ${penalties.yellow || penalties.red || penalties.gray ? `<span class="player-penalties">${penalties.red ? `<i class="player-penalty penalty-red" aria-label="Красная карточка"></i>` : penalties.yellow ? `<i class="player-penalty penalty-yellow" aria-label="Жёлтая карточка"></i>` : ""}${penalties.gray ? `<i class="player-penalty penalty-gray" aria-label="Серые карточки"><b>${penalties.gray > 1 ? penalties.gray : ""}</b></i>` : ""}</span>` : ""}
    ${player.status === "dead" ? `<span class="elimination-mark killed-mark" aria-label="Убит"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path><circle cx="12" cy="12" r="1.5"></circle></svg></span>` : ""}
    ${player.status === "removed" ? `<span class="elimination-mark voted-mark" aria-label="Заголосован"><svg viewBox="0 0 24 24"><path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"></path></svg></span>` : ""}
    ${player.status === "expelled" ? `<span class="elimination-mark expelled-mark" aria-label="Удалён"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"></path></svg></span>` : ""}
    ${player.status === "speaking" ? `<span class="speaker-label">Говорит</span><span class="speaker-ring"></span>` : ""}
    <div class="nameplate"><span class="number">${player.number}</span><span class="name ${nameClass}">${escapeHtml(player.name)}</span></div>
    <span class="badges">${player.fouls ? `<span class="badge">Ф${player.fouls}</span>` : ""}${player.nominated ? `<span class="badge nom">↑</span>` : ""}</span>
  </div>`;
}

function render(state, enteringIds = new Set(), overlayClass = "", penaltyAnimations = new Map()) {
  const visibilityClass = state.overlayVisible ? "is-visible" : "is-hidden";
  root.innerHTML = `<div class="overlay ${visibilityClass} ${overlayClass}">
    ${gameLogMarkup(state)}
    <div class="match-info"><span class="event">${escapeHtml(state.event)}</span><span class="top-divider"></span><span class="game-count">Игра <b>${state.game}</b> / ${state.gamesTotal}</span></div>
    <div class="bottom-bar">
      ${state.tournamentLogo ? `<img class="tournament-logo" src="${state.tournamentLogo}" alt="">` : `<span class="logo-space"></span>`}
      <div class="players">${state.players.map((player, index) => playerMarkup(player, [enteringIds.has(player.id) ? "role-entering" : "", penaltyAnimations.get(player.id) || ""].filter(Boolean).join(" "), index)).join("")}</div>
    </div>
  </div>`;
}

function applyState(nextState) {
  if (!currentState) {
    currentState = nextState;
    render(nextState);
    return;
  }
  if (currentState.overlayVisible !== nextState.overlayVisible) {
    const token = ++animationToken;
    if (nextState.overlayVisible) {
      currentState = nextState;
      render(nextState, new Set(), "overlay-showing");
    } else {
      root.querySelector(".overlay")?.classList.add("overlay-hiding");
      setTimeout(() => {
        if (token === animationToken) {
          currentState = nextState;
          render(nextState);
        }
      }, 560);
    }
    return;
  }
  const previousRoles = new Map(
    currentState.players.map((player) => [player.id, player.role]),
  );
  const changed = new Set(
    nextState.players
      .filter(
        (player) =>
          previousRoles.has(player.id) &&
          previousRoles.get(player.id) !== player.role,
      )
      .map((player) => player.id),
  );
  const penaltyAnimations = new Map();
  nextState.players.forEach((player) => {
    const previous = currentState.players.find((item) => item.id === player.id)?.penalties || {};
    const penalties = player.penalties || {};
    if (penalties.red && !previous.red) penaltyAnimations.set(player.id, "penalty-flash-red");
    else if (penalties.yellow && !previous.yellow) penaltyAnimations.set(player.id, "penalty-flash-yellow");
    else if (Number(penalties.gray || 0) > Number(previous.gray || 0)) penaltyAnimations.set(player.id, "penalty-flash-gray");
  });
  if (!changed.size) {
    currentState = nextState;
    render(nextState, new Set(), "", penaltyAnimations);
    return;
  }
  const token = ++animationToken;
  changed.forEach((id) =>
    root.querySelector(`[data-id="${id}"]`)?.classList.add("role-leaving"),
  );
  setTimeout(() => {
    if (token !== animationToken) return;
    currentState = nextState;
    render(nextState, changed, "", penaltyAnimations);
  }, 280);
}

applyState(await fetch("/api/state").then((response) => response.json()));
const socket = new WebSocket(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`,
);
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "state") applyState(message.state);
  if (message.type === "reload") location.reload();
});
socket.addEventListener("close", () =>
  setTimeout(() => location.reload(), 1500),
);
