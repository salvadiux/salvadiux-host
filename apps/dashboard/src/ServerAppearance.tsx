import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bold,
  Eye,
  ImageIcon,
  Italic,
  RotateCcw,
  Save,
  Strikethrough,
  Underline,
  Upload,
} from "lucide-react";
import { api, type Instance } from "./lib";
import { Button, Card, Spinner } from "./components/ui";

type Appearance = {
  name: string;
  description: string;
  motd: string;
  icon: string | null;
  maxPlayers: number;
  address: string;
  software?: string;
};

const COLORS = [
  ["0", "Black", "#000000"],
  ["1", "Dark blue", "#0000aa"],
  ["2", "Dark green", "#00aa00"],
  ["3", "Dark aqua", "#00aaaa"],
  ["4", "Dark red", "#aa0000"],
  ["5", "Dark purple", "#aa00aa"],
  ["6", "Gold", "#ffaa00"],
  ["7", "Gray", "#aaaaaa"],
  ["8", "Dark gray", "#555555"],
  ["9", "Blue", "#5555ff"],
  ["a", "Green", "#55ff55"],
  ["b", "Aqua", "#55ffff"],
  ["c", "Red", "#ff5555"],
  ["d", "Light purple", "#ff55ff"],
  ["e", "Yellow", "#ffff55"],
  ["f", "White", "#ffffff"],
] as const;

const SYMBOLS = ["★", "✦", "♥", "⚔", "☠", "⛏", "◆", "●", "➜", "✔", "✘", "⚡"];

type MotdStyle = {
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  obfuscated: boolean;
};

const defaultMotdStyle = (): MotdStyle => ({
  color: "#aaaaaa",
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  obfuscated: false,
});

function renderMotd(value: string) {
  const parts: { text: string; style: MotdStyle }[] = [];
  let style = defaultMotdStyle();
  let text = "";
  const flush = () => {
    if (text) parts.push({ text, style: { ...style } });
    text = "";
  };
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "<") {
      const end = value.indexOf(">", index + 1);
      if (end !== -1) {
        const tag = value.slice(index + 1, end).toLowerCase();
        const closing = tag.startsWith("/");
        const name = closing ? tag.slice(1) : tag;
        const namedColors: Record<string, string> = { black: "#000000", dark_blue: "#0000aa", dark_green: "#00aa00", dark_aqua: "#00aaaa", dark_red: "#aa0000", dark_purple: "#aa00aa", gold: "#ffaa00", gray: "#aaaaaa", dark_gray: "#555555", blue: "#5555ff", green: "#55ff55", aqua: "#55ffff", red: "#ff5555", light_purple: "#ff55ff", yellow: "#ffff55", white: "#ffffff" };
        const color = /^#[0-9a-f]{6}$/i.test(name) ? name : namedColors[name];
        if (color || ["bold", "italic", "underlined", "strikethrough", "obfuscated", "reset"].includes(name)) {
          flush();
          if (name === "reset") style = defaultMotdStyle();
          else if (color) style = closing ? defaultMotdStyle() : { ...defaultMotdStyle(), color };
          else if (name === "bold") style.bold = !closing;
          else if (name === "italic") style.italic = !closing;
          else if (name === "underlined") style.underline = !closing;
          else if (name === "strikethrough") style.strike = !closing;
          else if (name === "obfuscated") style.obfuscated = !closing;
          index = end;
          continue;
        }
      }
    }
    if (value[index] === "§" && value[index + 1]) {
      flush();
      const code = value[++index].toLowerCase();
      const color = COLORS.find(([candidate]) => candidate === code)?.[2];
      if (color) style = { ...defaultMotdStyle(), color };
      else if (code === "l") style.bold = true;
      else if (code === "o") style.italic = true;
      else if (code === "n") style.underline = true;
      else if (code === "m") style.strike = true;
      else if (code === "k") style.obfuscated = true;
      else if (code === "r") style = defaultMotdStyle();
      continue;
    }
    text += value[index];
  }
  flush();
  return parts.map((part, index) => (
    <span
      className={part.style.obfuscated ? "motd-obfuscated" : undefined}
      key={`${index}:${part.text}`}
      style={{
        color: part.style.color,
        fontWeight: part.style.bold ? 800 : 500,
        fontStyle: part.style.italic ? "italic" : undefined,
        textDecoration: [
          part.style.underline ? "underline" : "",
          part.style.strike ? "line-through" : "",
        ]
          .filter(Boolean)
          .join(" "),
      }}
    >
      {part.text}
    </span>
  ));
}

function MiniMessageEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const insert = (tag: string) => {
    const target = textarea.current;
    if (!target) return;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    onChange(value.slice(0, start) + tag + value.slice(end));
    requestAnimationFrame(() => { target.focus(); target.setSelectionRange(start + tag.length, start + tag.length); });
  };
  return <div className="motd-editor minimessage-editor">
    <div className="motd-toolbar"><div className="format-buttons">
      {["<#8b5cf6>", "</#8b5cf6>", "<bold>", "</bold>", "<italic>", "</italic>", "<reset>"].map((tag) => <button type="button" className="format-button minimessage-tag" key={tag} onClick={() => insert(tag)}>{tag}</button>)}
    </div></div>
    <textarea ref={textarea} value={value} rows={4} spellCheck={false} placeholder="<#8b5cf6>Scarll Universe</#8b5cf6>" onChange={(event) => onChange(event.target.value)} />
    <div className="symbol-strip"><span>Velocity MiniMessage · tags are supported by the proxy</span><div>{SYMBOLS.map((symbol) => <button type="button" key={symbol} onClick={() => insert(symbol)}>{symbol}</button>)}</div></div>
  </div>;
}

function IconEditor({
  initial,
  onChange,
}: {
  initial: string | null;
  onChange: (value: string | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [source, setSource] = useState<string | null>(initial);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setSource(initial);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [initial]);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const context = target.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, target.width, target.height);
    context.fillStyle = "#121a24";
    context.fillRect(0, 0, target.width, target.height);
    if (!source) {
      onChange(null);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const scale =
        Math.max(target.width / image.width, target.height / image.height) *
        zoom;
      const width = image.width * scale;
      const height = image.height * scale;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        (target.width - width) / 2 + offset.x,
        (target.height - height) / 2 + offset.y,
        width,
        height,
      );
      const output = document.createElement("canvas");
      output.width = 64;
      output.height = 64;
      output.getContext("2d")?.drawImage(target, 0, 0, 64, 64);
      onChange(output.toDataURL("image/png"));
    };
    image.src = source;
  }, [source, zoom, offset, onChange]);

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div className="icon-editor">
      <div className="icon-canvas-wrap">
        <canvas
          ref={canvas}
          width={320}
          height={320}
          aria-label="Server icon crop preview"
          onPointerDown={(event) => {
            drag.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = event.currentTarget.width / rect.width;
            const next = {
              x: offset.x + (event.clientX - drag.current.x) * ratio,
              y: offset.y + (event.clientY - drag.current.y) * ratio,
            };
            drag.current = { x: event.clientX, y: event.clientY };
            setOffset(next);
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        />
        {!source && (
          <div className="icon-empty">
            <ImageIcon />
            <strong>Add an image</strong>
            <span>PNG, JPG or WebP</span>
          </div>
        )}
        <div className="crop-frame" aria-hidden="true" />
      </div>
      <div className="icon-controls">
        <label className="button secondary upload-button">
          <Upload />
          Choose image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                setSource(String(reader.result));
                reset();
              };
              reader.readAsDataURL(file);
            }}
          />
        </label>
        <button
          className="icon-tool"
          type="button"
          title="Reset crop"
          aria-label="Reset crop"
          onClick={reset}
          disabled={!source}
        >
          <RotateCcw />
        </button>
      </div>
      <label className="zoom-control">
        <span>Zoom</span>
        <input
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          disabled={!source}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
        <output>{Math.round(zoom * 100)}%</output>
      </label>
      <p>
        Drag the image to reposition it. Salvadiux exports the required 64×64
        PNG.
      </p>
    </div>
  );
}

function MotdEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const insert = (prefix: string, wrap = false) => {
    const target = textarea.current;
    if (!target) return;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const selected = value.slice(start, end);
    const suffix = wrap && selected ? "§r" : "";
    const next =
      value.slice(0, start) + prefix + selected + suffix + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      target.focus();
      const cursor = start + prefix.length + selected.length;
      target.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="motd-editor">
      <div className="motd-toolbar" aria-label="Text formatting tools">
        <div className="format-buttons">
          {[
            ["§l", "Bold", Bold],
            ["§o", "Italic", Italic],
            ["§n", "Underline", Underline],
            ["§m", "Strikethrough", Strikethrough],
          ].map(([code, label, Icon]) => (
            <button
              type="button"
              className="format-button"
              title={String(label)}
              aria-label={String(label)}
              key={String(code)}
              onClick={() => insert(String(code), true)}
            >
              <Icon />
            </button>
          ))}
          <button
            type="button"
            className="format-button obfuscate-button"
            title="Obfuscated"
            aria-label="Obfuscated text"
            onClick={() => insert("§k", true)}
          >
            AB
          </button>
          <button
            type="button"
            className="format-button reset-button"
            title="Reset formatting"
            onClick={() => insert("§r")}
          >
            Reset
          </button>
        </div>
        <div className="color-row" aria-label="Minecraft text colors">
          {COLORS.map(([code, label, color]) => (
            <button
              type="button"
              className="color-swatch"
              style={{ backgroundColor: color }}
              title={label}
              aria-label={label}
              key={code}
              onClick={() => insert(`§${code}`)}
            />
          ))}
        </div>
      </div>
      <textarea
        ref={textarea}
        value={value}
        rows={4}
        spellCheck={false}
        placeholder="A Minecraft Server"
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="symbol-strip">
        <span>Minecraft-friendly symbols</span>
        <div>
          {SYMBOLS.map((symbol) => (
            <button type="button" key={symbol} onClick={() => insert(symbol)}>
              {symbol}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ServerPreview({
  name,
  motd,
  icon,
  maxPlayers,
}: {
  name: string;
  motd: string;
  icon: string | null;
  maxPlayers: number;
}) {
  return (
    <div className="preview-stage">
      <div className="preview-label">
        <Eye />
        Minecraft server list preview
      </div>
      <div className="minecraft-server-row">
        <div className="minecraft-icon">
          {icon ? (
            <img src={icon} alt="" />
          ) : (
            <span>{name.trim()[0] || "S"}</span>
          )}
        </div>
        <div className="minecraft-copy">
          <strong>{name || "My Minecraft Server"}</strong>
          <div className="minecraft-motd">
            {renderMotd(motd || "A Minecraft Server")}
          </div>
        </div>
        <div className="minecraft-status">
          <span>0/{maxPlayers}</span>
          <i aria-label="Server connection available">
            <b />
            <b />
            <b />
            <b />
          </i>
        </div>
      </div>
      <p>
        Players choose the first-line server name in their own client. The icon
        and formatted description are supplied by this server.
      </p>
    </div>
  );
}

export function ServerAppearance({ instance }: { instance: Instance }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["appearance", instance.id],
    queryFn: () => api<Appearance>(`/api/instances/${instance.id}/appearance`),
  });
  const [name, setName] = useState(instance.name);
  const [motd, setMotd] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!query.data || loaded) return;
    setName(query.data.name);
    setMotd(query.data.motd);
    setIcon(query.data.icon);
    setLoaded(true);
  }, [query.data, loaded]);

  useEffect(() => setLoaded(false), [instance.id]);

  const save = useMutation({
    mutationFn: () =>
      api(`/api/instances/${instance.id}/appearance`, {
        method: "PUT",
        body: JSON.stringify({ name, motd, icon }),
      }),
    onSuccess: async () => {
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({ queryKey: ["config", instance.id] }),
      ]);
    },
  });

  if (query.isLoading || !query.data) return <Spinner />;

  return (
    <>
      <div className="page-title appearance-title">
        <div>
          <span className="appearance-eyebrow">SERVER IDENTITY</span>
          <h1>Make it recognizable</h1>
          <p>
            Edit the name, server-list description, formatting, symbols, and
            icon for this server or the Velocity network proxy.
          </p>
        </div>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !name.trim()}
        >
          {save.isPending ? <Spinner /> : <Save />}
          {save.isPending ? "Saving..." : "Save appearance"}
        </Button>
      </div>

      <div className="appearance-layout">
        <div className="appearance-editor-column">
          <Card className="appearance-card identity-card">
            <div className="section-heading">
              <span>01</span>
              <div>
                <h2>Name and description</h2>
                <p>
                  Use formatting sparingly so the important words remain easy to
                  scan.
                </p>
              </div>
            </div>
            <label className="appearance-field">
                <span>{query.data.software === "velocity" ? "Network name" : "Server name"}</span>
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="Salvadiux World"
              />
              <small>
                This identifies the instance in Salvadiux and labels the
                preview.
              </small>
            </label>
            <label className="appearance-field">
              <span>{query.data.software === "velocity" ? "Velocity MOTD · MiniMessage" : "Server description · MOTD"}</span>
              {query.data.software === "velocity" ? <MiniMessageEditor value={motd} onChange={setMotd} /> : <MotdEditor value={motd} onChange={setMotd} />}
              <small>
                {query.data.software === "velocity" ? "Velocity supports MiniMessage tags. Restart the proxy to publish the updated network list message." : "Two lines work best. Formatting is saved with vanilla-compatible Minecraft codes."}
              </small>
            </label>
          </Card>

          <Card className="appearance-card">
            <div className="section-heading">
              <span>02</span>
              <div>
                <h2>Server icon</h2>
                <p>
                  Upload any common image, then zoom and drag it into the square
                  crop.
                </p>
              </div>
            </div>
            <IconEditor initial={query.data.icon} onChange={setIcon} />
          </Card>
        </div>

        <aside className="appearance-preview-column">
          <ServerPreview
            name={name}
            motd={motd}
            icon={icon}
            maxPlayers={query.data.maxPlayers}
          />
          <div className="appearance-note">
            <strong>What will change</strong>
            <span>{query.data.software === "velocity" ? "velocity.toml · motd" : "server.properties · motd"}</span>
            <span>server-icon.png · 64×64 PNG</span>
            <span>Salvadiux instance name</span>
          </div>
          {save.isSuccess && (
            <div className="saved">Appearance saved · restart required</div>
          )}
          {save.error && <div className="error">{save.error.message}</div>}
        </aside>
      </div>
    </>
  );
}
