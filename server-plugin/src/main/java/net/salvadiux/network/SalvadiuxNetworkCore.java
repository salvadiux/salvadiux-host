package net.salvadiux.network;

import com.google.gson.JsonObject;
import com.google.gson.JsonArray;
import com.google.gson.JsonParser;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.ShulkerBox;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import io.papermc.paper.event.player.AsyncChatEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.BlockStateMeta;
import org.bukkit.inventory.meta.SkullMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.plugin.messaging.PluginMessageListener;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;
import org.bukkit.GameMode;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.time.Duration;
import java.lang.reflect.Method;
import java.util.Base64;
import java.util.ArrayList;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class SalvadiuxNetworkCore extends JavaPlugin implements Listener, PluginMessageListener {
    private record TrailOption(String id, Particle particle, Material icon, String label, String requiredRank) {}
    private record TeleportRequest(UUID requester, boolean bringTarget, long expiresAt) {}

    private static final String CHANNEL = "BungeeCord";
    private static final String PROMO_CHANNEL = "salvadiux:promo";
    private static final String MODERATION_CHANNEL = "salvadiux:moderation";
    private static final String COSMETICS_TITLE = "Cosméticos Salvadiux";
    private static final String MENU_TITLE = "Salvadiux · Menú";
    private static final String STAFF_TITLE = "Salvadiux · Staff";
    private static final String STAFF_PLAYER_TITLE = "Staff · ";
    private static final String STAFF_CONFIRM_TITLE = "Confirmar expulsión · ";
    private static final List<TrailOption> TRAIL_OPTIONS = List.of(
            new TrailOption("off", null, Material.BARRIER, "Sin efecto", "user"),
            new TrailOption("happy_villager", Particle.HAPPY_VILLAGER, Material.EMERALD, "Chispas verdes", "user"),
            new TrailOption("end_rod", Particle.END_ROD, Material.END_ROD, "Brillo del End", "vip"),
            new TrailOption("heart", Particle.HEART, Material.POPPY, "Corazones", "vip"),
            new TrailOption("flame", Particle.FLAME, Material.FIRE_CHARGE, "Llamas", "ultra"),
            new TrailOption("soul_fire", Particle.SOUL_FIRE_FLAME, Material.SOUL_TORCH, "Llama de alma", "ultra"),
            new TrailOption("note", Particle.NOTE, Material.NOTE_BLOCK, "Notas musicales", "admin")
    );
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
    private final Map<UUID, Location> previousLocations = new ConcurrentHashMap<>();
    private final Map<UUID, TeleportRequest> teleportRequests = new ConcurrentHashMap<>();
    private final Map<UUID, Long> teleportCooldowns = new ConcurrentHashMap<>();
    private final Map<UUID, Long> reportCooldowns = new ConcurrentHashMap<>();
    private final Set<UUID> frozenPlayers = ConcurrentHashMap.newKeySet();
    private final Map<UUID, Long> mutedPlayers = new ConcurrentHashMap<>();
    private final Map<UUID, Long> bannedPlayers = new ConcurrentHashMap<>();
    private final Map<UUID, UUID> followedPlayers = new ConcurrentHashMap<>();
    private final Set<UUID> vanishedPlayers = ConcurrentHashMap.newKeySet();
    private final Set<UUID> staffChatPlayers = ConcurrentHashMap.newKeySet();
    private final Set<String> processedModerationEvents = ConcurrentHashMap.newKeySet();
    private NamespacedKey selectorKey;
    private NamespacedKey cosmeticKey;
    private NamespacedKey menuActionKey;
    private NamespacedKey targetPlayerKey;
    private NamespacedKey reportIdKey;
    private String networkId;
    private String token;
    private String apiUrl;
    private String mode;
    private String realmId;
    private String serverAlias;
    private volatile long moderationCursor;
    private String hubAlias;
    private boolean hubBuildProtection;
    private volatile boolean freezeBlocksChat = true;
    private Method gatewayIsLogged;
    private int automaticPromotionIndex;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        getConfig().options().copyDefaults(true);
        saveConfig();
        freezeBlocksChat = getConfig().getBoolean("moderation.freeze-block-chat", true);
        for (String frozenId : getConfig().getStringList("moderation.frozen-players")) {
            try { frozenPlayers.add(UUID.fromString(frozenId)); } catch (IllegalArgumentException ignored) { }
        }
        loadModerationState();
        networkId = getConfig().getString("network-id", "").trim();
        token = getConfig().getString("access-token", "").trim();
        apiUrl = getConfig().getString("api-url", "http://127.0.0.1:3210").replaceAll("/+$", "");
        mode = getConfig().getString("mode", "hub").toLowerCase();
        realmId = getConfig().getString("realm-id", "default");
        serverAlias = getConfig().getString("server-alias", "");
        moderationCursor = Math.max(0, getConfig().getLong("moderation.shared-cursor", 0));
        hubAlias = getConfig().getString("hub-alias", "hub");
        hubBuildProtection = getConfig().getBoolean("hub-build-protection.enabled", mode.equals("hub"));
        configureHubSpawn();
        if (mode.equals("gateway")) {
            try {
                gatewayIsLogged = Class.forName("com.tense.zauth.SessionManager").getMethod("isLogged", UUID.class);
            } catch (ReflectiveOperationException | LinkageError exception) {
                getLogger().severe("Gateway transfers are disabled because zAuth login status could not be loaded.");
            }
        }
        if (networkId.isBlank() || token.isBlank()) {
            getLogger().warning("Network API is not configured; per-mode location sync is disabled.");
        }
        selectorKey = new NamespacedKey(this, "mode_selector");
        cosmeticKey = new NamespacedKey(this, "cosmetic_trail");
        menuActionKey = new NamespacedKey(this, "menu_action");
        targetPlayerKey = new NamespacedKey(this, "target_player");
        reportIdKey = new NamespacedKey(this, "report_id");
        Bukkit.getMessenger().registerOutgoingPluginChannel(this, CHANNEL);
        Bukkit.getMessenger().registerIncomingPluginChannel(this, CHANNEL, this);
        Bukkit.getMessenger().registerIncomingPluginChannel(this, PROMO_CHANNEL, this);
        Bukkit.getMessenger().registerIncomingPluginChannel(this, MODERATION_CHANNEL, this);
        Bukkit.getPluginManager().registerEvents(this, this);
        long interval = Math.max(10, getConfig().getLong("tracking.interval-seconds", 30));
        Bukkit.getScheduler().runTaskTimer(this, () -> Bukkit.getOnlinePlayers().forEach(this::saveLocation), interval * 20L, interval * 20L);
        Bukkit.getScheduler().runTaskTimer(this, () -> Bukkit.getOnlinePlayers().forEach(this::applyRankPresentation), 20L, 100L);
        startPromotionBot();
        startCosmeticTrails();
        Bukkit.getScheduler().runTaskTimer(this, this::updateStaffFollowers, 20L, 40L);
        Bukkit.getScheduler().runTaskTimer(this, this::updatePlayerLists, 40L, 100L);
        if (!networkId.isBlank() && !token.isBlank() && !serverAlias.isBlank()) {
            Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::pollNetworkModeration, 40L, 100L);
        } else getLogger().warning("Shared moderation is disabled until network-id, access-token, and server-alias are configured.");
        getLogger().info("Network core ready for mode " + mode + " in realm " + realmId + ".");
    }

    private void startPromotionBot() {
        if (!getConfig().getBoolean("promotion-bot.enabled", true)) return;
        List<String> messages = getConfig().getStringList("promotion-bot.messages");
        if (messages.isEmpty()) {
            getLogger().warning("Promotion bot is enabled, but promotion-bot.messages is empty.");
            return;
        }
        long intervalTicks = Math.max(30, getConfig().getLong("promotion-bot.interval-seconds", 180)) * 20L;
        long initialDelayTicks = Math.max(5, getConfig().getLong("promotion-bot.initial-delay-seconds", 45)) * 20L;
        new BukkitRunnable() {
            private int messageIndex;

            @Override
            public void run() {
                Component announcement = promotionComponent(messages.get(messageIndex++ % messages.size()));
                for (Player player : Bukkit.getOnlinePlayers()) {
                    if (mode.equals("gateway") && !isGatewayLoginComplete(player)) continue;
                    player.sendMessage(announcement);
                }
            }
        }.runTaskTimer(this, initialDelayTicks, intervalTicks);
    }

    private Component promotionComponent(String template) {
        String prefix = getConfig().getString("promotion-bot.prefix", "&5✦ &lSCARLL'S UNIVERSE &5✦");
        String storeUrl = getConfig().getString("promotion-bot.store-url", "https://discord.gg/XnJjTqyKDM");
        String message = template
                .replace("{mode}", mode)
                .replace("{vip_price}", getConfig().getString("promotion-bot.prices.vip", "Consulta en Discord"))
                .replace("{ultra_price}", getConfig().getString("promotion-bot.prices.ultra", "Consulta en Discord"))
                .replace("{store_url}", storeUrl);
        return LegacyComponentSerializer.legacyAmpersand().deserialize(prefix + "\n" + message);
    }

    private void launchPromotion(Player player, String[] args) {
        if (!hasRankAtLeast(player, "owner")) {
            player.sendMessage("§cSolo Owner puede lanzar anuncios globales con /promo.");
            return;
        }
        List<String> messages = getConfig().getStringList("promotion-bot.messages");
        if (messages.isEmpty()) {
            player.sendMessage("§cNo hay mensajes promocionales configurados.");
            return;
        }
        int index;
        if (args.length == 0) {
            index = automaticPromotionIndex++ % messages.size();
        } else if (args.length == 1) {
            index = switch (args[0].toLowerCase()) {
                case "vip" -> 0;
                case "ultra" -> 1;
                case "kits", "kit" -> 2;
                case "warps", "warp" -> 3;
                default -> -1;
            };
            if (index < 0 || index >= messages.size()) {
                player.sendMessage("§eUso: /promo [vip|ultra|kits|warps]");
                return;
            }
        } else {
            player.sendMessage("§eUso: /promo [vip|ultra|kits|warps]");
            return;
        }

        Component announcement = promotionComponent(messages.get(index));
        Bukkit.getOnlinePlayers().forEach(online -> online.sendMessage(announcement));
        forwardPromotion(player, announcement);
        player.sendMessage("§aAnuncio enviado a la network.");
    }

    private void forwardPromotion(Player sender, Component announcement) {
        if (networkId.isBlank() || token.isBlank() || serverAlias.isBlank()) {
            sender.sendMessage("§eEl anuncio solo llegó a este modo: falta enlazar este backend a una network.");
            return;
        }
        try {
            String json = GsonComponentSerializer.gson().serialize(announcement);
            String signature = signPromotion(json);
            ByteArrayOutputStream payloadBytes = new ByteArrayOutputStream();
            try (DataOutputStream payload = new DataOutputStream(payloadBytes)) {
                payload.writeUTF(networkId);
                payload.writeUTF(json);
                payload.writeUTF(signature);
            }
            ByteArrayOutputStream messageBytes = new ByteArrayOutputStream();
            try (DataOutputStream message = new DataOutputStream(messageBytes)) {
                message.writeUTF("Forward");
                message.writeUTF("ALL");
                message.writeUTF(PROMO_CHANNEL);
                message.writeShort(payloadBytes.size());
                payloadBytes.writeTo(message);
            }
            sender.sendPluginMessage(this, CHANNEL, messageBytes.toByteArray());
        } catch (Exception exception) {
            getLogger().warning("Could not forward global promotion: " + exception.getMessage());
            sender.sendMessage("§cNo se pudo enviar el anuncio a los otros modos.");
        }
    }

    private String signPromotion(String json) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(token.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.getEncoder().encodeToString(mac.doFinal((networkId + "\n" + json).getBytes(StandardCharsets.UTF_8)));
    }

    private void handleForwardedPromotion(byte[] message) {
        try (DataInputStream input = new DataInputStream(new ByteArrayInputStream(message))) {
            String receivedNetwork = input.readUTF();
            String json = input.readUTF();
            String signature = input.readUTF();
            if (!networkId.equals(receivedNetwork) || token.isBlank() || !MessageDigest.isEqual(signPromotion(json).getBytes(StandardCharsets.UTF_8), signature.getBytes(StandardCharsets.UTF_8))) return;
            Component announcement = GsonComponentSerializer.gson().deserialize(json);
            Bukkit.getOnlinePlayers().forEach(online -> online.sendMessage(announcement));
        } catch (Exception exception) {
            getLogger().warning("Ignored an invalid network promotion message: " + exception.getMessage());
        }
    }

    private void openCosmetics(Player player) {
        Inventory inventory = Bukkit.createInventory(null, 27, Component.text(COSMETICS_TITLE, NamedTextColor.LIGHT_PURPLE).decorate(TextDecoration.BOLD));
        String selected = getConfig().getString("cosmetics.players." + player.getUniqueId() + ".trail", "off");
        int[] slots = {10, 11, 12, 13, 14, 15, 16};
        for (int index = 0; index < TRAIL_OPTIONS.size(); index++) {
            TrailOption option = TRAIL_OPTIONS.get(index);
            ItemStack item = new ItemStack(option.icon());
            ItemMeta meta = item.getItemMeta();
            NamedTextColor color = switch (option.requiredRank()) {
                case "owner" -> NamedTextColor.GOLD;
                case "admin" -> NamedTextColor.RED;
                case "ultra" -> NamedTextColor.LIGHT_PURPLE;
                case "vip" -> NamedTextColor.AQUA;
                default -> NamedTextColor.GREEN;
            };
            meta.displayName(Component.text(option.label(), color, TextDecoration.BOLD));
            String access = hasRankAtLeast(player, option.requiredRank()) ? "Disponible" : "Requiere " + option.requiredRank().toUpperCase();
            String active = selected.equals(option.id()) ? " · ACTIVO" : "";
            meta.lore(List.of(Component.text(access + active, selected.equals(option.id()) ? NamedTextColor.GREEN : NamedTextColor.GRAY), Component.text("Efecto visual sin ventaja de juego", NamedTextColor.DARK_GRAY)));
            meta.getPersistentDataContainer().set(cosmeticKey, PersistentDataType.STRING, option.id());
            item.setItemMeta(meta);
            inventory.setItem(slots[index], item);
        }
        player.openInventory(inventory);
    }

    private void startCosmeticTrails() {
        if (!getConfig().getBoolean("cosmetics.enabled", true)) return;
        long interval = Math.max(5, getConfig().getLong("cosmetics.particle-interval-ticks", 10));
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            for (Player player : Bukkit.getOnlinePlayers()) {
                if (mode.equals("gateway") && !isGatewayLoginComplete(player)) continue;
                String selected = getConfig().getString("cosmetics.players." + player.getUniqueId() + ".trail", "off");
                TrailOption option = TRAIL_OPTIONS.stream().filter(trail -> trail.id().equals(selected)).findFirst().orElse(null);
                if (option == null || option.particle() == null || !hasRankAtLeast(player, option.requiredRank())) continue;
                Location location = player.getLocation().add(0, 0.15, 0);
                player.getWorld().spawnParticle(option.particle(), location, 1, 0.22, 0.12, 0.22, 0);
            }
        }, 20L, interval);
    }

    @EventHandler(ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        if (isHubBuildProtected(event.getPlayer())) {
            event.setCancelled(true);
            event.getPlayer().sendMessage("§cEl Hub está protegido. Solo Owner y Admin pueden romper bloques.");
        }
    }

    @EventHandler(ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        if (isHubBuildProtected(event.getPlayer())) {
            event.setCancelled(true);
            event.getPlayer().sendMessage("§cEl Hub está protegido. Solo Owner y Admin pueden colocar bloques.");
        }
        if (isFrozen(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenBlockBreak(BlockBreakEvent event) {
        if (isFrozen(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenMove(PlayerMoveEvent event) {
        if (!isFrozen(event.getPlayer()) || event.getTo() == null) return;
        Location from = event.getFrom();
        Location to = event.getTo();
        if (from.getX() != to.getX() || from.getY() != to.getY() || from.getZ() != to.getZ()) {
            event.setTo(new Location(from.getWorld(), from.getX(), from.getY(), from.getZ(), to.getYaw(), to.getPitch()));
        }
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenTeleport(PlayerTeleportEvent event) {
        if (isFrozen(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenCommand(PlayerCommandPreprocessEvent event) {
        if (!isFrozen(event.getPlayer())) return;
        String commandLine = event.getMessage().toLowerCase(java.util.Locale.ROOT);
        if (List.of("/msg", "/tell", "/w", "/r", "/reply", "/report", "/help").stream().noneMatch(commandLine::startsWith)) {
            event.setCancelled(true);
            event.getPlayer().sendMessage("§cEstás congelado. Espera instrucciones del staff.");
        }
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenChat(AsyncChatEvent event) {
        UUID senderId = event.getPlayer().getUniqueId();
        if (staffChatPlayers.contains(senderId)) {
            event.setCancelled(true);
            Component message = Component.text("[STAFF] ", NamedTextColor.RED).append(Component.text(event.getPlayer().getName() + ": ", NamedTextColor.GRAY)).append(event.message());
            Bukkit.getScheduler().runTask(this, () -> Bukkit.getOnlinePlayers().stream().filter(player -> hasStaffRole(player, 1)).forEach(player -> player.sendMessage(message)));
            return;
        }
        if (frozenPlayers.contains(senderId)) {
            if (freezeBlocksChat) {
                event.setCancelled(true);
                Bukkit.getScheduler().runTask(this, () -> event.getPlayer().sendMessage("§cNo puedes escribir en el chat mientras estás congelado."));
                return;
            }
        }
        Long mutedUntil = mutedPlayers.get(senderId);
        if (mutedUntil != null && (mutedUntil == -1L || mutedUntil > System.currentTimeMillis())) {
            event.setCancelled(true);
            Bukkit.getScheduler().runTask(this, () -> event.getPlayer().sendMessage("§cTienes el chat silenciado. Motivo: §f" + getConfig().getString("moderation.mutes." + senderId + ".reason", "Consulta con el staff.")));
        }
    }

    @EventHandler(priority = org.bukkit.event.EventPriority.HIGH, ignoreCancelled = true)
    public void onRankedChat(AsyncChatEvent event) {
        if (staffChatPlayers.contains(event.getPlayer().getUniqueId())) return;
        Player sender = event.getPlayer();
        String rank = displayRank(sender);
        NamedTextColor color = rankColor(sender);
        event.renderer((source, sourceDisplayName, message, viewer) -> Component.text("[" + rank + "] ", color, TextDecoration.BOLD)
                .append(Component.text(source.getName(), NamedTextColor.WHITE))
                .append(Component.text(": ", NamedTextColor.DARK_GRAY))
                .append(message));
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenInteract(PlayerInteractEvent event) {
        if (isFrozen(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenDrop(PlayerDropItemEvent event) {
        if (isFrozen(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenPickup(EntityPickupItemEvent event) {
        if (event.getEntity() instanceof Player player && isFrozen(player)) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenDamage(EntityDamageByEntityEvent event) {
        if (event.getEntity() instanceof Player victim && isFrozen(victim)) event.setCancelled(true);
        if (event.getDamager() instanceof Player attacker && isFrozen(attacker)) event.setCancelled(true);
    }

    private boolean isFrozen(Player player) {
        return frozenPlayers.contains(player.getUniqueId());
    }

    private int staffLevel(Player player) {
        if (player.isOp() || player.hasPermission("salvadiux.rank.owner") || player.hasPermission("salvadiux.staff.owner")) return 5;
        if (player.hasPermission("salvadiux.rank.admin") || player.hasPermission("salvadiux.staff.admin")) return 4;
        if (player.hasPermission("salvadiux.staff.srmod")) return 3;
        if (player.hasPermission("salvadiux.staff.moderator")) return 2;
        if (player.hasPermission("salvadiux.staff.helper")) return 1;
        return 0;
    }

    private boolean hasStaffRole(Player player, int minimumLevel) {
        return staffLevel(player) >= minimumLevel;
    }

    private void setFrozen(Player actor, Player target, boolean frozen) {
        if (!hasStaffRole(actor, 2) || staffLevel(actor) <= staffLevel(target)) {
            actor.sendMessage("§cNo puedes congelar a alguien de tu mismo rango o superior.");
            return;
        }
        applyFreezeState(target.getUniqueId(), frozen, false);
        broadcastFreezeState(actor, target.getUniqueId(), frozen);
        target.sendMessage(frozen ? "§c§lHAS SIDO CONGELADO" : "§aEl staff te descongeló.");
        actor.sendMessage(frozen ? "§aCongelaste a " + target.getName() + "." : "§eDescongelaste a " + target.getName() + ".");
    }

    private boolean requireSurvival(Player player, String feature) {
        if (mode.equals("survival")) return true;
        player.sendMessage("§e" + feature + " solo está disponible en Survival.");
        return false;
    }

    private String normalizeHomeName(String value) {
        if (value == null) return "";
        String name = value.toLowerCase(java.util.Locale.ROOT);
        return name.matches("[a-z0-9_-]{1,16}") ? name : "";
    }

    private int homeLimit(Player player) {
        if (hasRankAtLeast(player, "owner")) return -1;
        String rank = player.hasPermission("salvadiux.rank.admin") ? "admin"
                : player.hasPermission("salvadiux.rank.ultra") ? "ultra"
                : player.hasPermission("salvadiux.rank.vip") ? "vip" : "user";
        return Math.max(0, getConfig().getInt("homes.limits." + rank, switch (rank) {
            case "admin" -> 20;
            case "ultra" -> 10;
            case "vip" -> 5;
            default -> 2;
        }));
    }

    private void setHome(Player player, String[] args) {
        if (!requireSurvival(player, "Los homes")) return;
        String name = normalizeHomeName(args.length == 0 ? "home" : args[0]);
        if (name.isBlank()) {
            player.sendMessage("§eUso: /sethome [nombre] (1-16 letras, números, _ o -).");
            return;
        }
        String path = "homes." + player.getUniqueId() + "." + name;
        boolean exists = getConfig().contains(path + ".world");
        int limit = homeLimit(player);
        var homes = getConfig().getConfigurationSection("homes." + player.getUniqueId());
        if (!exists && limit >= 0 && (homes == null ? 0 : homes.getKeys(false).size()) >= limit) {
            player.sendMessage("§cLlegaste a tu límite de " + limit + " homes para tu rango.");
            return;
        }
        Location location = player.getLocation();
        getConfig().set(path + ".world", location.getWorld().getName());
        getConfig().set(path + ".x", location.getX());
        getConfig().set(path + ".y", location.getY());
        getConfig().set(path + ".z", location.getZ());
        getConfig().set(path + ".yaw", location.getYaw());
        getConfig().set(path + ".pitch", location.getPitch());
        saveConfig();
        player.sendMessage("§aHome " + name + " guardado.");
    }

    private void teleportHome(Player player, String name) {
        if (!requireSurvival(player, "Los homes")) return;
        String normalized = normalizeHomeName(name);
        String path = "homes." + player.getUniqueId() + "." + normalized;
        if (normalized.isBlank() || !getConfig().contains(path + ".world")) {
            player.sendMessage("§cNo existe ese home. Usa /homes para ver tu lista.");
            return;
        }
        World world = Bukkit.getWorld(getConfig().getString(path + ".world", ""));
        if (world == null) {
            player.sendMessage("§cEl mundo del home no está cargado.");
            return;
        }
        Location destination = new Location(world, getConfig().getDouble(path + ".x"), getConfig().getDouble(path + ".y"), getConfig().getDouble(path + ".z"), (float) getConfig().getDouble(path + ".yaw"), (float) getConfig().getDouble(path + ".pitch"));
        previousLocations.put(player.getUniqueId(), player.getLocation().clone());
        player.teleportAsync(destination).thenAccept(success -> Bukkit.getScheduler().runTask(this, () -> player.sendMessage(success ? "§aTeletransportado a " + normalized + "." : "§cNo se pudo cargar ese home.")));
    }

    private void listHomes(Player player) {
        if (!requireSurvival(player, "Los homes")) return;
        var section = getConfig().getConfigurationSection("homes." + player.getUniqueId());
        List<String> homes = section == null ? List.of() : section.getKeys(false).stream().sorted().toList();
        player.sendMessage(homes.isEmpty() ? "§eNo tienes homes. Crea uno con /sethome [nombre]." : "§aTus homes (" + homes.size() + "): §f" + String.join(", ", homes) + "§7 · /home <nombre>");
    }

    private void deleteHome(Player player, String[] args) {
        if (!requireSurvival(player, "Los homes")) return;
        if (args.length != 1) {
            player.sendMessage("§eUso: /delhome <nombre>");
            return;
        }
        String name = normalizeHomeName(args[0]);
        String path = "homes." + player.getUniqueId() + "." + name;
        if (name.isBlank() || !getConfig().contains(path + ".world")) {
            player.sendMessage("§cNo existe ese home.");
            return;
        }
        getConfig().set(path, null);
        saveConfig();
        player.sendMessage("§aHome " + name + " eliminado.");
    }

    private void openHomesMenu(Player player) {
        if (!requireSurvival(player, "Los homes")) return;
        Inventory inventory = Bukkit.createInventory(null, 54, Component.text("Homes Salvadiux", NamedTextColor.GREEN));
        var section = getConfig().getConfigurationSection("homes." + player.getUniqueId());
        if (section != null) {
            int slot = 0;
            for (String home : section.getKeys(false).stream().sorted().toList()) {
                if (slot >= 45) break;
                inventory.setItem(slot++, menuItem(Material.RED_BED, "§a" + home, List.of("§7Pulsa para ir a este home."), "home_" + home));
            }
        }
        if (inventory.firstEmpty() == 0) inventory.setItem(22, menuItem(Material.PAPER, "§eAún no tienes homes", List.of("§7Usa /sethome [nombre] en Survival."), null));
        inventory.setItem(49, menuItem(Material.OAK_SIGN, "§bCrear home", List.of("§7Escribe §f/sethome <nombre>§7."), null));
        player.openInventory(inventory);
    }

    private void requestTeleport(Player requester, String[] args, boolean bringTarget) {
        if (!requireSurvival(requester, "TPA")) return;
        if (args.length != 1) {
            requester.sendMessage("§eUso: /" + (bringTarget ? "tpahere" : "tpa") + " <jugador>");
            return;
        }
        Player target = Bukkit.getPlayerExact(args[0]);
        if (target == null || target.equals(requester)) {
            requester.sendMessage("§cEse jugador no está conectado o no es un destino válido.");
            return;
        }
        long now = System.currentTimeMillis();
        long cooldownMillis = Math.max(0, getConfig().getLong("teleport-requests.cooldown-seconds", 5)) * 1000L;
        long lastRequest = teleportCooldowns.getOrDefault(requester.getUniqueId(), 0L);
        if (now - lastRequest < cooldownMillis) {
            requester.sendMessage("§eEspera " + Math.max(1, (cooldownMillis - (now - lastRequest)) / 1000L) + " s antes de enviar otra solicitud.");
            return;
        }
        teleportCooldowns.put(requester.getUniqueId(), now);
        long ttl = Math.max(15, getConfig().getLong("teleport-requests.expiry-seconds", 60));
        TeleportRequest request = new TeleportRequest(requester.getUniqueId(), bringTarget, System.currentTimeMillis() + ttl * 1000L);
        teleportRequests.put(target.getUniqueId(), request);
        String commandName = bringTarget ? "tpaccept" : "tpaccept";
        target.sendMessage(Component.text("[TPA] ", NamedTextColor.LIGHT_PURPLE).append(Component.text(requester.getName(), NamedTextColor.WHITE))
                .append(Component.text(bringTarget ? " quiere que vayas a su ubicación. " : " quiere teletransportarse contigo. ", NamedTextColor.GRAY))
                .append(Component.text("[Aceptar]", NamedTextColor.GREEN).clickEvent(net.kyori.adventure.text.event.ClickEvent.runCommand("/" + commandName)))
                .append(Component.text(" "))
                .append(Component.text("[Rechazar]", NamedTextColor.RED).clickEvent(net.kyori.adventure.text.event.ClickEvent.runCommand("/tpdeny"))));
        requester.sendMessage("§aSolicitud enviada a " + target.getName() + ". Expira en " + ttl + " segundos.");
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (teleportRequests.remove(target.getUniqueId(), request) && target.isOnline()) target.sendMessage("§7La solicitud de teleport expiró.");
            Player source = Bukkit.getPlayer(requester.getUniqueId());
            if (source != null) source.sendMessage("§7Tu solicitud de teleport expiró.");
        }, ttl * 20L);
    }

    private void acceptTeleport(Player target) {
        if (!requireSurvival(target, "TPA")) return;
        TeleportRequest request = teleportRequests.remove(target.getUniqueId());
        if (request == null || request.expiresAt() < System.currentTimeMillis()) {
            target.sendMessage("§eNo tienes solicitudes pendientes.");
            return;
        }
        Player requester = Bukkit.getPlayer(request.requester());
        if (requester == null) {
            target.sendMessage("§cEl jugador que envió la solicitud ya se desconectó.");
            return;
        }
        Player traveler = request.bringTarget() ? target : requester;
        Player destination = request.bringTarget() ? requester : target;
        previousLocations.put(traveler.getUniqueId(), traveler.getLocation().clone());
        traveler.teleportAsync(destination.getLocation()).thenAccept(success -> Bukkit.getScheduler().runTask(this, () -> {
            target.sendMessage(success ? "§aSolicitud aceptada." : "§cNo se pudo completar el teleport.");
            requester.sendMessage(success ? "§aTu solicitud fue aceptada." : "§cNo se pudo completar el teleport.");
        }));
    }

    private void denyTeleport(Player target) {
        TeleportRequest request = teleportRequests.remove(target.getUniqueId());
        if (request == null) {
            target.sendMessage("§eNo tienes solicitudes pendientes.");
            return;
        }
        target.sendMessage("§eSolicitud rechazada.");
        Player requester = Bukkit.getPlayer(request.requester());
        if (requester != null) requester.sendMessage("§c" + target.getName() + " rechazó tu solicitud.");
    }

    private void randomTeleport(Player player) {
        if (!requireSurvival(player, "RTP")) return;
        World world = player.getWorld();
        int radius = Math.max(100, getConfig().getInt("rtp.radius", 5000));
        int spawnSafeRadius = Math.max(0, getConfig().getInt("rtp.spawn-safe-radius", 250));
        org.bukkit.WorldBorder border = world.getWorldBorder();
        Location center = border.getCenter();
        double borderRadius = Math.max(0, border.getSize() / 2.0 - 16);
        int safeRadius = (int) Math.min(radius, borderRadius);
        if (safeRadius <= spawnSafeRadius) {
            player.sendMessage("§cEl borde del mundo es demasiado pequeño para RTP.");
            return;
        }
        java.util.concurrent.ThreadLocalRandom random = java.util.concurrent.ThreadLocalRandom.current();
        for (int attempt = 0; attempt < 48; attempt++) {
            int x = (int) Math.floor(center.getX() + random.nextInt(-safeRadius, safeRadius + 1));
            int z = (int) Math.floor(center.getZ() + random.nextInt(-safeRadius, safeRadius + 1));
            if (Math.hypot(x - center.getX(), z - center.getZ()) < spawnSafeRadius) continue;
            int y = world.getHighestBlockYAt(x, z);
            org.bukkit.block.Block floor = world.getBlockAt(x, y, z);
            org.bukkit.block.Block feet = world.getBlockAt(x, y + 1, z);
            org.bukkit.block.Block head = world.getBlockAt(x, y + 2, z);
            if (!floor.getType().isSolid() || !feet.isPassable() || !head.isPassable()) continue;
            if (floor.isLiquid() || feet.isLiquid() || head.isLiquid()) continue;
            Location destination = new Location(world, x + 0.5, y + 1, z + 0.5, player.getLocation().getYaw(), player.getLocation().getPitch());
            previousLocations.put(player.getUniqueId(), player.getLocation().clone());
            player.sendMessage("§eBuscando un lugar seguro...");
            player.teleportAsync(destination).thenAccept(success -> Bukkit.getScheduler().runTask(this, () -> player.sendMessage(success ? "§a¡Encontraste un lugar nuevo!" : "§cFalló el teleport; inténtalo otra vez.")));
            return;
        }
        player.sendMessage("§cNo encontré una ubicación segura cerca. Inténtalo otra vez o amplía rtp.radius en config.yml.");
    }

    private void submitReport(Player reporter, String[] args) {
        if (!requireSurvival(reporter, "Los reportes")) return;
        if (args.length < 2) {
            reporter.sendMessage("§eUso: /report <jugador> <motivo>");
            return;
        }
        Player target = Bukkit.getPlayerExact(args[0]);
        if (target == null || target.equals(reporter)) {
            reporter.sendMessage("§cSolo puedes reportar a un jugador conectado distinto de ti.");
            return;
        }
        long now = System.currentTimeMillis();
        long cooldownMillis = Math.max(5, getConfig().getLong("moderation.report-cooldown-seconds", 30)) * 1000L;
        long lastReport = reportCooldowns.getOrDefault(reporter.getUniqueId(), 0L);
        if (now - lastReport < cooldownMillis) {
            reporter.sendMessage("§eEspera " + Math.max(1, (cooldownMillis - (now - lastReport)) / 1000L) + " s para enviar otro reporte.");
            return;
        }
        reportCooldowns.put(reporter.getUniqueId(), now);
        int id;
        do { id = java.util.concurrent.ThreadLocalRandom.current().nextInt(1, Integer.MAX_VALUE); }
        while (getConfig().contains("moderation.reports.items." + id));
        String path = "moderation.reports.items." + id;
        String reason = String.join(" ", java.util.Arrays.copyOfRange(args, 1, args.length)).trim();
        if (reason.length() > 180) reason = reason.substring(0, 180);
        getConfig().set(path + ".target-uuid", target.getUniqueId().toString());
        getConfig().set(path + ".target-name", target.getName());
        getConfig().set(path + ".reporter-uuid", reporter.getUniqueId().toString());
        getConfig().set(path + ".reporter-name", reporter.getName());
        getConfig().set(path + ".reason", reason);
        getConfig().set(path + ".created-at", System.currentTimeMillis());
        getConfig().set(path + ".status", "open");
        saveConfig();
        JsonObject reportEvent = new JsonObject();
        reportEvent.addProperty("operation", "report");
        reportEvent.addProperty("id", id);
        reportEvent.addProperty("target-uuid", target.getUniqueId().toString());
        reportEvent.addProperty("target-name", target.getName());
        reportEvent.addProperty("reporter-uuid", reporter.getUniqueId().toString());
        reportEvent.addProperty("reporter-name", reporter.getName());
        reportEvent.addProperty("reason", reason);
        reportEvent.addProperty("created-at", System.currentTimeMillis());
        sendNetworkModeration(reporter, reportEvent);
        reporter.sendMessage("§aReporte #" + id + " enviado al staff.");
        Component alert = Component.text("§c[Reporte #" + id + "] §f" + reporter.getName() + " reportó a " + target.getName() + ": §7" + reason);
        Bukkit.getOnlinePlayers().stream().filter(staff -> hasStaffRole(staff, 1)).forEach(staff -> staff.sendMessage(alert));
    }

    private void openReportsMenu(Player staff) {
        if (!hasStaffRole(staff, 1)) {
            staff.sendMessage("§cRevisar reportes requiere rango Helper o superior.");
            return;
        }
        Inventory inventory = Bukkit.createInventory(null, 54, Component.text("Reportes abiertos", NamedTextColor.RED));
        var reports = getConfig().getConfigurationSection("moderation.reports.items");
        if (reports != null) {
            int slot = 0;
            for (String id : reports.getKeys(false).stream().sorted((a, b) -> Integer.compare(Integer.parseInt(b), Integer.parseInt(a))).toList()) {
                if (!getConfig().getString("moderation.reports.items." + id + ".status", "open").equals("open") || slot >= 45) continue;
                String path = "moderation.reports.items." + id;
                ItemStack item = menuItem(Material.PAPER, "§c#" + id + " · " + getConfig().getString(path + ".target-name", "Jugador"),
                        List.of("§7Reportó: §f" + getConfig().getString(path + ".reporter-name", "?"), "§7Motivo: §f" + getConfig().getString(path + ".reason", "Sin motivo"), "§ePulsa para ir al jugador", "§8Shift + clic para cerrar"), "report_" + id);
                ItemMeta meta = item.getItemMeta();
                meta.getPersistentDataContainer().set(reportIdKey, PersistentDataType.INTEGER, Integer.parseInt(id));
                item.setItemMeta(meta);
                inventory.setItem(slot++, item);
            }
        }
        if (inventory.firstEmpty() == 0) inventory.setItem(22, menuItem(Material.LIME_STAINED_GLASS_PANE, "§aNo hay reportes abiertos", List.of(), null));
        staff.openInventory(inventory);
    }

    private void toggleReport(Player staff, ItemStack clicked, boolean close) {
        if (!hasStaffRole(staff, 1) || clicked == null || !clicked.hasItemMeta()) return;
        Integer id = clicked.getItemMeta().getPersistentDataContainer().get(reportIdKey, PersistentDataType.INTEGER);
        if (id == null) return;
        String path = "moderation.reports.items." + id;
        if (close) {
            getConfig().set(path + ".status", "closed");
            getConfig().set(path + ".closed-by", staff.getName());
            saveConfig();
            JsonObject closeEvent = new JsonObject();
            closeEvent.addProperty("operation", "report-close");
            closeEvent.addProperty("id", id);
            closeEvent.addProperty("closed-by", staff.getName());
            sendNetworkModeration(staff, closeEvent);
            staff.sendMessage("§aReporte #" + id + " cerrado.");
            openReportsMenu(staff);
            return;
        }
        try {
            Player target = Bukkit.getPlayer(UUID.fromString(getConfig().getString(path + ".target-uuid", "")));
            if (target == null) staff.sendMessage("§eEl jugador reportado está desconectado.");
            else staff.teleportAsync(target.getLocation());
        } catch (IllegalArgumentException ignored) {
            staff.sendMessage("§cEl reporte contiene un UUID inválido.");
        }
    }

    private void loadModerationState() {
        var mutes = getConfig().getConfigurationSection("moderation.mutes");
        if (mutes != null) {
            for (String id : mutes.getKeys(false)) {
                try {
                    UUID uuid = UUID.fromString(id);
                    long until = getConfig().getLong("moderation.mutes." + id + ".expires-at", -1L);
                    if (until == -1L || until > System.currentTimeMillis()) mutedPlayers.put(uuid, until);
                } catch (IllegalArgumentException ignored) { }
            }
        }
        var bans = getConfig().getConfigurationSection("moderation.bans");
        if (bans != null) {
            for (String id : bans.getKeys(false)) {
                try {
                    UUID uuid = UUID.fromString(id);
                    long until = getConfig().getLong("moderation.bans." + id + ".expires-at", -1L);
                    if (until == -1L || until > System.currentTimeMillis()) bannedPlayers.put(uuid, until);
                } catch (IllegalArgumentException ignored) { }
            }
        }
        for (String id : getConfig().getStringList("moderation.vanished-players")) {
            try { vanishedPlayers.add(UUID.fromString(id)); } catch (IllegalArgumentException ignored) { }
        }
    }

    private boolean isMuted(UUID uuid) {
        Long until = mutedPlayers.get(uuid);
        return until != null && (until == -1L || until > System.currentTimeMillis());
    }

    private long parseDuration(String input) {
        String value = input.toLowerCase(java.util.Locale.ROOT);
        if (value.equals("perma") || value.equals("permanent")) return -1L;
        if (!value.matches("[1-9][0-9]{0,5}[smhdw]")) return 0L;
        long amount = Long.parseLong(value.substring(0, value.length() - 1));
        long multiplier = switch (value.charAt(value.length() - 1)) {
            case 's' -> 1000L;
            case 'm' -> 60_000L;
            case 'h' -> 3_600_000L;
            case 'd' -> 86_400_000L;
            case 'w' -> 604_800_000L;
            default -> 0L;
        };
        try { return Math.multiplyExact(amount, multiplier); } catch (ArithmeticException ignored) { return 0L; }
    }

    private boolean requireStaff(Player staff) {
        if (hasStaffRole(staff, 1)) return true;
        staff.sendMessage("§cEsta acción requiere rango Helper o superior.");
        return false;
    }

    private boolean requireModerator(Player staff) {
        if (hasStaffRole(staff, 2)) return true;
        staff.sendMessage("§cEsta acción requiere rango Moderador o superior.");
        return false;
    }

    private boolean canStaffActOn(Player staff, Player target) {
        if (!requireModerator(staff)) return false;
        if (staffLevel(staff) > staffLevel(target)) return true;
        staff.sendMessage("§cNo puedes actuar sobre alguien de tu mismo rango staff o superior.");
        return false;
    }

    private boolean canInspectTarget(Player staff, Player target) {
        if (!requireStaff(staff)) return false;
        if (staffLevel(staff) > staffLevel(target)) return true;
        staff.sendMessage("§cNo puedes inspeccionar a alguien de tu mismo rango staff o superior.");
        return false;
    }

    private void warnPlayer(Player staff, String[] args) {
        if (!requireModerator(staff)) return;
        if (args.length < 2) {
            staff.sendMessage("§eUso: /warn <jugador> <motivo>");
            return;
        }
        Player target = Bukkit.getPlayerExact(args[0]);
        if (target == null || !canStaffActOn(staff, target)) return;
        String reason = String.join(" ", java.util.Arrays.copyOfRange(args, 1, args.length));
        recordModerationAction("warnings", target, staff, reason);
        target.sendMessage("§cHas recibido una advertencia del staff: §f" + reason);
        staff.sendMessage("§aAdvertencia registrada para " + target.getName() + ".");
    }

    private void mutePlayer(Player staff, String[] args) {
        if (!requireModerator(staff)) return;
        if (args.length < 3) {
            staff.sendMessage("§eUso: /mute <jugador> <10m|2h|1d|perma> <motivo>");
            return;
        }
        Player target = Bukkit.getPlayerExact(args[0]);
        long duration = parseDuration(args[1]);
        if (target == null || !canStaffActOn(staff, target)) return;
        if (duration == 0L) {
            staff.sendMessage("§cDuración inválida. Usa segundos, minutos, horas, días, semanas o perma.");
            return;
        }
        long until = duration < 0 ? -1L : System.currentTimeMillis() + duration;
        String reason = String.join(" ", java.util.Arrays.copyOfRange(args, 2, args.length));
        mutedPlayers.put(target.getUniqueId(), until);
        String path = "moderation.mutes." + target.getUniqueId();
        getConfig().set(path + ".expires-at", until);
        getConfig().set(path + ".reason", reason);
        getConfig().set(path + ".by", staff.getName());
        saveConfig();
        JsonObject muteEvent = new JsonObject();
        muteEvent.addProperty("operation", "mute");
        muteEvent.addProperty("uuid", target.getUniqueId().toString());
        muteEvent.addProperty("expires-at", until);
        muteEvent.addProperty("by", staff.getName());
        muteEvent.addProperty("reason", reason);
        sendNetworkModeration(staff, muteEvent);
        target.sendMessage("§cChat silenciado" + (until < 0 ? " permanentemente" : " por " + args[1]) + ". Motivo: §f" + reason);
        staff.sendMessage("§aSilenciaste a " + target.getName() + ".");
    }

    private void unmutePlayer(Player staff, String[] args) {
        if (!requireModerator(staff) || args.length != 1) {
            if (args.length != 1) staff.sendMessage("§eUso: /unmute <jugador>");
            return;
        }
        Player target = Bukkit.getPlayerExact(args[0]);
        if (target == null || !canStaffActOn(staff, target)) return;
        mutedPlayers.remove(target.getUniqueId());
        getConfig().set("moderation.mutes." + target.getUniqueId(), null);
        saveConfig();
        JsonObject unmuteEvent = new JsonObject();
        unmuteEvent.addProperty("operation", "unmute");
        unmuteEvent.addProperty("uuid", target.getUniqueId().toString());
        sendNetworkModeration(staff, unmuteEvent);
        target.sendMessage("§aTu silencio fue retirado por el staff.");
        staff.sendMessage("§aQuitaste el silencio de " + target.getName() + ".");
    }

    private void banPlayer(Player staff, String[] args) {
        if (!hasStaffRole(staff, 3)) { staff.sendMessage("§cAplicar bans requiere rango SrMod o superior."); return; }
        if (args.length < 3) { staff.sendMessage("§eUso: /ban <jugador> <10m|2h|1d|perma> <motivo>"); return; }
        Player target = Bukkit.getPlayerExact(args[0]);
        long duration = parseDuration(args[1]);
        if (target == null || !canStaffActOn(staff, target)) return;
        if (duration == 0L) { staff.sendMessage("§cDuración inválida."); return; }
        long until = duration < 0 ? -1L : System.currentTimeMillis() + duration;
        String reason = String.join(" ", java.util.Arrays.copyOfRange(args, 2, args.length));
        applyBanState(target.getUniqueId(), until, staff.getName(), reason);
        JsonObject event = new JsonObject();
        event.addProperty("operation", "ban");
        event.addProperty("uuid", target.getUniqueId().toString());
        event.addProperty("expires-at", until);
        event.addProperty("by", staff.getName());
        event.addProperty("reason", reason);
        sendNetworkModeration(staff, event);
        target.kick(Component.text("Acceso bloqueado por el staff. Motivo: " + reason + (until < 0 ? "" : " · vence " + java.time.Instant.ofEpochMilli(until)), NamedTextColor.RED));
        staff.sendMessage("§aBan aplicado a " + target.getName() + " en toda la network.");
    }

    private void unbanPlayer(Player staff, String[] args) {
        if (!hasStaffRole(staff, 3)) { staff.sendMessage("§cQuitar bans requiere rango SrMod o superior."); return; }
        if (args.length != 1) { staff.sendMessage("§eUso: /unban <uuid>"); return; }
        UUID uuid;
        try { uuid = UUID.fromString(args[0]); } catch (IllegalArgumentException invalid) { staff.sendMessage("§eUsa el UUID del jugador para evitar confusiones de nombre."); return; }
        applyBanState(uuid, 0L, staff.getName(), "");
        JsonObject event = new JsonObject();
        event.addProperty("operation", "unban");
        event.addProperty("uuid", uuid.toString());
        sendNetworkModeration(staff, event);
        staff.sendMessage("§aBan retirado en toda la network.");
    }

    private void applyBanState(UUID uuid, long expiresAt, String by, String reason) {
        if (expiresAt == 0L || (expiresAt > 0 && expiresAt <= System.currentTimeMillis())) {
            bannedPlayers.remove(uuid);
            getConfig().set("moderation.bans." + uuid, null);
        } else {
            bannedPlayers.put(uuid, expiresAt);
            getConfig().set("moderation.bans." + uuid + ".expires-at", expiresAt);
            getConfig().set("moderation.bans." + uuid + ".by", by);
            getConfig().set("moderation.bans." + uuid + ".reason", reason);
        }
        saveConfig();
    }

    @EventHandler
    public void onBannedLogin(PlayerLoginEvent event) {
        Long until = bannedPlayers.get(event.getPlayer().getUniqueId());
        if (until == null) return;
        if (until != -1L && until <= System.currentTimeMillis()) {
            applyBanState(event.getPlayer().getUniqueId(), 0L, "", "");
            return;
        }
        String reason = getConfig().getString("moderation.bans." + event.getPlayer().getUniqueId() + ".reason", "Sin motivo especificado");
        event.disallow(PlayerLoginEvent.Result.KICK_BANNED, "§cAcceso bloqueado en Salvadiux Network.\n§7Motivo: §f" + reason);
    }

    private void recordModerationAction(String type, Player target, Player staff, String reason) {
        String stamp = System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 8);
        String path = "moderation." + type + "." + target.getUniqueId() + "." + stamp;
        getConfig().set(path + ".player", target.getName());
        getConfig().set(path + ".by", staff.getName());
        getConfig().set(path + ".reason", reason.length() > 180 ? reason.substring(0, 180) : reason);
        saveConfig();
        JsonObject recordEvent = new JsonObject();
        recordEvent.addProperty("operation", "record");
        recordEvent.addProperty("record-type", type);
        recordEvent.addProperty("uuid", target.getUniqueId().toString());
        recordEvent.addProperty("player", target.getName());
        recordEvent.addProperty("id", stamp);
        recordEvent.addProperty("by", staff.getName());
        recordEvent.addProperty("reason", reason.length() > 180 ? reason.substring(0, 180) : reason);
        sendNetworkModeration(staff, recordEvent);
    }

    private void addStaffNote(Player staff, String[] args) {
        if (!requireStaff(staff)) return;
        if (args.length < 2) {
            staff.sendMessage("§eUso: /note <jugador> <nota>");
            return;
        }
        Player target = Bukkit.getPlayerExact(args[0]);
        if (target == null) {
            staff.sendMessage("§cEse jugador no está conectado.");
            return;
        }
        recordModerationAction("notes", target, staff, String.join(" ", java.util.Arrays.copyOfRange(args, 1, args.length)));
        staff.sendMessage("§aNota privada guardada para " + target.getName() + ".");
    }

    private void showStaffNotes(Player staff, String[] args) {
        if (!requireStaff(staff)) return;
        if (args.length != 1) {
            staff.sendMessage("§eUso: /notes <jugador>");
            return;
        }
        Player target = Bukkit.getPlayerExact(args[0]);
        if (target == null) {
            staff.sendMessage("§cEse jugador no está conectado.");
            return;
        }
        var entries = getConfig().getConfigurationSection("moderation.notes." + target.getUniqueId());
        staff.sendMessage("§6Notas de " + target.getName() + ":");
        if (entries == null || entries.getKeys(false).isEmpty()) staff.sendMessage("§7Sin notas registradas.");
        else entries.getKeys(false).stream().sorted().skip(Math.max(0, entries.getKeys(false).size() - 10L)).forEach(id -> staff.sendMessage("§7[" + getConfig().getString("moderation.notes." + target.getUniqueId() + "." + id + ".by", "?") + "] §f" + getConfig().getString("moderation.notes." + target.getUniqueId() + "." + id + ".reason", "")));
    }

    private void toggleVanish(Player staff) {
        if (!hasStaffRole(staff, 2)) { staff.sendMessage("§cVanish requiere rango Moderador o superior."); return; }
        boolean vanish = vanishedPlayers.add(staff.getUniqueId());
        if (!vanish) vanishedPlayers.remove(staff.getUniqueId());
        getConfig().set("moderation.vanished-players", vanishedPlayers.stream().map(UUID::toString).toList());
        saveConfig();
        for (Player viewer : Bukkit.getOnlinePlayers()) {
            if (viewer.equals(staff)) continue;
            if (vanish && !hasStaffRole(viewer, 1)) viewer.hidePlayer(this, staff);
            else viewer.showPlayer(this, staff);
        }
        staff.sendMessage(vanish ? "§aVanish activado." : "§eVanish desactivado.");
    }

    private void applyVanishVisibility(Player joining) {
        for (UUID id : vanishedPlayers) {
            Player hidden = Bukkit.getPlayer(id);
            if (hidden != null && !joining.equals(hidden) && !hasStaffRole(joining, 1)) joining.hidePlayer(this, hidden);
        }
        if (hasStaffRole(joining, 1)) {
            for (UUID id : vanishedPlayers) {
                Player hidden = Bukkit.getPlayer(id);
                if (hidden != null) joining.showPlayer(this, hidden);
            }
        }
    }

    private void followPlayer(Player staff, String[] args) {
        if (!requireStaff(staff)) return;
        if (args.length != 1 || args[0].equalsIgnoreCase("stop")) {
            followedPlayers.remove(staff.getUniqueId());
            staff.sendMessage("§eSeguimiento detenido.");
            return;
        }
        Player target = Bukkit.getPlayerExact(args[0]);
        if (target == null || !canInspectTarget(staff, target)) return;
        followedPlayers.put(staff.getUniqueId(), target.getUniqueId());
        staff.sendMessage("§aSiguiendo a " + target.getName() + ". Usa /follow stop para detenerte.");
    }

    private void updateStaffFollowers() {
        followedPlayers.forEach((staffId, targetId) -> {
            Player staff = Bukkit.getPlayer(staffId);
            Player target = Bukkit.getPlayer(targetId);
            if (staff == null || target == null || !staff.isOnline() || !target.isOnline()) {
                followedPlayers.remove(staffId);
                return;
            }
            if (staff.getWorld().equals(target.getWorld()) && staff.getLocation().distanceSquared(target.getLocation()) < 36) return;
            Location behind = target.getLocation().clone().subtract(target.getLocation().getDirection().multiply(2));
            behind.setY(target.getLocation().getY());
            staff.teleportAsync(behind);
        });
    }

    private void toggleStaffChat(Player staff, String[] args) {
        if (!requireStaff(staff)) return;
        if (args.length == 0) {
            boolean enabled = !staffChatPlayers.remove(staff.getUniqueId());
            if (enabled) staffChatPlayers.add(staff.getUniqueId());
            staff.sendMessage(enabled ? "§cChat Staff activado. Tus mensajes irán solo al equipo." : "§eChat Staff desactivado.");
            return;
        }
        String message = String.join(" ", args);
        Component formatted = Component.text("[STAFF] ", NamedTextColor.RED).append(Component.text(staff.getName() + ": ", NamedTextColor.GRAY)).append(Component.text(message, NamedTextColor.WHITE));
        Bukkit.getOnlinePlayers().stream().filter(player -> hasStaffRole(player, 1)).forEach(player -> player.sendMessage(formatted));
    }

    private boolean isHubBuildProtected(Player player) {
        return hubBuildProtection && mode.equals("hub")
                && !player.hasPermission("salvadiux.rank.owner")
                && !player.hasPermission("salvadiux.rank.admin");
    }

    @Override
    public void onDisable() {
        try {
            java.util.concurrent.CompletableFuture<?>[] saves = Bukkit.getOnlinePlayers().stream().map(this::saveLocation).toArray(java.util.concurrent.CompletableFuture[]::new);
            java.util.concurrent.CompletableFuture.allOf(saves).get(4, java.util.concurrent.TimeUnit.SECONDS);
        } catch (Exception exception) {
            getLogger().warning("Some player mode data could not be flushed during shutdown: " + exception.getMessage());
        }
        Bukkit.getMessenger().unregisterOutgoingPluginChannel(this, CHANNEL);
        Bukkit.getMessenger().unregisterIncomingPluginChannel(this, CHANNEL);
        Bukkit.getMessenger().unregisterIncomingPluginChannel(this, PROMO_CHANNEL);
        Bukkit.getMessenger().unregisterIncomingPluginChannel(this, MODERATION_CHANNEL);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        applyVanishVisibility(player);
        Bukkit.getScheduler().runTaskLater(this, this::updatePlayerLists, 2L);
        Bukkit.getScheduler().runTask(this, () -> applyRankPresentation(player));
        if (mode.equals("hub")) {
            ensureSelector(player);
            Bukkit.getScheduler().runTaskLater(this, () -> ensureSelector(player), 120L);
            return;
        }
        if (mode.equals("gateway")) {
            new BukkitRunnable() {
                private int elapsedTicks;

                @Override
                public void run() {
                    if (!player.isOnline()) {
                        cancel();
                        return;
                    }
                    elapsedTicks += 10;
                    if (isGatewayLoginComplete(player)) {
                        cancel();
                        connect(player, hubAlias);
                    } else if (elapsedTicks >= 900) {
                        cancel();
                    }
                }
            }.runTaskTimer(this, 40L, 10L);
            return;
        }
        if (java.util.List.of("survival", "creative").contains(mode)) loadLocation(player);
        if (isFrozen(player)) Bukkit.getScheduler().runTaskLater(this, () -> player.sendMessage("§c§lSigues congelado. Espera instrucciones del staff."), 40L);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        saveLocation(event.getPlayer());
        Bukkit.getScheduler().runTaskLater(this, this::updatePlayerLists, 2L);
        UUID id = event.getPlayer().getUniqueId();
        followedPlayers.remove(id);
        followedPlayers.values().removeIf(id::equals);
        staffChatPlayers.remove(id);
    }

    @EventHandler
    public void onInteract(PlayerInteractEvent event) {
        if (isFrozen(event.getPlayer())) {
            event.setCancelled(true);
            return;
        }
        ItemStack item = event.getItem();
        if (item == null || !item.hasItemMeta() || !item.getItemMeta().getPersistentDataContainer().has(selectorKey, PersistentDataType.BYTE)) return;
        event.setCancelled(true);
        openModeSelector(event.getPlayer());
    }

    @EventHandler
    public void onInventoryClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;
        if (isFrozen(player)) {
            event.setCancelled(true);
            return;
        }
        String title = PlainTextComponentSerializer.plainText().serialize(event.getView().title());
        if (title.equals(COSMETICS_TITLE)) {
            event.setCancelled(true);
            ItemStack clicked = event.getCurrentItem();
            if (clicked == null || !clicked.hasItemMeta()) return;
            String selected = clicked.getItemMeta().getPersistentDataContainer().get(cosmeticKey, PersistentDataType.STRING);
            TrailOption option = TRAIL_OPTIONS.stream().filter(trail -> trail.id().equals(selected)).findFirst().orElse(null);
            if (option == null) return;
            if (!hasRankAtLeast(player, option.requiredRank())) {
                player.sendMessage("§cEste cosmético requiere rango " + option.requiredRank().toUpperCase() + ".");
                return;
            }
            getConfig().set("cosmetics.players." + player.getUniqueId() + ".trail", option.id());
            saveConfig();
            JsonObject cosmeticEvent = new JsonObject();
            cosmeticEvent.addProperty("operation", "cosmetic");
            cosmeticEvent.addProperty("uuid", player.getUniqueId().toString());
            cosmeticEvent.addProperty("trail", option.id());
            sendNetworkModeration(player, cosmeticEvent);
            player.closeInventory();
            player.sendMessage(option.id().equals("off") ? "§eEfecto cosmético desactivado." : "§aCosmético equipado: " + option.label() + ".");
            return;
        }
        if (title.equals(MENU_TITLE)) {
            event.setCancelled(true);
            if (event.getClickedInventory() != event.getView().getTopInventory()) return;
            String action = readMenuAction(event.getCurrentItem());
            switch (action) {
                case "staff" -> openStaffMenu(player);
                case "modes" -> {
                    player.closeInventory();
                    openModeSelector(player);
                }
                case "kits" -> openKitMenu(player);
                case "warps" -> openWarpMenu(player);
                case "homes" -> openHomesMenu(player);
                case "cosmetics" -> openCosmetics(player);
                case "profile" -> openProfile(player);
                case "discord" -> player.sendMessage(Component.text("Scarll's Universe · Discord", NamedTextColor.LIGHT_PURPLE)
                        .clickEvent(net.kyori.adventure.text.event.ClickEvent.openUrl(getConfig().getString("promotion-bot.store-url", "https://discord.gg/XnJjTqyKDM"))));
                default -> { }
            }
            return;
        }
        if (title.equals(STAFF_TITLE)) {
            event.setCancelled(true);
            if (!hasStaffRole(player, 1)) return;
            if (event.getClickedInventory() != event.getView().getTopInventory()) return;
            if (readMenuAction(event.getCurrentItem()).equals("close")) {
                player.closeInventory();
                return;
            }
            if (readMenuAction(event.getCurrentItem()).equals("staff_vanish")) {
                toggleVanish(player);
                openStaffMenu(player);
                return;
            }
            if (readMenuAction(event.getCurrentItem()).equals("reports")) {
                openReportsMenu(player);
                return;
            }
            UUID targetId = readTargetPlayer(event.getCurrentItem());
            Player target = targetId == null ? null : Bukkit.getPlayer(targetId);
            if (target != null) openStaffPlayerMenu(player, target);
            return;
        }
        if (title.startsWith(STAFF_PLAYER_TITLE)) {
            event.setCancelled(true);
            if (!hasStaffRole(player, 1)) return;
            if (event.getClickedInventory() != event.getView().getTopInventory()) return;
            String action = readMenuAction(event.getCurrentItem());
            if (action.equals("staff_back")) {
                openStaffMenu(player);
                return;
            }
            UUID targetId = readTargetPlayer(event.getCurrentItem());
            Player target = targetId == null ? null : Bukkit.getPlayer(targetId);
            if (target == null) {
                player.sendMessage("§cEse jugador ya no está conectado.");
                openStaffMenu(player);
                return;
            }
            if (staffLevel(player) <= staffLevel(target)) {
                player.sendMessage("§cNo puedes inspeccionar a alguien de tu mismo rango staff o superior.");
                openStaffMenu(player);
                return;
            }
            switch (action) {
                case "staff_history" -> {
                    if (!hasStaffRole(player, 2)) player.sendMessage("§cEl historial requiere rango Moderador o superior.");
                    else if (!Bukkit.getPluginManager().isPluginEnabled("CoreProtect")) player.sendMessage("§eCoreProtect no está instalado en este servidor.");
                    else {
                        var attachment = player.addAttachment(this);
                        attachment.setPermission("coreprotect.lookup", true);
                        attachment.setPermission("coreprotect.co", true);
                        try {
                            player.performCommand("co lookup u:" + target.getName() + " t:1h");
                        } finally {
                            player.removeAttachment(attachment);
                        }
                    }
                }
                case "staff_follow" -> followPlayer(player, new String[]{target.getName()});
                case "staff_ender" -> openReadOnlyEnderChest(player, target);
                case "staff_teleport" -> {
                    player.teleportAsync(target.getLocation());
                    player.sendMessage("§aTeletransportado con " + target.getName() + ".");
                }
                case "staff_inventory" -> openReadOnlyInventory(player, target);
                case "staff_kick" -> openKickConfirmation(player, target);
                case "staff_freeze" -> setFrozen(player, target, !isFrozen(target));
                default -> { }
            }
            return;
        }
        if (title.startsWith(STAFF_CONFIRM_TITLE)) {
            event.setCancelled(true);
            if (!hasStaffRole(player, 2)) return;
            if (event.getClickedInventory() != event.getView().getTopInventory()) return;
            UUID targetId = readTargetPlayer(event.getCurrentItem());
            Player target = targetId == null ? null : Bukkit.getPlayer(targetId);
            String action = readMenuAction(event.getCurrentItem());
            if (target != null && staffLevel(player) <= staffLevel(target)) {
                player.sendMessage("§cNo puedes moderar a alguien de tu mismo rango o superior.");
                openStaffMenu(player);
                return;
            }
            if (action.equals("kick_confirm") && target != null) {
                target.kick(Component.text("Has sido expulsado por el equipo de moderación."));
                player.sendMessage("§aExpulsaste a " + target.getName() + ".");
                openStaffMenu(player);
            } else if (action.equals("staff_back")) {
                if (target != null) openStaffPlayerMenu(player, target);
                else openStaffMenu(player);
            }
            return;
        }
        if (title.equals("Reportes abiertos")) {
            event.setCancelled(true);
            if (event.getClickedInventory() != event.getView().getTopInventory()) return;
            if (readMenuAction(event.getCurrentItem()).startsWith("report_")) toggleReport(player, event.getCurrentItem(), event.isShiftClick());
            return;
        }
        if (title.startsWith("Inspección · ")) {
            event.setCancelled(true);
            return;
        }
        if (title.startsWith("Perfil · ")) {
            event.setCancelled(true);
            return;
        }
        if (title.equals("Kits Salvadiux")) {
            event.setCancelled(true);
            if (event.getClickedInventory() != event.getView().getTopInventory()) return;
            String kit = readMenuAction(event.getCurrentItem());
            if (kit.startsWith("claim_")) {
                player.closeInventory();
                claimKit(player, new String[]{kit.substring("claim_".length())});
            }
            return;
        }
        if (title.equals("Warps Salvadiux")) {
            event.setCancelled(true);
            if (event.getClickedInventory() != event.getView().getTopInventory()) return;
            String warpName = readMenuAction(event.getCurrentItem());
            if (warpName.startsWith("warp_")) {
                player.closeInventory();
                warp(player, new String[]{warpName.substring("warp_".length())});
            }
            return;
        }
        if (title.equals("Homes Salvadiux")) {
            event.setCancelled(true);
            if (event.getClickedInventory() != event.getView().getTopInventory()) return;
            String home = readMenuAction(event.getCurrentItem());
            if (home.startsWith("home_")) {
                player.closeInventory();
                teleportHome(player, home.substring("home_".length()));
            }
            return;
        }
        if (!title.equals("Choose a game mode")) return;
        event.setCancelled(true);
        ItemStack item = event.getCurrentItem();
        if (item == null || !item.hasItemMeta()) return;
        String alias = item.getItemMeta().getPersistentDataContainer().get(selectorKey, PersistentDataType.STRING);
        if (alias == null || alias.isBlank()) return;
        player.closeInventory();
        connect(player, alias);
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrozenInventoryDrag(InventoryDragEvent event) {
        if (event.getWhoClicked() instanceof Player player && isFrozen(player)) event.setCancelled(true);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("This command is only available in game.");
            return true;
        }
        if (mode.equals("gateway") && !isGatewayLoginComplete(player)) {
            player.sendMessage("§cInicia sesión antes de usar comandos de la network.");
            return true;
        }
        switch (command.getName().toLowerCase()) {
            case "menu" -> openMainMenu(player);
            case "staff" -> openStaffMenu(player);
            case "kit" -> claimKit(player, args);
            case "promo" -> launchPromotion(player, args);
            case "cosmeticos" -> openCosmetics(player);
            case "modalidades" -> {
                if (mode.equals("hub")) openModeSelector(player);
                else player.sendMessage("§eUsa /hub para abrir el selector de modalidades.");
            }
            case "survival", "creative" -> {
                String targetMode = command.getName().toLowerCase();
                if (mode.equals("gateway")) player.sendMessage("§eInicia sesión y usa la brújula del Hub para elegir una modalidad.");
                else connect(player, getConfig().getString("mode-servers." + targetMode, targetMode));
            }
            case "hub" -> {
                if (mode.equals("gateway") && !isGatewayLoginComplete(player)) {
                    player.sendMessage("§cInicia sesión antes de salir del lobby de autenticación.");
                    return true;
                }
                connect(player, hubAlias);
            }
            case "feed" -> feed(player);
            case "ec" -> openEnderChest(player);
            case "craft" -> openCrafting(player);
            case "fly" -> toggleFlight(player);
            case "warp" -> warp(player, args);
            case "setwarp" -> setWarp(player, args);
            case "delwarp" -> deleteWarp(player, args);
            case "home" -> {
                if (args.length == 0) openHomesMenu(player);
                else teleportHome(player, args[0]);
            }
            case "sethome" -> setHome(player, args);
            case "homes" -> listHomes(player);
            case "delhome" -> deleteHome(player, args);
            case "tpa" -> requestTeleport(player, args, false);
            case "tpahere" -> requestTeleport(player, args, true);
            case "tpaccept" -> acceptTeleport(player);
            case "tpdeny" -> denyTeleport(player);
            case "rtp" -> randomTeleport(player);
            case "report" -> submitReport(player, args);
            case "reports" -> openReportsMenu(player);
            case "freeze" -> {
                if (!hasStaffRole(player, 2)) player.sendMessage("§cCongelar requiere rango Moderador o superior.");
                else if (args.length != 1) player.sendMessage("§eUso: /freeze <jugador>");
                else {
                    Player target = Bukkit.getPlayerExact(args[0]);
                    if (target == null) player.sendMessage("§cEse jugador no está conectado.");
                    else setFrozen(player, target, !isFrozen(target));
                }
            }
            case "warn" -> warnPlayer(player, args);
            case "mute" -> mutePlayer(player, args);
            case "unmute" -> unmutePlayer(player, args);
            case "ban" -> banPlayer(player, args);
            case "unban" -> unbanPlayer(player, args);
            case "note" -> addStaffNote(player, args);
            case "notes" -> showStaffNotes(player, args);
            case "vanish" -> toggleVanish(player);
            case "follow" -> followPlayer(player, args);
            case "sc", "staffchat" -> toggleStaffChat(player, args);
            case "spawn" -> {
                World world = player.getWorld();
                Location spawn = world.getSpawnLocation();
                previousLocations.put(player.getUniqueId(), player.getLocation().clone());
                player.teleportAsync(spawn).thenAccept(success -> Bukkit.getScheduler().runTask(this, () -> player.sendMessage(success ? "§aReturned to this mode's spawn." : "§cCould not load the spawn.")));
            }
            case "back" -> {
                Location previous = previousLocations.get(player.getUniqueId());
                if (previous == null || !previous.getWorld().equals(player.getWorld())) player.sendMessage("§eNo previous position is available in this mode.");
                else {
                    Location current = player.getLocation().clone();
                    player.teleportAsync(previous).thenAccept(success -> { if (success) previousLocations.put(player.getUniqueId(), current); });
                }
            }
            default -> { return false; }
        }
        return true;
    }

    private void openMainMenu(Player player) {
        Inventory inventory = Bukkit.createInventory(null, 45, Component.text(MENU_TITLE, NamedTextColor.DARK_PURPLE).decorate(TextDecoration.BOLD));
        inventory.setItem(4, menuItem(Material.NETHER_STAR, "§d§lSALVADIUX NETWORK", List.of("§7Modo actual: §f" + mode, "§7Rango: §f" + rankLabel(player)), null));
        inventory.setItem(10, menuItem(Material.COMPASS, "§b§lModalidades", List.of("§7Elige Survival, Creative o Hub."), "modes"));
        inventory.setItem(12, menuItem(Material.ENCHANTED_BOOK, "§6§lKits", List.of("§7Consulta y reclama los kits de tu rango.", "§8Los kits se reclaman en Survival."), "kits"));
        inventory.setItem(14, menuItem(Material.MAP, "§a§lWarps", List.of("§7Explora los warps disponibles para tu rango."), "warps"));
        inventory.setItem(16, menuItem(Material.FIREWORK_STAR, "§d§lCosméticos", List.of("§7Partículas visuales desbloqueadas por rango."), "cosmetics"));
        inventory.setItem(20, menuItem(Material.RED_BED, "§a§lMis homes", List.of("§7Ubicaciones guardadas en Survival.", "§e/home §7Abrir · §e/sethome §7Guardar"), "homes"));
        inventory.setItem(29, menuItem(Material.PLAYER_HEAD, "§e§lMi perfil", List.of("§7Rango, modo y estadísticas locales."), "profile"));
        inventory.setItem(31, menuItem(Material.WRITABLE_BOOK, "§f§lAyuda rápida", List.of("§e/hub §7Volver al lobby", "§e/spawn §7Volver al spawn", "§e/back §7Regresar a tu posición anterior", "§e/tpa <jugador> §7Solicitar teleport", "§e/rtp §7Explorar Survival", "§e/report <jugador> <motivo>"), null));
        inventory.setItem(33, menuItem(Material.AMETHYST_SHARD, "§5§lScarll's Universe", List.of("§7Abre el Discord de la comunidad."), "discord"));
        if (hasStaffRole(player, 1)) inventory.setItem(40, menuItem(Material.IRON_SWORD, "§c§lPanel Staff", List.of("§7Herramientas según tu rol de staff."), "staff"));
        player.openInventory(inventory);
    }

    private void openProfile(Player player) {
        Inventory inventory = Bukkit.createInventory(null, 27, Component.text("Perfil · " + player.getName(), NamedTextColor.AQUA));
        inventory.setItem(10, menuItem(Material.PLAYER_HEAD, "§f" + player.getName(), List.of("§7Rango: " + rankLabel(player), "§7Modo: §f" + mode, "§7Mundo: §f" + player.getWorld().getName()), null));
        inventory.setItem(13, menuItem(Material.CLOCK, "§bTiempo y combate", List.of("§7Tiempo jugado en este servidor: §f" + player.getStatistic(org.bukkit.Statistic.PLAY_ONE_MINUTE) / 1200 + " min", "§7Muertes: §f" + player.getStatistic(org.bukkit.Statistic.DEATHS), "§7Bajas: §f" + player.getStatistic(org.bukkit.Statistic.PLAYER_KILLS)), null));
        inventory.setItem(16, menuItem(Material.GRASS_BLOCK, "§aExploración", List.of("§7Bloques caminados: §f" + player.getStatistic(org.bukkit.Statistic.WALK_ONE_CM) / 100 + " m", "§7Bloques minados: §f" + player.getStatistic(org.bukkit.Statistic.MINE_BLOCK, Material.STONE)), null));
        player.openInventory(inventory);
    }

    private void openKitMenu(Player player) {
        Inventory inventory = Bukkit.createInventory(null, 27, Component.text("Kits Salvadiux", NamedTextColor.GOLD));
        String[] kits = {"user", "vip", "ultra", "admin", "owner"};
        Material[] icons = {Material.CHEST, Material.DIAMOND, Material.NETHERITE_INGOT, Material.IRON_SWORD, Material.NETHER_STAR};
        for (int i = 0; i < kits.length; i++) {
            String kit = kits[i];
            boolean available = hasRankAtLeast(player, kit);
            inventory.setItem(10 + i, menuItem(icons[i], (available ? "§a" : "§c") + "Kit " + kit.toUpperCase(), List.of(available ? "§7Pulsa para reclamar" : "§cRequiere rango " + kit.toUpperCase(), "§8Cooldown y reglas normales aplican"), available ? "claim_" + kit : null));
        }
        player.openInventory(inventory);
    }

    private void openWarpMenu(Player player) {
        Inventory inventory = Bukkit.createInventory(null, 54, Component.text("Warps Salvadiux", NamedTextColor.GREEN));
        var section = getConfig().getConfigurationSection("warps");
        if (section != null) {
            int slot = 0;
            for (String name : section.getKeys(false).stream().sorted().toList()) {
                if (slot >= 45) break;
                String required = getConfig().getString("warps." + name + ".rank", "user");
                boolean available = hasRankAtLeast(player, required);
                inventory.setItem(slot++, menuItem(available ? Material.LODESTONE : Material.BARRIER,
                        (available ? "§a" : "§c") + name, List.of("§7Rango mínimo: §f" + required.toUpperCase()), available ? "warp_" + name : null));
            }
        }
        if (inventory.firstEmpty() == 0) inventory.setItem(22, menuItem(Material.PAPER, "§eNo hay warps configurados", List.of("§7Un Admin puede crear uno con /setwarp."), null));
        player.openInventory(inventory);
    }

    private void openStaffMenu(Player player) {
        if (!hasStaffRole(player, 1)) {
            player.sendMessage("§cEl panel Staff requiere rango Helper o superior.");
            return;
        }
        Inventory inventory = Bukkit.createInventory(null, 54, Component.text(STAFF_TITLE, NamedTextColor.RED).decorate(TextDecoration.BOLD));
        int slot = 0;
        for (Player target : Bukkit.getOnlinePlayers()) {
            if (slot >= 45) break;
            ItemStack head = new ItemStack(Material.PLAYER_HEAD);
            SkullMeta meta = (SkullMeta) head.getItemMeta();
            meta.setOwningPlayer(target);
            meta.displayName(Component.text(target.getName(), NamedTextColor.WHITE));
            meta.lore(List.of(Component.text("Rango: " + rankLabel(target), NamedTextColor.GRAY), Component.text("Pulsa para inspeccionar", NamedTextColor.YELLOW)));
            meta.getPersistentDataContainer().set(targetPlayerKey, PersistentDataType.STRING, target.getUniqueId().toString());
            head.setItemMeta(meta);
            inventory.setItem(slot++, head);
        }
        inventory.setItem(49, menuItem(Material.BARRIER, "§cCerrar", List.of(), "close"));
        inventory.setItem(48, menuItem(Material.WRITABLE_BOOK, "§eReportes", List.of("§7Revisar y cerrar reportes pendientes."), "reports"));
        if (hasStaffRole(player, 2)) inventory.setItem(47, menuItem(Material.POTION, "§dVanish", List.of(vanishedPlayers.contains(player.getUniqueId()) ? "§7Estado: activado" : "§7Estado: desactivado"), "staff_vanish"));
        player.openInventory(inventory);
    }

    private void openStaffPlayerMenu(Player staff, Player target) {
        Inventory inventory = Bukkit.createInventory(null, 27, Component.text(STAFF_PLAYER_TITLE + target.getName(), NamedTextColor.RED));
        inventory.setItem(4, playerHead(target, "§f" + target.getName(), List.of("§7Rango: " + rankLabel(target), "§7Mundo: §f" + target.getWorld().getName(), "§7Ping: §f" + target.getPing() + " ms"), null));
        boolean coreProtect = Bukkit.getPluginManager().isPluginEnabled("CoreProtect");
        ItemStack historyItem = menuItem(coreProtect ? Material.WRITABLE_BOOK : Material.GRAY_DYE,
                coreProtect ? "§eHistorial de bloques" : "§7Historial no disponible",
                List.of(coreProtect ? "§7CoreProtect · últimas 1 h" : "§8Instala CoreProtect para habilitarlo."), coreProtect ? "staff_history" : null);
        if (coreProtect) {
            ItemMeta historyMeta = historyItem.getItemMeta();
            historyMeta.getPersistentDataContainer().set(targetPlayerKey, PersistentDataType.STRING, target.getUniqueId().toString());
            historyItem.setItemMeta(historyMeta);
        }
        if (hasStaffRole(staff, 2)) inventory.setItem(9, historyItem);
        inventory.setItem(11, playerHead(target, "§bTeletransportarse", List.of("§7Ir a la ubicación actual del jugador."), "staff_teleport"));
        inventory.setItem(10, playerHead(target, "§dSeguir", List.of("§7Mantenerte cerca del jugador."), "staff_follow"));
        inventory.setItem(12, playerHead(target, "§5Ender Chest", List.of("§7Abrir inventario de solo lectura."), "staff_ender"));
        inventory.setItem(13, playerHead(target, "§eVer inventario", List.of("§7Vista de solo lectura.", "§8Admin/Owner pueden revisar contenido."), "staff_inventory"));
        if (hasStaffRole(staff, 2)) {
            inventory.setItem(15, playerHead(target, "§cExpulsar", List.of("§7Abrir confirmación antes de ejecutar."), "staff_kick"));
            inventory.setItem(17, playerHead(target, isFrozen(target) ? "§aDescongelar" : "§bCongelar", List.of("§7" + (isFrozen(target) ? "Quitar freeze" : "Bloquea movimiento y acciones")), "staff_freeze"));
        }
        inventory.setItem(22, menuItem(Material.ARROW, "§fVolver a jugadores", List.of(), "staff_back"));
        staff.openInventory(inventory);
    }

    private void openReadOnlyInventory(Player staff, Player target) {
        Inventory inventory = Bukkit.createInventory(null, 54, Component.text("Inspección · " + target.getName(), NamedTextColor.YELLOW));
        ItemStack[] contents = target.getInventory().getStorageContents();
        for (int i = 0; i < Math.min(36, contents.length); i++) inventory.setItem(i, contents[i] == null ? null : contents[i].clone());
        ItemStack[] armor = target.getInventory().getArmorContents();
        for (int i = 0; i < armor.length; i++) inventory.setItem(45 + i, armor[i] == null ? null : armor[i].clone());
        ItemStack offhand = target.getInventory().getItemInOffHand();
        if (!offhand.getType().isAir()) inventory.setItem(50, offhand.clone());
        inventory.setItem(53, menuItem(Material.BARRIER, "§cVista de solo lectura", List.of("§7Los objetos no pueden moverse desde aquí."), null));
        staff.openInventory(inventory);
    }

    private void openReadOnlyEnderChest(Player staff, Player target) {
        Inventory inventory = Bukkit.createInventory(null, 27, Component.text("Inspección · EnderChest " + target.getName(), NamedTextColor.DARK_PURPLE));
        ItemStack[] contents = target.getEnderChest().getContents();
        for (int i = 0; i < contents.length; i++) inventory.setItem(i, contents[i] == null ? null : contents[i].clone());
        staff.openInventory(inventory);
    }

    private void openKickConfirmation(Player staff, Player target) {
        Inventory inventory = Bukkit.createInventory(null, 27, Component.text(STAFF_CONFIRM_TITLE + target.getName(), NamedTextColor.DARK_RED));
        inventory.setItem(11, playerHead(target, "§c§lConfirmar expulsión", List.of("§7Expulsar a " + target.getName() + " del servidor."), "kick_confirm"));
        inventory.setItem(15, playerHead(target, "§aCancelar", List.of("§7Volver al inspector."), "staff_back"));
        staff.openInventory(inventory);
    }

    private ItemStack playerHead(Player target, String name, List<String> lore, String action) {
        ItemStack item = new ItemStack(Material.PLAYER_HEAD);
        SkullMeta meta = (SkullMeta) item.getItemMeta();
        meta.setOwningPlayer(target);
        meta.displayName(LegacyComponentSerializer.legacySection().deserialize(name));
        meta.lore(lore.stream().map(line -> LegacyComponentSerializer.legacySection().deserialize(line)).toList());
        if (action != null) meta.getPersistentDataContainer().set(menuActionKey, PersistentDataType.STRING, action);
        meta.getPersistentDataContainer().set(targetPlayerKey, PersistentDataType.STRING, target.getUniqueId().toString());
        item.setItemMeta(meta);
        return item;
    }

    private ItemStack menuItem(Material material, String name, List<String> lore, String action) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        meta.displayName(LegacyComponentSerializer.legacySection().deserialize(name));
        meta.lore(lore.stream().map(line -> LegacyComponentSerializer.legacySection().deserialize(line)).toList());
        if (action != null) meta.getPersistentDataContainer().set(menuActionKey, PersistentDataType.STRING, action);
        item.setItemMeta(meta);
        return item;
    }

    private String readMenuAction(ItemStack item) {
        if (item == null || !item.hasItemMeta()) return "";
        return item.getItemMeta().getPersistentDataContainer().getOrDefault(menuActionKey, PersistentDataType.STRING, "");
    }

    private UUID readTargetPlayer(ItemStack item) {
        if (item == null || !item.hasItemMeta()) return null;
        String value = item.getItemMeta().getPersistentDataContainer().get(targetPlayerKey, PersistentDataType.STRING);
        if (value == null) return null;
        try { return UUID.fromString(value); } catch (IllegalArgumentException ignored) { return null; }
    }

    private String rankLabel(Player player) {
        String rank = displayRank(player);
        String color = switch (rank) { case "OWNER" -> "§6"; case "ADMIN", "MODERATOR" -> "§c"; case "SRMOD" -> "§5"; case "HELPER", "USER" -> "§a"; case "ULTRA" -> "§d"; default -> "§b"; };
        return color + rank;
    }

    private String displayRank(Player player) {
        int staff = staffLevel(player);
        if (staff >= 5) return "OWNER";
        if (staff >= 4) return "ADMIN";
        if (staff >= 3) return "SRMOD";
        if (staff >= 2) return "MODERATOR";
        if (staff >= 1) return "HELPER";
        return player.hasPermission("salvadiux.rank.ultra") ? "ULTRA"
                : player.hasPermission("salvadiux.rank.vip") ? "VIP" : "USER";
    }

    private NamedTextColor rankColor(Player player) {
        return switch (displayRank(player)) {
            case "OWNER" -> NamedTextColor.GOLD;
            case "ADMIN" -> NamedTextColor.RED;
            case "SRMOD" -> NamedTextColor.DARK_PURPLE;
            case "MODERATOR" -> NamedTextColor.RED;
            case "HELPER" -> NamedTextColor.GREEN;
            case "ULTRA" -> NamedTextColor.LIGHT_PURPLE;
            case "VIP" -> NamedTextColor.AQUA;
            default -> NamedTextColor.GREEN;
        };
    }

    private void updatePlayerLists() {
        for (Player player : Bukkit.getOnlinePlayers()) updatePlayerList(player);
    }

    private void updatePlayerList(Player player) {
        if (!getConfig().getBoolean("tab-list.enabled", true)) return;
        String discordUrl = getConfig().getString("tab-list.discord-url", getConfig().getString("promotion-bot.store-url", "https://discord.gg/XnJjTqyKDM"));
        if (discordUrl == null || !discordUrl.startsWith("https://")) discordUrl = "https://discord.gg/XnJjTqyKDM";
        String modeName = switch (mode) {
            case "gateway" -> "Login";
            case "hub" -> "Hub";
            case "survival" -> "Survival";
            case "creative" -> "Creativo";
            default -> mode;
        };
        Component discord = Component.text("Discord", NamedTextColor.AQUA, TextDecoration.UNDERLINED)
                .clickEvent(ClickEvent.openUrl(discordUrl))
                .hoverEvent(HoverEvent.showText(Component.text("Abrir Scarll's Universe", NamedTextColor.GRAY)));
        Component header = Component.text("✦ SCARLL'S UNIVERSE ✦", NamedTextColor.LIGHT_PURPLE, TextDecoration.BOLD)
                .append(Component.newline())
                .append(Component.text("━━━━━━━━━━━━━━━━━━━━━━━━", NamedTextColor.DARK_GRAY))
                .append(Component.newline())
                .append(Component.text("Network · " + modeName + " · ", NamedTextColor.GRAY))
                .append(discord);
        Component footer = Component.text("━━━━━━━━━━━━━━━━━━━━━━━━", NamedTextColor.DARK_GRAY)
                .append(Component.newline())
                .append(Component.text("Jugadores en este modo: ", NamedTextColor.GRAY))
                .append(Component.text(Bukkit.getOnlinePlayers().size() + " / " + Bukkit.getMaxPlayers(), NamedTextColor.WHITE))
                .append(Component.newline())
                .append(Component.text("Tu rango: ", NamedTextColor.GRAY))
                .append(Component.text(displayRank(player), rankColor(player), TextDecoration.BOLD));
        player.sendPlayerListHeaderAndFooter(header, footer);
    }

    private void giveSelector(Player player) {
        ItemStack item = new ItemStack(Material.COMPASS);
        ItemMeta meta = item.getItemMeta();
        meta.displayName(Component.text("Game modes", NamedTextColor.AQUA).decorate(TextDecoration.BOLD));
        meta.lore(java.util.List.of(Component.text("Right click to choose a mode", NamedTextColor.GRAY)));
        meta.getPersistentDataContainer().set(selectorKey, PersistentDataType.BYTE, (byte) 1);
        item.setItemMeta(meta);
        player.getInventory().setItem(4, item);
    }

    private void ensureSelector(Player player) {
        if (!player.isOnline()) return;
        for (ItemStack item : player.getInventory().getStorageContents()) {
            if (item != null && item.hasItemMeta() && item.getItemMeta().getPersistentDataContainer().has(selectorKey, PersistentDataType.BYTE)) return;
        }
        giveSelector(player);
    }

    private void applyRankPresentation(Player player) {
        String rank = displayRank(player).toLowerCase(java.util.Locale.ROOT);
        NamedTextColor color = rankColor(player);
        String label = displayRank(player);
        Component prefix = Component.text("[" + label + "] ", color, TextDecoration.BOLD);
        player.playerListName(prefix.append(Component.text(player.getName(), NamedTextColor.WHITE)));
        Scoreboard scoreboard = Bukkit.getScoreboardManager().getMainScoreboard();
        String teamName = switch (rank) {
            case "owner" -> "sv_00_owner";
            case "admin" -> "sv_01_admin";
            case "srmod" -> "sv_02_srmod";
            case "moderator" -> "sv_03_moderator";
            case "helper" -> "sv_04_helper";
            case "ultra" -> "sv_05_ultra";
            case "vip" -> "sv_06_vip";
            default -> "sv_07_user";
        };
        Team team = scoreboard.getTeam(teamName);
        if (team == null) team = scoreboard.registerNewTeam(teamName);
        team.prefix(prefix);
        team.color(color);
        team.setOption(Team.Option.NAME_TAG_VISIBILITY, Team.OptionStatus.ALWAYS);
        for (Team existing : scoreboard.getTeams()) {
            if (!existing.equals(team) && existing.hasEntry(player.getName())) existing.removeEntry(player.getName());
        }
        team.addEntry(player.getName());
        player.setScoreboard(scoreboard);
    }

    private void claimKit(Player player, String[] args) {
        if (!mode.equals("survival")) {
            player.sendMessage("§eLos kits se reclaman en Survival.");
            return;
        }
        if (args.length == 0) {
            List<String> available = List.of("user", "vip", "ultra", "admin", "owner").stream()
                    .filter(kit -> hasRankAtLeast(player, kit)).toList();
            player.sendMessage("§eTus kits: " + String.join(", ", available) + ". Usa /kit <rango>.");
            return;
        }
        String kit = args[0].toLowerCase();
        if (!List.of("user", "vip", "ultra", "admin", "owner").contains(kit)) {
            player.sendMessage("§cEse kit no existe. Usa /kit para ver los disponibles.");
            return;
        }
        if (!hasRankAtLeast(player, kit)) {
            player.sendMessage("§cTu rango no tiene acceso a ese kit.");
            return;
        }
        long now = System.currentTimeMillis();
        String claimPath = "kit-claims." + player.getUniqueId() + "." + kit;
        boolean unlimited = getRankLevel(player) >= getRankLevel("owner");
        long cooldownHours = Math.max(0, getConfig().getLong("rank-features.kit-cooldown-hours", 24));
        long cooldownMillis = unlimited ? 0 : cooldownHours * 3_600_000L;
        long remaining = cooldownMillis - (now - getConfig().getLong(claimPath, 0L));
        if (cooldownMillis > 0 && remaining > 0) {
            player.sendMessage("§ePodrás volver a reclamarlo en " + Math.max(1, remaining / 3_600_000L) + " h.");
            return;
        }
        List<ItemStack> items = createKit(kit);
        decorateKit(items, kit);
        long emptySlots = java.util.Arrays.stream(player.getInventory().getStorageContents()).filter(item -> item == null || item.getType().isAir()).count();
        if (emptySlots < items.size()) {
            player.sendMessage("§cLibera " + items.size() + " espacios de inventario antes de reclamar este kit.");
            return;
        }
        player.getInventory().addItem(items.toArray(ItemStack[]::new));
        if (cooldownMillis > 0) {
            getConfig().set(claimPath, now);
            saveConfig();
        }
        player.sendMessage(unlimited ? "§aKit " + kit.toUpperCase() + " reclamado. Owner no tiene espera entre kits." : "§aKit " + kit.toUpperCase() + " reclamado. Próximo uso en " + cooldownHours + " h.");
    }

    private void feed(Player player) {
        if (!hasFeature(player, "feed", "vip")) return;
        player.setFoodLevel(20);
        player.setSaturation(20);
        player.sendMessage("§aHambre restaurada.");
    }

    private void openEnderChest(Player player) {
        if (!hasFeature(player, "enderchest", "ultra")) return;
        player.openInventory(player.getEnderChest());
    }

    private void openCrafting(Player player) {
        if (!hasFeature(player, "craft", "vip")) return;
        player.openWorkbench(player.getLocation(), true);
    }

    private void toggleFlight(Player player) {
        if (!hasFeature(player, "fly", "ultra")) return;
        boolean enabled = !player.getAllowFlight();
        player.setAllowFlight(enabled);
        if (!enabled && player.isFlying()) player.setFlying(false);
        player.sendMessage(enabled ? "§aVuelo activado." : "§eVuelo desactivado.");
    }

    private boolean hasFeature(Player player, String feature, String defaultRank) {
        String required = getConfig().getString("rank-features." + feature, defaultRank).toLowerCase();
        if (hasRankAtLeast(player, required)) return true;
        player.sendMessage("§cNecesitas rango " + required.toUpperCase() + " o superior para usar esto.");
        return false;
    }

    private int getRankLevel(Player player) {
        if (player.isOp() || player.hasPermission("salvadiux.rank.owner")) return getRankLevel("owner");
        if (player.hasPermission("salvadiux.rank.admin")) return getRankLevel("admin");
        if (player.hasPermission("salvadiux.rank.ultra")) return getRankLevel("ultra");
        if (player.hasPermission("salvadiux.rank.vip")) return getRankLevel("vip");
        return getRankLevel("user");
    }

    private int getRankLevel(String rank) {
        return switch (rank.toLowerCase()) {
            case "owner" -> 5;
            case "admin", "staff" -> 4;
            case "ultra" -> 3;
            case "vip" -> 2;
            default -> 1;
        };
    }

    private boolean hasRankAtLeast(Player player, String required) {
        return getRankLevel(player) >= getRankLevel(required);
    }

    private void warp(Player player, String[] args) {
        var section = getConfig().getConfigurationSection("warps");
        if (args.length == 0) {
            if (section == null || section.getKeys(false).isEmpty()) {
                player.sendMessage("§eAún no hay warps. Un Owner o Admin puede crearlos con /setwarp <nombre> [rango].");
                return;
            }
            List<String> available = section.getKeys(false).stream()
                    .filter(name -> hasRankAtLeast(player, getConfig().getString("warps." + name + ".rank", "user")))
                    .sorted().toList();
            player.sendMessage(available.isEmpty() ? "§eNo tienes warps disponibles." : "§aWarps: §f" + String.join(", ", available));
            return;
        }
        String name = normalizeWarpName(args[0]);
        if (name.isBlank()) {
            player.sendMessage("§cEl nombre del warp no es válido.");
            return;
        }
        String path = "warps." + name;
        if (!getConfig().contains(path + ".world")) {
            player.sendMessage("§cNo existe el warp " + name + ". Usa /warp para ver los disponibles.");
            return;
        }
        String required = getConfig().getString(path + ".rank", "user").toLowerCase();
        if (!hasRankAtLeast(player, required)) {
            player.sendMessage("§cEse warp requiere rango " + required.toUpperCase() + " o superior.");
            return;
        }
        World world = Bukkit.getWorld(getConfig().getString(path + ".world", ""));
        if (world == null) {
            player.sendMessage("§cEl mundo de ese warp no está cargado.");
            return;
        }
        Location destination = new Location(world, getConfig().getDouble(path + ".x"), getConfig().getDouble(path + ".y"), getConfig().getDouble(path + ".z"), (float) getConfig().getDouble(path + ".yaw"), (float) getConfig().getDouble(path + ".pitch"));
        previousLocations.put(player.getUniqueId(), player.getLocation().clone());
        player.teleportAsync(destination).thenAccept(success -> Bukkit.getScheduler().runTask(this, () -> player.sendMessage(success ? "§aWarp: " + name : "§cNo se pudo cargar ese warp.")));
    }

    private void setWarp(Player player, String[] args) {
        if (!hasRankAtLeast(player, "admin")) {
            player.sendMessage("§cSolo Admin y Owner pueden crear warps.");
            return;
        }
        if (args.length < 1 || args.length > 2) {
            player.sendMessage("§eUso: /setwarp <nombre> [user|vip|ultra|admin|owner]");
            return;
        }
        String name = normalizeWarpName(args[0]);
        if (name.isBlank()) {
            player.sendMessage("§cEl nombre del warp no es válido.");
            return;
        }
        String required = args.length == 2 ? args[1].toLowerCase() : "user";
        if (!List.of("user", "vip", "ultra", "admin", "owner").contains(required)) {
            player.sendMessage("§cEse rango no es válido.");
            return;
        }
        Location location = player.getLocation();
        String path = "warps." + name;
        getConfig().set(path + ".world", location.getWorld().getName());
        getConfig().set(path + ".x", location.getX());
        getConfig().set(path + ".y", location.getY());
        getConfig().set(path + ".z", location.getZ());
        getConfig().set(path + ".yaw", location.getYaw());
        getConfig().set(path + ".pitch", location.getPitch());
        getConfig().set(path + ".rank", required);
        saveConfig();
        player.sendMessage("§aWarp " + name + " guardado. Rango mínimo: " + required.toUpperCase() + ".");
    }

    private void deleteWarp(Player player, String[] args) {
        if (!hasRankAtLeast(player, "admin")) {
            player.sendMessage("§cSolo Admin y Owner pueden borrar warps.");
            return;
        }
        if (args.length != 1) {
            player.sendMessage("§eUso: /delwarp <nombre>");
            return;
        }
        String name = normalizeWarpName(args[0]);
        if (name.isBlank()) {
            player.sendMessage("§cEl nombre del warp no es válido.");
            return;
        }
        if (!getConfig().contains("warps." + name)) {
            player.sendMessage("§cNo existe el warp " + name + ".");
            return;
        }
        getConfig().set("warps." + name, null);
        saveConfig();
        player.sendMessage("§aWarp " + name + " eliminado.");
    }

    private String normalizeWarpName(String input) {
        String name = input.toLowerCase().replaceAll("[^a-z0-9_-]", "");
        return name.length() > 32 ? name.substring(0, 32) : name;
    }

    private void decorateKit(List<ItemStack> items, String kit) {
        for (ItemStack item : items) decorateKitItem(item, kit);
    }

    private void decorateKitItem(ItemStack item, String kit) {
        if (item == null || item.getType().isAir()) return;
        ItemMeta meta = item.getItemMeta();
        boolean shulker = meta instanceof BlockStateMeta && ((BlockStateMeta) meta).getBlockState() instanceof ShulkerBox;
        if (!shulker) {
            NamedTextColor color = switch (kit) {
                case "owner" -> NamedTextColor.GOLD;
                case "admin" -> NamedTextColor.RED;
                case "ultra" -> NamedTextColor.LIGHT_PURPLE;
                case "vip" -> NamedTextColor.AQUA;
                default -> NamedTextColor.GREEN;
            };
            String rankLabel = kit.toUpperCase();
            meta.displayName(Component.text(itemDisplayName(item.getType()) + " " + rankLabel, color, TextDecoration.BOLD));
            item.setItemMeta(meta);
        }
        if (shulker) {
            BlockStateMeta boxMeta = (BlockStateMeta) item.getItemMeta();
            ShulkerBox box = (ShulkerBox) boxMeta.getBlockState();
            for (int slot = 0; slot < box.getInventory().getSize(); slot++) decorateKitItem(box.getInventory().getItem(slot), kit);
            boxMeta.setBlockState(box);
            item.setItemMeta(boxMeta);
        }
    }

    private String itemDisplayName(Material material) {
        return switch (material) {
            case NETHERITE_SWORD, DIAMOND_SWORD, IRON_SWORD -> "Espada de " + material.name().replace("_SWORD", "").toLowerCase().replace('_', ' ');
            case NETHERITE_PICKAXE, DIAMOND_PICKAXE, IRON_PICKAXE -> "Pico de " + material.name().replace("_PICKAXE", "").toLowerCase().replace('_', ' ');
            case NETHERITE_HELMET, DIAMOND_HELMET, IRON_HELMET -> "Casco de " + material.name().replace("_HELMET", "").toLowerCase().replace('_', ' ');
            case NETHERITE_CHESTPLATE, DIAMOND_CHESTPLATE, IRON_CHESTPLATE -> "Pechera de " + material.name().replace("_CHESTPLATE", "").toLowerCase().replace('_', ' ');
            case NETHERITE_LEGGINGS, DIAMOND_LEGGINGS, IRON_LEGGINGS -> "Grebas de " + material.name().replace("_LEGGINGS", "").toLowerCase().replace('_', ' ');
            case NETHERITE_BOOTS, DIAMOND_BOOTS, IRON_BOOTS -> "Botas de " + material.name().replace("_BOOTS", "").toLowerCase().replace('_', ' ');
            case GOLDEN_APPLE -> "Manzana dorada";
            case COOKED_BEEF -> "Filete";
            case FIREWORK_ROCKET -> "Cohete";
            case SHULKER_BOX -> "Shulker";
            case ELYTRA -> "Élitros";
            default -> material.name().toLowerCase().replace('_', ' ');
        };
    }

    private List<ItemStack> createKit(String kit) {
        List<ItemStack> items = new ArrayList<>();
        switch (kit) {
            case "user" -> {
                items.add(new ItemStack(Material.IRON_SWORD));
                items.add(new ItemStack(Material.IRON_PICKAXE));
                items.add(new ItemStack(Material.IRON_HELMET));
                items.add(new ItemStack(Material.IRON_CHESTPLATE));
                items.add(new ItemStack(Material.IRON_LEGGINGS));
                items.add(new ItemStack(Material.IRON_BOOTS));
                items.add(new ItemStack(Material.COOKED_BEEF, 32));
                items.add(new ItemStack(Material.TORCH, 32));
            }
            case "vip" -> {
                items.add(enchant(Material.DIAMOND_SWORD, Map.of(org.bukkit.enchantments.Enchantment.SHARPNESS, 3, org.bukkit.enchantments.Enchantment.UNBREAKING, 3)));
                items.add(enchant(Material.DIAMOND_PICKAXE, Map.of(org.bukkit.enchantments.Enchantment.EFFICIENCY, 3, org.bukkit.enchantments.Enchantment.UNBREAKING, 3)));
                items.add(new ItemStack(Material.DIAMOND_HELMET));
                items.add(new ItemStack(Material.DIAMOND_CHESTPLATE));
                items.add(new ItemStack(Material.DIAMOND_LEGGINGS));
                items.add(new ItemStack(Material.DIAMOND_BOOTS));
                items.add(new ItemStack(Material.GOLDEN_APPLE, 16));
                items.add(new ItemStack(Material.COOKED_BEEF, 64));
            }
            case "ultra" -> {
                items.add(ultraUtilityShulker());
                items.add(ultraWeaponsShulker());
                items.add(ultraArmorShulker());
            }
            case "admin", "owner" -> {
                items.add(enchant(Material.NETHERITE_SWORD, Map.of(org.bukkit.enchantments.Enchantment.SHARPNESS, 5, org.bukkit.enchantments.Enchantment.UNBREAKING, 3, org.bukkit.enchantments.Enchantment.MENDING, 1)));
                items.add(enchant(Material.NETHERITE_PICKAXE, Map.of(org.bukkit.enchantments.Enchantment.EFFICIENCY, 5, org.bukkit.enchantments.Enchantment.UNBREAKING, 3, org.bukkit.enchantments.Enchantment.MENDING, 1)));
                items.add(enchant(Material.NETHERITE_HELMET, Map.of(org.bukkit.enchantments.Enchantment.PROTECTION, 4, org.bukkit.enchantments.Enchantment.UNBREAKING, 3, org.bukkit.enchantments.Enchantment.MENDING, 1)));
                items.add(enchant(Material.NETHERITE_CHESTPLATE, Map.of(org.bukkit.enchantments.Enchantment.PROTECTION, 4, org.bukkit.enchantments.Enchantment.UNBREAKING, 3, org.bukkit.enchantments.Enchantment.MENDING, 1)));
                items.add(enchant(Material.NETHERITE_LEGGINGS, Map.of(org.bukkit.enchantments.Enchantment.PROTECTION, 4, org.bukkit.enchantments.Enchantment.UNBREAKING, 3, org.bukkit.enchantments.Enchantment.MENDING, 1)));
                items.add(enchant(Material.NETHERITE_BOOTS, Map.of(org.bukkit.enchantments.Enchantment.PROTECTION, 4, org.bukkit.enchantments.Enchantment.UNBREAKING, 3, org.bukkit.enchantments.Enchantment.MENDING, 1)));
                items.add(new ItemStack(Material.GOLDEN_APPLE, 32));
            }
        }
        return items;
    }

    private ItemStack ultraUtilityShulker() {
        ItemStack goldenApples = new ItemStack(Material.GOLDEN_APPLE, 64);
        ItemStack rockets = new ItemStack(Material.FIREWORK_ROCKET, 64);
        return shulker("Ultra · movilidad y herramientas", goldenApples,
                unsafe(Material.ELYTRA, org.bukkit.enchantments.Enchantment.UNBREAKING, 6, org.bukkit.enchantments.Enchantment.MENDING, 6), rockets,
                unsafe(Material.NETHERITE_PICKAXE, org.bukkit.enchantments.Enchantment.EFFICIENCY, 6, org.bukkit.enchantments.Enchantment.UNBREAKING, 6, org.bukkit.enchantments.Enchantment.MENDING, 6, org.bukkit.enchantments.Enchantment.FORTUNE, 3),
                unsafe(Material.NETHERITE_AXE, org.bukkit.enchantments.Enchantment.EFFICIENCY, 6, org.bukkit.enchantments.Enchantment.UNBREAKING, 6, org.bukkit.enchantments.Enchantment.MENDING, 6),
                unsafe(Material.NETHERITE_SHOVEL, org.bukkit.enchantments.Enchantment.EFFICIENCY, 6, org.bukkit.enchantments.Enchantment.UNBREAKING, 6, org.bukkit.enchantments.Enchantment.MENDING, 6),
                unsafe(Material.NETHERITE_HOE, org.bukkit.enchantments.Enchantment.EFFICIENCY, 6, org.bukkit.enchantments.Enchantment.UNBREAKING, 6, org.bukkit.enchantments.Enchantment.MENDING, 6));
    }

    private ItemStack ultraWeaponsShulker() {
        return shulker("Ultra · armas", unsafe(Material.NETHERITE_SWORD, org.bukkit.enchantments.Enchantment.SHARPNESS, 6, org.bukkit.enchantments.Enchantment.UNBREAKING, 6, org.bukkit.enchantments.Enchantment.MENDING, 6, org.bukkit.enchantments.Enchantment.LOOTING, 4),
                unsafe(Material.NETHERITE_AXE, org.bukkit.enchantments.Enchantment.SHARPNESS, 6, org.bukkit.enchantments.Enchantment.UNBREAKING, 6, org.bukkit.enchantments.Enchantment.MENDING, 6),
                unsafe(Material.BOW, org.bukkit.enchantments.Enchantment.POWER, 6, org.bukkit.enchantments.Enchantment.UNBREAKING, 6, org.bukkit.enchantments.Enchantment.MENDING, 6),
                new ItemStack(Material.ARROW, 64));
    }

    private ItemStack ultraArmorShulker() {
        return shulker("Ultra · armadura Netherite", ultraArmor(Material.NETHERITE_HELMET, org.bukkit.enchantments.Enchantment.RESPIRATION),
                ultraArmor(Material.NETHERITE_CHESTPLATE, null), ultraArmor(Material.NETHERITE_LEGGINGS, null),
                ultraArmor(Material.NETHERITE_BOOTS, org.bukkit.enchantments.Enchantment.FEATHER_FALLING));
    }

    private ItemStack ultraArmor(Material material, org.bukkit.enchantments.Enchantment extra) {
        ItemStack item = new ItemStack(material);
        Map<org.bukkit.enchantments.Enchantment, Integer> enchants = new HashMap<>();
        enchants.put(org.bukkit.enchantments.Enchantment.PROTECTION, 6);
        enchants.put(org.bukkit.enchantments.Enchantment.FIRE_PROTECTION, 6);
        enchants.put(org.bukkit.enchantments.Enchantment.BLAST_PROTECTION, 6);
        enchants.put(org.bukkit.enchantments.Enchantment.PROJECTILE_PROTECTION, 6);
        enchants.put(org.bukkit.enchantments.Enchantment.UNBREAKING, 6);
        enchants.put(org.bukkit.enchantments.Enchantment.MENDING, 6);
        if (extra != null) enchants.put(extra, 6);
        item.addUnsafeEnchantments(enchants);
        return item;
    }

    private ItemStack shulker(String title, ItemStack... contents) {
        ItemStack item = new ItemStack(Material.SHULKER_BOX);
        BlockStateMeta meta = (BlockStateMeta) item.getItemMeta();
        ShulkerBox box = (ShulkerBox) meta.getBlockState();
        for (int i = 0; i < contents.length && i < box.getInventory().getSize(); i++) box.getInventory().setItem(i, contents[i]);
        meta.setBlockState(box);
        meta.displayName(Component.text(title, NamedTextColor.LIGHT_PURPLE).decorate(TextDecoration.BOLD));
        item.setItemMeta(meta);
        return item;
    }

    private ItemStack enchant(Material material, Map<org.bukkit.enchantments.Enchantment, Integer> enchantments) {
        ItemStack item = new ItemStack(material);
        item.addEnchantments(enchantments);
        return item;
    }

    private ItemStack unsafe(Material material, Object... enchantments) {
        ItemStack item = new ItemStack(material);
        Map<org.bukkit.enchantments.Enchantment, Integer> values = new HashMap<>();
        for (int i = 0; i + 1 < enchantments.length; i += 2) values.put((org.bukkit.enchantments.Enchantment) enchantments[i], (Integer) enchantments[i + 1]);
        item.addUnsafeEnchantments(values);
        return item;
    }

    private void openModeSelector(Player player) {
        Map<String, String> servers = getConfig().getConfigurationSection("mode-servers") == null ? Map.of() : getConfig().getConfigurationSection("mode-servers").getValues(false).entrySet().stream().collect(HashMap::new, (map, entry) -> map.put(entry.getKey(), String.valueOf(entry.getValue())), HashMap::putAll);
        Inventory inventory = Bukkit.createInventory(null, 27, Component.text("Choose a game mode", NamedTextColor.DARK_GRAY));
        int[] slots = {11, 15};
        int index = 0;
        for (String targetMode : java.util.List.of("survival", "creative")) {
            String alias = servers.get(targetMode);
            if (alias == null || alias.isBlank()) continue;
            ItemStack item = new ItemStack(targetMode.equals("survival") ? Material.GRASS_BLOCK : Material.BRICKS);
            ItemMeta meta = item.getItemMeta();
            meta.displayName(Component.text(targetMode.equals("survival") ? "Survival" : "Creative", targetMode.equals("survival") ? NamedTextColor.GREEN : NamedTextColor.LIGHT_PURPLE));
            meta.lore(java.util.List.of(Component.text("Click to continue", NamedTextColor.GRAY)));
            meta.getPersistentDataContainer().set(selectorKey, PersistentDataType.STRING, alias);
            item.setItemMeta(meta);
            inventory.setItem(slots[Math.min(index++, slots.length - 1)], item);
        }
        player.openInventory(inventory);
    }

    private void connect(Player player, String alias) {
        if (alias.equalsIgnoreCase(serverAlias)) {
            if (mode.equals("hub") && !Bukkit.getWorlds().isEmpty()) player.teleportAsync(Bukkit.getWorlds().get(0).getSpawnLocation());
            else player.sendMessage("§eYa estás en ese servidor.");
            return;
        }
        saveLocation(player).completeOnTimeout(null, 1500, java.util.concurrent.TimeUnit.MILLISECONDS)
                .whenComplete((saved, error) -> Bukkit.getScheduler().runTask(this, () -> {
            if (!player.isOnline()) return;
            if (error != null || !Boolean.TRUE.equals(saved)) getLogger().warning("Location sync failed for " + player.getName() + "; continuing transfer because each backend stores its own player inventory.");
            sendConnect(player, alias);
        }));
    }

    private void configureHubSpawn() {
        if (!mode.equals("hub") || !getConfig().getBoolean("hub-spawn.enabled", false) || Bukkit.getWorlds().isEmpty()) return;
        String worldName = getConfig().getString("hub-spawn.world", "");
        World world = worldName.isBlank() ? Bukkit.getWorlds().get(0) : Bukkit.getWorld(worldName);
        if (world == null) world = Bukkit.getWorlds().get(0);
        int x = (int) Math.floor(getConfig().getDouble("hub-spawn.x", 0));
        int y = (int) Math.floor(getConfig().getDouble("hub-spawn.y", 64));
        int z = (int) Math.floor(getConfig().getDouble("hub-spawn.z", 0));
        world.setSpawnLocation(x, y, z);
        getLogger().info("Hub spawn set to " + world.getName() + " at " + x + ", " + y + ", " + z + ".");
    }

    private void sendConnect(Player player, String alias) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (DataOutputStream out = new DataOutputStream(bytes)) { out.writeUTF("Connect"); out.writeUTF(alias); }
            player.sendPluginMessage(this, CHANNEL, bytes.toByteArray());
        } catch (Exception exception) {
            player.sendMessage("§cCould not connect to that server.");
            getLogger().warning("Failed to route " + player.getName() + " to " + alias + ": " + exception.getMessage());
        }
    }

    private boolean isGatewayLoginComplete(Player player) {
        if (!mode.equals("gateway")) return true;
        if (gatewayIsLogged == null) return false;
        try {
            return Boolean.TRUE.equals(gatewayIsLogged.invoke(null, player.getUniqueId()));
        } catch (ReflectiveOperationException | LinkageError exception) {
            return false;
        }
    }

    private java.util.concurrent.CompletableFuture<Boolean> saveLocation(Player player) {
        if (networkId.isBlank() || token.isBlank() || !java.util.List.of("survival", "creative").contains(mode)) return java.util.concurrent.CompletableFuture.completedFuture(true);
        Location location = player.getLocation();
        if (location.getWorld() == null) return java.util.concurrent.CompletableFuture.completedFuture(true);
        JsonObject body = new JsonObject();
        body.addProperty("uuid", player.getUniqueId().toString());
        body.addProperty("name", player.getName());
        body.addProperty("mode", mode);
        body.addProperty("realmId", realmId);
        body.addProperty("serverAlias", serverAlias);
        body.addProperty("worldKey", location.getWorld().getName());
        body.addProperty("x", location.getX());
        body.addProperty("y", location.getY());
        body.addProperty("z", location.getZ());
        body.addProperty("yaw", location.getYaw());
        body.addProperty("pitch", location.getPitch());
        HttpRequest request = HttpRequest.newBuilder(uri("/players/location"))
                .timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
        return http.sendAsync(request, HttpResponse.BodyHandlers.discarding()).thenApply(response -> response.statusCode() == 200).exceptionally(error -> { getLogger().fine("Location save failed: " + error.getMessage()); return false; });
    }

    private java.util.concurrent.CompletableFuture<Boolean> saveProfile(Player player) {
        if (networkId.isBlank() || token.isBlank() || !java.util.List.of("hub", "survival", "creative").contains(mode)) return java.util.concurrent.CompletableFuture.completedFuture(true);
                try {
            JsonObject profile = new JsonObject();
            profile.addProperty("inventory", encodeItems(player.getInventory().getContents()));
            profile.addProperty("armor", encodeItems(player.getInventory().getArmorContents()));
            profile.addProperty("enderChest", encodeItems(player.getEnderChest().getContents()));
            profile.addProperty("health", player.getHealth());
            profile.addProperty("food", player.getFoodLevel());
            profile.addProperty("saturation", player.getSaturation());
            profile.addProperty("level", player.getLevel());
            profile.addProperty("experience", player.getExp());
            profile.addProperty("totalExperience", player.getTotalExperience());
            JsonObject body = new JsonObject();
            body.addProperty("uuid", player.getUniqueId().toString());
            body.addProperty("name", player.getName());
            body.addProperty("mode", mode);
            body.addProperty("serverAlias", serverAlias);
            body.add("profile", profile);
            HttpRequest request = HttpRequest.newBuilder(uri("/players/profile"))
                    .timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
            return http.sendAsync(request, HttpResponse.BodyHandlers.discarding()).thenApply(response -> response.statusCode() == 200).exceptionally(error -> { getLogger().fine("Profile save failed: " + error.getMessage()); return false; });
        } catch (Exception exception) {
            getLogger().warning("Could not serialize profile for " + player.getName() + ": " + exception.getMessage());
            return java.util.concurrent.CompletableFuture.completedFuture(false);
        }
    }

    private void restoreProfile(Player player, Runnable afterRestore) {
        if (networkId.isBlank() || token.isBlank() || !java.util.List.of("hub", "survival", "creative").contains(mode)) {
            Bukkit.getScheduler().runTask(this, afterRestore);
            return;
        }
        String query = "?uuid=" + encode(player.getUniqueId().toString()) + "&mode=" + encode(mode);
        HttpRequest request = HttpRequest.newBuilder(uri("/players/profile" + query)).timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + token).GET().build();
        http.sendAsync(request, HttpResponse.BodyHandlers.ofString()).whenComplete((response, error) -> Bukkit.getScheduler().runTask(this, () -> {
            if (error != null) {
                getLogger().warning("Could not load " + mode + " profile for " + player.getName() + ": " + error.getMessage());
                player.sendMessage("§eYour saved " + mode + " profile is temporarily unavailable.");
                if (mode.equals("hub")) afterRestore.run();
                return;
            }
            if (!player.isOnline()) return;
            if (response.statusCode() != 200) {
                if (mode.equals("hub")) afterRestore.run();
                return;
            }
            try {
                JsonObject envelope = JsonParser.parseString(response.body()).getAsJsonObject();
                JsonObject data = envelope.getAsJsonObject("data");
                if (data != null && data.has("profile") && !data.get("profile").isJsonNull()) applyProfile(player, data.getAsJsonObject("profile"));
                afterRestore.run();
            } catch (Exception exception) {
                getLogger().warning("Saved profile data was invalid for " + player.getName() + ": " + exception.getMessage());
                player.sendMessage("§cYour saved profile could not be restored safely; no transfer was made.");
                if (mode.equals("hub")) afterRestore.run();
            }
        }));
    }

    private void applyProfile(Player player, JsonObject profile) throws Exception {
        player.getInventory().setContents(decodeItems(profile.get("inventory").getAsString()));
        player.getInventory().setArmorContents(decodeItems(profile.get("armor").getAsString()));
        player.getEnderChest().setContents(decodeItems(profile.get("enderChest").getAsString()));
        player.setGameMode(switch (mode) { case "creative" -> GameMode.CREATIVE; case "hub" -> GameMode.ADVENTURE; default -> GameMode.SURVIVAL; });
        double maxHealth = player.getAttribute(Attribute.GENERIC_MAX_HEALTH) == null ? 20 : player.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue();
        player.setHealth(Math.max(1, Math.min(maxHealth, profile.get("health").getAsDouble())));
        player.setFoodLevel(Math.max(0, Math.min(20, profile.get("food").getAsInt())));
        player.setSaturation(Math.max(0, Math.min(20, profile.get("saturation").getAsFloat())));
        player.setLevel(Math.max(0, profile.get("level").getAsInt()));
        player.setExp(Math.max(0, Math.min(1, profile.get("experience").getAsFloat())));
        player.setTotalExperience(Math.max(0, profile.get("totalExperience").getAsInt()));
    }

    private static String encodeItems(ItemStack[] items) {
        JsonArray encoded = new JsonArray();
        for (ItemStack item : items) {
            if (item == null || item.getType().isAir()) encoded.add(com.google.gson.JsonNull.INSTANCE);
            else encoded.add(Base64.getEncoder().encodeToString(item.serializeAsBytes()));
        }
        return encoded.toString();
    }

    private static ItemStack[] decodeItems(String encoded) {
        JsonArray serialized = JsonParser.parseString(encoded).getAsJsonArray();
        ItemStack[] items = new ItemStack[serialized.size()];
        for (int index = 0; index < serialized.size(); index++) if (!serialized.get(index).isJsonNull()) items[index] = ItemStack.deserializeBytes(Base64.getDecoder().decode(serialized.get(index).getAsString()));
        return items;
    }

    private void loadLocation(Player player) {
        if (networkId.isBlank() || token.isBlank() || !java.util.List.of("survival", "creative").contains(mode)) return;
        String query = "?uuid=" + encode(player.getUniqueId().toString()) + "&mode=" + encode(mode);
        HttpRequest request = HttpRequest.newBuilder(uri("/players/location" + query)).timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + token).GET().build();
        http.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenAccept(response -> {
            if (response.statusCode() != 200) return;
            try {
                JsonObject envelope = JsonParser.parseString(response.body()).getAsJsonObject();
                JsonObject data = envelope.getAsJsonObject("data");
                if (data == null || !data.has("location") || data.get("location").isJsonNull()) return;
                JsonObject saved = data.getAsJsonObject("location");
                Bukkit.getScheduler().runTask(this, () -> {
                    if (!player.isOnline()) return;
                    String savedAlias = saved.get("serverAlias").getAsString();
                    if (!savedAlias.equalsIgnoreCase(serverAlias)) {
                        sendConnect(player, savedAlias);
                        return;
                    }
                    World world = Bukkit.getWorld(saved.get("worldKey").getAsString());
                    if (world == null) return;
                    double x = saved.get("x").getAsDouble(), y = saved.get("y").getAsDouble(), z = saved.get("z").getAsDouble();
                    Location destination = new Location(world, x, y, z, saved.get("yaw").getAsFloat(), saved.get("pitch").getAsFloat());
                    if (!world.getWorldBorder().isInside(destination) || y < world.getMinHeight() || y >= world.getMaxHeight()) return;
                    previousLocations.put(player.getUniqueId(), player.getLocation().clone());
                    player.teleportAsync(destination);
                });
            } catch (Exception exception) {
                getLogger().warning("Invalid saved location for " + player.getName() + ": " + exception.getMessage());
            }
        }).exceptionally(error -> { getLogger().fine("Location load failed: " + error.getMessage()); return null; });
    }

    private URI uri(String path) { return URI.create(apiUrl + "/api/internal/networks/" + encode(networkId) + path); }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }

    @Override
    public void onPluginMessageReceived(String channel, Player player, byte[] message) {
        if (PROMO_CHANNEL.equals(channel)) handleForwardedPromotion(message);
        else if (MODERATION_CHANNEL.equals(channel)) {
            if (message.length > 0 && message[0] == '{') handleNetworkModeration(message);
            else handleForwardedFreeze(message); // accept messages from older Salvadiux plugin builds during rolling restarts
        }
    }

    private void broadcastFreezeState(Player sender, UUID targetId, boolean frozen) {
        JsonObject event = new JsonObject();
        event.addProperty("operation", "freeze");
        event.addProperty("uuid", targetId.toString());
        event.addProperty("frozen", frozen);
        sendNetworkModeration(sender, event);
    }

    private String signModeration(JsonObject payload) throws Exception {
        JsonObject unsigned = payload.deepCopy();
        unsigned.remove("signature");
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(token.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String value = networkId + "\n" + unsigned;
        return Base64.getEncoder().encodeToString(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
    }

    private String signModeration(String uuid, boolean frozen) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(token.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String value = networkId + "\n" + uuid + "\n" + frozen;
        return Base64.getEncoder().encodeToString(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
    }

    private void sendNetworkModeration(Player sender, JsonObject event) {
        if (networkId.isBlank() || token.isBlank() || serverAlias.isBlank()) return;
        try {
            JsonObject payload = event.deepCopy();
            String eventKey = UUID.randomUUID().toString();
            payload.addProperty("networkId", networkId);
            payload.addProperty("eventKey", eventKey);
            payload.addProperty("sourceAlias", serverAlias);
            payload.addProperty("signature", signModeration(payload));
            processedModerationEvents.add(eventKey);
            byte[] json = payload.toString().getBytes(StandardCharsets.UTF_8);

            ByteArrayOutputStream messageBytes = new ByteArrayOutputStream();
            try (DataOutputStream message = new DataOutputStream(messageBytes)) {
                message.writeUTF("Forward");
                message.writeUTF("ALL");
                message.writeUTF(MODERATION_CHANNEL);
                message.writeShort(json.length);
                message.write(json);
            }
            sender.sendPluginMessage(this, CHANNEL, messageBytes.toByteArray());

            JsonObject apiBody = new JsonObject();
            apiBody.addProperty("eventKey", eventKey);
            apiBody.addProperty("sourceAlias", serverAlias);
            apiBody.add("event", payload);
            HttpRequest request = HttpRequest.newBuilder(uri("/moderation/events"))
                    .timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(apiBody.toString())).build();
            http.sendAsync(request, HttpResponse.BodyHandlers.discarding()).thenAccept(response -> {
                if (response.statusCode() != 200) getLogger().warning("Could not save network moderation event (HTTP " + response.statusCode() + ").");
            }).exceptionally(error -> { getLogger().warning("Network moderation persistence failed: " + error.getMessage()); return null; });
        } catch (Exception exception) {
            getLogger().warning("Could not forward network moderation event: " + exception.getMessage());
            sender.sendMessage("§eLa acción se guardó en este modo, pero la sincronización de red no está disponible.");
        }
    }

    private void pollNetworkModeration() {
        try {
            URI eventsUri = URI.create(uri("/moderation/events") + "?after=" + moderationCursor);
            HttpRequest request = HttpRequest.newBuilder(eventsUri).timeout(Duration.ofSeconds(8))
                    .header("Authorization", "Bearer " + token).GET().build();
            http.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).thenAccept(response -> {
                if (response.statusCode() != 200) {
                    getLogger().fine("Shared moderation poll returned HTTP " + response.statusCode() + ".");
                    return;
                }
                JsonObject root = JsonParser.parseString(response.body()).getAsJsonObject();
                JsonArray events = root.getAsJsonObject("data").getAsJsonArray("events");
                if (events == null || events.isEmpty()) return;
                Bukkit.getScheduler().runTask(this, () -> {
                    for (var entry : events) {
                        JsonObject row = entry.getAsJsonObject();
                        JsonObject payload = row.getAsJsonObject("event");
                        if (payload != null) applyNetworkModeration(payload);
                        moderationCursor = Math.max(moderationCursor, row.get("sequence").getAsLong());
                    }
                    getConfig().set("moderation.shared-cursor", moderationCursor);
                    saveConfig();
                });
            }).exceptionally(error -> { getLogger().fine("Shared moderation poll failed: " + error.getMessage()); return null; });
        } catch (Exception exception) {
            getLogger().fine("Shared moderation poll could not start: " + exception.getMessage());
        }
    }

    private void handleNetworkModeration(byte[] message) {
        try {
            JsonObject payload = JsonParser.parseString(new String(message, StandardCharsets.UTF_8)).getAsJsonObject();
            Bukkit.getScheduler().runTask(this, () -> applyNetworkModeration(payload));
        } catch (Exception exception) {
            getLogger().warning("Ignored an invalid network moderation message: " + exception.getMessage());
        }
    }

    private void applyNetworkModeration(JsonObject payload) {
        try {
            String receivedNetwork = payload.get("networkId").getAsString();
            String signature = payload.get("signature").getAsString();
            if (!networkId.equals(receivedNetwork) || token.isBlank()
                    || !MessageDigest.isEqual(signModeration(payload).getBytes(StandardCharsets.UTF_8), signature.getBytes(StandardCharsets.UTF_8))) return;
            String eventKey = payload.get("eventKey").getAsString();
            if (processedModerationEvents.size() > 8192) processedModerationEvents.clear();
            if (!processedModerationEvents.add(eventKey)) return;
            String operation = payload.get("operation").getAsString();
            switch (operation) {
                case "freeze" -> applyFreezeState(UUID.fromString(payload.get("uuid").getAsString()), payload.get("frozen").getAsBoolean(), true);
                case "mute" -> {
                    UUID uuid = UUID.fromString(payload.get("uuid").getAsString());
                    long until = payload.get("expires-at").getAsLong();
                    if (until == -1L || until > System.currentTimeMillis()) mutedPlayers.put(uuid, until); else mutedPlayers.remove(uuid);
                    String path = "moderation.mutes." + uuid;
                    if (until == -1L || until > System.currentTimeMillis()) {
                        getConfig().set(path + ".expires-at", until);
                        getConfig().set(path + ".by", payload.get("by").getAsString());
                        getConfig().set(path + ".reason", payload.get("reason").getAsString());
                    }
                    saveConfig();
                }
                case "unmute" -> {
                    UUID uuid = UUID.fromString(payload.get("uuid").getAsString());
                    mutedPlayers.remove(uuid);
                    getConfig().set("moderation.mutes." + uuid, null);
                    saveConfig();
                    Player online = Bukkit.getPlayer(uuid);
                    if (online != null) online.sendMessage("§aTu silencio fue retirado por el staff.");
                }
                case "ban" -> {
                    UUID uuid = UUID.fromString(payload.get("uuid").getAsString());
                    long until = payload.get("expires-at").getAsLong();
                    String by = payload.get("by").getAsString();
                    String reason = payload.get("reason").getAsString();
                    applyBanState(uuid, until, by, reason);
                    Player online = Bukkit.getPlayer(uuid);
                    if (online != null) online.kick(Component.text("Acceso bloqueado por el staff. Motivo: " + reason, NamedTextColor.RED));
                }
                case "unban" -> applyBanState(UUID.fromString(payload.get("uuid").getAsString()), 0L, "", "");
                case "cosmetic" -> {
                    String trail = payload.get("trail").getAsString();
                    if (TRAIL_OPTIONS.stream().noneMatch(option -> option.id().equals(trail))) return;
                    getConfig().set("cosmetics.players." + UUID.fromString(payload.get("uuid").getAsString()) + ".trail", trail);
                    saveConfig();
                }
                case "record" -> {
                    String type = payload.get("record-type").getAsString();
                    if (!List.of("warnings", "notes").contains(type)) return;
                    String id = payload.get("id").getAsString();
                    String path = "moderation." + type + "." + payload.get("uuid").getAsString() + "." + id;
                    getConfig().set(path + ".player", payload.get("player").getAsString());
                    getConfig().set(path + ".by", payload.get("by").getAsString());
                    getConfig().set(path + ".reason", payload.get("reason").getAsString());
                    saveConfig();
                }
                case "report" -> {
                    String path = "moderation.reports.items." + payload.get("id").getAsInt();
                    getConfig().set(path + ".target-uuid", payload.get("target-uuid").getAsString());
                    getConfig().set(path + ".target-name", payload.get("target-name").getAsString());
                    getConfig().set(path + ".reporter-uuid", payload.get("reporter-uuid").getAsString());
                    getConfig().set(path + ".reporter-name", payload.get("reporter-name").getAsString());
                    getConfig().set(path + ".reason", payload.get("reason").getAsString());
                    getConfig().set(path + ".created-at", payload.get("created-at").getAsLong());
                    getConfig().set(path + ".status", "open");
                    saveConfig();
                    Component alert = Component.text("[Reporte #" + payload.get("id").getAsInt() + "] " + payload.get("reporter-name").getAsString() + " reportó a " + payload.get("target-name").getAsString() + ": " + payload.get("reason").getAsString(), NamedTextColor.RED);
                    Bukkit.getOnlinePlayers().stream().filter(staff -> hasStaffRole(staff, 1)).forEach(staff -> staff.sendMessage(alert));
                }
                case "report-close" -> {
                    String path = "moderation.reports.items." + payload.get("id").getAsInt();
                    getConfig().set(path + ".status", "closed");
                    getConfig().set(path + ".closed-by", payload.get("closed-by").getAsString());
                    saveConfig();
                }
                default -> getLogger().fine("Ignored unknown moderation operation " + operation + ".");
            }
        } catch (Exception exception) {
            getLogger().warning("Ignored an invalid network moderation event: " + exception.getMessage());
        }
    }

    private void applyFreezeState(UUID uuid, boolean frozen, boolean notify) {
        List<String> ids = new ArrayList<>(getConfig().getStringList("moderation.frozen-players"));
        ids.remove(uuid.toString());
        if (frozen) {
            ids.add(uuid.toString());
            frozenPlayers.add(uuid);
        } else frozenPlayers.remove(uuid);
        getConfig().set("moderation.frozen-players", ids);
        saveConfig();
        Player online = Bukkit.getPlayer(uuid);
        if (notify && online != null) online.sendMessage(frozen ? "§c§lHAS SIDO CONGELADO" : "§aEl staff te descongeló.");
    }

    private void handleForwardedFreeze(byte[] message) {
        try (DataInputStream input = new DataInputStream(new ByteArrayInputStream(message))) {
            String receivedNetwork = input.readUTF();
            String uuidValue = input.readUTF();
            boolean frozen = input.readBoolean();
            String signature = input.readUTF();
            if (!networkId.equals(receivedNetwork) || token.isBlank()
                    || !MessageDigest.isEqual(signModeration(uuidValue, frozen).getBytes(StandardCharsets.UTF_8), signature.getBytes(StandardCharsets.UTF_8))) return;
            UUID uuid = UUID.fromString(uuidValue);
            Bukkit.getScheduler().runTask(this, () -> applyFreezeState(uuid, frozen, true));
        } catch (Exception exception) {
            getLogger().warning("Ignored an invalid network freeze message: " + exception.getMessage());
        }
    }
}
