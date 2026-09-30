import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
const Editor = lazy(() => import("@monaco-editor/react"));
import {
  Activity,
  ArrowLeft,
  Archive,
  BellRing,
  CheckCircle2,
  Box,
  ChevronRight,
  ChevronLeft,
  CircleGauge,
  ChartNoAxesCombined,
  Crosshair,
  Command,
  Copy,
  Cpu,
  Database,
  Download,
  File,
  FileCode2,
  Flame,
  HardDrive,
  Folder,
  Globe2,
  Gamepad2,
  MoonStar,
  Menu,
  MemoryStick,
  Monitor,
  Map as MapIcon,
  MapPin,
  LayoutDashboard,
  Maximize2,
  Minus,
  Mountain,
  Network,
  Package,
  Paintbrush,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Square,
  Terminal,
  TriangleAlert,
  TreePine,
  Trash2,
  Upload,
  Users,
  Waypoints,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { create } from "zustand";
import { api, formatBytes, TOKEN, type Instance } from "./lib";
import { Badge, Button, Card, Empty, Spinner } from "./components/ui";
import { ServerAppearance } from "./ServerAppearance";
import {
  applyDashboardPreferences,
  DashboardPreferencesPage,
  loadDashboardPreferences,
  playDashboardSound,
  soundCategoryForEvent,
  unlockDashboardAudio,
} from "./DashboardPreferences";

type Page =
  | "overview"
  | "console"
  | "players"
  | "statistics"
  | "files"
  | "plugins"
  | "worlds"
  | "map"
  | "appearance"
  | "backups"
  | "scheduler"
  | "discord"
  | "networks"
  | "network"
  | "topology"
  | "configuration"
  | "preferences"
  | "advanced";
const useUi = create<{
  page: Page;
  setPage: (p: Page) => void;
  instanceId?: string;
  select: (id: string) => void;
  menu: boolean;
  toggle: () => void;
}>((set) => ({
  page: "overview",
  setPage: (page) => set({ page }),
  select: (instanceId) => set({ instanceId, page: "overview" }),
  menu: false,
  toggle: () => set((s) => ({ menu: !s.menu })),
}));
const nav: [string, { id: Page; label: string; icon: any }[]][] = [
  [
    "Server",
    [
      { id: "overview", label: "Overview", icon: CircleGauge },
      { id: "console", label: "Console", icon: Terminal },
      { id: "players", label: "Players", icon: Users },
      { id: "statistics", label: "Statistics", icon: ChartNoAxesCombined },
      { id: "files", label: "Files", icon: Folder },
    ],
  ],
  [
    "Manage",
    [
      { id: "plugins", label: "Plugins", icon: Package },
      { id: "worlds", label: "Worlds", icon: Globe2 },
      { id: "map", label: "World map", icon: MapIcon },
      { id: "appearance", label: "Appearance", icon: Paintbrush },
      { id: "backups", label: "Backups", icon: Archive },
      { id: "scheduler", label: "Scheduler", icon: Zap },
      { id: "discord", label: "Discord", icon: BellRing },
      { id: "networks", label: "Networks", icon: Network },
      { id: "topology", label: "Network topology", icon: Waypoints },
      { id: "network", label: "Playit tunnel", icon: Network },
    ],
  ],
  [
    "System",
    [
      { id: "configuration", label: "Configuration", icon: Settings },
      { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
      { id: "advanced", label: "Diagnostics", icon: Wrench },
    ],
  ],
];
export function App() {
  const ui = useUi();
  useEffect(() => {
    applyDashboardPreferences(loadDashboardPreferences());
  }, []);
  useEffect(() => {
    const unlock = () => unlockDashboardAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);
  const instances = useQuery({
    queryKey: ["instances"],
    queryFn: () => api<Instance[]>("/api/instances"),
  });
  const chosen =
    instances.data?.find((x) => x.id === ui.instanceId) ?? instances.data?.[0];
  const proxyPages: Page[] = ["overview", "console", "statistics", "files", "plugins", "backups", "scheduler", "discord", "map", "networks", "network", "topology", "configuration", "preferences", "advanced"];
  const visibleNav = chosen?.software === "velocity" ? nav.map(([group, items]) => [group, items.filter((item) => proxyPages.includes(item.id))] as typeof nav[number]).filter(([, items]) => items.length) : nav;
  const currentPage = visibleNav.flatMap(([, items]) => items).find((item) => item.id === ui.page);
  useEffect(() => { if (chosen?.software === "velocity" && !proxyPages.includes(ui.page)) ui.setPage("overview"); }, [chosen?.software, ui.page]);
  useEffect(() => {
    if (chosen && !ui.instanceId) ui.select(chosen.id);
  }, [chosen?.id]);
  const [createOpen, setCreateOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, []);
  if (ui.page === "networks") return <>
    <NetworkWorkspace instances={instances.data ?? []} initialInstance={chosen} onCreateServer={() => setCreateOpen(true)} onExit={() => ui.setPage("overview")} onSearch={() => setPalette(true)} />
    {createOpen && <CreateServer onClose={() => setCreateOpen(false)} />}
    {palette && <Palette onClose={() => setPalette(false)} instance={chosen} />}
    {chosen && <SoundAlertMonitor instance={chosen} />}
  </>;
  return (
    <div className="shell">
      <aside
        className={ui.menu ? "sidebar open" : "sidebar"}
        aria-label="Server navigation"
      >
        <div className="brand">
          <img className="mark brand-image" src="/assets/salvadiux-icon.png" alt="" />
          <div>
            <strong>Salvadiux</strong>
            <small>HOST CONTROL</small>
          </div>
          <Button className="icon mobile" onClick={ui.toggle}>
            <X />
          </Button>
        </div>
        <Button className="new-server" onClick={() => setCreateOpen(true)}>
          <Plus />
          Create server
        </Button>
        {visibleNav.map(([group, items]) => (
          <div className="nav-group" key={group}>
            <span>{group}</span>
            {items.map((item) => (
              <button
                className={ui.page === item.id ? "nav active" : "nav"}
                key={item.id}
                aria-current={ui.page === item.id ? "page" : undefined}
                onClick={() => {
                  ui.setPage(item.id);
                  if (ui.menu) ui.toggle();
                }}
              >
                <item.icon />
                {item.label}
              </button>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <Shield />
          <span>
            Local control plane<small>Encrypted session</small>
          </span>
        </div>
      </aside>
      {ui.menu && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={ui.toggle}
        />
      )}
      <main className="workspace">
        <header className="workspace-header">
          <Button className="icon mobile" onClick={ui.toggle}>
            <Menu />
          </Button>
          <div className="workspace-breadcrumb" aria-label={`Current page: ${currentPage?.label ?? "Overview"}`}>
            <span>Salvadiux</span>
            <ChevronRight aria-hidden="true" />
            <strong>{currentPage?.label ?? "Overview"}</strong>
          </div>
          <button className="search-trigger" onClick={() => setPalette(true)}>
            <Search />
            Search files, plugins, settings…<kbd>Ctrl K</kbd>
          </button>
          <div className="instance-select">
            {chosen ? (
              <>
                <span className={`status-dot ${chosen.status}`} />
                <select
                  value={chosen.id}
                  onChange={(e) => ui.select(e.target.value)}
                >
                  {instances.data?.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <span>No servers</span>
            )}
          </div>
        </header>
        <div className={ui.page === "map" ? "content content-map" : "content"}>
          {instances.isLoading ? (
            <div className="center">
              <Spinner />
            </div>
          ) : !chosen ? (
            <Welcome onCreate={() => setCreateOpen(true)} />
          ) : (
            <PageView page={ui.page} instance={chosen} instances={instances.data ?? []} />
          )}
        </div>
      </main>
      {createOpen && <CreateServer onClose={() => setCreateOpen(false)} />}{" "}
      {palette && (
        <Palette onClose={() => setPalette(false)} instance={chosen} />
      )}
      {chosen && <SoundAlertMonitor instance={chosen} />}
    </div>
  );
}
function Welcome({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="welcome">
      <div className="welcome-art">
        <Server />
      </div>
      <h1>Run your first server</h1>
      <p>
        Choose Minecraft software and a version. Salvadiux downloads the
        matching Java runtime and creates an isolated server instance.
      </p>
      <Button onClick={onCreate}>
        <Plus />
        Create server
      </Button>
    </div>
  );
}
function PageView({ page, instance, instances = [instance] }: { page: Page; instance: Instance; instances?: Instance[] }) {
  switch (page) {
    case "overview":
      return <Overview i={instance} />;
    case "console":
      return <ConsolePage i={instance} />;
    case "files":
      return <FilesPage i={instance} />;
    case "configuration":
      return <ConfigPage i={instance} />;
    case "appearance":
      return <ServerAppearance instance={instance} />;
    case "preferences":
      return <DashboardPreferencesPage />;
    case "plugins":
      return <PluginsPage i={instance} />;
    case "backups":
      return <BackupsPage i={instance} />;
    case "worlds":
      return <WorldsPage i={instance} />;
    case "map":
      return instance.software === "velocity" ? <NetworkDashboardMap proxy={instance} instances={instances} /> : <WorldMapPage i={instance} />;
    case "players":
      return <PlayersPage i={instance} />;
    case "statistics":
      return <StatisticsPage i={instance} />;
    case "scheduler":
      return <SchedulerPage i={instance} />;
    case "discord":
      return <DiscordPage i={instance} />;
    case "networks":
      return <NetworkControlPage />;
    case "network":
      return <PlayitPage i={instance} />;
    case "topology":
      return <NetworkTopologyPage selected={instance} />;
    default:
      return <Diagnostics />;
  }
}
function Title({
  title,
  sub,
  actions,
}: {
  title: string;
  sub: string;
  actions?: any;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
function useStatus(i: Instance) {
  return useQuery({
    queryKey: ["status", i.id],
    queryFn: () => api<any>(`/api/instances/${i.id}/status`),
    refetchInterval: 3000,
    retry: false,
  });
}
function SoundAlertMonitor({ instance }: { instance: Instance }) {
  // Share the same cache entries as the visible pages: alert monitoring should
  // observe live data, not issue a second background poll for every resource.
  const activity = useQuery({ queryKey: ["activity", instance.id], queryFn: () => api<any[]>(`/api/instances/${instance.id}/activity`), refetchInterval: 4000, staleTime: 0 });
  const status = useStatus(instance);
  const host = useQuery({ queryKey: ["system-stats"], queryFn: () => api<any>("/api/system/stats"), refetchInterval: 8000 });
  const storage = useQuery({ queryKey: ["storage", instance.id], queryFn: () => api<any>(`/api/instances/${instance.id}/storage`), refetchInterval: 60000, retry: false });
  const seen = useRef<Set<string> | null>(null);
  const previousInstance = useRef(instance.id);
  const previousStatus = useRef<any>(null);
  const previousHost = useRef<any>(null);
  const previousStorage = useRef<any>(null);
  useEffect(() => { previousInstance.current = instance.id; seen.current = null; previousStatus.current = null; previousHost.current = null; previousStorage.current = null; }, [instance.id]);
  const playCategories = (categories: string[]) => {
    const preferences = loadDashboardPreferences();
    if (preferences.soundEnabled && categories.some((category) => preferences.soundEvents.includes("*") || preferences.soundEvents.includes(category))) playDashboardSound(preferences.soundStyle, preferences.soundVolume);
  };
  useEffect(() => {
    if (!activity.data) return;
    if (previousInstance.current !== instance.id) { previousInstance.current = instance.id; seen.current = new Set(activity.data.map((event) => event.id)); return; }
    if (seen.current === null) { seen.current = new Set(activity.data.map((event) => event.id)); return; }
    const fresh = activity.data.filter((event) => !seen.current!.has(event.id));
    for (const event of activity.data) seen.current.add(event.id);
    if (!fresh.length) return;
    playCategories(fresh.map((event) => soundCategoryForEvent(String(event.type ?? ""))));
  }, [activity.dataUpdatedAt, instance.id]);
  useEffect(() => {
    const current = status.data;
    if (!current) return;
    const previous = previousStatus.current;
    if (previous && previousInstance.current === instance.id) {
      const categories: string[] = [];
      if (Boolean(previous.running) !== Boolean(current.running)) categories.push("server");
      const beforePlayers = new Set<string>(previous.players ?? []), nowPlayers = new Set<string>(current.players ?? []);
      if ([...nowPlayers].some((name) => !beforePlayers.has(name)) || [...beforePlayers].some((name) => !nowPlayers.has(name))) categories.push("players");
      const preferences = loadDashboardPreferences(), memoryLimit = Math.max(1, instance.maxMemoryMb * 1024 * 1024);
      const wasHigh = (Number(previous.metrics?.cpu ?? 0) >= preferences.alertCpu) || (Number(previous.metrics?.memory ?? 0) / memoryLimit * 100 >= preferences.alertMemory);
      const isHigh = (Number(current.metrics?.cpu ?? 0) >= preferences.alertCpu) || (Number(current.metrics?.memory ?? 0) / memoryLimit * 100 >= preferences.alertMemory);
      if (!wasHigh && isHigh) categories.push("server");
      if (categories.length) playCategories(categories);
    }
    previousStatus.current = current;
  }, [status.dataUpdatedAt, instance.id, instance.maxMemoryMb]);
  useEffect(() => {
    const current = host.data;
    if (!current) return;
    const previous = previousHost.current, preferences = loadDashboardPreferences();
    if (previous) {
      const beforePercent = (previous.totalMemory - previous.freeMemory) / previous.totalMemory * 100;
      const nowPercent = (current.totalMemory - current.freeMemory) / current.totalMemory * 100;
      if ((previous.cpuUsage ?? 0) < preferences.alertCpu && (current.cpuUsage ?? 0) >= preferences.alertCpu || beforePercent < preferences.alertMemory && nowPercent >= preferences.alertMemory) playCategories(["server"]);
    }
    previousHost.current = current;
  }, [host.dataUpdatedAt]);
  useEffect(() => {
    const current = storage.data;
    if (!current?.total) return;
    const previous = previousStorage.current, preferences = loadDashboardPreferences();
    if (previous && previous.free / previous.total * 100 > preferences.alertDisk && current.free / current.total * 100 <= preferences.alertDisk) playCategories(["server"]);
    previousStorage.current = current;
  }, [storage.dataUpdatedAt]);
  return null;
}
function Overview({ i }: { i: Instance }) {
  const qc = useQueryClient();
  const ui = useUi();
  const [worldSlide, setWorldSlide] = useState(0);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(`salvadiux-widgets-${i.id}`) ?? "[]"); } catch { return []; } });
  const widgetNames = ["world", "launch", "metrics", "alerts", "pulse", "details"];
  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem(`salvadiux-widget-order-${i.id}`) ?? "[]"); return [...saved.filter((id: string) => widgetNames.includes(id)), ...widgetNames.filter((id) => !saved.includes(id))]; } catch { return widgetNames; } });
  useEffect(() => { localStorage.setItem(`salvadiux-widgets-${i.id}`, JSON.stringify(hiddenWidgets)); }, [i.id, hiddenWidgets]);
  useEffect(() => { localStorage.setItem(`salvadiux-widget-order-${i.id}`, JSON.stringify(widgetOrder)); }, [i.id, widgetOrder]);
  const status = useStatus(i);
  const worlds = useQuery({
    queryKey: ["worlds", i.id],
    queryFn: () => api<Array<{ name: string; path?: string; modifiedAt?: string }>>(`/api/instances/${i.id}/worlds`),
    refetchInterval: 10000,
  });
  const [samples, setSamples] = useState<
    Record<string, Array<{ at: number; cpu: number; memory: number }>>
  >({});
  useEffect(() => {
    if (!status.data) return;
    if (!status.data.running) {
      setSamples((current) => (current[i.id]?.length ? { ...current, [i.id]: [] } : current));
      return;
    }
    const metrics = status.data.metrics;
    if (!metrics) return;
    setSamples((current) => ({
      ...current,
      [i.id]: [
        ...(current[i.id] ?? []),
        { at: Date.now(), cpu: metrics.cpu, memory: metrics.memory },
      ].slice(-24),
    }));
  }, [i.id, status.dataUpdatedAt, status.data]);
  const act = useQuery({
    queryKey: ["activity", i.id],
    queryFn: () => api<any[]>(`/api/instances/${i.id}/activity`),
    refetchInterval: 5000,
  });
  const backups = useQuery({ queryKey: ["backups", i.id], queryFn: () => api<any[]>(`/api/instances/${i.id}/backups`), refetchInterval: 30000 });
  const config = useQuery({ queryKey: ["config", i.id], queryFn: () => api<any>(`/api/instances/${i.id}/config`), refetchInterval: 30000 });
  const playerProfiles = useQuery({ queryKey: ["players", i.id], queryFn: () => api<any>(`/api/instances/${i.id}/players`), refetchInterval: 15000 });
  const hostStats = useQuery({ queryKey: ["system-stats"], queryFn: () => api<any>("/api/system/stats"), refetchInterval: 8000 });
  const storage = useQuery({ queryKey: ["storage", i.id], queryFn: () => api<any>(`/api/instances/${i.id}/storage`), refetchInterval: 60000, retry: false });
  const createBackup = useMutation({ mutationFn: () => api(`/api/instances/${i.id}/backups`, { method: "POST", body: "{}" }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["backups", i.id] }); void qc.invalidateQueries({ queryKey: ["activity", i.id] }); } });
  const action = useMutation({
    mutationFn: (name: "start" | "stop" | "restart") =>
      api(`/api/instances/${i.id}/${name}`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["status", i.id] });
      void qc.invalidateQueries({ queryKey: ["instances"] });
    },
  });
  const live = status.data?.status ?? i.status;
  const worldList = worlds.data ?? [];
  const featuredWorld = worldList.length ? worldList[worldSlide % worldList.length]! : null;
  const featuredDimension = featuredWorld ? worldDimension(featuredWorld.name) : "overworld";
  const featuredArt = featuredDimension === "nether" ? "/assets/worlds/nether.webp" : featuredDimension === "end" ? "/assets/worlds/end.webp" : "/assets/worlds/overworld.webp";
  const hostMemoryPercent = hostStats.data ? ((hostStats.data.totalMemory - hostStats.data.freeMemory) / hostStats.data.totalMemory) * 100 : 0;
  const javaMemoryPercent = status.data?.metrics ? (status.data.metrics.memory / (i.maxMemoryMb * 1024 * 1024)) * 100 : 0;
  const backupAgeHours = backups.data?.[0] ? (Date.now() - new Date(backups.data[0].createdAt).getTime()) / 3600000 : Infinity;
  const alertPreferences = loadDashboardPreferences();
  const alerts = [
    ...(status.isError ? [{ title: "Server control is unreachable", detail: "The local agent did not return a status. Check Diagnostics before issuing commands.", page: "advanced" as Page, kind: "danger" }] : []),
    ...(i.restartRequired ? [{ title: "Server restart required", detail: "Saved configuration changes need a restart to take effect.", page: "configuration" as Page, kind: "warning" }] : []),
    ...(hostMemoryPercent >= alertPreferences.alertMemory ? [{ title: "Host memory is running high", detail: `${hostMemoryPercent.toFixed(0)}% of system memory is in use (warning at ${alertPreferences.alertMemory}%).`, page: "statistics" as Page, kind: "warning" }] : []),
    ...(hostStats.data?.cpuUsage >= alertPreferences.alertCpu ? [{ title: "Host CPU is heavily loaded", detail: `${hostStats.data.cpuUsage.toFixed(0)}% processor use (warning at ${alertPreferences.alertCpu}%).`, page: "statistics" as Page, kind: "warning" }] : []),
    ...(javaMemoryPercent >= alertPreferences.alertMemory ? [{ title: "Java memory is near its limit", detail: `${javaMemoryPercent.toFixed(0)}% of the configured maximum heap is in use.`, page: "statistics" as Page, kind: "warning" }] : []),
    ...(storage.data && storage.data.total > 0 && (storage.data.free / storage.data.total) * 100 <= alertPreferences.alertDisk ? [{ title: "Server disk space is low", detail: `${formatBytes(storage.data.free)} free · warning at ${alertPreferences.alertDisk}% free.`, page: "files" as Page, kind: "warning" }] : []),
    ...(!backups.data?.length ? [{ title: "No recovery point exists", detail: "Create a backup before installing plugins or changing worlds.", page: "backups" as Page, kind: "warning" }] : backupAgeHours > alertPreferences.alertBackupHours ? [{ title: "Latest backup is stale", detail: `Last snapshot: ${new Date(backups.data[0].createdAt).toLocaleString()}.`, page: "backups" as Page, kind: "warning" }] : []),
  ];
  const widgetOptions = [["world", "World carousel"], ["launch", "Quick launch"], ["metrics", "Metric cards"], ["alerts", "Health alerts"], ["pulse", "Live overview cards"], ["details", "Server details and activity"]] as const;
  const moveWidget = (id: string, direction: -1 | 1) => setWidgetOrder((items) => { const current = items.indexOf(id), next = current + direction; if (next < 0 || next >= items.length) return items; const copy = [...items]; [copy[current], copy[next]] = [copy[next]!, copy[current]!]; return copy; });
  const widgetStyle = (id: string) => ({ order: widgetOrder.indexOf(id) + 2 });
  return (
    <div className="overview-layout">
      <div className="hero" style={{ order: 0 }}>
        <div className="hero-grid" />
        <div className="hero-copy">
          <div className="server-icon">
            <Server />
          </div>
          <div>
            <div className="eyebrow">
              <Badge tone={live}>{live}</Badge>
              {i.restartRequired && (
                <Badge tone="warning">Restart required</Badge>
              )}
            </div>
            <h1>{i.name}</h1>
            <p>
              {i.software.toUpperCase()} · Minecraft {i.minecraftVersion} · Java{" "}
              {i.javaMajor}
            </p>
          </div>
        </div>
        <div className="hero-actions">
          {status.data?.running ? (
            <><Button className="secondary" disabled={action.isPending} onClick={() => action.mutate("restart")}><RotateCcw />Restart</Button><Button className="danger" disabled={action.isPending} onClick={() => action.mutate("stop")}><Square />Stop</Button></>
          ) : (
            <Button
              disabled={action.isPending}
              onClick={() => action.mutate("start")}
            >
              <Play />
              Start
            </Button>
          )}
          <Button className="secondary" disabled={createBackup.isPending} onClick={() => createBackup.mutate()}>{createBackup.isPending ? <Spinner /> : <Archive />}Backup</Button>
        </div>
      </div>
      <div className="overview-customize" style={{ order: 1 }}><Button className="secondary" onClick={() => setCustomizeOpen((open) => !open)}><SlidersHorizontal />Personalize dashboard</Button>{customizeOpen && <div className="widget-picker"><strong>Dashboard sections · drag order</strong>{widgetOrder.map((id, index) => { const [, label] = widgetOptions.find(([optionId]) => optionId === id)!; return <div className="widget-picker-row" key={id}><label><input type="checkbox" checked={!hiddenWidgets.includes(id)} onChange={(event) => setHiddenWidgets((items) => event.target.checked ? items.filter((item) => item !== id) : [...items, id])} />{label}</label><span><button aria-label={`Move ${label} up`} disabled={!index} onClick={() => moveWidget(id, -1)}>↑</button><button aria-label={`Move ${label} down`} disabled={index === widgetOrder.length - 1} onClick={() => moveWidget(id, 1)}>↓</button></span></div>; })}</div>}</div>
      {!hiddenWidgets.includes("world") && <section style={widgetStyle("world")} className={`world-feature world-feature-${featuredDimension}`} aria-label="World carousel">
        <img key={`${featuredWorld?.name ?? "empty"}:${featuredArt}`} className="world-feature-art" src={featuredArt} alt="" draggable="false" />
        <div className="world-feature-shade" />
        <div className="world-feature-top"><span><Gamepad2 /> SERVER WORLDS</span><span>{worldList.length ? `${String(worldSlide + 1).padStart(2, "0")} / ${String(worldList.length).padStart(2, "0")}` : "WORLD HUB"}</span></div>
        <div className="world-feature-content" key={featuredWorld?.name ?? "empty-world"}>
          <span className="world-feature-kicker">{featuredWorld ? worldLabel(featuredWorld.name, featuredDimension) : "YOUR GAME UNIVERSE"}</span>
          <h2>{featuredWorld?.name ?? "Your worlds, together"}</h2>
          <p>{featuredWorld ? `Explore ${featuredWorld.name} · ${i.software.toUpperCase()} ${i.minecraftVersion}` : "Lobby, survival, creative and custom worlds in one control room."}</p>
          <Button className="world-feature-cta" onClick={() => ui.setPage("map")}><Globe2 />Explore world<MapIcon /></Button>
        </div>
        <div className="world-feature-visual"><div className={`world-feature-icon world-feature-icon-${featuredDimension}`}><img src={featuredArt} alt="" draggable="false" /></div><span>{featuredWorld ? "WORLD SELECTED" : "READY TO PLAY"}</span><strong>{featuredWorld ? worldLabel(featuredWorld.name, featuredDimension) : "Server hub"}</strong></div>
        <div className="world-feature-controls"><button aria-label="Previous world" disabled={worldList.length < 2} onClick={() => setWorldSlide((n) => (n - 1 + worldList.length) % worldList.length)}><ChevronLeft /></button><div className="world-feature-dots">{worldList.map((world, index) => <button key={world.name} className={index === worldSlide ? "active" : ""} aria-label={`Show ${world.name}`} onClick={() => setWorldSlide(index)} />)}</div><button aria-label="Next world" disabled={worldList.length < 2} onClick={() => setWorldSlide((n) => (n + 1) % worldList.length)}><ChevronRight /></button></div>
      </section>}
      {action.error && <div className="error">{action.error.message}</div>}
      {!hiddenWidgets.includes("launch") && <section style={widgetStyle("launch")} className="launchpad-section" aria-label="Quick launch">
        <div className="launchpad-heading"><div><span>JUMP BACK IN</span><h2>Quick launch</h2></div><span>Pick up where you left off</span></div>
        <div className="launchpad-grid">
          {[
            { id: "map" as Page, title: "World explorer", detail: "Maps · markers · players", icon: MapIcon, tone: "map" },
            { id: "plugins" as Page, title: "Discover", detail: "Plugins · mods · updates", icon: Package, tone: "discover" },
            { id: "players" as Page, title: "Player hub", detail: "Skins · whitelist · bans", icon: Users, tone: "players" },
            { id: "backups" as Page, title: "Snapshots", detail: "Restore · download · schedule", icon: Archive, tone: "backups" },
          ].map((item) => <button className={`launch-card launch-${item.tone}`} key={item.id} onClick={() => ui.setPage(item.id)}><span className="launch-icon"><item.icon /></span><span className="launch-card-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight className="launch-arrow" /></button>)}
        </div>
      </section>}
      {!hiddenWidgets.includes("metrics") && <div style={widgetStyle("metrics")} className="metrics">
        <Metric
          label="CPU"
          value={
            status.data?.metrics
              ? `${status.data.metrics.cpu.toFixed(1)}%`
              : "Unavailable"
          }
          icon={Activity}
          history={samples[i.id]?.map((sample) => sample.cpu)}
          historyLabel="CPU usage"
        />
        <Metric
          label="RAM"
          value={
            status.data?.metrics
              ? formatBytes(status.data.metrics.memory)
              : "Unavailable"
          }
          icon={Database}
          history={samples[i.id]?.map((sample) => sample.memory)}
          historyLabel="Memory usage"
        />
        <Metric
          label="Worlds"
          value={String(worlds.data?.length ?? "—")}
          icon={Globe2}
        />
        <Metric
          label="Uptime"
          value={
            status.data?.metrics
              ? formatDuration(status.data.metrics.elapsed)
              : "Unavailable"
          }
          icon={Waypoints}
        />
      </div>}
      {!hiddenWidgets.includes("alerts") && <Card style={widgetStyle("alerts")} className="alert-center"><div className="alert-center-heading"><div><span>SERVER HEALTH</span><h2>Alert center</h2></div><Badge tone={alerts.length ? "warning" : "online"}>{alerts.length ? `${alerts.length} needs attention` : "All clear"}</Badge></div>{alerts.length ? <div className="alert-list">{alerts.map((alert) => <button key={alert.title} className="alert-row" onClick={() => ui.setPage(alert.page)}><TriangleAlert /><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><ChevronRight /></button>)}</div> : <div className="all-clear"><CheckCircle2 /><span><strong>No active alerts</strong><small>Memory, backups and saved configuration look healthy.</small></span>{storage.data && <small className="storage-chip"><HardDrive />{formatBytes(storage.data.free)} free</small>}</div>}</Card>}
      {!hiddenWidgets.includes("pulse") && <section style={widgetStyle("pulse")} className="overview-pulse" aria-label="Server at a glance">
        <Card className="pulse-players">
          <div className="pulse-card-heading"><span>Player activity</span><button onClick={() => ui.setPage("players")}>Manage <ChevronRight /></button></div>
          <div className="pulse-player-content"><div className="player-ring" style={{ "--player-fill": `${Math.min(100, ((status.data?.playerCount ?? status.data?.players?.length ?? 0) / Math.max(1, Number(config.data?.values?.["max-players"] ?? 20))) * 100)}%` } as React.CSSProperties}><strong>{status.data?.playerCount ?? status.data?.players?.length ?? 0}</strong><small>online</small></div><div className="pulse-player-info"><strong>{status.data?.playerCount ?? status.data?.players?.length ?? 0}<span> / {config.data?.values?.["max-players"] ?? 20}</span></strong><small>{status.data?.running ? "Server accepting connections" : "Server currently offline"}</small><div className="player-facepile">{(playerProfiles.data?.online ?? []).slice(0, 5).map((player: any) => <img key={player.name} src={player.profile?.head ?? `/assets/avatars/${[...player.name].reduce((sum: number, c: string) => sum + c.charCodeAt(0), 0) % 2 ? "alex" : "steve"}.svg`} title={player.name} alt={`${player.name} skin`} />)}{(status.data?.playerCount ?? status.data?.players?.length ?? 0) > 5 && <span>+{(status.data?.playerCount ?? status.data?.players?.length ?? 0) - 5}</span>}{!(playerProfiles.data?.online?.length) && <span className="facepile-empty">Live player skins appear here</span>}</div></div></div>
        </Card>
        <Card className="pulse-resources">
          <div className="pulse-card-heading"><span>Host resources</span><button onClick={() => ui.setPage("statistics")}>Details <ChevronRight /></button></div>
          <ResourceBar label="Host CPU" value={hostStats.data?.cpuUsage} suffix="%" color="blue" />
          <ResourceBar label="System memory" value={hostStats.data ? ((hostStats.data.totalMemory - hostStats.data.freeMemory) / hostStats.data.totalMemory) * 100 : null} suffix="%" color="violet" detail={hostStats.data ? `${formatBytes(hostStats.data.totalMemory - hostStats.data.freeMemory)} / ${formatBytes(hostStats.data.totalMemory)}` : "Sampling host"} />
          <ResourceBar label="Java memory" value={status.data?.metrics ? status.data.metrics.memory / (i.maxMemoryMb * 1024 * 1024) * 100 : null} suffix="%" color="green" detail={status.data?.metrics ? `${formatBytes(status.data.metrics.memory)} of ${i.maxMemoryMb} MB configured` : "Server process unavailable"} />
        </Card>
        <Card className="pulse-backup">
          <div className="pulse-card-heading"><span>Backup health</span><button onClick={() => ui.setPage("backups")}>Open backups <ChevronRight /></button></div>
          {backups.data?.[0] ? <><div className="backup-last"><span className="backup-check"><Shield /></span><div><strong>Latest snapshot</strong><small>{new Date(backups.data[0].createdAt).toLocaleString()}</small></div></div><div className="backup-foot"><span>{formatBytes(backups.data[0].size)}</span><span>{backups.data.length} saved backups</span></div></> : <><div className="backup-empty"><Archive /><span><strong>No backup snapshots yet</strong><small>Protect your worlds before changing plugins or configs.</small></span></div><Button className="secondary backup-create" onClick={() => createBackup.mutate()} disabled={createBackup.isPending}>{createBackup.isPending ? <Spinner /> : <Plus />}{createBackup.isPending ? "Creating snapshot…" : "Create first backup"}</Button>{createBackup.error && <small className="error">{createBackup.error.message}</small>}</>}
        </Card>
      </section>}
      {!hiddenWidgets.includes("details") && <div style={widgetStyle("details")} className="overview-grid">
        <Card>
          <h2>Server information</h2>
          <Info
            label="Address"
            value={`${i.host === "0.0.0.0" ? "localhost" : i.host}:${i.port}`}
          />
          <Info label="Software" value={`${i.software} ${i.build ?? ""}`} />
          <Info label="PID" value={status.data?.pid ?? "Unavailable"} />
          <Info label="Instance" value={i.path} />
        </Card>
        <Card>
          <h2>Recent activity</h2>
          {act.data?.length ? (
            act.data.slice(0, 7).map((a) => (
              <div className="activity" key={a.id}>
                <span />
                <div>
                  <strong>{a.message}</strong>
                  <small>{new Date(a.createdAt).toLocaleString()}</small>
                </div>
              </div>
            ))
          ) : (
            <Empty title="No activity yet" />
          )}
        </Card>
        <Card className="wide">
          <h2>Live console</h2>
          <pre className="mini-console">
            {status.data?.logs?.slice(-8).join("\n") ||
              "Server output will appear here after startup."}
          </pre>
        </Card>
      </div>}
    </div>
  );
}
function Metric({
  label,
  value,
  icon: Icon,
  history,
  historyLabel,
}: {
  label: string;
  value: string;
  icon: any;
  history?: number[];
  historyLabel?: string;
}) {
  return (
    <Card className={`metric${history ? " metric-with-chart" : ""}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="metric-trailing">
        <Icon />
        {history && (
          <div className="metric-chart-wrap">
            <Sparkline
              values={history}
              label={historyLabel ?? label}
              formatValue={historyLabel === "CPU usage" ? (n) => `${n.toFixed(1)}%` : formatBytes}
            />
            <small>Last ~60 sec</small>
          </div>
        )}
      </div>
    </Card>
  );
}
function ResourceBar({ label, value, suffix, color, detail }: { label: string; value: number | null | undefined; suffix: string; color: "blue" | "violet" | "green"; detail?: string }) {
  const known = Number.isFinite(value);
  const amount = known ? Math.max(0, Math.min(100, Number(value))) : 0;
  return <div className="resource-bar"><div><span>{label}</span><strong>{known ? `${amount.toFixed(0)}${suffix}` : "—"}</strong></div><div className="resource-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? amount : undefined}><i className={`resource-fill ${color}`} style={{ width: `${amount}%` }} /></div>{detail && <small>{detail}</small>}</div>;
}
function Sparkline({
  values,
  label,
  formatValue,
}: {
  values: number[];
  label: string;
  formatValue?: (value: number) => string;
}) {
  const width = 104;
  const height = 30;
  const valuesForScale = values.length ? values : [0];
  const min = Math.min(...valuesForScale);
  const max = Math.max(...valuesForScale);
  const range = max - min || 1;
  const points = valuesForScale.map((value, index) => {
    const x = valuesForScale.length === 1 ? width : (index / (valuesForScale.length - 1)) * width;
    const y = height - 2 - ((value - min) / range) * (height - 5);
    return `${x},${y}`;
  });
  const latest = values.at(-1);
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        latest === undefined
          ? `${label}: waiting for live samples`
          : `${label}: ${values.length} recent samples, latest ${formatValue?.(latest) ?? latest.toFixed(1)}`
      }
      focusable="false"
    >
      <title>
        {latest === undefined
          ? `${label}: waiting for live samples`
          : `${label}: ${values.length} recent samples, latest ${formatValue?.(latest) ?? latest.toFixed(1)}`}
      </title>
      {values.length > 1 ? (
        <polyline points={points.join(" ")} />
      ) : (
        <circle cx={width} cy={height / 2} r="2.5" />
      )}
    </svg>
  );
}
function Info({ label, value }: { label: string; value: any }) {
  return (
    <div className="info">
      <span>{label}</span>
      <strong title={String(value)}>{value}</strong>
    </div>
  );
}
function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
function ConsolePage({ i }: { i: Instance }) {
  const [lines, setLines] = useState<
    { line: string; level: string; at: string }[]
  >([]);
  const [command, setCommand] = useState("");
  const [paused, setPaused] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${protocol}://${location.host}/api/instances/${i.id}/console?token=${encodeURIComponent(TOKEN)}`,
    );
    ws.onmessage = (e) => {
      const v = JSON.parse(e.data);
      if (v.type === "console") setLines((x) => [...x.slice(-1999), v]);
    };
    return () => ws.close();
  }, [i.id]);
  useEffect(() => {
    if (!paused) end.current?.scrollIntoView();
  }, [lines, paused]);
  const send = async () => {
    if (!command.trim()) return;
    await api(`/api/instances/${i.id}/command`, {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    setCommand("");
  };
  return (
    <>
      <Title
        title="Console"
        sub="Live output and direct server commands"
        actions={
          <Button className="secondary" onClick={() => setPaused((x) => !x)}>
            {paused ? "Resume scroll" : "Pause scroll"}
          </Button>
        }
      />
      <Card className="terminal-card">
        <div className="terminal-lines">
          {lines.length ? (
            lines.map((x, n) => (
              <div className={x.level} key={n}>
                <time>{new Date(x.at).toLocaleTimeString()}</time>
                {x.line}
              </div>
            ))
          ) : (
            <Empty
              title="No console output"
              detail="Start the server to begin streaming logs."
            />
          )}
          <div ref={end} />
        </div>
        <div className="command-line">
          <Command />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void send()}
            placeholder="Enter a command…"
          />
          <Button onClick={() => void send()}>Send</Button>
        </div>
      </Card>
    </>
  );
}
function FilesPage({ i }: { i: Instance }) {
  const [path, setPath] = useState("");
  const [selected, setSelected] = useState<string>();
  const [createKind, setCreateKind] = useState<"file" | "directory">();
  const [createName, setCreateName] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["files", i.id, path],
    queryFn: () =>
      api<any[]>(
        `/api/instances/${i.id}/files?path=${encodeURIComponent(path)}`,
      ),
  });
  const file = useQuery({
    queryKey: ["file", i.id, selected],
    queryFn: () =>
      api<any>(
        `/api/instances/${i.id}/file?path=${encodeURIComponent(selected!)}`,
      ),
    enabled: !!selected,
  });
  const [content, setContent] = useState("");
  useEffect(() => {
    if (file.data && !file.data.binary) setContent(file.data.content);
  }, [file.data]);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/instances/${i.id}/file`, {
        method: "PUT",
        body: JSON.stringify({ path: selected, content }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["files", i.id] });
      await queryClient.invalidateQueries({ queryKey: ["file", i.id, selected] });
    },
  });
  const create = useMutation({
    mutationFn: () => {
      const name = createName.trim().replaceAll("\\", "/");
      return api(`/api/instances/${i.id}/files`, {
        method: "POST",
        body: JSON.stringify({ path: [path, name].filter(Boolean).join("/"), type: createKind }),
      });
    },
    onSuccess: async () => {
      const target = [path, createName.trim().replaceAll("\\", "/")].filter(Boolean).join("/");
      await queryClient.invalidateQueries({ queryKey: ["files", i.id] });
      if (createKind === "file") setSelected(target);
      setCreateName("");
      setCreateKind(undefined);
    },
  });
  const reveal = useMutation({
    mutationFn: (folder: boolean) => api(`/api/instances/${i.id}/files/reveal`, {
      method: "POST",
      body: JSON.stringify({ path: folder ? path : selected, folder }),
    }),
  });
  const upload = useMutation({
    mutationFn: async (selectedFile: File) => {
      const form = new FormData();
      form.append("file", selectedFile);
      const response = await fetch(`/api/instances/${i.id}/files/upload?path=${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: form,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.userMessage ?? result.error?.message ?? `Upload failed (${response.status})`);
      return result.data;
    },
    onSuccess: async (_result, selectedFile) => {
      await queryClient.invalidateQueries({ queryKey: ["files", i.id] });
      setSelected([path, selectedFile.name].filter(Boolean).join("/"));
    },
  });
  const open = (e: any) =>
    e.type === "directory" ? setPath(e.path) : setSelected(e.path);
  return (
    <>
      <Title
        title="Files"
        sub="Browse and edit files inside this instance"
        actions={<>
          <Button className="secondary" onClick={() => reveal.mutate(true)} disabled={reveal.isPending}><Folder /> Open folder</Button>
          <Button className="secondary" onClick={() => setCreateKind("directory")}><Plus /> New folder</Button>
          <Button onClick={() => setCreateKind("file")}><Plus /> New file</Button>
          <Button className="secondary" onClick={() => uploadInput.current?.click()} disabled={upload.isPending}><Upload /> {upload.isPending ? "Uploading…" : "Upload"}</Button>
          <Button className="secondary" onClick={() => list.refetch()}><RefreshCw /> Refresh</Button>
        </>}
      />
      <input ref={uploadInput} className="visually-hidden-file-input" type="file" onChange={(event) => { const selectedFile = event.target.files?.[0]; if (selectedFile) upload.mutate(selectedFile); event.target.value = ""; }} />
      {upload.isError && <div className="file-action-error">{upload.error.message}</div>}
      {reveal.isError && <div className="file-action-error">{reveal.error.message}</div>}
      <div className="files-layout">
        <Card className="file-browser">
          {createKind && <form className="file-create-form" onSubmit={(event) => { event.preventDefault(); if (createName.trim() && !create.isPending) create.mutate(); }}>
            <strong>{createKind === "file" ? "Create file" : "Create folder"}</strong>
            <input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder={createKind === "file" ? "example.yml" : "folder-name"} aria-label="New file or folder name" />
            <div><Button type="button" className="secondary" onClick={() => { setCreateKind(undefined); setCreateName(""); }}>Cancel</Button><Button type="submit" disabled={!createName.trim() || create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button></div>
            {create.isError && <small className="file-action-error">{create.error.message}</small>}
          </form>}
          <div className="breadcrumbs">
            <button onClick={() => setPath("")}>root</button>
            {path
              .split("/")
              .filter(Boolean)
              .map((p, n) => (
                <button
                  key={n}
                  onClick={() =>
                    setPath(
                      path
                        .split("/")
                        .slice(0, n + 1)
                        .join("/"),
                    )
                  }
                >
                  <ChevronRight />
                  {p}
                </button>
              ))}
          </div>
          {list.isLoading ? (
            <Spinner />
          ) : (
            list.data?.length ? list.data.map((e) => (
              <button
                className={
                  selected === e.path ? "file-row selected" : "file-row"
                }
                onClick={() => open(e)}
                key={e.path}
              >
                {e.type === "directory" ? (
                  <Folder />
                ) : e.editable ? (
                  <FileCode2 />
                ) : (
                  <File />
                )}
                <span>
                  {e.name}
                  <small>
                    {e.type === "file" ? formatBytes(e.size) : "Folder"}
                  </small>
                </span>
              </button>
            )) : <Empty title="This folder is empty" detail="Create a file or folder to get started." />
          )}
        </Card>
        <Card className="editor-card">
          {!selected ? (
            <Empty
              title="Select a text file"
              detail="Binary JAR files are protected from text editing."
            />
          ) : file.isLoading ? (
            <Spinner />
          ) : file.data?.binary ? (
            <Empty
              title="Binary file"
              detail={`${file.data.name} · ${formatBytes(file.data.size)}`}
            />
          ) : (
            <>
              <div className="editor-head">
                <span title={selected}>{selected}</span>
                <div className="file-editor-actions">
                  <Button className="secondary" onClick={() => reveal.mutate(false)} disabled={reveal.isPending}><Folder /> Show in Explorer</Button>
                  <Button disabled={save.isPending || content === file.data.content} onClick={() => save.mutate()}>Save</Button>
                </div>
              </div>
              <Suspense fallback={<div className="editor-loading"><Spinner />Loading editor…</div>}><Editor
                height="560px"
                theme="vs-dark"
                path={selected}
                value={content}
                onChange={(v) => setContent(v ?? "")}
                options={{
                  fontSize: 14,
                  wordWrap: "on",
                  minimap: { enabled: false },
                  automaticLayout: true,
                }}
              /></Suspense>
              {save.isSuccess && (
                <div className="saved">Saved · restart may be required</div>
              )}
              {save.isError && <div className="file-action-error">{save.error.message}</div>}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
type PropertyKind = "boolean" | "number" | "password" | "select" | "text";
type PropertyMeta = {
  label?: string;
  description?: string;
  kind?: PropertyKind;
  options?: string[];
  inverted?: boolean;
};

const PROPERTY_META: Record<string, PropertyMeta> = {
  "online-mode": {
    label: "Allow non-premium accounts",
    description:
      "Allows players without Microsoft/Mojang verification (online-mode=false).",
    kind: "boolean",
    inverted: true,
  },
  gamemode: {
    label: "Default gamemode",
    kind: "select",
    options: ["survival", "creative", "adventure", "spectator"],
  },
  difficulty: {
    kind: "select",
    options: ["peaceful", "easy", "normal", "hard"],
  },
  "level-type": {
    label: "World type",
    kind: "select",
    options: [
      "minecraft:normal",
      "minecraft:flat",
      "minecraft:large_biomes",
      "minecraft:amplified",
      "minecraft:single_biome_surface",
    ],
  },
  "rcon.password": { label: "RCON password", kind: "password" },
  motd: { label: "MOTD" },
  pvp: { label: "PvP" },
  "server-ip": { label: "Server IP" },
  "server-port": { label: "Server port", kind: "number" },
  "query.port": { label: "Query port", kind: "number" },
  "rcon.port": { label: "RCON port", kind: "number" },
};

function propertyLabel(key: string) {
  return (
    PROPERTY_META[key]?.label ??
    key.replace(/[.-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function propertyKind(key: string, value: string): PropertyKind {
  const configured = PROPERTY_META[key]?.kind;
  if (configured) return configured;
  if (value === "true" || value === "false") return "boolean";
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return "number";
  return "text";
}

const CONFIG_PRESETS = [
  { id: "balanced", name: "Balanced", group: "Performance", description: "A steady baseline for a small public server.", values: { "view-distance": "10", "simulation-distance": "8", "entity-broadcast-range-percentage": "100", "network-compression-threshold": "256", "sync-chunk-writes": "true" } },
  { id: "low-resource", name: "Low resource", group: "Performance", description: "Reduces chunk and entity work on a smaller host.", values: { "view-distance": "6", "simulation-distance": "4", "entity-broadcast-range-percentage": "75", "network-compression-threshold": "512", "sync-chunk-writes": "true" } },
  { id: "high-visibility", name: "High visibility", group: "Performance", description: "Longer view distance needs more memory and CPU.", values: { "view-distance": "12", "simulation-distance": "10", "entity-broadcast-range-percentage": "100", "network-compression-threshold": "256", "sync-chunk-writes": "true" } },
  { id: "offline-access", name: "Allow non-premium names", group: "Access", description: "Offline mode disables Mojang authentication. Names and UUIDs are not identity proof; use a login plugin and keep admin permissions protected.", values: { "online-mode": "false", "enforce-secure-profile": "false", "white-list": "false", "enforce-whitelist": "false" } },
  { id: "premium-access", name: "Premium authentication", group: "Access", description: "Require Mojang authentication for player connections.", values: { "online-mode": "true", "enforce-secure-profile": "true", "white-list": "false", "enforce-whitelist": "false" } },
  { id: "private-server", name: "Private whitelist", group: "Access", description: "Only names on the server whitelist may join.", values: { "white-list": "true", "enforce-whitelist": "true", "spawn-protection": "16" } },
  { id: "public-server", name: "Open access", group: "Access", description: "Allow anyone to join, subject to bans and authentication mode.", values: { "white-list": "false", "enforce-whitelist": "false" } },
  { id: "survival-pvp", name: "Survival · PvP", group: "Gameplay", description: "Survival defaults with combat enabled and protected spawn.", values: { gamemode: "survival", difficulty: "hard", pvp: "true", "force-gamemode": "false", "spawn-protection": "16", "allow-flight": "false" } },
  { id: "peaceful-lobby", name: "Lobby · peaceful", group: "Gameplay", description: "Adventure-mode lobby defaults. This affects server defaults; per-world plugins can override them.", values: { gamemode: "adventure", difficulty: "peaceful", pvp: "false", "force-gamemode": "true", "spawn-protection": "0", "allow-flight": "true" } },
  { id: "creative", name: "Creative build", group: "Gameplay", description: "Creative defaults with flight enabled. Use a separate creative instance or per-world permissions for a network.", values: { gamemode: "creative", difficulty: "peaceful", pvp: "false", "force-gamemode": "true", "allow-flight": "true", "spawn-protection": "0" } },
  { id: "large-community", name: "Large community", group: "Capacity", description: "Raises the connection cap; actual capacity depends on CPU, memory, and plugins.", values: { "max-players": "60", "player-idle-timeout": "0", "network-compression-threshold": "256" } },
  { id: "small-community", name: "Small community", group: "Capacity", description: "A compact player cap and lower chunk distances.", values: { "max-players": "12", "view-distance": "8", "simulation-distance": "6" } },
];

function ConfigPage({ i }: { i: Instance }) {
  const q = useQuery({
    queryKey: ["config", i.id],
    queryFn: () => api<any>(`/api/instances/${i.id}/config`),
  });
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<"friendly" | "raw">(i.software === "velocity" ? "raw" : "friendly");
  const [filter, setFilter] = useState("");
  const [presetId, setPresetId] = useState("");
  useEffect(() => {
    if (q.data) setRaw(q.data.raw);
  }, [q.data]);
  useEffect(() => setMode(i.software === "velocity" ? "raw" : "friendly"), [i.software]);
  const save = useMutation({
    mutationFn: (body: any) =>
      api(`/api/instances/${i.id}/config`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => q.refetch(),
  });
  if (q.isLoading) return <Spinner />;
  const values: Record<string, string> = q.data?.values ?? {};
  const fields = Object.entries(values)
    .map(([key, value]) => ({
      ...PROPERTY_META[key],
      key,
      value,
      label: propertyLabel(key),
      kind: propertyKind(key, value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleFields = fields.filter(
    ({ key, label }) =>
      !normalizedFilter ||
      key.toLocaleLowerCase().includes(normalizedFilter) ||
      label.toLocaleLowerCase().includes(normalizedFilter),
  );
  const friendlySave = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const vals: Record<string, string> = {};
    for (const field of visibleFields) {
      const checked = fd.has(field.key);
      vals[field.key] =
        field.kind === "boolean"
          ? String(field.inverted ? !checked : checked)
          : String(fd.get(field.key) ?? "");
    }
    save.mutate({ values: vals });
  };
  const preset = CONFIG_PRESETS.find((item) => item.id === presetId);
  const presetChanges = preset ? Object.entries(preset.values).filter(([key, value]) => values[key] !== value) : [];
  return (
    <>
      <Title
        title="Configuration"
        sub="Friendly controls and the real server.properties file"
        actions={
          <div className="segmented">
            <button
              className={mode === "friendly" ? "active" : ""}
              onClick={() => setMode("friendly")}
            >
              Friendly
            </button>
            <button
              className={mode === "raw" ? "active" : ""}
              onClick={() => setMode("raw")}
            >
              Raw
            </button>
          </div>
        }
      />
      <Card className="config-presets">
        <div className="config-presets-head"><div><h2>Quick profiles</h2><p>Apply a reviewed set of server.properties values in one save. A timestamped backup is created automatically.</p></div><Badge>{CONFIG_PRESETS.length} profiles</Badge></div>
        <div className="config-preset-controls"><label><span>Profile</span><select value={presetId} onChange={(event) => setPresetId(event.target.value)}><option value="">Choose a profile…</option>{[...new Set(CONFIG_PRESETS.map((item) => item.group))].map((group) => <optgroup label={group} key={group}>{CONFIG_PRESETS.filter((item) => item.group === group).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label>{preset && <Button className="secondary" disabled={!presetChanges.length || save.isPending} onClick={() => { if (window.confirm(`Apply ${preset.name}? This changes ${presetChanges.length} server.properties values and marks the server for restart.`)) save.mutate({ values: Object.fromEntries(presetChanges) }); }}>Apply {presetChanges.length} changes</Button>}</div>
        {preset && <div className="config-preset-preview"><p>{preset.description}</p>{presetChanges.length ? <div className="config-preset-diff">{presetChanges.map(([key, value]) => <div key={key}><code>{key}</code><span>{values[key] ?? "unset"}</span><ChevronRight /><strong>{value}</strong></div>)}</div> : <div className="saved">This profile already matches the current configuration.</div>}</div>}
      </Card>
      <Card>
        {mode === "friendly" ? (
          <>
            <div className="config-toolbar">
              <div>
                <strong>All server properties</strong>
                <span>{fields.length} settings from server.properties</span>
              </div>
              <label className="config-search">
                <Search />
                <input
                  type="search"
                  placeholder="Search settings or property names..."
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </label>
            </div>
            <form
              className="config-form"
              onSubmit={(e) => {
                e.preventDefault();
                friendlySave(e.currentTarget);
              }}
            >
              <div className="config-grid">
                {visibleFields.map((field) => (
                  <label
                    className={`config-field${
                      field.key === "online-mode" ? " featured" : ""
                    }`}
                    key={`${field.key}:${field.value}`}
                  >
                    <span className="config-copy">
                      <strong>{field.label}</strong>
                      <code>{field.key}</code>
                      {field.description && <small>{field.description}</small>}
                    </span>
                    {field.kind === "boolean" ? (
                      <input
                        name={field.key}
                        type="checkbox"
                        defaultChecked={
                          field.inverted
                            ? field.value === "false"
                            : field.value === "true"
                        }
                      />
                    ) : field.kind === "select" ? (
                      <select name={field.key} defaultValue={field.value}>
                        {!field.options?.includes(field.value) && (
                          <option value={field.value}>{field.value}</option>
                        )}
                        {field.options?.map((option) => (
                          <option value={option} key={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        name={field.key}
                        type={field.kind}
                        defaultValue={field.value}
                        step={field.kind === "number" ? "any" : undefined}
                        autoComplete={
                          field.kind === "password" ? "new-password" : undefined
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
              {visibleFields.length === 0 && (
                <Empty
                  title="No matching settings"
                  detail="Try another property name."
                />
              )}
              <div className="config-actions">
                <span>
                  Changes are written to the real server.properties file and may
                  require a restart.
                </span>
                <Button
                  type="submit"
                  disabled={save.isPending || visibleFields.length === 0}
                >
                  {save.isPending ? "Saving..." : "Save configuration"}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <Suspense fallback={<div className="editor-loading"><Spinner />Loading editor…</div>}><Editor
              height="600px"
              theme="vs-dark"
              language="ini"
              value={raw}
              onChange={(v) => setRaw(v ?? "")}
              options={{ fontSize: 14, minimap: { enabled: false } }}
            /></Suspense>
            <div className="editor-actions">
              <Button
                disabled={save.isPending}
                onClick={() => save.mutate({ raw })}
              >
                Save raw file
              </Button>
            </div>
          </>
        )}
        {save.isSuccess && <div className="saved">Configuration saved</div>}
        {save.error && <div className="error">{save.error.message}</div>}
      </Card>
    </>
  );
}
function PluginsPage({ i }: { i: Instance }) {
  const status = useStatus(i);
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const results = useQuery({
    queryKey: ["plugin-search", i.id, search],
    queryFn: () => api<any[]>(search
      ? `/api/instances/${i.id}/plugins/search?q=${encodeURIComponent(search)}`
      : `/api/instances/${i.id}/plugins/recommended`),
  });
  const installed = useQuery({
    queryKey: ["plugins", i.id],
    queryFn: () => api<any[]>(`/api/instances/${i.id}/plugins`),
  });
  const install = useMutation({
    mutationFn: async (p: any) => {
      const versions = await api<any[]>(
        `/api/instances/${i.id}/plugins/${p.provider}/${p.id}/versions`,
      );
      const version =
        versions.find((v) => v.compatible && v.releaseType === "release") ??
        versions.find((v) => v.compatible);
      if (!version) throw new Error("No compatible version is available");
      const current = installed.data?.find((item) => item.provider === p.provider && item.projectId === p.id);
      if (current?.versionId === version.id) throw new Error(`${p.name} is already on the latest compatible version`);
      return api(`/api/instances/${i.id}/plugins/install`, {
        method: "POST",
        body: JSON.stringify({
          provider: p.provider,
          projectId: p.id,
          versionId: version.id,
          name: p.name,
        }),
      });
    },
    onSuccess: () => { void installed.refetch(); void qc.invalidateQueries({ queryKey: ["instances"] }); },
  });
  const rollback = useMutation({ mutationFn: (pluginId: string) => api(`/api/instances/${i.id}/plugins/${pluginId}/rollback`, { method: "POST", body: "{}" }), onSuccess: () => { void installed.refetch(); void qc.invalidateQueries({ queryKey: ["instances"] }); } });
  return (
    <>
      <Title
        title="Plugins"
        sub={`Compatible projects for ${i.software} ${i.minecraftVersion}`}
      />
      {i.software === "vanilla" ? (
        <Card>
          <Empty
            title="Plugins unavailable"
            detail="Vanilla servers do not load Bukkit or Paper plugins."
          />
        </Card>
      ) : (
        <>
          <div className="plugin-search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setSearch(query)}
              placeholder="Search Hangar and Modrinth…"
            />
            <Button onClick={() => setSearch(query)}>Search</Button>
          </div>
          {install.error && (
            <div className="error">{install.error.message}</div>
          )}
          {rollback.error && <div className="error">{rollback.error.message}</div>}
          <div className="plugin-layout">
            <div>
        <h2>{search ? "Search results" : "Recommended for this server"}</h2>
              <div className="plugin-grid">
                {results.isFetching ? (
                  <Spinner />
                ) : (
                  results.data?.length ? results.data.map((p) => (
                    <Card className="plugin" key={`${p.provider}-${p.id}`}>
                      {p.iconUrl ? (
                        <img src={p.iconUrl} alt="" />
                      ) : (
                        <div className="plugin-icon">
                          <Box />
                        </div>
                      )}
                      <div>
                        <h3>{p.name}</h3>
                        <p>{p.description || "No description provided."}</p>
                        <Badge>{p.recommendation ?? p.provider}</Badge>
                      </div>
                      <Button
                        disabled={install.isPending}
                        onClick={() => install.mutate(p)}
                      >
                        Install
                      </Button>
                    </Card>
                  )) : <Empty title={search ? "No compatible projects found" : "No verified recommendations found"} detail="Recommendations are checked against this Minecraft version and server software." />
                )}
              </div>
            </div>
            <div>
              <h2>Installed</h2>
              <Card>
                {installed.data?.length ? (
                  installed.data.map((p) => (
                    <div className="installed" key={p.id}>
                      <Package />
                      <div>
                        <strong>{p.name}</strong>
                        <small>
                          {p.managed
                            ? `Managed · ${p.provider}`
                            : "Unmanaged plugin"}
                        </small>
                      </div>
                      {p.managed && p.provider && p.projectId && <Button className="secondary plugin-update" disabled={install.isPending} title="Install the latest compatible release; the current JAR is saved for rollback" onClick={() => install.mutate({ id: p.projectId, provider: p.provider, name: p.name })}><RefreshCw />Update</Button>}
                      {p.managed && p.previousFile && <Button className="secondary plugin-update" disabled={Boolean(status.data?.running) || rollback.isPending} title={status.data?.running ? "Stop the server before rolling back" : "Restore the previous plugin JAR"} onClick={() => confirm(`Roll back ${p.name} to its previous JAR?`) && rollback.mutate(p.id)}><RotateCcw />Rollback</Button>}
                    </div>
                  ))
                ) : (
                  <Empty
                    title="No plugins installed"
                    detail="Search the store to add your first plugin."
                  />
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
function BackupsPage({ i }: { i: Instance }) {
  const qc = useQueryClient();
  const status = useStatus(i);
  const q = useQuery({
    queryKey: ["backups", i.id],
    queryFn: () => api<any[]>(`/api/instances/${i.id}/backups`),
  });
  const createBackup = useMutation({
    mutationFn: () =>
      api(`/api/instances/${i.id}/backups`, { method: "POST", body: "{}" }),
    onSuccess: () => q.refetch(),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/instances/${i.id}/backups/${id}`, { method: "DELETE" }),
    onSuccess: () => q.refetch(),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api<{ restored: boolean; safetySnapshot: string }>(`/api/instances/${i.id}/backups/${id}/restore`, { method: "POST", body: "{}" }),
    onSuccess: () => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["activity", i.id] }); },
  });
  return (
    <>
      <Title
        title="Backups"
        sub="Recovery points stored with this server"
        actions={
          <Button
            onClick={() => createBackup.mutate()}
            disabled={createBackup.isPending}
          >
            <Archive />
            Create backup
          </Button>
        }
      />
      <Card>
        {restore.data && <div className="saved restore-success"><CheckCircle2 /><span><strong>Backup restored successfully.</strong><small>A safety snapshot of the previous files was saved at {restore.data.safetySnapshot}</small></span></div>}
        {q.data?.length ? (
          q.data.map((b) => (
            <div className="table-row" key={b.id}>
              <Archive />
              <div>
                <strong>{b.name}</strong>
                <small>
                  {new Date(b.createdAt).toLocaleString()} ·{" "}
                  {formatBytes(b.size)}
                </small>
              </div>
              <div className="backup-actions"><Button className="secondary" disabled={Boolean(status.data?.running) || restore.isPending} title={status.data?.running ? "Stop the server before restoring" : "Restore this recovery point"} onClick={() => confirm(`Restore ${b.name}? Salvadiux will first create a safety snapshot of the current server files.`) && restore.mutate(b.id)}><RotateCcw />Restore</Button><Button className="icon danger" aria-label="Delete backup" onClick={() => confirm(`Delete ${b.name}?`) && remove.mutate(b.id)}><Trash2 /></Button></div>
            </div>
          ))
        ) : (
          <Empty
            title="No backups"
            detail="Create a recovery point before major changes."
          />
        )}
        {(restore.error || remove.error || createBackup.error) && <p className="error">{(restore.error || remove.error || createBackup.error)?.message}</p>}
      </Card>
    </>
  );
}
type WorldDimension = "overworld" | "nether" | "end" | "custom";

function worldDimension(name: string): WorldDimension {
  const normalized = name.toLowerCase();
  if (normalized.endsWith("_nether")) return "nether";
  if (normalized.endsWith("_the_end")) return "end";
  return ["world", "lobby", "survival", "creative"].includes(normalized)
    ? "overworld"
    : "custom";
}

function worldLabel(name: string, dimension: WorldDimension) {
  if (dimension === "nether") return "The Nether";
  if (dimension === "end") return "The End";
  if (dimension === "overworld") {
    const kind = name.toLowerCase();
    if (kind === "lobby") return "Lobby";
    if (kind === "survival") return "Survival";
    if (kind === "creative") return "Creative";
    return "Overworld";
  }
  return "Custom world";
}

function WorldsPage({ i }: { i: Instance }) {
  const client = useQueryClient();
  const status = useStatus(i);
  const [tab, setTab] = useState<"library" | "discover">("library");
  const [provider, setProvider] = useState("modrinth");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [mapCategory, setMapCategory] = useState("all");
  const [selected, setSelected] = useState<any>(null);
  const [versionId, setVersionId] = useState("");
  const [worldName, setWorldName] = useState("");
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: ["worlds", i.id],
    queryFn: () => api<any[]>(`/api/instances/${i.id}/worlds`),
  });
  const stagedMapsQuery = useQuery({ queryKey: ["staged-world-maps", i.id], queryFn: () => api<any[]>(`/api/instances/${i.id}/worlds/staged`) });
  const providersQuery = useQuery({ queryKey: ["world-providers", i.id], queryFn: () => api<any[]>(`/api/instances/${i.id}/worlds/providers`) });
  const discoverQuery = useQuery({
    queryKey: ["world-discover", i.id, provider, submittedSearch],
    queryFn: () => api<any>(`/api/instances/${i.id}/worlds/discover?provider=${encodeURIComponent(provider)}&q=${encodeURIComponent(submittedSearch)}`),
    enabled: tab === "discover" && provider !== "planetminecraft" && (provider !== "curseforge" || Boolean((providersQuery.data ?? []).find((entry: any) => entry.id === "curseforge")?.configured)),
  });
  const versionsQuery = useQuery({
    queryKey: ["world-versions", i.id, selected?.provider, selected?.id],
    queryFn: () => api<any[]>(`/api/instances/${i.id}/worlds/discover/${selected.provider}/${encodeURIComponent(selected.id)}/versions`),
    enabled: Boolean(selected),
  });
  const worlds = q.data ?? [];
  const visibleProjects = (discoverQuery.data?.projects ?? []).filter((project: any) => mapCategory === "all" || `${project.title} ${project.description}`.toLowerCase().includes(mapCategory));
  const stopped = status.data?.running === false;
  const installWorld = useMutation({
    mutationFn: () => api<any>(`/api/instances/${i.id}/worlds/install`, { method: "POST", body: JSON.stringify({ provider: selected.provider, projectId: selected.id, versionId, name: worldName }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["worlds", i.id] }); setSelected(null); setVersionId(""); window.alert("Mapa instalado. El mundo quedó listo para el siguiente inicio del servidor."); },
  });
  const installStagedMap = useMutation({
    mutationFn: (mapId: string) => api<any>(`/api/instances/${i.id}/worlds/install-staged`, { method: "POST", body: JSON.stringify({ mapId, worldName: mapId === "welcome" ? "welcome_lobby" : "salvadiux_hub" }) }),
    onSuccess: async (result) => { await client.invalidateQueries({ queryKey: ["worlds", i.id] }); await client.invalidateQueries({ queryKey: ["map-worlds", i.id] }); window.alert(`Mapa instalado en ${result.worldName}. El mundo anterior se conservó; reinicia el servidor para cargarlo.`); },
  });
  const importWorld = useMutation({
    mutationFn: async () => {
      const file = uploadFileRef.current?.files?.[0];
      if (!file) throw new Error("Choose a world ZIP first.");
      const form = new FormData(); form.append("file", file);
      const response = await fetch(`/api/instances/${i.id}/worlds/import?name=${encodeURIComponent(worldName)}`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: form });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error?.userMessage ?? body.error?.message ?? `Request failed (${response.status})`);
      return body.data;
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["worlds", i.id] }); await client.invalidateQueries({ queryKey: ["map-worlds", i.id] }); if (uploadFileRef.current) uploadFileRef.current.value = ""; window.alert("Mundo importado. Está listo para el próximo inicio del servidor."); },
  });
  const manageWorld = useMutation({
    mutationFn: ({ name, action }: { name: string; action: "delete" | "reset" }) => api<any>(`/api/instances/${i.id}/worlds/${encodeURIComponent(name)}${action === "reset" ? "/reset" : ""}`, { method: action === "delete" ? "DELETE" : "POST", body: action === "reset" ? "{}" : undefined }),
    onSuccess: async (_result, variables) => { await client.invalidateQueries({ queryKey: ["worlds", i.id] }); await client.invalidateQueries({ queryKey: ["map-worlds", i.id] }); window.alert(variables.action === "reset" ? "Mundo reiniciado. Se generará de nuevo al iniciar el servidor." : "Mundo eliminado. Se guardó una copia en Backups."); },
  });
  const duplicateWorld = useMutation({
    mutationFn: ({ source, name }: { source: string; name: string }) => api<any>(`/api/instances/${i.id}/worlds/${encodeURIComponent(source)}/duplicate`, { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["worlds", i.id] }); await client.invalidateQueries({ queryKey: ["map-worlds", i.id] }); },
  });
  const exportWorld = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch(`/api/instances/${i.id}/worlds/${encodeURIComponent(name)}/export`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.userMessage ?? body?.error?.message ?? `Export failed (${response.status})`); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "-")}.zip`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  useEffect(() => { if (selected) { setWorldName(String(selected.title ?? "world").normalize("NFKD").replace(/[^a-zA-Z0-9 _.()-]/g, "-").trim().slice(0, 48) || "world"); setVersionId(""); } }, [selected]);
  useEffect(() => { const versions = versionsQuery.data ?? []; if (versions.length && !versions.some((version: any) => version.id === versionId)) setVersionId(versions[0].id); }, [versionsQuery.data, versionId]);
  return (
    <>
      <Title
        title="Worlds"
        sub="Discover maps, install them safely, and manage every saved world."
        actions={<Badge tone={stopped ? "neutral" : status.data?.running ? "online" : "warning"}>{stopped ? "Server stopped · changes enabled" : status.data?.running ? "Server running · worlds locked" : "Checking server status…"}</Badge>}
      />
      {(stagedMapsQuery.data?.length ?? 0) > 0 && <Card className="staged-world-maps"><div className="network-section-heading"><div><span className="network-kicker">SALVADIUX MAP LIBRARY</span><h2>Prepared lobby maps</h2><p>Downloaded and checked for Minecraft {i.minecraftVersion}. Installing creates a new world folder, changes the next startup world, and preserves your current world.</p></div><Globe2 /></div><div className="staged-world-map-grid">{(stagedMapsQuery.data ?? []).map((map: any) => <article className="staged-world-map" key={map.id}><div><strong>{map.name}</strong><small>By {map.author} · {map.ready ? "Ready to install" : "Map archive missing"}</small></div><a href={map.source} target="_blank" rel="noreferrer">Source</a><p>{map.attribution}</p><Button className="secondary" disabled={!stopped || !map.ready || installStagedMap.isPending} onClick={() => confirm(`Install ${map.name} as a new world on ${i.name}? Its current world folder will remain untouched.`) && installStagedMap.mutate(map.id)}>{installStagedMap.isPending ? <Spinner /> : <Download />}{!stopped ? "Stop server to install" : installStagedMap.isPending ? "Installing…" : map.ready ? `Install as ${map.id === "welcome" ? "welcome lobby" : "hub"}` : "Download unavailable"}</Button></article>)}</div>{installStagedMap.error && <div className="error">{(installStagedMap.error as Error).message}</div>}</Card>}
      <div className="world-tabs" role="tablist" aria-label="Worlds">
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>Your worlds <span>{worlds.length}</span></button>
        <button className={tab === "discover" ? "active" : ""} onClick={() => setTab("discover")}>Discover maps</button>
      </div>
      {tab === "library" ? <div className="plugin-grid world-grid">
        {worlds.length ? (
          worlds.map((w: { name: string; modifiedAt: string }) => {
            const dimension = worldDimension(w.name);
            const WorldGlyph = dimension === "nether"
              ? Flame
              : dimension === "end"
                ? MoonStar
                  : dimension === "overworld"
                    ? TreePine
                    : Globe2;
            const worldArt = dimension === "nether"
              ? "/assets/worlds/nether.webp"
              : dimension === "end"
                ? "/assets/worlds/end.webp"
                : dimension === "overworld"
                  ? "/assets/worlds/overworld.webp"
                  : null;
            return (
            <Card className={`world world-${dimension} world-manage-card`} key={w.name}>
              <div className={`world-emblem world-emblem-${dimension}`} aria-hidden="true">
                {worldArt ? <img src={worldArt} alt="" draggable="false" /> : <WorldGlyph />}
              </div>
              <div>
                <h3>{w.name}</h3>
                <span className="world-kind">{worldLabel(w.name, dimension)}</span>
                <p className="world-date">
                  Updated {new Date(w.modifiedAt).toLocaleString()}
                </p>
                <div className="world-actions">
                  <Button className="secondary" disabled={!stopped || exportWorld.isPending} onClick={() => exportWorld.mutate(w.name)}><Download />Export ZIP</Button>
                  <Button className="secondary" disabled={!stopped || duplicateWorld.isPending} onClick={() => { const name = window.prompt(`Duplicate ${w.name} as:`, `${w.name}-copy`); if (name?.trim()) duplicateWorld.mutate({ source: w.name, name: name.trim() }); }}><Copy />Duplicate</Button>
                  <Button className="secondary" disabled={!stopped || manageWorld.isPending} onClick={() => { if (window.confirm(`Reiniciar “${w.name}”? Se guardará una copia ZIP del mundo y Minecraft lo generará de nuevo en el próximo inicio.`)) manageWorld.mutate({ name: w.name, action: "reset" }); }}><RotateCcw /> Reset world</Button>
                  <Button className="danger" disabled={!stopped || manageWorld.isPending} onClick={() => { if (window.confirm(`Eliminar “${w.name}”? Antes se guardará una copia ZIP en Backups.`)) manageWorld.mutate({ name: w.name, action: "delete" }); }}><Trash2 /> Remove</Button>
                </div>
              </div>
            </Card>
          )})
        ) : (
          <Card>
            <Empty
              title="No worlds yet"
              detail="Worlds appear after the server completes its first start."
            />
          </Card>
        )}
      </div> : <>
        <div className="world-discover-toolbar">
          <div className="world-provider-tabs">{(providersQuery.data ?? []).map((item: any) => <button key={item.id} className={provider === item.id ? "active" : ""} onClick={() => { setProvider(item.id); setSelected(null); if (item.id === "planetminecraft") setWorldName("custom-map"); }}>{item.name}{item.id === "curseforge" && !item.configured ? <span className="provider-locked">Key needed</span> : null}</button>)}</div>
          <form className="world-discover-search" onSubmit={(event) => { event.preventDefault(); setSubmittedSearch(search.trim()); setSelected(null); }}><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search maps and worlds…"/><Button type="submit" className="secondary">Search</Button></form>
        </div>
        {provider !== "planetminecraft" && <div className="world-category-filters" aria-label="Map category">{[["all", "All maps"], ["lobby", "Lobby"], ["survival", "Survival"], ["adventure", "Adventure"], ["parkour", "Parkour"], ["creative", "Creative"]].map(([id, label]) => <button key={id} className={mapCategory === id ? "active" : ""} onClick={() => setMapCategory(id)}>{label}</button>)}</div>}
        {provider === "planetminecraft" ? <Card className="world-external-import"><div className="world-provider-external"><Globe2/><div><h3>Explore Planet Minecraft</h3><p>Browse community maps, then import the downloaded ZIP directly into this server. The upload is checked for a valid Minecraft world before it is installed.</p></div><a className="button secondary" href="https://www.planetminecraft.com/projects/" target="_blank" rel="noreferrer">Browse maps <ChevronRight/></a></div><div className="world-import-row"><label className="world-field"><span>Destination folder</span><input maxLength={48} value={worldName} onChange={(event) => setWorldName(event.target.value)} /></label><label className="world-field"><span>World ZIP · up to 768 MB</span><input ref={uploadFileRef} type="file" accept=".zip,application/zip" /></label><Button onClick={() => importWorld.mutate()} disabled={!stopped || importWorld.isPending || !worldName.trim()}>{importWorld.isPending ? "Importing ZIP…" : stopped ? "Import world ZIP" : "Stop server to import"}</Button></div>{importWorld.error ? <p className="error-text">{(importWorld.error as Error).message}</p> : null}</Card> : null}
        {provider === "curseforge" && !(providersQuery.data ?? []).find((entry: any) => entry.id === "curseforge")?.configured ? <Card className="world-provider-note"><Shield/><div><strong>CurseForge needs a private API key</strong><p>Paste your key into <code>CURSEFORGE_API_KEY</code> in the project-root <code>.env</code> file, save it and restart Salvadiux Host. The key stays on the server.</p></div></Card> : null}
        {discoverQuery.isLoading ? <Card><Spinner /></Card> : discoverQuery.error ? <Card><Empty title="Could not load maps" detail={(discoverQuery.error as Error).message}/></Card> : null}
        {provider !== "planetminecraft" && visibleProjects.length ? <div className="world-discover-layout">
          <div className="world-discover-grid">{visibleProjects.map((project: any) => <Card className={`world-discover-card ${selected?.id === project.id ? "selected" : ""}`} key={project.id}>
            {project.icon ? <img className="world-project-icon" src={project.icon} alt="" loading="lazy"/> : <div className="world-project-icon fallback"><Mountain/></div>}
            <div className="world-project-copy"><span className="world-project-provider">{project.provider} · {project.author}</span><h3>{project.title}</h3><p>{project.description}</p><small>{Number(project.downloads ?? 0).toLocaleString()} downloads {project.latestFiles?.[0]?.name ? `· ${project.latestFiles[0].name}` : ""}</small></div>
            <Button className={selected?.id === project.id ? "" : "secondary"} onClick={() => setSelected(project)}>{selected?.id === project.id ? "Selected" : "View versions"}</Button>
          </Card>)}</div>
          {selected ? <Card className="world-install-panel">
            <div className="world-install-heading"><div><span className="world-project-provider">INSTALL MAP</span><h3>{selected.title}</h3></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close"><X/></button></div>
            {selected.gallery?.[0] ? <img className="world-install-preview" src={selected.gallery[0]} alt={`${selected.title} map preview`} loading="lazy"/> : null}
            <div className="world-project-meta"><span>By {selected.author}</span><span>{Number(selected.downloads ?? 0).toLocaleString()} downloads</span>{selected.updatedAt ? <span>Updated {new Date(selected.updatedAt).toLocaleDateString()}</span> : null}<a href={selected.url} target="_blank" rel="noreferrer">Provider page <ChevronRight/></a></div>
            {versionsQuery.isLoading ? <Spinner/> : versionsQuery.error ? <p className="error-text">{(versionsQuery.error as Error).message}</p> : versionsQuery.data?.length ? <>
              <label className="world-field"><span>Compatible release · Minecraft {i.minecraftVersion}</span><select value={versionId} onChange={(event) => setVersionId(event.target.value)}>{versionsQuery.data.map((version: any) => <option key={version.id} value={version.id}>{version.name}{version.date ? ` · ${new Date(version.date).toLocaleDateString()}` : ""}{version.files?.[0]?.size ? ` · ${formatBytes(version.files[0].size)}` : ""}</option>)}</select></label>
              <label className="world-field"><span>Folder name on this server</span><input maxLength={48} value={worldName} onChange={(event) => setWorldName(event.target.value)}/></label>
              <p className="world-safe-note"><Shield/> Installs into a new folder, validates the ZIP and level.dat, and never overwrites a world.</p>
              <Button disabled={!stopped || !versionId || !worldName.trim() || installWorld.isPending} onClick={() => installWorld.mutate()}>{installWorld.isPending ? "Installing map…" : stopped ? "Install world" : "Stop server to install"}</Button>
              {installWorld.error ? <p className="error-text">{(installWorld.error as Error).message}</p> : null}
            </> : <Empty title="No compatible ZIP releases" detail={`No world archive was found for Minecraft ${i.minecraftVersion}.`}/>}
          </Card> : null}
        </div> : null}
        {provider !== "planetminecraft" && !discoverQuery.isLoading && !discoverQuery.error && !visibleProjects.length && (providersQuery.data ?? []).find((entry: any) => entry.id === provider)?.configured ? <Card><Empty title={discoverQuery.data?.projects?.length ? "No maps in this category" : "No world maps found"} detail="Try another search, clear the category filter, or check the provider for maps supporting this Minecraft version."/></Card> : null}
      </>}
      {manageWorld.error ? <p className="error-text">{(manageWorld.error as Error).message}</p> : null}
      {duplicateWorld.error ? <p className="error-text">{(duplicateWorld.error as Error).message}</p> : null}
      {exportWorld.error ? <p className="error-text">{(exportWorld.error as Error).message}</p> : null}
    </>
  );
}
function StatisticsPage({ i }: { i: Instance }) {
  const [historyHours, setHistoryHours] = useState(24);
  const status = useStatus(i);
  const config = useQuery({ queryKey: ["config", i.id], queryFn: () => api<any>(`/api/instances/${i.id}/config`), refetchInterval: 30000 });
  const system = useQuery({
    queryKey: ["system-stats"],
    queryFn: () => api<any>("/api/system/stats"),
    refetchInterval: 5000,
  });
  const storage = useQuery({ queryKey: ["storage", i.id], queryFn: () => api<any>(`/api/instances/${i.id}/storage`), refetchInterval: 60000, retry: false });
  const historyQuery = useQuery({ queryKey: ["metrics-history", i.id, historyHours], queryFn: () => api<any[]>(`/api/instances/${i.id}/metrics/history?hours=${historyHours}`), refetchInterval: 60000 });
  const history = historyQuery.data ?? [];
  const host = system.data;
  const serverMemory = Number(status.data?.metrics?.memory ?? 0);
  const hostMemoryUsed = host ? host.totalMemory - host.freeMemory : 0;
  const online = status.data?.players ?? [];
  const maxPlayers = Number(config.data?.values?.["max-players"] ?? 20);
  const hostMemoryPercent = host?.totalMemory ? hostMemoryUsed / host.totalMemory * 100 : null;
  const javaMemoryPercent = i.maxMemoryMb ? serverMemory / (i.maxMemoryMb * 1024 * 1024) * 100 : null;
  const diskPercent = storage.data?.total ? storage.data.used / storage.data.total * 100 : null;
  const chartData = useMemo(() => ({
    hostCpu: history.flatMap((sample: any) => sample.hostCpu == null ? [] : [Number(sample.hostCpu)]),
    hostMemory: history.flatMap((sample: any) => sample.hostMemory == null ? [] : [Number(sample.hostMemory)]),
    serverCpu: history.flatMap((sample: any) => sample.serverCpu == null ? [] : [Number(sample.serverCpu)]),
    serverMemory: history.flatMap((sample: any) => sample.serverMemory == null ? [] : [Number(sample.serverMemory)]),
    players: history.flatMap((sample: any) => sample.players == null ? [] : [Number(sample.players)]),
    times: history.map((sample: any) => sample.sampledAt),
  }), [history]);
  return (
    <>
      <Title title="Statistics" sub="A calm, live view of host resources, Java performance and player activity" actions={<Badge tone={status.data?.running ? "online" : "offline"}><span className="stats-live-dot" />{status.data?.running ? "LIVE · 3s" : "SERVER OFFLINE"}</Badge>} />
      <div className="stats-overview">
        <StatsMetric icon={Cpu} label="HOST PROCESSOR" value={host?.cpuUsage == null ? "Sampling" : `${host.cpuUsage.toFixed(1)}%`} detail={host?.cpuModel ?? "Waiting for host data"} percent={host?.cpuUsage} tone="violet" />
        <StatsMetric icon={Activity} label="JAVA PROCESSOR" value={status.data?.metrics ? `${Math.min(100, status.data.metrics.cpu).toFixed(1)}%` : "—"} detail={status.data?.running ? "Minecraft process" : "Server offline"} percent={status.data?.metrics?.cpu} tone="mint" />
        <StatsMetric icon={Database} label="JAVA MEMORY" value={status.data?.metrics ? formatBytes(serverMemory) : "—"} detail={`Heap limit · ${i.maxMemoryMb} MB`} percent={javaMemoryPercent} tone="blue" />
        <StatsMetric icon={MemoryStick} label="SYSTEM MEMORY" value={host ? formatBytes(hostMemoryUsed) : "—"} detail={host ? `${formatBytes(host.freeMemory)} available of ${formatBytes(host.totalMemory)}` : "Waiting for host data"} percent={hostMemoryPercent} tone="lilac" />
        <StatsMetric icon={Users} label="PLAYERS ONLINE" value={`${online.length} / ${maxPlayers}`} detail={status.data?.running ? "Live player list" : "Server currently offline"} percent={online.length / Math.max(1, maxPlayers) * 100} tone="mint" />
        <StatsMetric icon={HardDrive} label="SERVER DISK" value={storage.data ? formatBytes(storage.data.used) : "—"} detail={storage.data ? `${formatBytes(storage.data.free)} free · ${formatBytes(storage.data.total)} total` : "Storage data unavailable"} percent={diskPercent} tone="blue" />
      </div>
      <div className="history-range"><div className="history-range-title"><ChartNoAxesCombined/><span>Performance history</span></div><div className="history-range-controls">{[[1, "1h"], [24, "24h"], [168, "7d"]].map(([hours, label]) => <button key={hours} className={historyHours === hours ? "active" : ""} onClick={() => setHistoryHours(Number(hours))}>{label}</button>)}</div><small>{history.length} samples · retained for 7 days</small></div>
      <div className="stats-chart-grid">
        <HistoryChart title="Host CPU" unit="%" values={chartData.hostCpu} color="#9a86bd" times={chartData.times} icon={Cpu} />
        <HistoryChart title="System memory" values={chartData.hostMemory} color="#789bb3" format={formatBytes} times={chartData.times} icon={MemoryStick} />
        <HistoryChart title="Java CPU" unit="%" values={chartData.serverCpu} color="#6da99e" times={chartData.times} icon={Activity} />
        <HistoryChart title="Java memory" values={chartData.serverMemory} color="#ad829f" format={formatBytes} times={chartData.times} icon={Database} />
        <HistoryChart title="Players online" values={chartData.players} color="#8d9bb9" unit=" players" times={chartData.times} icon={Users} />
      </div>
      <Card className="stats-host-card">
        <h2><span className="stats-section-icon"><Monitor/></span>Host & runtime</h2>
        <div className="stats-host-grid">
          <Info label="Operating system" value={host ? `${host.platform} ${host.release} · ${host.arch}` : "Loading…"} />
          <Info label="Processor" value={host ? `${host.cpuModel} · ${host.cpuCores} logical cores` : "Loading…"} />
          <Info label="System load (1 / 5 / 15m)" value={host?.loadAverage?.map((n: number) => n.toFixed(2)).join(" / ") ?? "Unavailable"} />
          <Info label="Available memory" value={host ? `${formatBytes(host.freeMemory)} free of ${formatBytes(host.totalMemory)}` : "Loading…"} />
          <Info label="Instance volume" value={storage.data ? `${formatBytes(storage.data.free)} free · ${formatBytes(storage.data.used)} used of ${formatBytes(storage.data.total)}` : "Unavailable"} />
          <Info label="Node.js runtime" value={host?.nodeVersion ?? "Loading…"} />
          <Info label="Java runtime" value={`Java ${i.javaMajor} · ${i.software} ${i.minecraftVersion}`} />
          <Info label="Host uptime" value={host ? formatDuration(host.uptime * 1000) : "Loading…"} />
          <Info label="Server uptime" value={status.data?.metrics ? formatDuration(status.data.metrics.elapsed) : "Offline"} />
        </div>
      </Card>
      <Card className="stats-online-card">
        <h2><span className="stats-section-icon"><Users/></span>Players online <Badge tone="online">{online.length}</Badge></h2>
        {online.length ? <div className="player-grid">{online.map((player: any) => <PlayerRow key={player.name} player={player} />)}</div> : <Empty title="No players online" detail={status.data?.running ? "Players appear here as they join." : "Start the server to see live players."} />}
      </Card>
    </>
  );
}

const StatsMetric = memo(function StatsMetric({ icon: Icon, label, value, detail, percent, tone }: { icon: any; label: string; value: string; detail: string; percent?: number | null; tone: string }) {
  const progress = percent === null || percent === undefined || !Number.isFinite(percent) ? null : Math.max(0, Math.min(100, percent));
  return <Card className={`stats-metric stats-tone-${tone}`}><div className="stats-metric-top"><span className="stats-metric-icon"><Icon/></span><span className="stats-metric-label">{label}</span>{progress !== null && <span className="stats-metric-percent">{progress.toFixed(0)}%</span>}</div><strong className="stats-metric-value">{value}</strong><small className="stats-metric-detail">{detail}</small><div className="stats-meter" aria-hidden="true"><i style={{ width: `${progress ?? 0}%` }}/></div></Card>;
});

const HistoryChart = memo(function HistoryChart({ title, values, color, unit = "", format, times = [], icon: Icon = Activity }: { title: string; values: number[]; color: string; unit?: string; format?: (value: number) => string; times?: string[]; icon?: any }) {
  const width = 600, height = 150;
  const max = Math.max(...values, 1);
  const points = useMemo(() => values.map((value, index) => `${values.length < 2 ? width / 2 : 4 + (index / (values.length - 1)) * (width - 8)},${height - 10 - (Math.max(0, value) / max) * (height - 22)}`).join(" "), [values, max]);
  const latest = values.at(-1), startTime = times[0], endTime = times.at(-1);
  const numberLabel = (value: number) => format ? format(value) : `${value.toFixed(1)}${unit}`;
  const chartId = `chart-${title.replace(/\W/g, "")}`;
  return <Card className="history-chart-card"><div className="history-chart-heading"><span className="history-chart-icon" style={{ "--chart-color": color } as React.CSSProperties}><Icon/></span><div className="history-chart-title"><small>HISTORY</small><h2>{title}</h2></div><strong>{latest === undefined ? "Waiting" : numberLabel(latest)}</strong></div><svg className="history-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} history chart`}><defs><linearGradient id={`fill-${chartId}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".18"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>{[0.25,0.5,0.75,1].map((fraction) => <line key={fraction} x1="0" x2={width} y1={height - 10 - fraction * (height - 22)} y2={height - 10 - fraction * (height - 22)} className="history-gridline"/>)}{values.length > 1 && <><polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#fill-${chartId})`}/><polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/><circle cx={width - 4} cy={Number(points.split(" ").at(-1)?.split(",")[1] ?? height)} r="4" fill={color} className="history-chart-end"/></>}</svg><div className="history-chart-foot"><span>{startTime ? new Date(startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "No samples"}</span><small>{values.length} samples · 1 minute interval</small><span>{endTime ? new Date(endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span></div></Card>;
});

type MapWorld = { name: string; spawn: { x: number; z: number }; dimensions: Array<{ id: string; label: string; chunks: number }> };
type MapMetadata = { startX: number; startZ: number; width: number; height: number; blocksPerPixel: number; chunksLoaded: number; structures: Array<{ id: string; x: number; y: number; z: number }>; biomes: string[]; blockPalette: string[] };
type LivePosition = { name: string; x: number; y: number; z: number; dimension: string; updatedAt: string };
type MapMarker = { id: string; label: string; x: number; z: number; color: string };
const blockTextureAverageCache = new Map<string, [number, number, number] | null>();
function NetworkDashboardMap({ proxy, instances }: { proxy: Instance; instances: Instance[] }) {
  const networks = useQuery({ queryKey: ["networks"], queryFn: () => api<any[]>("/api/networks"), refetchInterval: 10000 });
  const network = networks.data?.find((item: any) => (item.proxy?.id ?? item.proxyId) === proxy.id);
  const candidates = (network?.members ?? [])
    .map((member: any) => ({ member, instance: instances.find((item) => item.id === (member.instance?.id ?? member.instanceId)) }))
    .filter((entry: any) => entry.instance && ["paper", "purpur"].includes(entry.instance.software));
  candidates.sort((a: any, b: any) => {
    const priority = (role: string) => role === "survival" ? 0 : role === "hub" ? 1 : role === "creative" ? 2 : 3;
    return priority(a.member.role) - priority(b.member.role);
  });
  const fallback = instances.find((item) => ["paper", "purpur"].includes(item.software));
  const [nodeId, setNodeId] = useState("");
  const selected = candidates.find((entry: any) => entry.instance.id === nodeId) ?? candidates[0];
  const target = selected?.instance ?? fallback;
  useEffect(() => {
    if (selected?.instance?.id && nodeId !== selected.instance.id) setNodeId(selected.instance.id);
  }, [selected?.instance?.id]);
  if (!target) return <><Title title="World map" sub="Choose a Paper backend to inspect its saved world terrain." />{networks.isLoading ? <Card><Spinner /></Card> : <Card><Empty title="No map-ready server found" detail="Add a Paper or Purpur backend to this network, then its worlds will be available here." /></Card>}</>;
  return <>
    <Title title="Network world map" sub="Explore the actual saved terrain from any game server in this network." actions={candidates.length > 0 && <label className="network-map-source"><span>MAP SOURCE</span><select aria-label="Map source server" value={target.id} onChange={(event) => setNodeId(event.target.value)}>{candidates.map(({ member, instance }: any) => <option key={instance.id} value={instance.id}>{member.alias} · {member.role}</option>)}</select></label>} />
    {!candidates.length && <div className="network-map-fallback">Showing {target.name}; it is not currently attached to the selected Velocity network.</div>}
    <WorldMapPage i={target} showTitle={false} />
  </>;
}
function WorldMapPage({ i, showTitle = true }: { i: Instance; showTitle?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mapViewport = useRef<HTMLDivElement>(null);
  const wheelDelta = useRef(0);
  const wheelReset = useRef<number | undefined>(undefined);
  const [worldName, setWorldName] = useState("");
  const [dimensionId, setDimensionId] = useState("");
  const [center, setCenter] = useState({ x: 0, z: 0 });
  const [scale, setScale] = useState(2);
  const [map, setMap] = useState<MapMetadata | null>(null);
  const [heights, setHeights] = useState<Int16Array | null>(null);
  const [biomePixels, setBiomePixels] = useState<Uint8Array | null>(null);
  const [localTextures, setLocalTextures] = useState(false);
  const [markerSets, setMarkerSets] = useState<Record<string, MapMarker[]>>({});
  const [addMarkerMode, setAddMarkerMode] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ x: number; z: number; y: number; biome: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const markerStorageKey = `salvadiux-map-markers:${i.id}`;
  const markerSetKey = `${worldName}:${dimensionId}`;
  const markers = markerSets[markerSetKey] ?? [];
  useEffect(() => { try { const saved = localStorage.getItem(markerStorageKey); if (saved) setMarkerSets(JSON.parse(saved)); } catch {} }, [markerStorageKey]);
  useEffect(() => { localStorage.setItem(markerStorageKey, JSON.stringify(markerSets)); }, [markerStorageKey, markerSets]);
  const worldsQuery = useQuery({ queryKey: ["map-worlds", i.id], queryFn: () => api<MapWorld[]>(`/api/instances/${i.id}/map/worlds`), refetchInterval: 30000 });
  const positionsQuery = useQuery({ queryKey: ["map-players", i.id], queryFn: () => api<{ available: boolean; players: LivePosition[] }>(`/api/instances/${i.id}/map/players`), refetchInterval: 5000, enabled: !!worldName && !!dimensionId });
  const world = worldsQuery.data?.find((item) => item.name === worldName);
  const dimension = world?.dimensions.find((item) => item.id === dimensionId);
  useEffect(() => {
    if (!worldsQuery.data?.length || worldName) return;
    const first = worldsQuery.data[0]!;
    setWorldName(first.name); setCenter(first.spawn);
    setDimensionId(first.dimensions[0]?.id ?? "");
  }, [worldsQuery.data, worldName]);
  useEffect(() => {
    if (world && !world.dimensions.some((item) => item.id === dimensionId)) setDimensionId(world.dimensions[0]?.id ?? "");
  }, [world, dimensionId]);
  useEffect(() => {
    if (!worldName || !dimensionId) return;
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ world: worldName, dimension: dimensionId, x: String(center.x), z: String(center.z), scale: String(scale), width: "512", height: "256" });
        const response = await fetch(`/api/instances/${i.id}/map/tile?${params}`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: controller.signal });
        if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.userMessage ?? body?.error?.message ?? `Map request failed (${response.status})`); }
        const buffer = await response.arrayBuffer();
        const encodedMeta = response.headers.get("x-map-meta") ?? "";
        const meta = JSON.parse(atob(encodedMeta.replace(/-/g, "+").replace(/_/g, "/"))) as MapMetadata;
        const pixelLength = meta.width * meta.height * 4, heightLength = meta.width * meta.height * 2;
        const image = new ImageData(new Uint8ClampedArray(buffer.slice(0, pixelLength)), meta.width, meta.height);
        const nextHeights = new Int16Array(buffer.slice(pixelLength, pixelLength + heightLength));
        const biomeLength = meta.width * meta.height;
        const nextBiomes = new Uint8Array(buffer.slice(pixelLength + heightLength, pixelLength + heightLength + biomeLength));
        const blockBytes = new DataView(buffer, pixelLength + heightLength + biomeLength, biomeLength * 2);
        const nextBlocks = new Uint16Array(meta.width * meta.height);
        for (let index = 0; index < nextBlocks.length; index++) nextBlocks[index] = blockBytes.getUint16(index * 2, true);
        let hasLocalTextures = false;
        if (meta.blockPalette.length) {
          try {
            const atlasResponse = await fetch(`/api/instances/${i.id}/map/atlas`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ blocks: meta.blockPalette }), signal: controller.signal });
            if (atlasResponse.ok && atlasResponse.headers.get("x-map-textures") === "local-minecraft-assets") {
              const bitmap = await createImageBitmap(await atlasResponse.blob());
              const textureCanvas = document.createElement("canvas"); textureCanvas.width = bitmap.width; textureCanvas.height = 16;
              const textureContext = textureCanvas.getContext("2d", { willReadFrequently: true });
              if (textureContext) {
                textureContext.drawImage(bitmap, 0, 0);
                const averages = meta.blockPalette.map((block, paletteIndex) => {
                  if (blockTextureAverageCache.has(block)) return blockTextureAverageCache.get(block)!;
                  let average: [number, number, number] | null = null;
                  try {
                    const texture = textureContext.getImageData(paletteIndex * 16, 0, 16, 16).data;
                    let red = 0, green = 0, blue = 0, count = 0;
                    for (let offset = 0; offset < texture.length; offset += 4) if (texture[offset + 3]! > 32) { red += texture[offset]!; green += texture[offset + 1]!; blue += texture[offset + 2]!; count++; }
                    if (count) average = [red / count, green / count, blue / count];
                  } catch {}
                  blockTextureAverageCache.set(block, average); return average;
                });
                const pixels = image.data;
                for (let index = 0; index < nextBlocks.length; index++) {
                  const average = averages[nextBlocks[index]! - 1]; if (!average) continue;
                  const offset = index * 4;
                  // Blend real local game textures with the biome/elevation shading rendered from chunk data.
                  pixels[offset] = Math.round(pixels[offset]! * 0.42 + average[0] * 0.58);
                  pixels[offset + 1] = Math.round(pixels[offset + 1]! * 0.42 + average[1] * 0.58);
                  pixels[offset + 2] = Math.round(pixels[offset + 2]! * 0.42 + average[2] * 0.58);
                }
                hasLocalTextures = averages.some(Boolean);
              }
              bitmap.close();
            }
          } catch (textureError) { if (textureError instanceof DOMException && textureError.name === "AbortError") throw textureError; }
        }
        if (!active) return;
        if (canvas.current) { canvas.current.width = meta.width; canvas.current.height = meta.height; const context = canvas.current.getContext("2d"); if (context) context.putImageData(image, 0, 0); }
        setMap(meta); setHeights(nextHeights); setBiomePixels(nextBiomes); setLocalTextures(hasLocalTextures);
      } catch (caught) { if (active && !(caught instanceof DOMException && caught.name === "AbortError")) setError((caught as Error).message); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [i.id, worldName, dimensionId, center.x, center.z, scale]);
  const expectedDimension = (id: string) => id === "overworld" ? "minecraft:overworld" : id === "nether" ? "minecraft:the_nether" : id === "end" ? "minecraft:the_end" : id.startsWith("custom:") ? id.slice(7) : id;
  const visiblePlayers = (positionsQuery.data?.players ?? []).filter((player) => player.dimension === expectedDimension(dimensionId) && map && player.x >= map.startX && player.x < map.startX + map.width * scale && player.z >= map.startZ && player.z < map.startZ + map.height * scale);
  const chunkGridPixelsX = mapViewport.current && scale <= 8 ? mapViewport.current.clientWidth * 16 / (512 * scale) : 0;
  const chunkGridPixelsY = mapViewport.current && scale <= 8 ? mapViewport.current.clientHeight * 16 / (256 * scale) : 0;
  const chunkGridX = map ? -((map.startX % 16 + 16) % 16) / scale * ((mapViewport.current?.clientWidth ?? 512) / 512) : 0;
  const chunkGridY = map ? -((map.startZ % 16 + 16) % 16) / scale * ((mapViewport.current?.clientHeight ?? 256) / 256) : 0;
  const pointStyle = (x: number, z: number) => ({ left: `${(((x - (map?.startX ?? 0)) / scale) / (map?.width ?? 256)) * 100}%`, top: `${(((z - (map?.startZ ?? 0)) / scale) / (map?.height ?? 256)) * 100}%` });
  const pan = (dx: number, dz: number) => setCenter((current) => ({ x: current.x + dx * scale * 110, z: current.z + dz * scale * 110 }));
  const inspectMap = (event: MouseEvent<HTMLCanvasElement>) => {
    if (drag.current?.moved || !map || !heights || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const px = Math.max(0, Math.min(map.width - 1, Math.floor((event.clientX - rect.left) / rect.width * map.width)));
    const py = Math.max(0, Math.min(map.height - 1, Math.floor((event.clientY - rect.top) / rect.height * map.height)));
    const index = py * map.width + px, y = heights[index]!;
    setHover({ x: map.startX + px * scale, z: map.startZ + py * scale, y, biome: map.biomes[(biomePixels?.[index] ?? 0) - 1] ?? "Unexplored" });
  };
  const recenterOnPlayer = (player: LivePosition) => setCenter({ x: player.x, z: player.z });
  const changeZoom = (direction: number, anchor?: { x: number; y: number }) => {
    const levels = [64, 32, 16, 8, 4, 2, 1];
    const oldScale = scale, nextScale = levels[Math.max(0, Math.min(levels.length - 1, levels.indexOf(scale) + direction))]!;
    if (nextScale === oldScale) return;
    if (anchor && map) {
      const rect = canvas.current?.getBoundingClientRect();
      if (rect) {
        const rx = (anchor.x - rect.left) / rect.width - 0.5, rz = (anchor.y - rect.top) / rect.height - 0.5;
        setCenter((current) => ({ x: current.x + rx * map.width * (oldScale - nextScale), z: current.z + rz * map.height * (oldScale - nextScale) }));
      }
    }
    setScale(nextScale);
  };
  const handleMapWheel = (event: WheelEvent) => {
    event.preventDefault();
    wheelDelta.current += event.deltaY;
    if (Math.abs(wheelDelta.current) >= 55) {
      changeZoom(wheelDelta.current < 0 ? 1 : -1, { x: event.clientX, y: event.clientY });
      wheelDelta.current = 0;
    }
    if (wheelReset.current !== undefined) window.clearTimeout(wheelReset.current);
    wheelReset.current = window.setTimeout(() => { wheelDelta.current = 0; }, 180);
  };
  useEffect(() => {
    const viewport = mapViewport.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => handleMapWheel(event);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      if (wheelReset.current !== undefined) window.clearTimeout(wheelReset.current);
    };
  }, [scale, map]);
  const handleMapPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleMapPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    if (drag.current.moved) setDragOffset({ x: dx, y: dy });
  };
  const handleMapPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || !canvas.current) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (current.moved) {
      const rect = mapViewport.current?.getBoundingClientRect();
      if (rect && map) setCenter((value) => ({ x: value.x - dx / rect.width * map.width * scale, z: value.z - dy / rect.height * map.height * scale }));
    }
    else if (addMarkerMode && map) {
      const rect = canvas.current.getBoundingClientRect(), px = (event.clientX - rect.left) / rect.width, py = (event.clientY - rect.top) / rect.height;
      const label = window.prompt("Name this map marker", "My marker");
      if (label?.trim()) {
        const marker = { id: crypto.randomUUID(), label: label.trim().slice(0, 48), x: Math.round(map.startX + px * map.width * scale), z: Math.round(map.startZ + py * map.height * scale), color: "#a855f7" };
        setMarkerSets((sets) => ({ ...sets, [markerSetKey]: [...(sets[markerSetKey] ?? []), marker].slice(-100) }));
      }
      setAddMarkerMode(false);
    }
    drag.current = null; setDragOffset({ x: 0, y: 0 });
  };
  return <>
    {showTitle && <Title title="World atlas" sub="A navigable map built from the chunks this world has actually saved." actions={<Badge tone={loading ? "neutral" : "online"}>{loading ? "Loading terrain…" : "Live · refreshes every 15s"}</Badge>} />}
    <Card className="world-map-controls">
      <label className="map-select-field"><span>WORLD</span><select value={worldName} onChange={(event) => { const next = worldsQuery.data?.find((item) => item.name === event.target.value); setWorldName(event.target.value); if (next) { setCenter(next.spawn); setDimensionId(next.dimensions[0]?.id ?? ""); } }}>{worldsQuery.data?.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      <label className="map-select-field"><span>DIMENSION</span><select value={dimensionId} onChange={(event) => setDimensionId(event.target.value)}>{world?.dimensions.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.chunks.toLocaleString()} chunks</option>)}</select></label>
      <div className="map-zoom-controls" aria-label="Map zoom"><button aria-label="Zoom out" title="Zoom out" disabled={scale === 64} onClick={() => changeZoom(-1)}><Minus /></button><span><strong>{scale}</strong><small>blocks / pixel</small></span><button aria-label="Zoom in" title="Zoom in" disabled={scale === 1} onClick={() => changeZoom(1)}><Plus /></button></div>
      <div className="map-control-divider" />
      <Button className={addMarkerMode ? "map-marker-active" : "secondary"} onClick={() => setAddMarkerMode((active) => !active)}><MapPin />{addMarkerMode ? "Click map to place pin" : "Add pin"}</Button>
      <Button className="secondary" onClick={() => setCenter(world?.spawn ?? { x: 0, z: 0 })}><Crosshair />Go to spawn</Button>
      <Button className="secondary map-fullscreen-button" onClick={() => { const target = document.querySelector(".world-map-card") as HTMLElement & { requestFullscreen?: () => Promise<void> }; void target?.requestFullscreen?.(); }}><Maximize2 />Expand map</Button>
    </Card>
    {error && <div className="error">{error}</div>}
    {!worldsQuery.isLoading && !worldsQuery.data?.some((item) => item.dimensions.length) ? <Card><Empty title="No saved map chunks yet" detail="Start the server and explore a world. Terrain appears as Minecraft saves its chunks." /></Card> : <div className="map-content-grid">
      <Card className="world-map-card">
        <div className="map-title-row"><div><span className="map-kicker">WORLD ATLAS</span><h2>{worldName || "Loading world…"}</h2><p>{dimension?.label ?? "Select a dimension"} <i /> {map?.chunksLoaded ?? 0} chunks in view <i /> X {Math.round(center.x)} · Z {Math.round(center.z)}</p></div><div className="map-heading-tools"><span className="map-grid-readout"><Mountain />{map?.chunksLoaded ?? 0} explored chunks</span><div className="map-direction-controls"><button aria-label="Pan north" onClick={() => pan(0,-1)}>↑</button><button aria-label="Pan west" onClick={() => pan(-1,0)}>←</button><button aria-label="Pan south" onClick={() => pan(0,1)}>↓</button><button aria-label="Pan east" onClick={() => pan(1,0)}>→</button></div></div></div>
        <div ref={mapViewport} className={`map-viewport${addMarkerMode ? " adding-marker" : ""}`} style={{ backgroundSize: `${chunkGridPixelsX}px ${chunkGridPixelsY}px, ${chunkGridPixelsX}px ${chunkGridPixelsY}px`, backgroundPosition: `${chunkGridX}px ${chunkGridY}px, ${chunkGridX}px ${chunkGridY}px` } as React.CSSProperties}>
          <div className="map-coordinate-badge"><Crosshair />{Math.round(center.x)} / {Math.round(center.z)}</div>
          <div className="map-zoom-hint">Scroll to zoom <span>·</span> Drag to explore</div>
          <div className="map-layer" style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }} onPointerDown={handleMapPointerDown} onPointerMove={handleMapPointerMove} onPointerUp={handleMapPointerUp} onPointerCancel={() => { drag.current = null; setDragOffset({ x: 0, y: 0 }); }}>
            <canvas ref={canvas} width={512} height={256} onMouseMove={inspectMap} aria-label="Minecraft terrain map. Drag to move, scroll to zoom." />
            {map?.structures.map((structure) => <span key={`${structure.id}:${structure.x}:${structure.z}`} className="map-structure-marker" style={pointStyle(structure.x, structure.z)} title={`${structure.id} · Y ${structure.y}`}>⌂</span>)}
            {visiblePlayers.map((player) => <button key={player.name} className="map-player-marker" style={pointStyle(player.x, player.z)} title={`${player.name} · ${player.x.toFixed(1)}, Y ${player.y.toFixed(1)}, ${player.z.toFixed(1)}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => recenterOnPlayer(player)}><img src={`/assets/avatars/${[...player.name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 2 ? "alex" : "steve"}.svg`} alt="" /><span>{player.name}</span></button>)}
            {markers.map((marker) => <button key={marker.id} className="map-custom-marker" style={{ ...pointStyle(marker.x, marker.z), "--marker-color": marker.color } as React.CSSProperties} title={`${marker.label} · ${marker.x}, ${marker.z}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { const label = window.prompt("Rename map marker", marker.label); if (label === null) return; setMarkerSets((sets) => ({ ...sets, [markerSetKey]: (sets[markerSetKey] ?? []).map((item) => item.id === marker.id ? { ...item, label: label.trim().slice(0, 48) || item.label } : item) })); }}><MapPin /><span>{marker.label}</span></button>)}
          </div>
          {loading && <span className="map-loading"><i />Reading saved terrain…</span>}
          {map?.chunksLoaded === 0 && !loading && <span className="map-empty-overlay">No saved chunks around here yet. Pan to another area or explore the world in Minecraft.</span>}
          {hover && <div className="map-inspector"><Mountain /><strong>Y {hover.y === -32768 ? "—" : hover.y}</strong><span>{hover.biome.replaceAll("minecraft:", "")}</span><code>{hover.x}, {hover.z}</code></div>}
        </div>
        <div className="map-statusbar"><span><i className="map-legend-terrain" />{localTextures ? "Local Minecraft textures" : "Chunk terrain"}</span><span><i className="map-legend-structure">⌂</i>Structure</span><span><i className="map-legend-player" />Player</span><span><i className="map-legend-pin"><MapPin /></i>Saved pin</span><small>Only generated and saved terrain is shown.</small></div>
      </Card>
      <Card className="map-players-card"><div className="map-sidebar-heading"><div><span>LIVE TRACKING</span><h2>Map details</h2></div><Badge tone="online">{visiblePlayers.length} players</Badge></div><div className="map-stat-grid"><div><strong>{map?.chunksLoaded.toLocaleString() ?? "—"}</strong><small>Loaded chunks here</small></div><div><strong>{world?.dimensions.reduce((sum, item) => sum + item.chunks, 0).toLocaleString() ?? "—"}</strong><small>Saved in dimension set</small></div></div><h3>Players in view</h3>{visiblePlayers.length ? visiblePlayers.map((player) => <button className="map-player-row" key={player.name} onClick={() => recenterOnPlayer(player)}><img src={`/assets/avatars/${[...player.name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 2 ? "alex" : "steve"}.svg`} alt="" /><span><strong>{player.name}</strong><small>X {player.x.toFixed(1)} · Y {player.y.toFixed(1)} · Z {player.z.toFixed(1)}</small></span><MapPin /></button>) : <Empty title="No players in this view" detail={positionsQuery.data?.available ? "Connected players will appear as they enter this dimension." : "Exact positions appear when the running server exposes them to the agent."} />}<div className="map-pins-heading"><h3>Saved pins</h3><Badge>{markers.length}</Badge></div>{markers.length ? markers.map((marker) => <div className="map-pin-row" key={marker.id}><button onClick={() => setCenter({ x: marker.x, z: marker.z })}><MapPin /><span><strong>{marker.label}</strong><small>X {marker.x}, Z {marker.z}</small></span></button><button aria-label={`Remove ${marker.label}`} onClick={() => setMarkerSets((sets) => ({ ...sets, [markerSetKey]: (sets[markerSetKey] ?? []).filter((item) => item.id !== marker.id) }))}><X /></button></div>) : <small className="map-source-note">Choose Add pin, then click the map to save a favorite coordinate.</small>}<small className="map-source-note">Pins are saved in this browser. Terrain is read from this server’s world files; custom seeds and builds are preserved.</small></Card>
    </div>}
  </>;
}

function PlayerRow({ player, controls = [], onAction, disabled = true }: { player: any; controls?: Array<{ label: string; action: string; danger?: boolean; confirm?: boolean }>; onAction?: (action: string, player: string, confirmAction?: boolean) => void; disabled?: boolean }) {
  const [fallback, setFallback] = useState(false);
  useEffect(() => setFallback(false), [player.name, player.profile?.id]);
  const fallbackName = [...String(player.name)].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 2 ? "Alex" : "Steve";
  return <div className="player-row"><img className="player-avatar" src={fallback || !player.profile ? `/assets/avatars/${fallbackName.toLowerCase()}.svg` : player.profile.head} alt={`${player.profile?.name ?? player.name} Minecraft skin`} onError={() => { if (!fallback) setFallback(true); }} /><div><strong>{player.profile?.name ?? player.name}</strong><small>{player.profile ? (player.onlineMode === false ? "Mojang name match · offline identity unverified" : "Mojang profile verified") : "Default skin · profile unverified"}</small></div>{controls.length > 0 && <div className="player-actions">{controls.map((control) => <Button key={control.action} className={control.danger ? "secondary player-danger" : "secondary"} disabled={disabled} title={disabled ? "Actions require a server process managed by Salvadiux" : control.label} onClick={() => onAction?.(control.action, player.name, control.confirm)}>{control.label}</Button>)}</div>}</div>;
}

function PlayersPage({ i }: { i: Instance }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["players", i.id],
    queryFn: () => api<any>(`/api/instances/${i.id}/players`),
    refetchInterval: 5000,
  });
  const sections = [
    { title: "Online now", players: q.data?.online ?? [] },
    { title: "Whitelist", players: q.data?.whitelist ?? [] },
    { title: "Operators", players: q.data?.operators ?? [] },
    { title: "Banned players", players: q.data?.bannedPlayers ?? [] },
  ];
  const playerAction = useMutation({ mutationFn: ({ action, player }: { action: string; player: string }) => api(`/api/instances/${i.id}/players/action`, { method: "POST", body: JSON.stringify({ action, player }) }), onSuccess: () => { void q.refetch(); void qc.invalidateQueries({ queryKey: ["activity", i.id] }); } });
  const actionsBySection: Record<string, Array<{ label: string; action: string; danger?: boolean; confirm?: boolean }>> = {
    "Online now": [{ label: "Kick", action: "kick" }, { label: "Ban", action: "ban", danger: true, confirm: true }, { label: "OP", action: "op", confirm: true }],
    Whitelist: [{ label: "Remove", action: "whitelist remove", danger: true, confirm: true }],
    Operators: [{ label: "Deop", action: "deop", danger: true, confirm: true }],
    "Banned players": [{ label: "Pardon", action: "pardon", confirm: true }],
  };
  return (
    <>
      <Title
        title="Players"
        sub="Access lists read directly from the server files"
      />
      {!q.data?.controlReady && <div className="player-control-note"><TriangleAlert /><span><strong>Live moderation is unavailable for this process.</strong><small>Start this server from Salvadiux to enable command actions. This build does not yet send commands to externally launched servers.</small></span></div>}
      {playerAction.error && <div className="error">{playerAction.error.message}</div>}
      <div className="metrics">
        <Metric label="Online" value={String(q.data?.online?.length ?? 0)} icon={Users} />
        <Metric
          label="Whitelist"
          value={String(q.data?.whitelist?.length ?? 0)}
          icon={Shield}
        />
        <Metric
          label="Operators"
          value={String(q.data?.operators?.length ?? 0)}
          icon={Zap}
        />
        <Metric
          label="Banned"
          value={String(q.data?.bannedPlayers?.length ?? 0)}
          icon={X}
        />
      </div>
      {sections.map((section) => <Card key={section.title} className="players-section"><h2>{section.title}<Badge tone="online">{section.players.length}</Badge></h2>{section.players.length ? <div className="player-grid">{section.players.map((player: any, index: number) => <PlayerRow key={player.uuid ?? player.name ?? index} player={player} controls={actionsBySection[section.title]} disabled={!q.data?.controlReady || playerAction.isPending} onAction={(actionName, name, shouldConfirm) => (!shouldConfirm || confirm(`${actionsBySection[section.title]?.find((item) => item.action === actionName)?.label} ${name}?`)) && playerAction.mutate({ action: actionName, player: name })} />)}</div> : <Empty title={`No ${section.title.toLowerCase()}`} />}</Card>)}
    </>
  );
}
function NetworkWorkspace({ instances, initialInstance, onCreateServer, onExit, onSearch }: { instances: Instance[]; initialInstance?: Instance; onCreateServer: () => void; onExit: () => void; onSearch: () => void }) {
  const networksQuery = useQuery({ queryKey: ["networks"], queryFn: () => api<any[]>("/api/networks"), refetchInterval: 3500 });
  const [networkId, setNetworkId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [section, setSection] = useState<"overview" | "servers" | "players" | "console" | "statistics" | "files" | "plugins" | "worlds" | "map" | "appearance" | "backups" | "scheduler" | "discord" | "network" | "configuration" | "preferences" | "topology" | "advanced">("overview");
  const network = networksQuery.data?.find((item: any) => item.id === networkId) ?? networksQuery.data?.[0];
  useEffect(() => { if (network && networkId !== network.id) setNetworkId(network.id); }, [network?.id]);
  const memberRows = (network?.members ?? []).map((member: any) => ({ ...member, instance: instances.find((item) => item.id === (member.instance?.id ?? member.instanceId)) ?? member.instance }));
  const selectedMember = memberRows.find((member: any) => (member.instance?.id ?? member.instanceId) === memberId) ?? memberRows.find((member: any) => member.role === "hub") ?? memberRows[0];
  const target = selectedMember?.instance as Instance | undefined;
  const proxyTarget = instances.find((item) => item.id === (network?.proxy?.id ?? network?.proxyId)) ?? network?.proxy as Instance | undefined;
  const proxyNodeSelected = (section === "appearance" || section === "console") && memberId === proxyTarget?.id;
  const workspaceTarget = proxyNodeSelected ? proxyTarget : target;
  const label: Record<string, string> = { overview: "Network overview", servers: "Servers", players: "Players", console: "Console", statistics: "Statistics", files: "Files", plugins: "Plugins", worlds: "Worlds", map: "World map", appearance: "Appearance", backups: "Backups", scheduler: "Scheduler", discord: "Discord", network: "Playit tunnel", configuration: "Configuration", preferences: "Preferences", topology: "Topology", advanced: "Diagnostics" };
  const group: [string, typeof section[]][] = [["NETWORK", ["overview", "servers", "topology"]], ["OPERATIONS", ["players", "console", "statistics", "files"]], ["MANAGE", ["plugins", "worlds", "map", "appearance", "backups", "scheduler", "discord", "network"]], ["HOST", ["configuration", "preferences", "advanced"]]];
  return <div className="network-workspace-shell">
    <aside className="network-workspace-sidebar" aria-label="Network dashboard navigation">
      <div className="network-workspace-brand"><img className="mark brand-image" src="/assets/salvadiux-icon.png" alt="" /><div><strong>Salvadiux</strong><small>NETWORK CONTROL</small></div></div>
      <label className="network-workspace-picker"><span>Active network</span><select aria-label="Active network" value={network?.id ?? ""} onChange={(event) => { setNetworkId(event.target.value); setMemberId(""); }}><option value="" disabled>Select a network</option>{networksQuery.data?.map((item: any) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <Button className="new-server" onClick={onCreateServer}><Plus />Add server</Button>
      <nav className="network-workspace-nav">{group.map(([title, items]) => <div className="nav-group" key={title}><span>{title}</span>{items.map((id) => { const Icon = id === "overview" ? LayoutDashboard : id === "servers" ? Server : id === "topology" ? Waypoints : id === "players" ? Users : id === "console" ? Terminal : id === "statistics" ? ChartNoAxesCombined : id === "files" ? Folder : id === "plugins" ? Package : id === "worlds" ? Globe2 : id === "map" ? MapIcon : id === "appearance" ? Paintbrush : id === "backups" ? Archive : id === "scheduler" ? Zap : id === "discord" ? BellRing : id === "network" ? Network : id === "configuration" ? Settings : id === "preferences" ? SlidersHorizontal : Wrench; return <button key={id} className={section === id ? "nav active" : "nav"} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}><Icon />{label[id]}</button>; })}</div>)}</nav>
      <button className="network-workspace-exit" onClick={onExit}><ArrowLeft />Single server dashboard</button>
      <div className="sidebar-foot"><Shield /><span>Network control plane<small>Isolated multi-server view</small></span></div>
    </aside>
    <main className="network-workspace-main">
      <header className="network-workspace-header"><div className="workspace-breadcrumb"><span>Salvadiux Network</span><ChevronRight /><strong>{label[section]}</strong></div><button className="search-trigger" onClick={onSearch}><Search />Search servers and tools…<kbd>Ctrl K</kbd></button>{section === "network" && proxyTarget ? <div className="network-target-picker"><span>Public entry</span><strong>{proxyTarget.name} · Velocity</strong></div> : <label className="network-target-picker"><span>{section === "appearance" ? "Appearance target" : "Node"}</span><select aria-label="Selected network server" value={proxyNodeSelected ? proxyTarget?.id ?? "" : target?.id ?? ""} onChange={(event) => setMemberId(event.target.value)}>{(section === "appearance" || section === "console") && proxyTarget && <option value={proxyTarget.id}>{section === "console" ? "Velocity proxy · console" : "Velocity proxy · server list"}</option>}{memberRows.map((member: any) => <option key={member.id} value={member.instance?.id ?? member.instanceId}>{member.alias} · {member.role}</option>)}</select></label>}</header>
      <div className="network-workspace-content">
        {networksQuery.isLoading ? <div className="center"><Spinner /></div> : !network ? <><Title title="Build your network" sub="Create a Velocity proxy and backend servers to open the network dashboard." /><Card className="network-empty"><Network /><strong>No network configured yet</strong><span>Create servers, then configure a secure topology to manage them together.</span><Button onClick={() => setSection("topology")}><Waypoints />Create topology</Button>{initialInstance && <Button className="secondary" onClick={onCreateServer}><Plus />Create server</Button>}</Card></> : section === "overview" ? <NetworkControlPage /> : section === "servers" ? <NetworkServersPage network={network} instances={instances} onCreateServer={onCreateServer} /> : section === "topology" ? (initialInstance ? <NetworkTopologyPage selected={initialInstance} /> : <Card><h2>Topology setup</h2><p>Create a Velocity proxy and at least one Paper backend first.</p><Button onClick={onCreateServer}><Plus />Create server</Button></Card>) : section === "network" ? proxyTarget ? <><div className="network-node-context"><span className={`network-node-indicator ${proxyTarget.status}`} /><div><strong>Public network entry · Velocity proxy</strong><small>{proxyTarget.name} · Java {proxyTarget.host}:{proxyTarget.port} · Bedrock UDP 127.0.0.1:19132</small></div><Badge tone={proxyTarget.status === "online" ? "online" : "neutral"}>{proxyTarget.status}</Badge></div><PlayitPage i={proxyTarget} /></> : <Card className="network-empty"><Network /><strong>Network proxy unavailable</strong><span>Connect a Velocity proxy in Network topology to configure public Java and Bedrock tunnels.</span><Button onClick={() => setSection("topology")}><Waypoints />Open topology</Button></Card> : workspaceTarget ? <><div className="network-node-context"><span className={`network-node-indicator ${workspaceTarget.status}`} /><div><strong>{proxyNodeSelected ? (section === "console" ? "Velocity proxy · console" : "Velocity proxy · server list identity") : `${selectedMember?.alias} · ${selectedMember?.role}`}</strong><small>{workspaceTarget.name} · {workspaceTarget.software} {workspaceTarget.minecraftVersion} · {workspaceTarget.host}:{workspaceTarget.port}</small></div><Badge tone={workspaceTarget.status === "online" ? "online" : "neutral"}>{workspaceTarget.status}</Badge></div><PageView page={section as Page} instance={workspaceTarget} instances={instances} /></> : <Card className="network-empty"><Server /><strong>Add a game server first</strong><span>Node-specific tools need a backend attached to this network.</span><Button onClick={onCreateServer}><Plus />Create server</Button></Card>}
      </div>
    </main>
  </div>;
}

function NetworkServersPage({ network, instances, onCreateServer }: { network: any; instances: Instance[]; onCreateServer: () => void }) {
  const client = useQueryClient();
  const [instanceId, setInstanceId] = useState("");
  const [role, setRole] = useState("gateway");
  const [alias, setAlias] = useState("gateway");
  const members = network.members ?? [];
  const attached = new Set(members.map((member: any) => member.instance?.id ?? member.instanceId));
  const candidates = instances.filter((item) => ["paper", "purpur"].includes(item.software) && item.minecraftVersion === network.minecraftVersion && !attached.has(item.id));
  const selected = candidates.find((item) => item.id === instanceId) ?? candidates[0];
  const attach = useMutation({ mutationFn: () => api(`/api/networks/${network.id}/members`, { method: "POST", body: JSON.stringify({ instanceId: selected?.id, role, alias: alias.trim() || role }) }), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ["networks"] }), client.invalidateQueries({ queryKey: ["instances"] })]); setInstanceId(""); } });
  return <><Title title="Network servers" sub="Add compatible servers and manage every network node from its own context." actions={<Badge>{members.length} backends</Badge>} /><Card className="network-server-list"><div className="network-section-heading"><div><span className="network-kicker">CONNECTED NODES</span><h2>{network.name}</h2><p>Proxy entry point {network.proxy?.host}:{network.proxy?.port} · Minecraft {network.minecraftVersion}</p></div><Button onClick={onCreateServer}><Plus />Create server</Button></div><div className="network-control-nodes">{[{ id: network.proxy?.id ?? "proxy", title: "Velocity proxy", name: network.proxy?.name ?? "Unavailable", address: `${network.proxy?.host ?? "—"}:${network.proxy?.port ?? "—"}`, status: network.proxy?.status ?? "offline" }, ...members.map((member: any) => ({ id: member.id, title: `${member.alias} · ${member.role}`, name: member.instance?.name ?? "Server unavailable", address: `${member.instance?.host ?? "—"}:${member.instance?.port ?? "—"}`, status: member.instance?.status ?? "offline" }))].map((node: any) => <div className="network-control-node" key={node.id}><span className={`network-node-indicator ${node.status}`} /><div><strong>{node.title}</strong><small>{node.name} · {node.address}</small></div><Badge tone={node.status === "online" ? "online" : "neutral"}>{node.status}</Badge></div>)}</div></Card><Card className="network-attach-card"><div className="network-section-heading"><div><span className="network-kicker">GROW THE NETWORK</span><h2>Attach an existing backend</h2><p>Paper and Purpur servers on the same Minecraft release. Stop every network node before changing its routing.</p></div><Plus /></div>{!candidates.length ? <div className="network-empty"><Server /><strong>No compatible unattached servers</strong><span>Create another Paper server for Minecraft {network.minecraftVersion}; it will appear here when setup finishes.</span><Button onClick={onCreateServer}><Plus />Create compatible server</Button></div> : <form className="network-attach-form" onSubmit={(event) => { event.preventDefault(); attach.mutate(); }}><label><span>Server</span><select value={selected?.id ?? ""} onChange={(event) => setInstanceId(event.target.value)}>{candidates.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.minecraftVersion} · {item.host}:{item.port}</option>)}</select></label><label><span>Network role</span><select value={role} onChange={(event) => { setRole(event.target.value); setAlias(event.target.value); }}><option value="gateway">Gateway / welcome lobby</option><option value="hub">Hub</option><option value="survival">Survival</option><option value="creative">Creative</option><option value="minigame">Minigame</option><option value="events">Events</option></select></label><label><span>Proxy alias</span><input value={alias} maxLength={32} pattern="[a-z][a-z0-9_-]{0,31}" onChange={(event) => setAlias(event.target.value.toLowerCase())} required /></label><Button type="submit" disabled={attach.isPending || !selected}>{attach.isPending ? <Spinner /> : <Plus />}{attach.isPending ? "Attaching…" : "Attach server"}</Button></form>}{attach.error && <div className="error">{(attach.error as Error).message}</div>}<div className="network-attach-note"><Shield /><span>Attaching binds the backend to loopback, enables modern Velocity forwarding, and saves a restore snapshot. Routing changes require all current nodes stopped.</span></div></Card></>;
}

function NetworkControlPage() {
  const client = useQueryClient();
  const networksQuery = useQuery({ queryKey: ["networks"], queryFn: () => api<any[]>("/api/networks"), refetchInterval: 3500 });
  const backendNodes = (networksQuery.data ?? []).flatMap((network: any) => (network.members ?? []).map((member: any) => ({ id: member.instance?.id ?? member.instanceId, name: member.instance?.name ?? member.alias })));
  const nodeStatusQueries = useQueries({ queries: backendNodes.map((node: any) => ({ queryKey: ["status", node.id], queryFn: () => api<any>(`/api/instances/${node.id}/status`), refetchInterval: 4000, retry: false })) });
  const aggregate = nodeStatusQueries.reduce((summary, query) => {
    const status = query.data;
    return { online: summary.online + (status?.running ? 1 : 0), players: summary.players + (status?.players?.length ?? 0), memory: summary.memory + Number(status?.metrics?.memory ?? 0), cpu: summary.cpu + Number(status?.metrics?.cpu ?? 0) };
  }, { online: 0, players: 0, memory: 0, cpu: 0 });
  const start = useMutation({
    mutationFn: (id: string) => api<any>(`/api/networks/${id}/start`, { method: "POST", body: "{}" }),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ["networks"] }), client.invalidateQueries({ queryKey: ["instances"] })]); },
  });
  const stop = useMutation({
    mutationFn: (id: string) => api<any>(`/api/networks/${id}/stop`, { method: "POST", body: "{}" }),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ["networks"] }), client.invalidateQueries({ queryKey: ["instances"] })]); },
  });
  const pendingId = start.isPending ? String(start.variables ?? "") : stop.isPending ? String(stop.variables ?? "") : "";
  const pendingAction = start.isPending ? "start" : stop.isPending ? "stop" : "";
  return <>
    <Title title="Network overview" sub="Live health and resource usage across your connected game servers." actions={<Badge tone="online"><Activity />Live status</Badge>} />
    {backendNodes.length > 0 && <div className="network-aggregate-grid"><StatsMetric icon={Server} label="BACKENDS ONLINE" value={`${aggregate.online} / ${backendNodes.length}`} detail="Game servers responding" percent={aggregate.online / backendNodes.length * 100} tone="mint" /><StatsMetric icon={Users} label="PLAYERS ACROSS MODES" value={String(aggregate.players)} detail="Current backend connections" tone="violet" /><StatsMetric icon={Database} label="JAVA MEMORY IN USE" value={formatBytes(aggregate.memory)} detail="Sum across backend processes" tone="blue" /><StatsMetric icon={Cpu} label="JAVA CPU TOTAL" value={`${aggregate.cpu.toFixed(1)}%`} detail="Combined process usage" percent={Math.min(100, aggregate.cpu)} tone="lilac" /></div>}
    {networksQuery.isLoading ? <div className="center"><Spinner /></div> : !networksQuery.data?.length ? <Card className="network-empty"><Network /><strong>No network configured yet</strong><span>Open Network topology to connect a Velocity proxy with your lobby and game servers.</span></Card> : networksQuery.data.map((network: any) => {
      const nodes = [...(network.members ?? []).map((member: any) => ({ id: member.instance?.id ?? member.instanceId, title: `${member.alias} · ${member.role}`, name: member.instance?.name ?? "Server unavailable", address: `${member.instance?.host ?? "—"}:${member.instance?.port ?? "—"}`, status: member.instance?.status ?? "offline", role: member.role })), ...(network.proxy ? [{ id: network.proxy.id, title: "Velocity proxy", name: network.proxy.name, address: `${network.proxy.host}:${network.proxy.port}`, status: network.proxy.status, role: "proxy" }] : [])];
      const online = nodes.filter((node: any) => node.status === "online").length;
      const active = online > 0 || nodes.some((node: any) => node.status === "starting" || node.status === "stopping");
      const busy = pendingId === network.id;
      return <Card className="network-control-card" key={network.id}>
        <div className="network-control-heading"><div><span className="network-kicker">SALVADIUX NETWORK · {network.minecraftVersion}</span><h2>{network.name}</h2><p>{online} of {nodes.length} services online · Java entrypoint at {network.proxy?.host ?? "—"}:{network.proxy?.port ?? "—"}</p></div><div className="network-control-actions"><Button onClick={() => start.mutate(network.id)} disabled={start.isPending || stop.isPending || !network.proxy || !network.members?.length}>{busy && pendingAction === "start" ? <Spinner /> : <Play />}{busy && pendingAction === "start" ? "Starting network…" : "Start all"}</Button><Button className="secondary" onClick={() => confirm("Stop the proxy and every server in this network? Connected players will be disconnected.") && stop.mutate(network.id)} disabled={stop.isPending || start.isPending || !active}>{busy && pendingAction === "stop" ? <Spinner /> : <Square />}{busy && pendingAction === "stop" ? "Stopping network…" : "Stop all"}</Button></div></div>
        <div className="network-boot-order"><span><CheckCircle2 />Gateway / lobby</span><ChevronRight /><span><Server />Game modes</span><ChevronRight /><span><Network />Proxy opens last</span></div>
        <div className="network-control-nodes">{nodes.map((node: any) => <div className="network-control-node" key={node.id}><span className={`network-node-indicator ${node.status}`} /><div><strong>{node.title}</strong><small>{node.name} · {node.address}</small></div><Badge tone={node.status === "online" ? "online" : "neutral"}>{node.status}</Badge></div>)}</div>
      </Card>;
    })}
    {(start.error || stop.error || networksQuery.error) && <div className="error">{(start.error ?? stop.error ?? networksQuery.error)?.message}</div>}
  </>;
}
function NetworkTopologyPage({ selected }: { selected: Instance }) {
  const client = useQueryClient();
  const networksQuery = useQuery({ queryKey: ["networks"], queryFn: () => api<any[]>("/api/networks"), refetchInterval: 10_000 });
  const instancesQuery = useQuery({ queryKey: ["instances"], queryFn: () => api<Instance[]>("/api/instances") });
  const [name, setName] = useState("Salvadiux Network");
  const [proxyId, setProxyId] = useState(selected.software === "velocity" ? selected.id : "");
  const [members, setMembers] = useState([{ instanceId: "", role: "hub", alias: "hub", priority: 0 }]);
  const proxies = instancesQuery.data?.filter((instance) => instance.software === "velocity") ?? [];
  const backends = instancesQuery.data?.filter((instance) => ["paper", "purpur"].includes(instance.software)) ?? [];
  useEffect(() => {
    if (!proxyId && proxies[0]) setProxyId(proxies[0].id);
  }, [proxyId, proxies]);
  const create = useMutation({
    mutationFn: () => {
      const proxy = proxies.find((instance) => instance.id === proxyId);
      if (!proxy) throw new Error("Create or select a Velocity proxy first.");
      const firstBackend = backends.find((instance) => instance.id === members[0]?.instanceId);
      return api("/api/networks", { method: "POST", body: JSON.stringify({ name, proxyInstanceId: proxyId, minecraftVersion: firstBackend?.minecraftVersion, members }) });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["networks"] }); void client.invalidateQueries({ queryKey: ["instances"] }); },
  });
  const restore = useMutation({
    mutationFn: (id: string) => api(`/api/networks/${id}`, { method: "DELETE" }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["networks"] }); void client.invalidateQueries({ queryKey: ["instances"] }); },
  });
  const updateMember = (index: number, patch: Partial<(typeof members)[number]>) => setMembers((current) => current.map((member, row) => row === index ? { ...member, ...patch } : member));
  return <>
    <Title title="Network topology" sub="Create the secure proxy network, player routing, and per-mode location tracking." actions={<Badge tone="online">Modern forwarding</Badge>} />
    <div className="network-overview">
      <Card className="network-diagram-card"><div className="network-diagram"><div className="network-diagram-edge"><Globe2 /><span>Java + Bedrock edge</span></div><div className="network-diagram-line" /><div className="network-diagram-proxy"><Network /><span>Velocity · online-mode</span><small>Modern forwarding · shared secret</small></div><div className="network-diagram-branches"><div><span>Gateway / login</span></div><div><span>Hub</span></div><div><span>Survival realm</span></div><div><span>Creative plots</span></div><div><span>Match instances</span></div></div></div><p>Backends bind to loopback, authenticate forwarded identity with Velocity, and keep their own profile data. Survival Nether and End stay together inside their Survival backend.</p></Card>
      <Card className="network-checklist-card"><h2><Shield />Network safety</h2><div><CheckCircle2 /><span>Online authentication stays enabled at the proxy</span></div><div><CheckCircle2 /><span>Velocity modern forwarding signs player identity</span></div><div><CheckCircle2 /><span>Backend addresses must use loopback only</span></div><div><CheckCircle2 /><span>Configuration files get a restore snapshot</span></div><small>Do not publish the forwarding secret or expose backend ports.</small></Card>
    </div>
    {networksQuery.data?.map((network: any) => <Card className="network-instance-card" key={network.id}><div className="network-instance-heading"><div><span className="network-kicker">CONFIGURED NETWORK</span><h2>{network.name}</h2><p>Paper {network.minecraftVersion} · Velocity {network.proxy?.softwareVersion ?? "proxy"} at {network.proxy?.host}:{network.proxy?.port}</p></div><Button className="secondary" disabled={restore.isPending} onClick={() => confirm("Stop every node, restore its original files, and remove this network configuration?") && restore.mutate(network.id)}><RotateCcw />Restore original configs</Button></div><div className="network-node-grid"><div className="network-node network-node-proxy"><Network /><span><strong>Proxy</strong><small>{network.proxy?.name}</small></span><Badge tone={network.proxy?.status === "online" ? "online" : "neutral"}>{network.proxy?.status ?? "offline"}</Badge></div>{network.members.map((member: any) => <div className="network-node" key={member.id}><Server /><span><strong>{member.alias} · {member.role}</strong><small>{member.instance?.name} · {member.instance?.host}:{member.instance?.port}</small></span><Badge tone={member.instance?.status === "online" ? "online" : "neutral"}>{member.instance?.status ?? "offline"}</Badge></div>)}</div><div className="network-capabilities"><span><CheckCircle2 />Velocity forwarding</span><span><CheckCircle2 />Hub mode selector</span><span><CheckCircle2 />/hub · /spawn · /back</span><span><CheckCircle2 />Per-mode inventory profiles</span><span><CheckCircle2 />Survival/Creative location sync</span></div></Card>)}
    {networksQuery.data?.some((network: any) => network.recentLocations?.length) && <Card className="network-locations-card"><div className="network-section-heading"><div><span className="network-kicker">PLAYER LOCATION SERVICE</span><h2>Recent mode positions</h2><p>Saved independently for Survival and Creative through the authenticated Paper plugin.</p></div><MapPin /></div><div className="network-location-list">{networksQuery.data.flatMap((network: any) => (network.recentLocations ?? []).map((location: any) => ({ ...location, networkName: network.name }))).map((location: any) => <div className="network-location-row" key={`${location.networkId}:${location.playerUuid}:${location.modeId}`}><MapPin /><strong>{location.playerName}</strong><Badge>{location.modeId}</Badge><span>{location.networkName} · {location.realmId} · {location.worldKey}</span><code>{location.x.toFixed(1)}, {location.y.toFixed(1)}, {location.z.toFixed(1)}</code><time>{new Date(location.updatedAt).toLocaleString()}</time></div>)}</div></Card>}
    <Card className="network-create-card"><div className="network-section-heading"><div><span className="network-kicker">NETWORK BUILDER</span><h2>Attach Paper backends</h2><p>Pick a stopped Velocity proxy and one or more stopped Paper backends on the same Minecraft release.</p></div><Waypoints /></div>
      {!proxies.length ? <div className="network-empty"><Network /><strong>No Velocity proxy found</strong><span>Use Create server → Velocity Proxy first. Its default bind is loopback so Playit can target it without opening backend ports.</span></div> : <>
        <div className="network-form-grid"><label><span>Network name</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label><label><span>Velocity proxy</span><select value={proxyId} onChange={(event) => setProxyId(event.target.value)}>{proxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name} · {proxy.softwareVersion ?? "Velocity"}</option>)}</select></label></div>
        <div className="network-backend-list">{members.map((member, index) => <div className="network-backend-row" key={index}><label><span>Paper backend</span><select value={member.instanceId} onChange={(event) => updateMember(index, { instanceId: event.target.value })}><option value="">Choose a server…</option>{backends.map((instance) => <option key={instance.id} value={instance.id}>{instance.name} · {instance.minecraftVersion} · {instance.host}:{instance.port}</option>)}</select></label><label><span>Role</span><select value={member.role} onChange={(event) => updateMember(index, { role: event.target.value, alias: event.target.value })}><option value="gateway">Gateway / login</option><option value="hub">Hub</option><option value="survival">Survival</option><option value="creative">Creative</option><option value="minigame">Minigame</option><option value="events">Events</option></select></label><label><span>Proxy alias</span><input value={member.alias} maxLength={32} onChange={(event) => updateMember(index, { alias: event.target.value })} /></label><Button className="icon secondary" aria-label={`Remove backend ${index + 1}`} onClick={() => setMembers((current) => current.filter((_, row) => row !== index))} disabled={members.length <= 1}><Trash2 /></Button></div>)}</div>
        <div className="network-form-actions"><Button className="secondary" onClick={() => setMembers((current) => [...current, { instanceId: "", role: "survival", alias: `survival-${current.length}`, priority: current.length }])}><Plus />Add backend</Button><span>All backends must be stopped and bound to 127.0.0.1.</span><Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim() || members.some((member) => !member.instanceId || !member.alias.trim())}>{create.isPending ? <Spinner /> : <Shield />}{create.isPending ? "Configuring network…" : "Apply secure topology"}</Button></div>
      </>}
      {create.error && <div className="error">{create.error.message}</div>}{restore.error && <div className="error">{restore.error.message}</div>}
    </Card>
    <Card className="network-next-card"><h2>Shared services still to connect</h2><p>The network plugin now handles routing, hub selection, commands, and separate inventories and positions for Hub, Survival, and Creative. This Host keeps those profiles in its local SQLite database. For multiple host nodes, install MariaDB/Redis and choose a shared-profile provider; also configure Geyser/Floodgate, LuckPerms, anti-cheat, matchmaking, external monitoring, and off-node backups before public production.</p><div><Badge>MariaDB + Redis template</Badge><Badge>Geyser + Floodgate</Badge><Badge>LuckPerms</Badge><Badge>HuskSync for same-mode shards</Badge><Badge>Matchmaking</Badge><Badge>Prometheus + Grafana</Badge><Badge>S3 backups</Badge></div></Card>
  </>;
}
function PlayitPage({ i }: { i: Instance }) {
  const client = useQueryClient();
  const [copied, setCopied] = useState<"java" | "bedrock" | "">("");
  const status = useQuery({ queryKey: ["playit"], queryFn: () => api<any>("/api/playit/status"), refetchInterval: 4000 });
  const start = useMutation({ mutationFn: () => api("/api/playit/start", { method: "POST", body: JSON.stringify({ instanceId: i.id }) }), onSuccess: () => client.invalidateQueries({ queryKey: ["playit"] }) });
  const stop = useMutation({ mutationFn: () => api("/api/playit/stop", { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["playit"] }) });
  const ready = status.data?.running;
  const connected = status.data?.authenticated;
  const localEndpoint = `127.0.0.1:${i.port}`;
  const isProxy = i.software === "velocity";
  const bedrockEndpoint = "127.0.0.1:19132";
  const copyEndpoint = async (protocol: "java" | "bedrock") => {
    try { await navigator.clipboard.writeText(protocol === "bedrock" ? bedrockEndpoint : localEndpoint); setCopied(protocol); window.setTimeout(() => setCopied(""), 1800); }
    catch { setCopied(""); }
  };
  return <>
    <Title title="Playit tunnel" sub={isProxy ? "Expose the network proxy for Java and Bedrock without router port forwarding." : "Expose this Minecraft server without router port forwarding."} actions={<Badge tone={connected ? "online" : "neutral"}>{connected ? "Agent connected" : ready ? "Link account" : "Not connected"}</Badge>} />
    <div className="playit-grid">
      <Card className="playit-main-card"><div className="playit-symbol"><Network /></div><h2>{connected ? "Your Playit agent is connected" : ready ? "Authorize your Playit agent" : "Connect this server to Playit"}</h2><p>Salvadiux installs the official Windows agent and verifies its release checksum. Approve the one-time link below; Salvadiux then provisions the agent automatically. For a network, Java and Bedrock tunnels must both target the Velocity proxy.</p>
        <div className="playit-endpoint"><div><small>{isProxy ? "Java network entry · local origin" : "Local Minecraft endpoint"}</small><strong>{localEndpoint}</strong></div><code>TCP · Java</code><Button className="icon secondary" aria-label="Copy Java tunnel target" onClick={() => copyEndpoint("java")}><Copy /></Button></div>
        {isProxy ? <div className="playit-endpoint"><div><small>Bedrock network entry · local origin</small><strong>{bedrockEndpoint}</strong></div><code>UDP · Bedrock</code><Button className="icon secondary" aria-label="Copy Bedrock tunnel target" onClick={() => copyEndpoint("bedrock")}><Copy /></Button></div> : <div className="playit-waiting"><Network /> Bedrock cross-play is served by the network’s Velocity proxy. Configure its UDP tunnel from Network → Playit.</div>}
        {copied && <small className="muted">{copied === "java" ? "Java target copied." : "Bedrock target copied."}</small>}
        <div className="playit-actions">{ready ? <Button className="secondary" onClick={() => stop.mutate()} disabled={stop.isPending}><Square />Stop agent</Button> : <Button onClick={() => start.mutate()} disabled={start.isPending}>{start.isPending ? <Spinner /> : <Play />}{start.isPending ? "Preparing Playit…" : "Install and start Playit"}</Button>}<span>{status.data?.version ? `Official agent ${status.data.version}` : "Official signed release · SHA-256 checked"}</span></div>
        {start.error && <p className="error">{start.error.message}</p>}
        {status.data?.claimUrl && <div className="playit-claim"><strong>{status.data.claimState === "approval" ? "Waiting for your approval" : "Finish linking your account"}</strong><p>Open the official one-time link and approve the Salvadiux agent. After approval, the host completes the secure link automatically. Then create a <b>Minecraft Java</b> tunnel targeting <code>{localEndpoint}</code>{isProxy && <> and a <b>UDP tunnel</b> targeting <code>{bedrockEndpoint}</code></>}.</p><a href={status.data.claimUrl} target="_blank" rel="noreferrer">Approve agent on playit.gg <ChevronRight /></a></div>}
        {ready && !connected && !status.data?.claimUrl && <div className="playit-waiting"><span className="status-dot online" />{status.data?.claimState === "error" ? "Playit setup had a temporary error; the agent will retry." : "Waiting for Playit account approval. Keep Salvadiux open."}</div>}
        {connected && !status.data?.tunnels?.length && <div className="playit-waiting"><span className="status-dot online" />Agent connected. Create the Minecraft Java tunnel below to receive a public address.</div>}
      </Card>
      <Card className="playit-details"><h2>Connection details</h2><p>Local origin for {isProxy ? "the network’s Velocity entry point" : "this Minecraft server"}.</p><dl><div><dt>Java origin</dt><dd>{localEndpoint} · TCP</dd></div>{isProxy && <div><dt>Bedrock origin</dt><dd>{bedrockEndpoint} · UDP</dd></div>}<div><dt>Server</dt><dd>{i.name}</dd></div></dl><h3>Create public tunnels</h3><ol className="playit-steps"><li>Approve the agent with the one-time link.</li><li>Create a <b>Minecraft Java</b> tunnel with origin <code>{localEndpoint}</code>.</li>{isProxy && <li>Create a <b>UDP</b> tunnel with origin <code>{bedrockEndpoint}</code>. Bedrock UDP tunnel availability may depend on your Playit plan.</li>}</ol><a className="playit-create-link" href="https://playit.gg/account/setup/new-tunnel" target="_blank" rel="noreferrer">Open Playit tunnel setup <ChevronRight /></a>{status.data?.tunnels?.length > 0 && <><h3>Public tunnel addresses</h3>{status.data.tunnels.map((tunnel: any) => <div className="playit-public-address" key={tunnel.id}><strong>{tunnel.display_address}</strong><small>→ {tunnel.destination}{tunnel.is_disabled ? " · disabled" : " · online"}</small></div>)}</>}<h3>Reachable addresses on this PC</h3>{status.data?.localAddresses?.length ? status.data.localAddresses.map((address: string) => <code className="playit-address" key={address}>{address}:{i.port}</code>) : <span className="muted">Local network address appears when the agent is started.</span>}<small>Once linked, Playit tunnel addresses update here. Players use the public address; Salvadiux and Minecraft keep running on this PC.</small></Card>
    </div>
    {status.data?.log && <details className="playit-log"><summary>Agent output</summary><pre>{status.data.log}</pre></details>}
  </>;
}
function SchedulerPage({ i }: { i: Instance }) {
  const q = useQuery({
    queryKey: ["tasks", i.id],
    queryFn: () => api<any[]>(`/api/instances/${i.id}/tasks`),
  });
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 * * * *");
  const [action, setAction] = useState<"backup" | "command">("backup");
  const [command, setCommand] = useState("say §dScarll Universe §7Únete a nuestra comunidad: https://discord.gg/XnJjTqyKDM");
  const add = useMutation({
    mutationFn: () =>
      api(`/api/instances/${i.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ name, cron, action, command }),
      }),
    onSuccess: () => {
      setName("");
      q.refetch();
    },
  });
  return (
    <>
      <Title title="Scheduler" sub="Persisted maintenance tasks" />
      <Card>
        <p className="scheduler-description">Schedule backups or in-game announcements. The Scarll Universe invite is ready to post once per hour.</p>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly backup"
            required
          />
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            aria-label="Cron schedule"
            required
          />
          <select value={action} onChange={(event) => { const next = event.target.value as "backup" | "command"; setAction(next); if (next === "command") { setName("Scarll Universe community reminder"); setCron("0 * * * *"); } else { setName(""); setCron("0 4 * * *"); } }} aria-label="Scheduled action"><option value="backup">Backup</option><option value="command">Chat announcement</option></select>
          {action === "command" && <input value={command} onChange={(event) => setCommand(event.target.value)} aria-label="Server announcement" maxLength={240} />}
          <Button type="submit">Add {action === "backup" ? "backup" : "announcement"} task</Button>
        </form>
        {q.data?.map((t) => (
          <div className="table-row" key={t.id}>
            <Zap />
            <div>
              <strong>{t.name}</strong>
              <small>
                {t.action} · {t.cron} · {t.enabled ? "Enabled" : "Disabled"}
              </small>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}

type WebhookTemplate = { id: string; name: string; mode: "message" | "embed"; content: string; title: string; description: string; color: string; imageData: string | null };
type CustomWebhookEvent = { id: string; name: string; trigger: string; enabled: boolean; template: WebhookTemplate };
type DiscordPageData = { enabled: boolean; events: string[]; templates: WebhookTemplate[]; customEvents: CustomWebhookEvent[]; webhookConfigured: boolean };
const discordEventOptions = [
  ["server.online", "Server becomes ready"], ["server.offline", "Server stops or crashes"],
  ["player.join", "A player joins"], ["player.leave", "A player leaves"], ["player.death", "A player dies"], ["backup.created", "A backup finishes"],
] as const;
const customEventOptions = [
  ["manual", "Manual announcement"], ["server.online", "Server becomes ready"], ["server.offline", "Server stops"],
  ["player.join", "A player joins"], ["player.leave", "A player leaves"], ["player.death", "A player dies"], ["backup.created", "A backup finishes"],
  ["backup.restored", "A backup is restored"], ["player.action", "A player moderation action occurs"],
  ["instance.killed", "Server is force stopped"], ["instance.restarted", "Server restarts"],
] as const;
function DiscordPage({ i }: { i: Instance }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["discord", i.id], queryFn: () => api<DiscordPageData>(`/api/instances/${i.id}/discord`) });
  const [draft, setDraft] = useState<DiscordPageData | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedId, setSelectedId] = useState("server-online");
  const [newName, setNewName] = useState("");
  const [newTrigger, setNewTrigger] = useState("manual");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (query.data) setDraft(query.data); }, [query.data]);
  const save = useMutation({
    mutationFn: () => api<DiscordPageData>(`/api/instances/${i.id}/discord`, { method: "PUT", body: JSON.stringify({ ...draft, webhookUrl: webhookUrl.trim() || undefined }) }),
    onSuccess: (data) => { setDraft(data); setWebhookUrl(""); setNotice("Discord settings saved."); setError(""); void queryClient.invalidateQueries({ queryKey: ["discord", i.id] }); },
    onError: (caught) => { setError((caught as Error).message); setNotice(""); },
  });
  const disconnect = useMutation({
    mutationFn: () => api(`/api/instances/${i.id}/discord/webhook`, { method: "DELETE" }),
    onSuccess: () => { setDraft((current) => current ? { ...current, enabled: false, webhookConfigured: false } : current); setNotice("Webhook disconnected."); setError(""); void queryClient.invalidateQueries({ queryKey: ["discord", i.id] }); },
    onError: (caught) => setError((caught as Error).message),
  });
  const test = useMutation({
    mutationFn: async () => { await save.mutateAsync(); return api(`/api/instances/${i.id}/discord/test`, { method: "POST", body: JSON.stringify({ templateId: selectedId }) }); },
    onSuccess: () => { setNotice("Preview sent to Discord."); setError(""); },
    onError: (caught) => { setError((caught as Error).message); setNotice(""); },
  });
  if (!draft) return <div className="center"><Spinner /></div>;
  const updateTemplate = (id: string, patch: Partial<WebhookTemplate>) => setDraft((current) => current && ({ ...current, templates: current.templates.map((template) => template.id === id ? { ...template, ...patch } : template), customEvents: current.customEvents.map((event) => event.id === id ? { ...event, name: patch.name ?? event.name, template: { ...event.template, ...patch } } : event) }));
  const addCustom = () => {
    if (!newName.trim()) return;
    const id = `custom-${Date.now().toString(36)}`;
    const template: WebhookTemplate = { id, name: newName.trim(), mode: "embed", content: "", title: newName.trim(), description: "{{server}} · {{address}}", color: "#0a84ff", imageData: null };
    setDraft((current) => current && ({ ...current, customEvents: [...current.customEvents, { id, name: newName.trim(), trigger: newTrigger, enabled: true, template }] }));
    setSelectedId(id); setNewName("");
  };
  const selected = draft.templates.find((template) => template.id === selectedId) ?? draft.customEvents.find((event) => event.id === selectedId)?.template ?? draft.templates[0];
  const updateSelected = (patch: Partial<WebhookTemplate>) => updateTemplate(selected.id, patch);
  return <>
    <Title title="Discord announcements" sub="Connect a webhook, design your messages, and choose what your community sees." actions={<Badge tone={draft.enabled && draft.webhookConfigured ? "online" : "neutral"}>{draft.enabled && draft.webhookConfigured ? "Connected · active" : draft.webhookConfigured ? "Connected · paused" : "Optional · not connected"}</Badge>} />
    <div className="discord-layout">
      <div className="discord-editor-column">
        <Card className="discord-connect-card">
          <div className="discord-heading"><span className="discord-icon"><BellRing /></span><div><h2>Webhook connection</h2><p>Use an incoming webhook URL from a Discord channel you control.</p></div></div>
          <label className="discord-field"><span>{draft.webhookConfigured ? "Replace webhook URL" : "Discord webhook URL"}</span><input type="password" autoComplete="new-password" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder={draft.webhookConfigured ? "Connected · enter a new URL to replace" : "https://discord.com/api/webhooks/…"} /></label>
          <div className="discord-connect-actions"><label className="toggle-line"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>Enable automatic announcements</span></label>{draft.webhookConfigured && <Button className="secondary" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Disconnect</Button>}</div>
          <small className="discord-security-note">The webhook URL is encrypted before it is stored and never shown again. Notifications are off until you enable them.</small>
        </Card>
        <Card className="discord-events-card"><div className="discord-section-title"><div><h2>Automatic events</h2><p>Pick which server activity should post to Discord.</p></div><span className="discord-count">{draft.events.length}/{discordEventOptions.length}</span></div>{discordEventOptions.map(([id, label]) => <label className="discord-event-row" key={id}><span><strong>{label}</strong><small>{id}</small></span><input type="checkbox" checked={draft.events.includes(id)} onChange={(event) => setDraft({ ...draft, events: event.target.checked ? [...draft.events, id] : draft.events.filter((value) => value !== id) })} /></label>)}</Card>
        <Card className="discord-custom-card"><div className="discord-section-title"><div><h2>Your custom events</h2><p>Build extra automatic rules or one-click announcements.</p></div><span className="discord-count">{draft.customEvents.length}/20</span></div><div className="discord-custom-create"><input aria-label="Announcement name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Weekend event" /><select aria-label="When it should send" value={newTrigger} onChange={(event) => setNewTrigger(event.target.value)}>{customEventOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><Button onClick={addCustom} disabled={!newName.trim() || draft.customEvents.length >= 20}><Plus /> Create</Button></div>{draft.customEvents.map((event) => <div className="discord-custom-row" key={event.id}><label><input type="checkbox" checked={event.enabled} onChange={(change) => setDraft({ ...draft, customEvents: draft.customEvents.map((item) => item.id === event.id ? { ...item, enabled: change.target.checked } : item) })} /><span><strong>{event.name}</strong><small>{customEventOptions.find(([id]) => id === event.trigger)?.[1] ?? event.trigger}</small></span></label><Button className="secondary discord-small-button" onClick={() => { setSelectedId(event.id); document.querySelector(".discord-builder")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Edit</Button><Button className="icon secondary discord-small-button" aria-label={`Delete ${event.name}`} onClick={() => { setDraft({ ...draft, customEvents: draft.customEvents.filter((item) => item.id !== event.id) }); if (selectedId === event.id) setSelectedId("server-online"); }}><Trash2 /></Button><Button className="secondary discord-small-button" onClick={() => api(`/api/instances/${i.id}/discord/announce/${event.id}`, { method: "POST", body: "{}" }).then(() => setNotice(`“${event.name}” sent.`)).catch((caught) => setError(caught.message))}><Send /></Button></div>)}</Card>
      </div>
      <div className="discord-editor-column">
        <Card className="discord-builder"><div className="discord-section-title"><div><h2>Message builder</h2><p>Five starter templates are ready to customize. Use <code>{"{{server}}"}</code>, <code>{"{{address}}"}</code>, <code>{"{{player}}"}</code>, <code>{"{{count}}"}</code> and <code>{"{{event}}"}</code>.</p></div></div><label className="discord-field"><span>Editing template</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{draft.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}{draft.customEvents.map((event) => <option key={event.id} value={event.id}>Custom · {event.name}</option>)}</select></label>
          <TemplateEditor template={selected} onChange={updateSelected} onError={setError} />
          <div className="discord-preview-wrap"><span className="discord-preview-label">LIVE PREVIEW</span><DiscordPreview template={selected} server={i.name} address={`${i.host}:${i.port}`} /></div>
          <div className="discord-save-actions"><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Spinner /> : <Server />}Save settings</Button><Button className="secondary" onClick={() => test.mutate()} disabled={(!draft.webhookConfigured && !webhookUrl.trim()) || save.isPending || test.isPending}>{test.isPending ? <Spinner /> : <Send />}Save & send preview</Button></div>
          {notice && <div className="discord-success">{notice}</div>}{error && <div className="error">{error}</div>}
        </Card>
      </div>
    </div>
  </>;
}

function TemplateEditor({ template, onChange, onError }: { template: WebhookTemplate; onChange: (patch: Partial<WebhookTemplate>) => void; onError: (message: string) => void }) {
  const imageInput = useRef<HTMLInputElement>(null);
  return <div className="discord-template-form"><label className="discord-field"><span>Template name</span><input value={template.name} maxLength={48} onChange={(event) => onChange({ name: event.target.value })} /></label><label className="discord-field"><span>Message format</span><select value={template.mode} onChange={(event) => onChange({ mode: event.target.value as WebhookTemplate["mode"] })}><option value="embed">Rich embed</option><option value="message">Plain message</option></select></label>{template.mode === "message" ? <label className="discord-field"><span>Message text</span><textarea rows={4} maxLength={2000} value={template.content} placeholder="Write your announcement…" onChange={(event) => onChange({ content: event.target.value })} /></label> : <><label className="discord-field"><span>Message above embed (optional)</span><textarea rows={2} maxLength={2000} value={template.content} placeholder="Short message…" onChange={(event) => onChange({ content: event.target.value })} /></label><label className="discord-field"><span>Embed title</span><input maxLength={256} value={template.title} onChange={(event) => onChange({ title: event.target.value })} /></label><label className="discord-field"><span>Embed description</span><textarea rows={4} maxLength={4000} value={template.description} onChange={(event) => onChange({ description: event.target.value })} /></label><label className="discord-field discord-color-field"><span>Embed color</span><input type="color" value={template.color} onChange={(event) => onChange({ color: event.target.value })} /></label></>}
    <input ref={imageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { onChange({ imageData: await optimizeWebhookImage(file) }); onError(""); } catch (caught) { onError((caught as Error).message); } finally { event.target.value = ""; } }} />
    <div className="discord-image-actions"><Button className="secondary" onClick={() => imageInput.current?.click()}><Plus />{template.imageData ? "Replace image" : "Add image"}</Button>{template.imageData && <Button className="secondary" onClick={() => onChange({ imageData: null })}><Trash2 />Remove image</Button>}<small>Image is attached directly to Discord · up to 4 MB</small></div>
  </div>;
}
function DiscordPreview({ template, server, address }: { template: WebhookTemplate; server: string; address: string }) {
  const fill = (value: string) => value.replace(/\{\{(server|address|player|count|event)\}\}/gi, (_match, key: string) => ({ server, address, player: "Alex", count: "3", event: template.name }[key.toLowerCase() as "server" | "address" | "player" | "count" | "event"] ?? ""));
  return <div className="discord-preview"><div className="discord-preview-avatar">S</div><div className="discord-preview-body"><div className="discord-preview-author">Salvadiux <span>BOT</span><time>Today at 12:00 PM</time></div>{template.mode === "message" ? <div className="discord-preview-content">{fill(template.content) || <i>Your announcement text appears here.</i>}{template.imageData && <img className="discord-preview-image" src={template.imageData} alt="Uploaded announcement" />}</div> : <>{template.content && <div className="discord-preview-content">{fill(template.content)}</div>}<div className="discord-preview-embed" style={{ borderLeftColor: template.color }}><strong>{fill(template.title) || "Embed title"}</strong><p>{fill(template.description) || "Your embed description appears here."}</p>{template.imageData && <img className="discord-preview-image" src={template.imageData} alt="Uploaded embed artwork" />}<small>{server} · {address}</small></div></>}</div></div>;
}
async function optimizeWebhookImage(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPG, or WebP image.");
  const image = new Image();
  const src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read image.")); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
  image.src = src;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Invalid image.")); });
  const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d"); if (!context) throw new Error("Image editor unavailable."); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.8, 0.65, 0.5]) {
    const optimized = canvas.toDataURL("image/jpeg", quality);
    if (optimized.length < 5_300_000) return optimized;
  }
  throw new Error("This image is too large after optimization. Choose a smaller image.");
}

function Diagnostics() {
  const q = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => api<any>("/api/diagnostics"),
  });
  return (
    <>
      <Title
        title="Diagnostics"
        sub="Local control plane and provider health"
      />
      <Card>
        {q.data &&
          Object.entries(q.data)
            .filter(([k]) => k !== "providers")
            .map(([k, v]) => (
              <Info
                key={k}
                label={k}
                value={typeof v === "object" ? JSON.stringify(v) : v}
              />
            ))}
      </Card>
      <Card>
        <h2>Providers</h2>
        {q.data?.providers.map((p: any) => (
          <div className="table-row" key={p.id}>
            <Globe2 />
            <div>
              <strong>{p.name}</strong>
              <small>{p.status}</small>
            </div>
            <Badge tone="online">Ready</Badge>
          </div>
        ))}
      </Card>
    </>
  );
}
function CreateServer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<any>({
    software: "paper",
    name: "New Server",
    minMemoryMb: 1024,
    maxMemoryMb: 4096,
    host: "0.0.0.0",
    port: 25565,
    eulaAccepted: false,
  });
  const versions = useQuery({
    queryKey: ["versions", form.software],
    queryFn: () => api<any[]>(`/api/software/${form.software}/versions`),
  });
  useEffect(() => {
    if (!versions.data?.[0]) return;
    setForm((current: any) => {
      if (current.software === "velocity") return { ...current, softwareVersion: current.softwareVersion ?? versions.data![0].id, minecraftVersion: current.minecraftVersion ?? "1.21.1" };
      return { ...current, minecraftVersion: current.minecraftVersion ?? versions.data![0].id };
    });
  }, [versions.data, form.software]);
  const serverRelease = form.software === "velocity" ? form.softwareVersion : form.minecraftVersion;
  const builds = useQuery({
    queryKey: ["builds", form.software, serverRelease],
    queryFn: () =>
      api<any[]>(
        `/api/software/${form.software}/versions/${serverRelease}/builds`,
      ),
    enabled: !!serverRelease,
  });
  useEffect(() => {
    if (builds.data?.[0])
      setForm((f: any) => ({
        ...f,
        build: builds.data!.find((x) => x.stable)?.id ?? builds.data![0].id,
      }));
  }, [builds.data]);
  const createMutation = useMutation({
    mutationFn: () =>
      api<Instance>("/api/instances", {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["instances"] });
      onClose();
    },
  });
  const steps = ["Software", form.software === "velocity" ? "Proxy version" : "Version", "Resources", "Network", "Review"];
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div>
            <span>CREATE SERVER</span>
            <h2>{steps[step]}</h2>
          </div>
          <Button className="icon secondary" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="stepper">
          {steps.map((s, n) => (
            <span className={n <= step ? "active" : ""} key={s}>
              {n + 1}
              <small>{s}</small>
            </span>
          ))}
        </div>
        <div className="modal-body">
          {step === 0 && (
            <div className="choice-grid">
              {["paper", "purpur", "vanilla", "velocity"].map((s) => (
                <button
                  className={form.software === s ? "choice selected" : "choice"}
                  onClick={() =>
                    setForm({
                      ...form,
                      software: s,
                      minecraftVersion: s === "velocity" ? "1.21.1" : undefined,
                      softwareVersion: undefined,
                      host: s === "velocity" ? "127.0.0.1" : "0.0.0.0",
                      port: s === "velocity" ? 25570 : 25565,
                      minMemoryMb: s === "velocity" ? 512 : 1024,
                      maxMemoryMb: s === "velocity" ? 2048 : 4096,
                      eulaAccepted: false,
                    })
                  }
                  key={s}
                >
                  <Server />
                  <strong>{s[0].toUpperCase() + s.slice(1)}</strong>
                  <small>
                    {s === "velocity"
                      ? "Secure network proxy with modern forwarding"
                      : s === "vanilla"
                      ? "Official Minecraft server"
                      : s === "paper"
                        ? "High-performance plugin server"
                        : "Paper-compatible, highly configurable"}
                  </small>
                </button>
              ))}
            </div>
          )}
          {step === 1 && (
            <label className="field">
              <span>{form.software === "velocity" ? "Velocity release" : "Minecraft version"}</span>
              <select
                value={(form.software === "velocity" ? form.softwareVersion : form.minecraftVersion) ?? ""}
                onChange={(e) => setForm(form.software === "velocity" ? { ...form, softwareVersion: e.target.value } : { ...form, minecraftVersion: e.target.value })}
              >
                {versions.data?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                    {v.javaMajor ? ` · Java ${v.javaMajor}` : ""}
                    {v.experimental ? " · experimental" : ""}
                  </option>
                ))}
              </select>
              {form.software === "velocity" && <span>Backend Minecraft line: Paper {form.minecraftVersion}</span>}
              <span>Build</span>
              <select
                value={form.build ?? ""}
                onChange={(e) => setForm({ ...form, build: e.target.value })}
              >
                {builds.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id}
                    {b.stable ? " · stable" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {step === 2 && (
            <div className="form-grid">
              <label>
                <span>Server name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                <span>Minimum RAM (MB)</span>
                <input
                  type="number"
                  value={form.minMemoryMb}
                  onChange={(e) =>
                    setForm({ ...form, minMemoryMb: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span>Maximum RAM (MB)</span>
                <input
                  type="number"
                  value={form.maxMemoryMb}
                  onChange={(e) =>
                    setForm({ ...form, maxMemoryMb: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          )}
          {step === 3 && (
            <div className="form-grid">
              <label>
                <span>Bind address</span>
                <input
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                />
              </label>
              <label>
                <span>Port</span>
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) =>
                    setForm({ ...form, port: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          )}
          {step === 4 && (
            <div className="review">
              <Info label="Name" value={form.name} />
              <Info
                label="Software"
                value={form.software === "velocity" ? `Velocity ${form.softwareVersion} build ${form.build} · Paper backends ${form.minecraftVersion}` : `${form.software} ${form.minecraftVersion} build ${form.build}`}
              />
              <Info
                label="Memory"
                value={`${form.minMemoryMb}–${form.maxMemoryMb} MB`}
              />
              <Info label="Address" value={`${form.host}:${form.port}`} />
              {form.software === "velocity" ? <div className="notice"><Network /><span>Velocity routes authenticated players to Paper backends. This proxy does not require Minecraft EULA acceptance.</span></div> : <label className="eula">
                <input
                  type="checkbox"
                  checked={form.eulaAccepted}
                  onChange={(e) =>
                    setForm({ ...form, eulaAccepted: e.target.checked })
                  }
                />
                <span>
                  I agree to the{" "}
                  <a href="https://aka.ms/MinecraftEULA" target="_blank">
                    Minecraft EULA
                  </a>
                  . Salvadiux will download Java and the server software.
                </span>
              </label>}
            </div>
          )}
          {createMutation.error && (
            <div className="error">{createMutation.error.message}</div>
          )}
        </div>
        <div className="modal-actions">
          <Button
            className="secondary"
            disabled={step === 0 || createMutation.isPending}
            onClick={() => setStep(step - 1)}
          >
            Back
          </Button>
          {step < 4 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={step === 1 && !serverRelease}
            >
              Continue
            </Button>
          ) : (
            <Button
              disabled={(form.software !== "velocity" && !form.eulaAccepted) || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? (
                <>
                  <Spinner />
                  Installing…
                </>
              ) : (
                <>Create & install</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
function Palette({
  onClose,
  instance,
}: {
  onClose: () => void;
  instance?: Instance;
}) {
  const ui = useUi();
  const [q, setQ] = useState("");
  const items = nav
    .flatMap(([, x]) => x)
    .filter((x) => x.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div>
          <Search />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages and actions…"
          />
          <kbd>Esc</kbd>
        </div>
        {items.map((x) => (
          <button
            key={x.id}
            onClick={() => {
              ui.setPage(x.id);
              onClose();
            }}
          >
            <x.icon />
            {x.label}
            <ChevronRight />
          </button>
        ))}
        {instance && "restart server".includes(q.toLowerCase()) && (
          <button
            onClick={() => {
              void api(`/api/instances/${instance.id}/restart`, {
                method: "POST",
                body: "{}",
              });
              onClose();
            }}
          >
            <RefreshCw />
            Restart server
            <ChevronRight />
          </button>
        )}
      </div>
    </div>
  );
}
