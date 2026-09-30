import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Download,
  Eye,
  ImagePlus,
  MonitorCog,
  PanelsTopLeft,
  RotateCcw,
  Sparkles,
  Upload,
  Trash2,
  BellRing,
  Volume2,
} from "lucide-react";
import { Button, Card } from "./components/ui";

type DashboardPreferences = {
  background: string | null;
  opacity: number;
  blur: number;
  dim: number;
  positionX: number;
  positionY: number;
  accent: string;
  density: "comfortable" | "compact";
  motion: boolean;
  scale: number;
  radius: number;
  theme: "nebula" | "ocean" | "emerald" | "ember" | "slate";
  font: "system" | "rounded" | "mono";
  sidebar: "standard" | "wide" | "compact";
  surfaces: "glass" | "solid";
  glow: boolean;
  highContrast: boolean;
  motionSpeed: "calm" | "normal" | "fast";
  contentWidth: number;
  soundEnabled: boolean;
  soundVolume: number;
  soundStyle: "soft" | "chime" | "arcade";
  soundEvents: string[];
  alertCpu: number;
  alertMemory: number;
  alertDisk: number;
  alertBackupHours: number;
  ambience: "stars" | "grid" | "off";
};

const STORAGE_KEY = "salvadiux-dashboard-preferences-v1";
const DEFAULT_PREFERENCES: DashboardPreferences = {
  background: null,
  opacity: 30,
  blur: 4,
  dim: 62,
  positionX: 50,
  positionY: 50,
  accent: "#a445ff",
  density: "comfortable",
  motion: true,
  scale: 100,
  radius: 16,
  theme: "nebula",
  font: "system",
  sidebar: "standard",
  surfaces: "glass",
  glow: true,
  highContrast: false,
  motionSpeed: "normal",
  contentWidth: 1540,
  soundEnabled: false,
  soundVolume: 35,
  soundStyle: "soft",
  soundEvents: ["*"],
  alertCpu: 90,
  alertMemory: 85,
  alertDisk: 10,
  alertBackupHours: 24,
  ambience: "stars",
};

const SOUND_CATEGORIES = [
  ["server", "Server status"], ["players", "Player activity"], ["backups", "Backups"],
  ["worlds", "World changes"], ["plugins", "Plugins"], ["files", "Files and settings"],
  ["network", "Network and announcements"],
] as const;

export function soundCategoryForEvent(type: string) {
  if (type.startsWith("player.")) return "players";
  if (type.startsWith("backup.")) return "backups";
  if (type.startsWith("world.")) return "worlds";
  if (type.startsWith("plugin.")) return "plugins";
  if (type.startsWith("file.") || type.startsWith("configuration.")) return "files";
  if (type.startsWith("network.") || type.startsWith("announcement.")) return "network";
  return "server";
}

let audioContext: AudioContext | undefined;
export function unlockDashboardAudio() {
  if (typeof window === "undefined") return;
  try { audioContext ??= new AudioContext(); if (audioContext.state === "suspended") void audioContext.resume(); } catch { /* Audio is optional and may be unavailable in restricted browsers. */ }
}
export function playDashboardSound(style: DashboardPreferences["soundStyle"], volume: number) {
  if (volume <= 0 || typeof window === "undefined") return;
  try {
    audioContext ??= new AudioContext();
    const context = audioContext;
    void context.resume().then(() => {
      const pattern = style === "arcade" ? [440, 660, 880] : style === "chime" ? [660, 880] : [520, 660];
      const now = context.currentTime;
      pattern.forEach((frequency, index) => {
        const start = now + index * (style === "arcade" ? .085 : .12);
        const duration = style === "arcade" ? .075 : .16;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = style === "arcade" ? "square" : style === "chime" ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(.001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(.002, volume / 100 * .12), start + .018);
        gain.gain.exponentialRampToValueAtTime(.001, start + duration);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(start); oscillator.stop(start + duration + .02);
      });
    }).catch(() => {});
  } catch { /* Audio is optional and may be unavailable in restricted browsers. */ }
}

