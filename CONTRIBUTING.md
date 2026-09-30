# Contribuir a Salvadiux Host

¡Gracias por querer auditar o mejorar el proyecto! Se aceptan reportes reproducibles, correcciones de errores, mejoras de accesibilidad y propuestas de funciones.

## Antes de empezar

- Revisa el [README](README.md), la [arquitectura](ARCHITECTURE.md) y los issues existentes para evitar duplicados.
- Para fallos de seguridad, sigue [SECURITY.md](SECURITY.md); no abras un issue público con detalles explotables.
- No compartas archivos de `data/`, mundos, bases de datos, backups, `.env`, tokens, `forwarding.secret`, direcciones privadas ni logs sin revisar y redactar.

## Flujo de cambios

1. Haz un fork y crea una rama descriptiva desde `main`.
2. Mantén el cambio enfocado y explica qué problema resuelve.
3. Para cambios de API, seguridad o control de procesos, conserva el límite entre dashboard, API y agente. Las acciones visibles deben tener una operación real o indicar claramente que aún no están disponibles.
4. No incluyas mundos, datos de jugadores, secretos, JAR compilados ni resultados de build.
5. Ejecuta las comprobaciones aplicables desde la raíz:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```

   Si modificas `server-plugin`, compílalo también con JDK 21:

   ```powershell
   ./server-plugin/gradlew --no-daemon -p server-plugin build
   ```

6. Abre un Pull Request contra `main`, describe el comportamiento anterior y el nuevo, e incluye las pruebas realizadas. Adjunta capturas solo si están libres de datos privados.

## Estilo del proyecto

- Usa los proveedores y metadatos existentes para versiones y compatibilidad; no fijes builds que el proveedor puede resolver.
- Valida rutas de instancia con `safeResolve` y no interpoles entradas en comandos de shell.
- Mantén los ejemplos de `.env.example` con marcadores ficticios.
- Evita refactors amplios cuando un cambio pequeño resuelva el problema.

La licencia del proyecto es [MIT](LICENSE). Al enviar una contribución, aceptas que se distribuya bajo esa misma licencia.
