# Third-party notices / 第三方声明

The root MIT license covers original KAMUCL contributions only. Third-party
copyright, license and trademark rights remain with their respective holders.

## VoxLink protocol integration — LGPL-3.0-only

Upstream: https://github.com/AUGUHDAR/VoxLink
Revisions: 6b11d930fe4fe568dacc8c47fa0e46e08fa4b110 (original protocol replacement),
721c7fae05851971996e49a3ad0e595d5aa9a053 (launcher-integration contract / 1.1.7 behaviors),
924845e897d8fb36dca2474ade30e675278559d0 (1.0.94 strict punching policy audit),
c475faa98cca16d4a2eeef4422c862c36091e1fc (1.1.6 standard TURN, tickets and 1.1.9 behavior audit).
Authors: AUGUHDAR / VoxLink contributors.

The adaptations of PunchAuth.java and TurnRelayClient.java are in
src/main/core/voxlink/punchAuth.ts and turn.ts. The replacement protocol runtime
in rudp.ts, punch.ts, session.ts and engine.ts uses the licensed Java
ReliableUdpTransport, SignalingClient, SignalingWsTransport and ConnectionManager
protocols. The 1.0.91 adaptations additionally include modsync.ts, modsyncService.ts,
tcpPunch.ts, turnTcp.ts and connectionLog.ts, based on the Java modsync package,
TcpHolePuncher, P2PBridge, TurnTcpChannel, PunchProfile/PunchTuner and LogUploadManager.
The 1.0.94 port additionally includes punchProfiles.ts, punchPolicy.ts, punchRounds.ts
and the StunProbe sequential sampling/resend portions of stun.ts. Unmodified Java
parameter fixtures under tests/fixtures/voxlink-924845e retain the same LGPL license.
The 1.1.6 changes additionally adapt StdTurnClient, TURN background/standby flows,
TicketClient and NatLabels in stdTurn.ts, turnRelay.ts, turnBackground.ts, tickets.ts
and src/shared/voxlinkNat.ts. Updated unmodified parameter fixtures are in
tests/fixtures/voxlink-c475faa9. The authoritative integration contract is
docs/launcher-integration.md at revision c475faa9.
These files are distributed under LGPL-3.0-only. Node lifecycle,
cancellation, HTTP fallback and UI reporting are KAMUCL changes.
The former app-desktop Go adaptations have been replaced; the Java license does
not establish authorization for that historical Go source.

Full terms: licenses/LGPL-3.0.txt and licenses/GPL-3.0.txt. Users may modify and
rebuild these portions and recombine them with the application. KAMUCL imposes no
restriction on reverse engineering for debugging such modifications.
Build instructions: docs/CORRESPONDING_SOURCE.md.

## Skin preview — MIT

skinview3d v3.4.2: https://github.com/bs-community/skinview3d/tree/v3.4.2
src/renderer/src/vendor/skinview3d/model.ts is the upstream model with an added
attribution header. Full authors and terms: licenses/skinview3d.txt.
skinview-utils 0.7.1: https://github.com/bs-community/skinview-utils
Provides canvas skin loading and conversion. Terms: licenses/skinview-utils.txt.
The version and integrity are fixed in package-lock.json.
KAMUCL's preview interaction adapter is an original MIT contribution.
The previous HMCL/FCL-derived preview and conversion are no longer used.

## Other bundled libraries

ws 8.22.0 (MIT) provides native WebSocket control frames. Full terms: licenses/ws.txt.
minecraft-data 3.117.0 declares MIT in its package metadata. The generated snapshot
retains factual registry fields only; attribution and MIT terms: licenses/minecraft-data.txt.
Mojang 26.2/26.3 block names and valid property values were extracted using the
official server data generator. No Mojang JAR is distributed in this launcher.

## System memory organization

Feature reference: PCL / 龙腾猫跃, https://github.com/Meloong-Git/PCL .
PCL usage guidance: https://github.com/Meloong-Git/PCL/blob/main/LICENCE .
KAMUCL's implementation is independently written using Microsoft's documented
EmptyWorkingSet API: https://learn.microsoft.com/windows/win32/api/psapi/nf-psapi-emptyworkingset .
It does not include PCL binaries or unpublished implementations, and is not a
PCL derivative or an endorsed integration. Existing games are skipped.