const THEME_COLORS = {
  nebula: { bg: "#0a0914", sidebar: "rgba(13,11,22,.96)", surface: "rgba(19,16,30,.94)", surfaceRaised: "rgba(29,23,44,.94)", border: "rgba(192,151,255,.15)", muted: "#aaa0bd", accent: "#a445ff" },
  ocean: { bg: "#071019", sidebar: "rgba(7,15,24,.97)", surface: "rgba(10,23,34,.95)", surfaceRaised: "rgba(15,34,49,.95)", border: "rgba(91,190,255,.17)", muted: "#9bb8ca", accent: "#39b7ff" },
  emerald: { bg: "#08120f", sidebar: "rgba(8,18,15,.97)", surface: "rgba(13,27,22,.95)", surfaceRaised: "rgba(19,39,31,.95)", border: "rgba(91,220,165,.16)", muted: "#a0bdad", accent: "#43d69a" },
  ember: { bg: "#140c0c", sidebar: "rgba(20,12,12,.97)", surface: "rgba(31,18,18,.95)", surfaceRaised: "rgba(47,26,25,.95)", border: "rgba(255,151,112,.16)", muted: "#c0a6a0", accent: "#ff835f" },
  slate: { bg: "#0c1016", sidebar: "rgba(13,17,24,.97)", surface: "rgba(20,25,34,.95)", surfaceRaised: "rgba(30,37,48,.95)", border: "rgba(164,187,220,.16)", muted: "#a4adbd", accent: "#8baeff" },
} as const;

