'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const base = 'web_engine/src/main/ets/'
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex')

// These are files from the exact SHA-pinned 37.2.0 archive, not a moving SDK
// template. Refuse a new template until its native API differences are reviewed.
const sourceHashes = {
  'application/WebAbilityStage.ets': '5185f7386539d648107c8a6986b2b61e9203f32ab917c9496d4232138fc5ef33',
  'adapter/PermissionManagerAdapter.ets': '1a748719cf6a9a5e51cbeeca321092574c7c56621aa7161dedc56c6d90bd4c2d',
  'adapter/FilePickerAdapter.ets': 'b720fe2bdb7b7cd9154ff74c27a9bdf400057a290ff241a37de31e31dea6316a',
  'jsbindings/PermissionManagerAdapterBind.ets': 'd6522369c3e4e3360cb3cfe66655660cca26033fc1e86615f1d584cb8eac3614',
  'components/WebWindow.ets': '463d1b72c1b285be4ed1ead94000294902b3b0bc2f2aa3a3536267a188a48b67',
  'utils/GlobalThisHelper.ets': '5a3b944e5d126c7575de94d1eab649f956e39b9d966f24c594d8d5bb8cdbf39b',
  'adapter/AppLifecycleAdapter.ets': 'e39f87238f9175c15897a8edb3ebd174bed9f35f26e9698a5da970567db633eb',
  'adapter/DialogAdapter.ets': 'a343e6b2723cab7b0d6a3165dffe5f87f50ff21c34452040537d8705532e2175',
  'ability/WebAbility.ets': '90c0dc0781a3083659c42e2fb3c3a64d8cf2d8bf0c3db23db757c4edd241979a',
  'ability/WebEmbeddedAbility.ets': 'eee595c58ca73e3656b4ce5e096ac146a8f5384303b69879977e204bb83feda7'
}

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('Native template adaptation anchor is missing or ambiguous')
  return text.replace(from, to)
}
function replaceRange(text, from, until, replacement) {
  const begin = text.indexOf(from), end = text.indexOf(until, begin + from.length)
  if (begin < 0 || end < 0 || text.indexOf(from, begin + from.length) >= 0) throw new Error('Native template adaptation range is missing or ambiguous')
  return text.slice(0, begin) + replacement + text.slice(end)
}

function adapt(relative, bytes) {
  if (!sourceHashes[relative] || sha256(bytes) !== sourceHashes[relative]) throw new Error(`Unreviewed Harmony native template: ${relative}`)
  return Buffer.from(transform(relative, bytes.toString('utf8').replaceAll('\r\n', '\n')))
}

