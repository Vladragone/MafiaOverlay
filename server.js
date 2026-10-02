import http from "node:http";
import { watch } from "node:fs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import OBSWebSocket from "obs-websocket-js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");
const stateFile = path.join(dataDir, "state.json");
const port = Number(process.env.PORT || 4173);

const names = [
  "Наполеон",
  "Солнце",
  "AnnaMor",
  "Артик",
  "Cristo",
  "Infinity",
  "Juventini",
  "Leeroyka",
  "Рябина",
  "Свич",
];
const colors = [
  "#be2337",
  "#dc735d",
  "#bc5744",
  "#dba23d",
  "#e25043",
  "#d6879a",
  "#708796",
  "#3c8c84",
  "#aa5c79",
  "#7c62a7",
];

const initialState = {
  schemaVersion: 12,
  event: "Кубок города",
  table: "Финал",
  game: 1,
  gamesTotal: 10,
  tournamentLogo: "",
  tournamentBackground: "",
  publicApiBase: "https://mafiaunlimit.ru/api",
  tournamentId: "",
  currentGameId: "",
  tournamentDate: "3 октября 2026",
  streamStartsAt: "2026-10-03T11:00:00+03:00",
  sceneSettings: {},
  phase: "setup",
  overlayVisible: false,
  activePlayerId: null,
  revealRoles: true,
  participants: [...names, "Запасной 1", "Запасной 2"].map((name, index) => ({
    id: crypto.randomUUID(),
    name,
    avatar: "",
    color: colors[index % colors.length],
    frame: { scale: 1, x: 0, y: 0 },
  })),
  judges: [{ id: crypto.randomUUID(), name: "", avatar: "" }],
  seats: Array(10).fill(null),
  gameLog: {
    bestMove: [null, null, null],
    nights: [{ shot: null, donCheck: null, sheriffCheck: null }],
    days: [{ vote: null }],
    nominationOrder: [],
  },
  players: names.map((name, index) => ({
    id: crypto.randomUUID(),
    number: index + 1,
    name,
    role: "unknown",
    status: "alive",
    penalties: { yellow: false, red: false, gray: 0 },
    frame: { scale: 1, x: 0, y: 0 },
    fouls: 0,
    nominated: false,
    bestMove: false,
    avatar: "",
    color: colors[index],
  })),
};

let state = initialState;
let saveTimer;
const obs = new OBSWebSocket();
let obsConnected = false;
let obsAddress = "ws://127.0.0.1:4455";

async function loadState() {
  await mkdir(dataDir, { recursive: true });
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
    if (state.schemaVersion !== 12) {
      const previousPlayers = Array.isArray(state.players) ? state.players : [];
      const needsRosterMigration = !Array.isArray(state.participants);
      state.schemaVersion = 12;
      state.tournamentLogo ||= "";
      state.tournamentBackground ||= state.sceneSettings?.starting?.background || "";
      state.publicApiBase ||= "https://mafiaunlimit.ru/api";
      state.tournamentId ??= "";
      state.currentGameId ??= "";
      state.tournamentDate ||= "3 октября 2026";
      state.streamStartsAt ||= "2026-10-03T11:00:00+03:00";
      state.revealRoles = true;
      if (needsRosterMigration) {
        state.phase = "setup";
        state.overlayVisible = false;
        state.participants = previousPlayers.map((player, index) => ({
          id: player.participantId || player.id || crypto.randomUUID(),
          name: player.name || `Игрок ${index + 1}`,
          avatar: player.avatar || "",
          color: player.color || colors[index % colors.length],
          frame: player.frame || { scale: 1, x: 0, y: 0 },
        }));
        while (state.participants.length < 12) {
          const index = state.participants.length;
          state.participants.push({
            id: crypto.randomUUID(),
            name: `Запасной ${index - 9}`,
            avatar: "",
            color: colors[index % colors.length],
            frame: { scale: 1, x: 0, y: 0 },
          });
        }
        state.participants = state.participants.slice(0, 12);
        state.judges = [{ id: crypto.randomUUID(), name: "", avatar: "" }];
        state.seats = state.participants
          .slice(0, 10)
          .map((participant) => participant.id);
        state.players = state.participants
          .slice(0, 10)
          .map((participant, index) => ({
            id: crypto.randomUUID(),
            participantId: participant.id,
            number: index + 1,
            name: participant.name,
            avatar: participant.avatar,
            color: participant.color,
            frame: participant.frame,
            role: "unknown",
            status: "alive",
            penalties: { yellow: false, red: false, gray: 0 },
            fouls: 0,
            nominated: false,
            bestMove: false,
          }));
      }
      state.participants.forEach((participant) => {
        participant.frame ||= { scale: 1, x: 0, y: 0 };
        if (participant.frame.scale === 1.35) participant.frame.scale = 1;
      });
      state.players.forEach((player) => {
        player.frame ||= state.participants.find(
          (item) => item.id === player.participantId,
        )?.frame || { scale: 1, x: 0, y: 0 };
        if (player.frame.scale === 1.35) player.frame.scale = 1;
        player.penalties ||= {
          yellow: player.penaltyCard === "yellow",
          red: player.penaltyCard === "red",
          gray: player.penaltyCard === "gray" ? 1 : 0,
        };
      });
      state.gameLog ||= {
        bestMove: [null, null, null],
        nights: [{ shot: null, donCheck: null, sheriffCheck: null }],
        days: [{ vote: null }],
      };
      state.gameLog.nominationOrder ||= [];
      await persist();
    }
    state.gameLog ||= {
      bestMove: [null, null, null],
      nights: [{ shot: null, donCheck: null, sheriffCheck: null }],
      days: [{ vote: null }],
    };
    state.gameLog.nominationOrder ||= [];
    state.sceneSettings = normalizeSceneSettings(state.sceneSettings);
    if (inferTournamentIds()) await persist();
  } catch {
    await persist();
  }
}