export function loadDashboardPreferences(): DashboardPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      ...DEFAULT_PREFERENCES,
      ...stored,
      background: typeof stored.background === "string" && /^data:image\/(?:jpeg|png|webp);base64,/i.test(stored.background) ? stored.background : null,
      opacity: clampNumber(stored.opacity, 8, 65, DEFAULT_PREFERENCES.opacity),
      blur: clampNumber(stored.blur, 0, 20, DEFAULT_PREFERENCES.blur),
      dim: clampNumber(stored.dim, 20, 85, DEFAULT_PREFERENCES.dim),
      positionX: clampNumber(stored.positionX, 0, 100, DEFAULT_PREFERENCES.positionX),
      positionY: clampNumber(stored.positionY, 0, 100, DEFAULT_PREFERENCES.positionY),
      accent: /^#[0-9a-f]{6}$/i.test(stored.accent ?? "") ? stored.accent : DEFAULT_PREFERENCES.accent,
      density: stored.density === "compact" ? "compact" : "comfortable",
      motion: stored.motion !== false,
      scale: clampNumber(stored.scale, 90, 115, DEFAULT_PREFERENCES.scale),
      radius: clampNumber(stored.radius, 8, 24, DEFAULT_PREFERENCES.radius),
      theme: Object.hasOwn(THEME_COLORS, stored.theme) ? stored.theme : DEFAULT_PREFERENCES.theme,
      font: ["system", "rounded", "mono"].includes(stored.font) ? stored.font : DEFAULT_PREFERENCES.font,
      sidebar: ["standard", "wide", "compact"].includes(stored.sidebar) ? stored.sidebar : DEFAULT_PREFERENCES.sidebar,
      surfaces: stored.surfaces === "solid" ? "solid" : "glass",
      glow: stored.glow !== false,
      highContrast: stored.highContrast === true,
      motionSpeed: ["calm", "normal", "fast"].includes(stored.motionSpeed) ? stored.motionSpeed : "normal",
      contentWidth: clampNumber(stored.contentWidth, 1100, 2200, DEFAULT_PREFERENCES.contentWidth),
      soundEnabled: stored.soundEnabled === true,
      soundVolume: clampNumber(stored.soundVolume, 0, 100, DEFAULT_PREFERENCES.soundVolume),
      soundStyle: ["soft", "chime", "arcade"].includes(stored.soundStyle) ? stored.soundStyle : DEFAULT_PREFERENCES.soundStyle,
      soundEvents: Array.isArray(stored.soundEvents) ? stored.soundEvents.filter((item: unknown) => typeof item === "string" && (item === "*" || SOUND_CATEGORIES.some(([id]) => id === item))) : DEFAULT_PREFERENCES.soundEvents,
      alertCpu: clampNumber(stored.alertCpu, 50, 100, DEFAULT_PREFERENCES.alertCpu),
      alertMemory: clampNumber(stored.alertMemory, 50, 100, DEFAULT_PREFERENCES.alertMemory),
      alertDisk: clampNumber(stored.alertDisk, 2, 40, DEFAULT_PREFERENCES.alertDisk),
      alertBackupHours: clampNumber(stored.alertBackupHours, 6, 168, DEFAULT_PREFERENCES.alertBackupHours),
      ambience: ["stars", "grid", "off"].includes(stored.ambience) ? stored.ambience : DEFAULT_PREFERENCES.ambience,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function applyDashboardPreferences(settings: DashboardPreferences) {
  const root = document.documentElement;
  const palette = THEME_COLORS[settings.theme] ?? THEME_COLORS.nebula;
  root.style.setProperty(
    "--dashboard-wallpaper",
    settings.background ? `url("${settings.background}")` : "none",
  );
  root.style.setProperty("--wallpaper-opacity", String(settings.opacity / 100));
  root.style.setProperty("--wallpaper-blur", `${settings.blur}px`);
  root.style.setProperty("--wallpaper-dim", String(settings.dim / 100));
  root.style.setProperty("--wallpaper-x", `${settings.positionX}%`);
  root.style.setProperty("--wallpaper-y", `${settings.positionY}%`);
  root.style.setProperty("--accent", settings.accent);
  root.style.setProperty("--bg", palette.bg);
  root.style.setProperty("--sidebar", palette.sidebar);
  root.style.setProperty("--s1", palette.surface);
  root.style.setProperty("--s2", palette.surfaceRaised);
  root.style.setProperty("--s3", palette.surfaceRaised);
  root.style.setProperty("--border", settings.highContrast ? "rgba(255,255,255,.28)" : palette.border);
  root.style.setProperty("--muted", settings.highContrast ? "#d2d5df" : palette.muted);
  root.style.setProperty("--ui-scale", String(settings.scale / 100));
  root.style.setProperty("--card-radius", `${settings.radius}px`);
  root.style.setProperty("--content-max-width", `${settings.contentWidth}px`);
  root.style.fontFamily = settings.font === "rounded" ? '"Trebuchet MS", "Segoe UI", sans-serif' : settings.font === "mono" ? '"Cascadia Code", Consolas, monospace' : 'Inter, "Segoe UI", system-ui, sans-serif';
  root.dataset.uiTheme = settings.theme;
  root.dataset.uiSidebar = settings.sidebar;
  root.dataset.uiSurfaces = settings.surfaces;
  root.dataset.uiGlow = settings.glow ? "on" : "off";
  root.dataset.uiContrast = settings.highContrast ? "high" : "normal";
  root.dataset.uiMotionSpeed = settings.motionSpeed;
  root.dataset.uiDensity = settings.density;
  root.dataset.uiMotion = settings.motion ? "on" : "off";
  root.dataset.customWallpaper = settings.background ? "true" : "false";
  root.dataset.uiAmbience = settings.ambience;
}

