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

## Optional Java runtimes

Java is downloaded on demand from Eclipse Adoptium (Temurin) or Azul (Zulu),
and is not embedded in the KAMUCL release. The complete vendor distribution,
including its license and notice files, is retained unchanged during extraction.
Metadata/API references: https://api.adoptium.net/ and
https://api.azul.com/metadata/v1/docs/swagger . Runtime download, verification
and fallback logic are independently implemented in KAMUCL.

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