function transform(relative, text) {
  if (relative === 'application/WebAbilityStage.ets') {
    text = replaceOnce(text, '  private nativeThemeAdapter: NativeThemeAdapter | undefined;', `  private nativeThemeAdapter: NativeThemeAdapter | undefined;
  private pendingTermination: boolean = false;
  private bindingsReady: boolean = false;`)
    text = replaceRange(text, '  onPrepareTermination():', '  onConfigurationUpdate(', `  onPrepareTermination(): AbilityConstant.PrepareTermination {
    if (GlobalThisHelper.isTerminationApproved()) {
      return AbilityConstant.PrepareTermination.TERMINATE_IMMEDIATELY;
    }
    this.pendingTermination = true;
    this.dispatchPendingTermination();
    // Electron owns dirty-editor confirmation, accepted actions and retryable
    // persistence. AppLifecycleAdapter terminates our abilities after app.quit.
    return AbilityConstant.PrepareTermination.CANCEL;
  }

  private dispatchPendingTermination(): void {
    if (!this.pendingTermination || !this.bindingsReady || !GlobalThisHelper.isBrowserReady() || !this.nativeContext) return;
    this.pendingTermination = false;
    try {
      this.nativeContext.ExecuteCommand(CommandType.kAppQuit, { is_sync: false });
    } catch (error) {
      this.pendingTermination = true;
      console.error('KAMUCL close request failed: ' + JSON.stringify(error));
    }
  }

`)
    text = replaceOnce(text, '        this.nativeThemeAdapter = Inject.get(NativeThemeAdapter);', `        this.nativeThemeAdapter = Inject.get(NativeThemeAdapter);
        this.bindingsReady = true;
        GlobalThisHelper.setCloseDispatcher(() => this.dispatchPendingTermination());
        this.dispatchPendingTermination();`)
  } else if (relative === 'adapter/PermissionManagerAdapter.ets') {
    text = replaceOnce(text, '  private isInitialized: boolean = false;', `  private isInitialized: boolean = false;
  private initializing: Promise<void> | undefined;
  private permissionWrites: Promise<void> = Promise.resolve();`)
    text = replaceRange(text, '  @LogMethod\n  public async initPermissions()', '  @LogMethod\n  public activateFileAccessPersist(', `  @LogMethod
  public async initPermissions(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.restoreDirectoryPermissions();
    try { await this.initializing; }
    finally { this.initializing = undefined; }
  }

  private async restoreDirectoryPermissions(): Promise<void> {
    try {
      const uris = this.getUris();
      if (uris.length > 0) {
        await new Promise<void>((resolve, reject) => {
          this.activateFileAccessPersist(uris, (code: number) => {
            if (code === ACTIVATE_SUCCESS) resolve();
            else reject(new Error('Directory activation failed: ' + code));
          });
        });
      }
      this.isInitialized = true;
    } catch (error) {
      // A revoked grant is not readiness. Keep the old record for reauthorization.
      LogUtil.error(TAG, 'Directory permission restore failed: ' + JSON.stringify(error));
      throw error;
    }
  }

  public persistGrantedDirectories(uris: string[]): Promise<void> {
    const selected = uris.slice();
    const operation = this.permissionWrites.then(async () => {
      await this.fileAccessPersist(selected);
      await this.saveUris(selected);
    });
    this.permissionWrites = operation.catch(() => {});
    return operation;
  }

  @LogMethod
  public async saveUris(uris: string[]): Promise<void> {
    const store = preferences.getPreferencesSync(this.ctxAdapter.getContext(), options);
    const original = store.getSync('defaultDownloadUri', '[]');
    let previous = new Array<string>();
    try { previous = this.decodeSavedUris(original as string); }
    catch (error) {
      // A freshly selected and granted directory can repair damaged metadata.
      // Preserve the exact old preference value instead of silently discarding it.
      store.putSync('kamuclInvalidDirectoryUris-' + Date.now(), JSON.stringify({ originalValue: original }));
    }
    const combined = previous.slice();
    for (const uri of uris) if (!combined.includes(uri)) combined.push(uri);
    store.putSync('defaultDownloadUri', JSON.stringify(combined));
    try {
      await new Promise<void>((resolve, reject) => {
        store.flush((error: BusinessError) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } catch (error) {
      // A failed flush must not make a new grant appear saved in memory.
      store.putSync('defaultDownloadUri', original);
      throw error;
    }
  }

  @LogMethod
  private getUris(): string[] {
    const store = preferences.getPreferencesSync(this.ctxAdapter.getContext(), options);
    return this.decodeSavedUris(store.getSync('defaultDownloadUri', '[]') as string);
  }

  private decodeSavedUris(raw: string): string[] {
    if (typeof raw !== 'string') throw new Error('Invalid saved directory permissions');
    const values: string[] = JSON.parse(raw);
    if (!Array.isArray(values) || values.some((uri: string) => typeof uri !== 'string' || uri.length === 0)) {
      throw new Error('Invalid saved directory permissions');
    }
    return values;
  }

`)
    text = replaceRange(text, '  @LogMethod\n  public fileAccessPersist(', '  @LogMethod\n  openPermissionConfirm(', `  @LogMethod
  public async fileAccessPersist(uris: string[]): Promise<void> {
    if (uris.length === 0) throw new Error('No selected URI to persist');
    const policies = new Array<fileShare.PolicyInfo>();
    uris.forEach((uri: string) => {
      const policyReadWrite: fileShare.PolicyInfo = {
        uri: uri,
        operationMode: fileShare.OperationMode.READ_MODE | fileShare.OperationMode.WRITE_MODE,
      };
      policies.push(policyReadWrite);
    });
    await fileShare.persistPermission(policies);
  }

`)
  } else if (relative === 'adapter/FilePickerAdapter.ets') {
    text = replaceRange(text, '  @LogMethod\n  showDirDocumentViewPicker(', '  @LogMethod\n  showSaveAsDocumentViewPicker(', `  @LogMethod
  showDirDocumentViewPicker(file_access_persist: boolean, callback: (path: string) => void) {
    const options = new picker.DocumentSelectOptions();
    options.selectMode = picker.DocumentSelectMode.FOLDER;
    const documentPicker = new picker.DocumentViewPicker();
    documentPicker.select(options).then(async (selected: string[]) => {
      if (selected.length === 0) return '';
      const paths = this.dirFilter(selected);
      // 37.2.0 does not pass a persist flag from showOpenDialog. All selected
      // KAMUCL folders are reused after restart; persist the actual picker URIs.
      await this.permissionManagerAdapter.persistGrantedDirectories(selected);
      return JSON.stringify(paths);
    }).catch((error: Error) => {
      LogUtil.error(TAG, 'Directory selection or permission persistence failed: ' + JSON.stringify(error));
      return '';
    }).then((result: string) => {
      try { callback(result); }
      catch (error) { LogUtil.error(TAG, 'Native picker callback failed: ' + JSON.stringify(error)); }
    });
  }

`)
  } else if (relative === 'jsbindings/PermissionManagerAdapterBind.ets') {
    text = replaceOnce(text, '  implPermissionManagerAdapter().fileAccessPersist(uris);', `  // This legacy native binding has a void return; never leak a rejected Promise.
  implPermissionManagerAdapter().fileAccessPersist(uris).catch((error: Error) => {
    console.error('KAMUCL directory permission request failed: ' + JSON.stringify(error));
  });`)
  } else if (relative === 'adapter/DialogAdapter.ets') {
    text = replaceOnce(text, "import { BaseAdapter } from '../common/BaseAdapter';", `import { BaseAdapter } from '../common/BaseAdapter';
import Inject from '../common/InjectModule';
import { PermissionManagerAdapter } from './PermissionManagerAdapter';
import fileUri from '@ohos.file.fileuri';`)
    text = replaceRange(text, '    documentPicker.select(DocumentSelectOptions).then(', '  @LogMethod\n  showSaveDialog(', `    documentPicker.select(DocumentSelectOptions).then(async (selected: string[]) => {
      if (selected.length > 0 && dialogSettings.properties_open_directory) {
        const directories = dialogSettings.properties_open_mixed
          ? selected.filter((uri: string) => fs.statSync(new fileUri.FileUri(uri).path).isDirectory())
          : selected;
        if (directories.length > 0) {
          await Inject.get(PermissionManagerAdapter).persistGrantedDirectories(directories);
        }
      }
      return selected;
    }).catch((error: BusinessError) => {
      LogUtil.error(TAG, 'Directory selection or authorization failed: ' + JSON.stringify(error));
      return new Array<string>();
    }).then((selected: string[]) => {
      try { callback(selected, selected.length === 0); }
      catch (error) { LogUtil.error(TAG, 'Native dialog callback failed: ' + JSON.stringify(error)); }
    });
  }

`)
  } else if (relative === 'ability/WebAbility.ets' || relative === 'ability/WebEmbeddedAbility.ets') {
    text = replaceOnce(text, '    Inject.get(PermissionManagerAdapter).initPermissions();', `    Inject.get(PermissionManagerAdapter).initPermissions().catch((error: Error) => {
      // WebWindow reports the failure and offers an explicit retry/reauthorize.
      LogUtil.error(TAG, 'Directory permission restore failed: ' + JSON.stringify(error));
    });`)
  } else if (relative === 'utils/GlobalThisHelper.ets') {
    text = replaceOnce(text, 'export class GlobalThisHelper {', `export class GlobalThisHelper {
  private static terminationApproved: boolean = false;
  private static browserReady: boolean = false;
  private static closeDispatcher: (() => void) | undefined;

  public static isBrowserReady(): boolean { return GlobalThisHelper.browserReady; }

  public static setCloseDispatcher(dispatcher: () => void): void {
    GlobalThisHelper.closeDispatcher = dispatcher;
  }

  public static markBrowserReady(): void {
    GlobalThisHelper.browserReady = true;
    GlobalThisHelper.closeDispatcher?.();
  }

  public static isTerminationApproved(): boolean {
    return GlobalThisHelper.terminationApproved;
  }

  public static confirmTermination(): void {
    GlobalThisHelper.terminationApproved = true;
  }
`)
    text = replaceOnce(text, '  public static appInit(provider: DependencyProvider): void {', `  public static appInit(provider: DependencyProvider): void {
    GlobalThisHelper.terminationApproved = false;
    GlobalThisHelper.browserReady = false;
    GlobalThisHelper.closeDispatcher = undefined;`)
  } else if (relative === 'adapter/AppLifecycleAdapter.ets') {
    text = replaceOnce(text, "import { BaseAdapter } from '../common/BaseAdapter';", "import { BaseAdapter } from '../common/BaseAdapter';\nimport { GlobalThisHelper } from '../utils/GlobalThisHelper';")
    text = replaceOnce(text, `  onWebDestroy() {
    this.webStatus = WebStatus.kDestroy;`, `  onWebDestroy() {
    // Only Electron's completed quit approves native termination. A close
    // request, an editor cancel or a failed incremental save never sets this.
    GlobalThisHelper.confirmTermination();
    this.webStatus = WebStatus.kDestroy;`)
    text = replaceOnce(text, `  onWebCreate() {
    this.webStatus = WebStatus.kStart;`, `  onWebCreate() {
    this.webStatus = WebStatus.kStart;
    // Browser::Get is established by the actual native startup, not bindings.
    GlobalThisHelper.markBrowserReady();`)
  } else if (relative === 'components/WebWindow.ets') {
    text = replaceOnce(text, "import Inject from '../common/InjectModule';", "import Inject from '../common/InjectModule';\nimport { PermissionManagerAdapter } from '../adapter/PermissionManagerAdapter';")
    text = replaceOnce(text, `        this.config.nativeContext.runBrowser(vec_args);
        if (this.config.uri)
          this.config.nativeContext.ExecuteCommand(CommandType.kNewWindow, { url: this.config.uri, is_sync: true });`, `        // Restore recorded grants before Electron opens configured game folders.
        this.startBrowserWithDirectoryPermissions(vec_args);`)
    text = replaceOnce(text, '  private setDefaultBounds() {', `  private startBrowserWithDirectoryPermissions(args: string[]): void {
    const launch = () => {
      this.config.nativeContext.runBrowser(args);
      if (this.config.uri)
        this.config.nativeContext.ExecuteCommand(CommandType.kNewWindow, { url: this.config.uri, is_sync: true });
    };
    Inject.get(PermissionManagerAdapter).initPermissions().then(launch).catch((error: Error) => {
      LogUtil.error(TAG, 'Directory authorization initialization failed: ' + JSON.stringify(error));
      AlertDialog.show({
        title: '目录授权恢复失败',
        message: '部分已选择目录的授权无法恢复。可重试授权，或继续进入启动器并重新选择相关目录；授权恢复前这些目录不能使用。',
        autoCancel: false,
        primaryButton: { value: '重试授权', action: () => this.startBrowserWithDirectoryPermissions(args) },
        secondaryButton: { value: '继续并重新选择目录', action: launch },
      });
    });
  }

  private setDefaultBounds() {`)
  }
  return text
}

async function applyNativeAdaptations(project) {
  const changes = []
  for (const relative of Object.keys(sourceHashes)) {
    const file = path.join(project, base, relative)
    const original = await fs.readFile(file)
    const adapted = adapt(relative, original)
    await fs.writeFile(file, adapted)
    changes.push({ path: base + relative, originalSHA256: sha256(original), adaptedSHA256: sha256(adapted) })
  }
  return { schemaVersion: 1, runtime: '37.2.0', scope: 'native-template-source-adaptation-not-SDK-or-device-validation', changes }
}

module.exports = { adapt, sourceHashes, applyNativeAdaptations, transform }