async function persist() {
  await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist().catch(console.error), 100);
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function broadcast() {
  const payload = JSON.stringify({ type: "state", state });
  for (const client of wss.clients)
    if (client.readyState === 1) client.send(payload);
}

function broadcastReload(file) {
  const payload = JSON.stringify({ type: "reload", file });
  for (const client of wss.clients)
    if (client.readyState === 1) client.send(payload);
}

const scenePresets = [
  { name: "STARTING SOON", layout: "starting", sources: [] },
  { name: "STUDIO", layout: "studio", sources: ["camera"] },
  { name: "GAME", layout: "game", sources: ["game", "overlay"] },
  { name: "NIGHT", layout: "night", sources: ["game", "camera", "overlay"] },
  { name: "RESULTS", layout: "results", sources: ["camera"] },
  { name: "STANDINGS", layout: "standings", sources: ["camera"] },
  { name: "ПОБЕДА МАФИИ", layout: "mafia-win", sources: [] },
  { name: "ПОБЕДА МИРНЫХ", layout: "civilian-win", sources: [] },
  { name: "ОГЛАШЕНИЕ РЕЗУЛЬТАТОВ", layout: "announcement", sources: ["camera"] },
  { name: "TECHNICAL PAUSE", layout: "technical", sources: [] },
];

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

function normalizeSceneSettings(settings = {}) {
  return Object.fromEntries(Object.entries(sceneSettingDefaults).map(([key, defaults]) => [key, { ...defaults, ...(settings[key] || {}) }]));
}

function inferTournamentIds() {
  if (state.tournamentId && state.currentGameId) return false;
  const savedUrl = state.sceneSettings?.results?.dataUrl || state.sceneSettings?.standings?.dataUrl || "";
  const match = savedUrl.match(/\/tournaments\/(\d+)(?:\/games\/(\d+))?/);
  if (!match) return false;
  state.tournamentId ||= match[1];
  state.currentGameId ||= match[2] || "";
  return true;
}

async function sceneExists(sceneName) {
  const { scenes } = await obs.call("GetSceneList");
  return scenes.some((scene) => scene.sceneName === sceneName);
}

async function ensureScene(sceneName) {
  if (!(await sceneExists(sceneName)))
    await obs.call("CreateScene", { sceneName });
}

async function getInputNames() {
  const { inputs } = await obs.call("GetInputList");
  return new Set(inputs.map((input) => input.inputName));
}

async function ensureSceneItem(sceneName, inputName, transform) {
  let sceneItemId;
  try {
    ({ sceneItemId } = await obs.call("GetSceneItemId", {
      sceneName,
      sourceName: inputName,
    }));
  } catch {
    ({ sceneItemId } = await obs.call("CreateSceneItem", {
      sceneName,
      sourceName: inputName,
    }));
  }
  await obs.call("SetSceneItemTransform", {
    sceneName,
    sceneItemId,
    sceneItemTransform: transform,
  });
  return sceneItemId;
}

async function moveSceneItemToTop(sceneName, inputName) {
  const { sceneItemId } = await obs.call("GetSceneItemId", {
    sceneName,
    sourceName: inputName,
  });
  const { sceneItems } = await obs.call("GetSceneItemList", { sceneName });
  await obs.call("SetSceneItemIndex", {
    sceneName,
    sceneItemId,
    sceneItemIndex: Math.max(0, sceneItems.length - 1),
  });
}

