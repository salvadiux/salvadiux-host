# Servicios privados de red

Para el procedimiento completo desde la creación de instancias hasta las pruebas de conexión, consulta [`docs/crear-network.md`](../../docs/crear-network.md).

Este perfil prepara MariaDB y Redis para los plugins y servicios de la red Minecraft. La base SQLite de Salvadiux Host sigue guardando el inventario local del panel; estos contenedores no migran ni reemplazan esos datos.

## Inicio en Windows

1. Instala Docker Desktop con el motor Linux habilitado.
2. Copia `.env.example` como `.env` en esta carpeta y reemplaza los tres secretos por valores aleatorios distintos. No subas `.env` a Git.
3. Ejecuta `docker compose --env-file .env -f compose.yaml up -d` desde esta carpeta.
4. Comprueba `docker compose --env-file .env -f compose.yaml ps` y que ambos servicios aparezcan `healthy`.

Los puertos publicados se enlazan exclusivamente a `127.0.0.1`, para que las instancias del host puedan conectarse sin exponerlos a la LAN ni a Playit. No abras MariaDB ni Redis en el túnel Playit ni en el firewall público. Cada plugin debe recibir credenciales limitadas a su esquema/usuario y Redis debe usar una contraseña distinta.

## Estado de la red local Salvadiux

MariaDB y Redis se encuentran provisionados con este Compose. El proxy, Gateway, Hub, Survival y Creative comparten ahora la misma base de LuckPerms y usan `messaging-service: sql` para propagar cambios. El H2 original del Gateway y su exportación comprimida permanecen respaldados dentro de la carpeta privada de esa instancia. El procedimiento oficial de cambio de almacenamiento está en [LuckPerms](https://luckperms.net/wiki/Switching-storage-types); la configuración de red está descrita en [Network Installation](https://luckperms.net/wiki/Network-Installation).

El compose mantiene ambos servicios enlazados solo a loopback. Redis queda disponible para la siguiente fase, pero el servicio de perfiles y el enrutador aún no lo usan; MariaDB de LuckPerms no implica que ya exista una base de datos compartida para inventarios o matchmaking.

Las instancias Paper del mismo perfil deben ejecutar versiones compatibles y usar nombres de cluster consistentes. LuckPerms puede usar MariaDB y Redis para mensajería; HuskSync puede usar una base compartida y Redis para transferencias. No habilites la sincronización global de ubicaciones de HuskSync entre modalidades: la posición Survival y Creative debe mantenerse separada por perfil.

## Alcance actual

Este compose solo provisiona dependencias. Salvadiux Host todavía no configura automáticamente cada plugin, esquema, backup externo S3, proxy SQL, réplicas, snapshots ni alta disponibilidad. Antes de producción, fija las imágenes a digests aprobados, guarda secretos en un administrador de secretos, configura copias externas y ensaya una restauración completa.

## Roles de moderación de Salvadiux

LuckPerms comparte sus grupos entre Gateway, Hub, Survival y Creative. El plugin de red reconoce estos permisos: `salvadiux.staff.helper`, `salvadiux.staff.moderator`, `salvadiux.staff.srmod`, `salvadiux.staff.admin` y `salvadiux.staff.owner`. Los niveles heredan las herramientas inferiores declaradas por el plugin; `salvadiux.rank.admin` y OP se conservan como Admin/Owner.

Ejecuta desde consola del proxy o de un backend conectado a LuckPerms. Los grupos base se crean una vez; añade los nodos a `admin` y `owner` existentes para conservar sus rangos actuales:

```text
/lp creategroup helper
/lp group helper permission set salvadiux.staff.helper true
/lp creategroup moderator
/lp group moderator permission set salvadiux.staff.moderator true
/lp creategroup srmod
/lp group srmod permission set salvadiux.staff.srmod true
/lp group admin permission set salvadiux.staff.admin true
/lp group owner permission set salvadiux.staff.owner true
```

Asigna jugadores con `/lp user <jugador> parent set <grupo>`. Helper puede ver reportes, inspeccionar inventarios en modo de solo lectura, seguir jugadores y usar chat staff. Moderator añade warn, mute, kick, freeze, vanish e historial CoreProtect. SrMod añade ban y unban globales. Admin y Owner heredan las herramientas inferiores. Bans, mutes, freezes, reportes, advertencias y notas se guardan como eventos autenticados de red, así los backends apagados los recuperan al iniciar.