function optimizeBackground(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choose a PNG, JPG, WebP, or another image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () =>
        reject(new Error("The selected image is not valid."));
      image.onload = () => {
        const limit = 2560;
        const scale = Math.min(1, limit / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("The browser could not process this image."));
          return;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.84));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="preference-slider">
      <span>
        <strong>{label}</strong>
        <output>
          {value}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function DashboardPreferencesPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const settingsInput = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState(loadDashboardPreferences);
  const [error, setError] = useState("");

  useEffect(() => {
    applyDashboardPreferences(settings);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setError("");
    } catch {
      setError(
        "This image is too large for browser storage. Choose a smaller image.",
      );
    }
  }, [settings]);

  const update = (values: Partial<DashboardPreferences>) =>
    setSettings((current) => ({ ...current, ...values }));
  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "salvadiux-preferences.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <div className="page-title preferences-title">
        <div>
          <span className="appearance-eyebrow">DASHBOARD</span>
          <h1>Make it yours</h1>
          <p>Shape the colors, layout and feel of your Salvadiux control room.</p>
        </div>
        <div className="preferences-title-actions"><Button className="secondary" onClick={() => settingsInput.current?.click()}><Upload />Import setup</Button><Button className="secondary" onClick={exportSettings}><Download />Export setup</Button><Button className="secondary" onClick={() => setSettings(DEFAULT_PREFERENCES)}><RotateCcw />Restore defaults</Button><input ref={settingsInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const parsed = JSON.parse(await file.text()); localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); setSettings(loadDashboardPreferences()); setError(""); } catch { setError("That preferences file could not be imported."); } finally { event.target.value = ""; } }} /></div>
      </div>

      <div className="preferences-layout">
        <Card className="preferences-card theme-card">
          <div className="preference-card-heading"><span><Sparkles /></span><div><h2>Color mood</h2><p>Switch the full dashboard palette, then fine-tune the highlight color.</p></div></div>
          <div className="theme-options">{([ ["nebula", "Nebula", "#a445ff", "#181127"], ["ocean", "Deep ocean", "#39b7ff", "#0b1b29"], ["emerald", "Emerald", "#43d69a", "#10251e"], ["ember", "Ember", "#ff835f", "#2b1715"], ["slate", "Moonstone", "#8baeff", "#1c2533"] ] as const).map(([id, label, color, backdrop]) => <button key={id} type="button" className={`theme-option${settings.theme === id ? " selected" : ""}`} aria-pressed={settings.theme === id} onClick={() => update({ theme: id, accent: color })}><span className="theme-preview" style={{ background: `linear-gradient(135deg, ${backdrop}, #0a0a10)` }}><i style={{ background: color }} /><i /><i /></span><strong>{label}</strong><small>{settings.theme === id ? "Selected" : "Apply palette"}</small></button>)}</div>
          <div className="preference-extra"><div><strong>Accent color</strong><span>Used by active navigation, buttons, charts and focus rings.</span></div><div className="accent-swatches">{[["Violet", "#a445ff"], ["Blue", "#39b7ff"], ["Mint", "#43d69a"], ["Coral", "#ff835f"], ["Gold", "#ffc15e"], ["Pink", "#ff72ca"]].map(([name, color]) => <button key={color} type="button" title={`${name} accent`} aria-label={`${name} accent`} aria-pressed={settings.accent === color} className="accent-swatch" style={{ "--swatch": color } as CSSProperties} onClick={() => update({ accent: color })} />)}<input className="custom-accent" type="color" aria-label="Custom accent color" value={settings.accent} onChange={(event) => update({ accent: event.target.value })} /></div></div>
          <div className="preference-extra"><div><strong>Typography</strong><span>Change the typeface throughout the dashboard.</span></div><select value={settings.font} onChange={(event) => update({ font: event.target.value as DashboardPreferences["font"] })}><option value="system">System · clean</option><option value="rounded">Rounded · friendly</option><option value="mono">Monospace · terminal</option></select></div>
          <div className="preference-live-preview"><span>LIVE PREVIEW</span><div><strong>Scarll Universe</strong><small>Dashboard color, type and selected state</small></div><Button>Launch server</Button></div>
        </Card>

        <Card className="preferences-card wallpaper-card">
          <div className="preference-card-heading">
            <span>
              <ImagePlus />
            </span>
            <div>
              <h2>Personal background</h2>
              <p>Stored only in this browser and optimized before saving.</p>
            </div>
          </div>

          <div
            className={`wallpaper-preview${settings.background ? " has-image" : ""}`}
            style={
              settings.background
                ? {
                    backgroundImage: `linear-gradient(rgba(0,0,0,${settings.dim / 100}), rgba(0,0,0,${settings.dim / 100})), url("${settings.background}")`,
                    backgroundPosition: `${settings.positionX}% ${settings.positionY}%`,
                  }
                : undefined
            }
          >
            {!settings.background && (
              <div>
                <Sparkles />
                <strong>Your background will appear here</strong>
                <span>The dark treatment keeps controls readable.</span>
              </div>
            )}
            <div className="wallpaper-preview-window">
              <i />
              <i />
              <i />
              <span />
            </div>
          </div>

          <div className="wallpaper-actions">
            <Button onClick={() => fileInput.current?.click()}>
              <ImagePlus />
              {settings.background ? "Replace image" : "Choose image"}
            </Button>
            {settings.background && (
              <Button
                className="secondary"
                onClick={() => update({ background: null })}
              >
                <Trash2 />
                Remove
              </Button>
            )}
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept="image/*"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  update({ background: await optimizeBackground(file) });
                } catch (caught) {
                  setError((caught as Error).message);
                } finally {
                  event.target.value = "";
                }
              }}
            />
          </div>
          {error && <div className="error">{error}</div>}
        </Card>

        <Card className="preferences-card treatment-card">
          <div className="preference-card-heading">
            <span>
              <MonitorCog />
            </span>
            <div>
              <h2>Visual treatment</h2>
              <p>Changes apply immediately across the entire dashboard.</p>
            </div>
          </div>

          <div className="preference-controls">
            <Slider
              label="Image intensity"
              value={settings.opacity}
              min={8}
              max={65}
              suffix="%"
              onChange={(opacity) => update({ opacity })}
            />
            <Slider
              label="Dark overlay"
              value={settings.dim}
              min={20}
              max={85}
              suffix="%"
              onChange={(dim) => update({ dim })}
            />
            <Slider
              label="Background blur"
              value={settings.blur}
              min={0}
              max={20}
              suffix="px"
              onChange={(blur) => update({ blur })}
            />
            <Slider
              label="Horizontal focus"
              value={settings.positionX}
              min={0}
              max={100}
              suffix="%"
              onChange={(positionX) => update({ positionX })}
            />
            <Slider
              label="Vertical focus"
              value={settings.positionY}
              min={0}
              max={100}
              suffix="%"
              onChange={(positionY) => update({ positionY })}
            />
            <div className="preference-extra"><div><strong>Interface density</strong><span>Choose how much fits on screen.</span></div><select value={settings.density} onChange={(event) => update({ density: event.target.value as DashboardPreferences["density"] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
            <Slider label="Text size" value={settings.scale} min={90} max={115} suffix="%" onChange={(scale) => update({ scale })} />
            <Slider label="Card corners" value={settings.radius} min={8} max={24} suffix="px" onChange={(radius) => update({ radius })} />
            <div className="preference-extra"><div><strong>Content width</strong><span>Set the maximum width of the main work area.</span></div><output>{settings.contentWidth}px</output></div><Slider label="Workspace width" value={settings.contentWidth} min={1100} max={2200} suffix="px" onChange={(contentWidth) => update({ contentWidth })} />
          </div>
        </Card>

        <Card className="preferences-card controls-card">
          <div className="preference-card-heading"><span><PanelsTopLeft /></span><div><h2>Workspace & navigation</h2><p>Control the shape of the dashboard and how much space it uses.</p></div></div>
          <div className="preference-controls">
            <div className="preference-extra"><div><strong>Sidebar style</strong><span>Switch between full labels, extra room or icon rail.</span></div><select value={settings.sidebar} onChange={(event) => update({ sidebar: event.target.value as DashboardPreferences["sidebar"] })}><option value="standard">Standard</option><option value="wide">Wide</option><option value="compact">Compact icon rail</option></select></div>
            <div className="preference-extra"><div><strong>Panel treatment</strong><span>Glass shows more wallpaper; solid is more opaque.</span></div><select value={settings.surfaces} onChange={(event) => update({ surfaces: event.target.value as DashboardPreferences["surfaces"] })}><option value="glass">Glass</option><option value="solid">Solid</option></select></div>
            <div className="preference-extra"><div><strong>Ambient backdrop</strong><span>Add a very subtle starfield or grid behind the dashboard.</span></div><select value={settings.ambience} onChange={(event) => update({ ambience: event.target.value as DashboardPreferences["ambience"] })}><option value="stars">Soft starfield</option><option value="grid">Quiet grid</option><option value="off">None</option></select></div>
            <label className="motion-toggle"><span><strong>High contrast</strong><small>Brighten supporting text and panel borders.</small></span><input type="checkbox" checked={settings.highContrast} onChange={(event) => update({ highContrast: event.target.checked })} /></label>
            <label className="motion-toggle"><span><strong>Ambient glow</strong><small>Colored light around cards and the server hero.</small></span><input type="checkbox" checked={settings.glow} onChange={(event) => update({ glow: event.target.checked })} /></label>
            <label className="motion-toggle"><span><strong>Interface motion</strong><small>Enable slide transitions and hover movement.</small></span><input type="checkbox" checked={settings.motion} onChange={(event) => update({ motion: event.target.checked })} /></label>
            <div className="preference-extra"><div><strong>Motion speed</strong><span>Set the tempo of transitions.</span></div><select disabled={!settings.motion} value={settings.motionSpeed} onChange={(event) => update({ motionSpeed: event.target.value as DashboardPreferences["motionSpeed"] })}><option value="calm">Calm</option><option value="normal">Normal</option><option value="fast">Fast</option></select></div>
            <div className="preference-hint"><Eye /><span>These choices apply immediately, stay in this browser and can be exported to another device.</span></div>
          </div>
        </Card>

        <Card className="preferences-card sound-alerts-card">
          <div className="preference-card-heading"><span><BellRing /></span><div><h2>Sound alerts & health thresholds</h2><p>Choose what gets a quiet audio cue and when the dashboard should flag resource pressure.</p></div></div>
          <div className="preference-controls">
            <label className="motion-toggle"><span><strong>Play sounds for new activity</strong><small>Alerts are generated in this browser and stay muted until enabled.</small></span><input type="checkbox" checked={settings.soundEnabled} onChange={(event) => update({ soundEnabled: event.target.checked })} /></label>
            <div className="preference-extra"><div><strong>Sound style</strong><span>Soft, bright, or game-like.</span></div><select disabled={!settings.soundEnabled} value={settings.soundStyle} onChange={(event) => update({ soundStyle: event.target.value as DashboardPreferences["soundStyle"] })}><option value="soft">Soft pulse</option><option value="chime">Glass chime</option><option value="arcade">Pixel cue</option></select></div>
            <Slider label="Alert volume" value={settings.soundVolume} min={0} max={100} suffix="%" onChange={(soundVolume) => update({ soundVolume })} />
            <Button className="secondary sound-test" disabled={!settings.soundEnabled || settings.soundVolume === 0} onClick={() => playDashboardSound(settings.soundStyle, settings.soundVolume)}><Volume2 />Test sound</Button>
            <div className="sound-category-grid"><label className="sound-category-row"><span><strong>All activity</strong><small>Play for every new server activity event.</small></span><input type="checkbox" checked={settings.soundEvents.includes("*")} onChange={(event) => update({ soundEvents: event.target.checked ? ["*"] : [] })} /></label>{SOUND_CATEGORIES.map(([id, label]) => <label className="sound-category-row" key={id}><span><strong>{label}</strong><small>{id === "files" ? "Includes configuration changes" : `Events from ${label.toLowerCase()}`}</small></span><input type="checkbox" checked={settings.soundEvents.includes("*") || settings.soundEvents.includes(id)} onChange={(event) => update({ soundEvents: event.target.checked ? [...settings.soundEvents.filter((value) => value !== "*"), id] : settings.soundEvents.filter((value) => value !== id && value !== "*") })} /></label>)}</div>
            <div className="threshold-heading"><span>HEALTH ALERTS</span><small>Applied to the overview alert center.</small></div>
            <Slider label="Host CPU warning" value={settings.alertCpu} min={50} max={100} suffix="%" onChange={(alertCpu) => update({ alertCpu })} />
            <Slider label="Memory warning" value={settings.alertMemory} min={50} max={100} suffix="%" onChange={(alertMemory) => update({ alertMemory })} />
            <Slider label="Low disk space warning" value={settings.alertDisk} min={2} max={40} suffix="% free" onChange={(alertDisk) => update({ alertDisk })} />
            <Slider label="Backup is considered stale after" value={settings.alertBackupHours} min={6} max={168} suffix=" hours" onChange={(alertBackupHours) => update({ alertBackupHours })} />
          </div>
        </Card>
      </div>
    </>
  );
}