async function ensureBrowserSource(sceneName, inputName, url) {
  const inputNames = await getInputNames();
  if (!inputNames.has(inputName)) {
    await obs.call("CreateInput", {
      sceneName,
      inputName,
      inputKind: "browser_source",
      inputSettings: { url, width: 1920, height: 1080, fps: 60 },
      sceneItemEnabled: true,
    });
  } else {
    await obs.call("SetInputSettings", {
      inputName,
      inputSettings: { url, width: 1920, height: 1080 },
    });
    await ensureSceneItem(sceneName, inputName, {
      positionX: 0,
      positionY: 0,
      scaleX: 1,
      scaleY: 1,
      boundsType: "OBS_BOUNDS_STRETCH",
      boundsWidth: 1920,
      boundsHeight: 1080,
    });
  }
}

async function setupObsScenes({
  gameSourceName = "Захват экрана",
  cameraSourceName = "Камера ведущего",
} = {}) {
  state.sceneSettings = normalizeSceneSettings(state.sceneSettings);
  const inputNames = await getInputNames();
  const gameTransform = {
    positionX: 0,
    positionY: 0,
    scaleX: 1,
    scaleY: 1,
    boundsType: "OBS_BOUNDS_STRETCH",
    boundsWidth: 1920,
    boundsHeight: 1080,
  };
  const commentsGameTransform = {
    positionX: 24,
    positionY: 120,
    scaleX: 1,
    scaleY: 1,
    boundsType: "OBS_BOUNDS_STRETCH",
    boundsWidth: 1416,
    boundsHeight: 900,
  };
  const commentsCameraTransform = {
    positionX: 1480,
    positionY: 90,
    scaleX: 1,
    scaleY: 1,
    boundsType: "OBS_BOUNDS_STRETCH",
    boundsWidth: 390,
    boundsHeight: 292,
  };
  const resultsCameraTransform = {
    positionX: 1502,
    positionY: 660,
    scaleX: 1,
    scaleY: 1,
    boundsType: "OBS_BOUNDS_SCALE_INNER",
    boundsAlignment: 0,
    boundsWidth: 354,
    boundsHeight: 260,
  };
  const announcementCameraTransform = {
    positionX: 42,
    positionY: 42,
    scaleX: 1,
    scaleY: 1,
    boundsType: "OBS_BOUNDS_SCALE_INNER",
    boundsAlignment: 0,
    boundsWidth: 1336,
    boundsHeight: 996,
  };

  for (const preset of scenePresets) {
    const settings = state.sceneSettings[preset.layout];
    const presetGameSource = settings.gameSource || gameSourceName;
    const presetCameraSource = settings.cameraSource || cameraSourceName;
    await ensureScene(preset.name);
    await ensureBrowserSource(
      preset.name,
      `Mafia Layout | ${preset.layout}`,
      `http://127.0.0.1:${port}/scene.html?layout=${preset.layout}`,
    );
    if (preset.sources.includes("game") && inputNames.has(presetGameSource))
      await ensureSceneItem(preset.name, presetGameSource, gameTransform);
    if (preset.layout === "night") {
      if (inputNames.has(presetGameSource))
        await ensureSceneItem(
          preset.name,
          presetGameSource,
          commentsGameTransform,
        );
      if (inputNames.has(presetCameraSource))
        await ensureSceneItem(
          preset.name,
          presetCameraSource,
          commentsCameraTransform,
        );
    }
    if (preset.layout === "studio" && inputNames.has(presetCameraSource))
      await ensureSceneItem(preset.name, presetCameraSource, gameTransform);
    if (["results", "standings"].includes(preset.layout) && inputNames.has(presetCameraSource))
      await ensureSceneItem(preset.name, presetCameraSource, resultsCameraTransform);
    if (preset.layout === "announcement" && inputNames.has(presetCameraSource))
      await ensureSceneItem(preset.name, presetCameraSource, announcementCameraTransform);
    await moveSceneItemToTop(preset.name, `Mafia Layout | ${preset.layout}`);
    if (preset.sources.includes("overlay")) {
      await ensureBrowserSource(
        preset.name,
        `Mafia Players | ${preset.layout}`,
        new URL(settings.overlayUrl || "/overlay.html", `http://127.0.0.1:${port}`).href,
      );
      await moveSceneItemToTop(preset.name, `Mafia Players | ${preset.layout}`);
    }
    if (["results", "standings"].includes(preset.layout) && inputNames.has(presetCameraSource))
      await moveSceneItemToTop(preset.name, presetCameraSource);
  }
  return scenePresets.map((preset) => preset.name);
}

