# KAMUCL local offline skin provider

Original Java source licensed GPL-3.0-or-later. The Java agent serves one captured offline player's PNG and signed texture property from inside that game's JVM, using a random loopback-only route. It contains no Minecraft or authlib-injector source.

Build from the project root with JDK 17 or newer:

```text
node scripts/build-offline-skin-agent.cjs
```

Compilation uses `javac --release 8`; generated classes and the JAR are ignored build output. The production build copies the JAR to its own unpacked resources. At first use, the launcher separately obtains and SHA256-verifies the author's official authlib-injector release. Its license, exception and corresponding-source location are listed in THIRD_PARTY_NOTICES.md.

The launcher captures an immutable PNG, model and account identity for each launch. A temporary private configuration supplies that JVM's signing keys and route; the agent removes it after reading. It does not persist online credentials or replace the game's original skin files. Closing the launcher does not shut down the game-local provider. Resetting the account affects the next launch; existing captured textures remain available to already accepted launches.

Tests use original synthetic PNGs and disposable accounts. The provider does not promise that other players or servers display the selected local skin. Native JVM/authlib probes are separate evidence from actual game rendering.