## Seven-character illustrations

The user supplied front/back character references. KAMUCL's transparent 2D
illustrations were generated from those references; capes were removed and
backs were completed. Derived animation layers are included in source. Character
and trademark rights remain with their respective holders; no affiliation is implied.

Vue/runtime packages, Three.js, @iarna/toml, adm-zip, koffi and undici:
complete license texts are retained in licenses/ and dependency packages.
Electron/Chromium notices remain alongside the executable in LICENSE and
LICENSES.chromium.html. Compile-only bridge dependencies are not embedded.

The license-material audit in `audit-reports/LICENSE_AUDIT.md` distinguishes
dependency declarations, installed packages, and actual packaged bytes. It does
not certify that every asset or every historical release is authorized.

## Koffi native headers — MIT

Koffi 3.2.1's native implementation uses the header-only Node.js API wrappers
and C Node-API headers. Their notices are retained even when development-only
vendor directories are omitted from a Windows binary package:

- `licenses/node-addon-api.txt`: copyright 2017 Node.js API collaborators,
  upstream node-addon-api v8.9.2.
- `licenses/node-api-headers.txt`: copyright 2021 Node.js,
  upstream node-api-headers v1.8.0 license text.

These exact texts were checked against Koffi's lock-integrity-verified 3.2.1
package archive and the pinned primary upstream license files. The actual
header revision bundled by Koffi is not inferred from matching license text.
`docs/third-party-provenance.json` records the full hashes and primary locations.

## Windows portable wrapper and extraction libraries

The portable EXE contains NSIS 3.0.4.1/System and unmodified separately loaded
StdUtils 1.14 and Nsis7z 19.00 plugin DLLs. The launcher-specific NSIS template
changes are in `scripts/portable-build-hook.cjs`; they do not modify plugin DLLs.

- NSIS/System: `licenses/NSIS-3.0.4.1-COPYING.txt`, including the original
  zlib, bzip2, CPL terms and the NSIS LZMA linking exception. These are terms
  for specific NSIS portions; they do not change the root project's license.
- StdUtils: copyright 2004–2018 LoRd_MuldeR; LGPL-2.1-or-later.
  `licenses/LGPL-2.1.txt`, `licenses/StdUtils-README.txt` and the unaltered
  `licenses/StdUtils-LGPL-CLARIFICATION.txt` are provided. The clarification
  covers unmodified plugin DLLs used strictly through the NSIS plugin interface;
  modification or direct source incorporation requires separate analysis.
- Nsis7z/7-Zip 19.00: copyright Igor Pavlov and Nsis7z contributors. The full
  7-Zip 19.00 license and LGPL text are `licenses/7zip-19.00.txt` and
  `licenses/7zip-19.00-COPYING.txt`. The supplied Nsis7z SDK notice is also
  preserved as `licenses/Nsis7z-SDK-License.txt`; its public-domain SDK statement
  is not a blanket relicense of the linked 7-Zip C++ code.

Complete version-pinned library source archives and the supplied project/build
files are distributed in `licenses/source/`; see its README for overlay and
rebuild instructions. They contain original upstream sources and notices.
The 1.1.21 EXE's Nsis7z x86-unicode DLL was byte-identical to the official
19.00 distribution. Source availability is not a claim of a bit-identical rebuild.

## Asset provenance and Minecraft rights

The 83 built-in mob icons are identified in `src/renderer/src/mobIcons.ts` as
Minecraft Wiki game-texture icons. Per-file source pages/revisions and the
applicable reuse conditions have not yet been verified. The launch illustrations,
character references, reconstructed skins and pig-face branding also have
incomplete rights-holder records. They are inventoried in
`audit-reports/ASSET_INVENTORY.json`; user supply, public availability or generated
derivation alone is not treated as proof of all necessary rights. Existing files
and historical evidence have been preserved rather than silently removed.