async function proxyTournamentApi(res, resource) {
  const base = String(state.publicApiBase || "https://mafiaunlimit.ru/api").replace(/\/$/, "");
  const tournamentId = String(state.tournamentId || "").trim();
  const gameId = String(state.currentGameId || "").trim();
  if (!/^\d+$/.test(tournamentId))
    return json(res, 400, { error: "Укажите ID турнира в панели управления" });
  if (resource === "scores" && !/^\d+$/.test(gameId))
    return json(res, 400, { error: "Укажите ID текущей игры" });

  state.sceneSettings = normalizeSceneSettings(state.sceneSettings);
  const suffix = resource === "scores"
    ? `/public/tournaments/${tournamentId}/games/${gameId}/scores`
    : `/public/tournaments/${tournamentId}/standings`;
  try {
    const target = `${base}${suffix}`;
    const parsedTarget = new URL(target);
    if (!["http:", "https:"].includes(parsedTarget.protocol))
      return json(res, 400, { error: "Ссылка на таблицу должна начинаться с http:// или https://" });
    const response = await fetch(parsedTarget, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      return json(res, response.status, { error: payload.detail || payload.error || "Mafia Unlimit не вернул данные" });
    return json(res, 200, payload);
  } catch (error) {
    return json(res, 502, { error: `Нет связи с Mafia Unlimit: ${error.message}` });
  }
}

async function api(req, res, pathname) {
  if (pathname === "/api/state" && req.method === "GET")
    return json(res, 200, state);
  if (pathname === "/api/state" && req.method === "PUT") {
    const next = await body(req);
    if (!next || !Array.isArray(next.players))
      return json(res, 400, { error: "Некорректное состояние" });
    state = next;
    scheduleSave();
    broadcast();
    return json(res, 200, state);
  }
  if (pathname === "/api/tournament/standings" && req.method === "GET")
    return proxyTournamentApi(res, "standings");
  if (pathname === "/api/tournament/scores" && req.method === "GET")
    return proxyTournamentApi(res, "scores");
  if (pathname === "/api/obs/status" && req.method === "GET") {
    return json(res, 200, { connected: obsConnected, address: obsAddress });
  }
  if (pathname === "/api/obs/connect" && req.method === "POST") {
    const data = await body(req);
    try {
      if (obsConnected) await obs.disconnect();
      obsAddress = data.address || obsAddress;
      await obs.connect(obsAddress, data.password || undefined);
      obsConnected = true;
      const { scenes, currentProgramSceneName } =
        await obs.call("GetSceneList");
      return json(res, 200, {
        connected: true,
        currentScene: currentProgramSceneName,
        scenes: scenes.map((s) => s.sceneName),
      });
    } catch (error) {
      obsConnected = false;
      return json(res, 400, { connected: false, error: error.message });
    }
  }
  if (pathname === "/api/obs/scenes" && req.method === "GET") {
    if (!obsConnected) return json(res, 409, { error: "OBS не подключён" });
    try {
      const { scenes, currentProgramSceneName } =
        await obs.call("GetSceneList");
      return json(res, 200, {
        currentScene: currentProgramSceneName,
        scenes: scenes.map((s) => s.sceneName),
      });
    } catch (error) {
      obsConnected = false;
      return json(res, 500, { error: error.message });
    }
  }
  if (pathname === "/api/obs/scene" && req.method === "POST") {
    if (!obsConnected) return json(res, 409, { error: "OBS не подключён" });
    try {
      const data = await body(req);
      await obs.call("SetCurrentProgramScene", { sceneName: data.sceneName });
      return json(res, 200, { ok: true, currentScene: data.sceneName });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  if (pathname === "/api/obs/setup-scenes" && req.method === "POST") {
    if (!obsConnected) return json(res, 409, { error: "OBS не подключён" });
    try {
      const data = await body(req);
      const createdScenes = await setupObsScenes(data);
      const { currentProgramSceneName } = await obs.call("GetSceneList");
      return json(res, 200, {
        ok: true,
        scenes: createdScenes,
        currentScene: currentProgramSceneName,
      });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await api(req, res, url.pathname);
      if (handled !== false) return;
      return json(res, 404, { error: "Не найдено" });
    }
    let pathname = decodeURIComponent(
      url.pathname === "/" ? "/index.html" : url.pathname,
    );
    const filePath = path.resolve(publicDir, `.${pathname}`);
    if (!filePath.startsWith(publicDir))
      return json(res, 403, { error: "Запрещено" });
    await stat(filePath);
    res.writeHead(200, {
      "Content-Type":
        mime[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(await readFile(filePath));
  } catch (error) {
    if (!res.headersSent)
      json(res, error.code === "ENOENT" ? 404 : 500, { error: error.message });
  }
});

const wss = new WebSocketServer({ server, path: "/live" });
wss.on("connection", (socket) =>
  socket.send(JSON.stringify({ type: "state", state })),
);
obs.on("ConnectionClosed", () => {
  obsConnected = false;
});

let reloadTimer;
watch(publicDir, { recursive: true }, (_event, filename) => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => broadcastReload(filename || "public"), 100);
});

await loadState();
server.listen(port, "0.0.0.0", () => {
  console.log(`Mafia OBS Control: http://localhost:${port}`);
  console.log(`OBS overlay:       http://localhost:${port}/overlay.html`);
  console.log("Live reload:       enabled for public files");
});
