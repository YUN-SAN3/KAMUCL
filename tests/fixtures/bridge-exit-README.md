`kamucl-bridge-1.0.0.jar` is the unmodified KAMUCL Bridge 1.0.0
previously distributed by this project (MIT, see the repository `LICENSE`). Its Java
source is retained in Git at tag `v1.0.69`, under `bridge/src`.
It is a regression fixture, never bundled or installed into player instances.

The baseline contains a non-daemon HTTP dispatcher that prevents natural JVM
exit. `node scripts/verify-bridge-exit.cjs --baseline` demonstrates this in
isolated child JVMs; `node scripts/verify-bridge-exit.cjs` verifies the corrected
bundled bridge, live authenticated requests, saving completion, interrupted
requests, natural exit and immediate MOD file removal.

The upgrade test compares the entire normalized JAR payload, ignoring only ZIP
metadata and the build-tool manifest. Changed code or extra files are not trusted
as a stock version. Filename changes do not prevent recognition.