Minecraft name, brand and asset use is governed separately by Mojang/Microsoft's
usage guidelines: https://www.minecraft.net/en-us/usage-guidelines . This launcher
is not an official Minecraft product and is not approved by or associated with
Mojang or Microsoft. These statements do not establish permission for any
particular asset or commercial use. No font files are bundled in the tracked
source; CSS font names refer to the user's system fonts. The palm feedback SVGs
and procedural audio are declared original KAMUCL contributions; no external
audio sample library was observed in the reviewed source.

## Offline account appearance

offline-skin-agent/src/cn/kamucl/skin/OfflineSkinAgent.java is an original KAMUCL
component licensed GPL-3.0-or-later. Its source and build script are included;
full terms: licenses/GPL-3.0.txt. It serves only the captured local appearance
inside the game's JVM and does not authenticate access to online servers.

authlib-injector is downloaded on demand, not bundled with the launcher:
https://github.com/yushijinhun/authlib-injector (AGPLv3 with the upstream
authlib-injector additional exception; see its COPYING.md).
Upstream source, license and build instructions are available in that repository;
https://github.com/yushijinhun/authlib-injector/blob/develop/COPYING.md.
The existing download path checks the official release SHA256 before use.
An unaltered full AGPL text with the upstream exception is also retained as
`licenses/authlib-injector-AGPL-exception.txt`, pinned to upstream commit
879c6cbfce848f37e7da656d59a20cb93bd7102b. It is a license reference, not a
declaration about arbitrary modified or future injector versions. Java-agent
loading and HTTP interaction must satisfy that exception's exact conditions;
the library itself retains its AGPL terms.

## Optional Java runtimes

Java is downloaded on demand from Eclipse Adoptium (Temurin) or Azul (Zulu),
and is not embedded in the KAMUCL release. The complete vendor distribution,
including its license and notice files, is retained unchanged during extraction.
Metadata/API references: https://api.adoptium.net/ and
https://api.azul.com/metadata/v1/docs/swagger . Runtime download, verification
and fallback logic are independently implemented in KAMUCL.

## Electron FFmpeg shared library source

Electron 44.3.0's DEPS selects Chromium 152.0.7977.78, whose DEPS pins FFmpeg to
2b68d2babae73714846961fb0ee47e3b3d2e39a9. The Windows and Mac runtime provide
FFmpeg as a shared library. Its full LGPL and component-license texts are
`licenses/FFmpeg-COPYING.LGPLv2.1`, `licenses/FFmpeg-COPYING.LGPLv3`, and
`licenses/FFmpeg-LICENSE.txt`; original runtime notices are preserved separately.

The matching Release provides `KAMUCL-1.1.22-runtime-source.zip`: complete
version-pinned FFmpeg and Electron source archives, FFmpeg patch, DEPS and fixed
Chromium build/configuration material, with per-file hashes. It is supplied as
source material, not loaded by the launcher, and is not the complete Chromium
dependency graph. The exact release-config sources disable GPL/NONFREE/VERSION3
for the reviewed Windows x64 and Mac ARM64 configurations; the audit did not
rebuild machine code to prove every option or clear codec patents. The existence
of optional GPL sections in FFmpeg's license text is not treated as proof that
the release binary enables them. See `audit-reports/RUNTIME_SOURCE_PROVENANCE.json`.

## Referenced launcher projects

PCL: https://github.com/Meloong-Git/PCL
HMCL: https://github.com/HMCL-dev/HMCL
Prism: https://github.com/PrismLauncher/PrismLauncher
XMCL: https://github.com/Voxelum/x-minecraft-launcher
Modrinth: https://github.com/modrinth/code
ATLauncher: https://github.com/ATLauncher/ATLauncher
MultiMC: https://github.com/MultiMC/Launcher

Acknowledgement does not grant permission or imply endorsement. Referencing
behavior, formats or UI features does not relicense upstream code. Historical
release issues are recorded in docs/LICENSE_REMEDIATION.md. New replacements
do not retroactively establish permission for older releases.
