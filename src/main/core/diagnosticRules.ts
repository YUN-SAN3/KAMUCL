import type { DiagnosticFinding } from '../../shared/instanceCenter'
import { redactDiagnosticText } from './diagnostics'
const RULES: Array<{rule:string;title:string;pattern:RegExp;advice:string;action?:DiagnosticFinding['action'];confidence:DiagnosticFinding['confidence']}> = [
  {rule:'java-version',title:'Java 版本不兼容',pattern:/UnsupportedClassVersionError|class file version .*only recognizes|requires Java (?:version )?\d+/i,advice:'选择该实例要求的 Java 版本后重新启动。',action:'java',confidence:'certain'},
  {rule:'java-argument',title:'Java 启动参数无效',pattern:/Unrecognized VM option|Unrecognized option:|Invalid maximum heap size|Improperly specified VM option/i,advice:'检查版本设置中的 JVM 参数，只修改报错指出的参数。',confidence:'certain'},
  {rule:'memory',title:'内存分配或使用失败',pattern:/OutOfMemoryError|Could not reserve enough space|Native memory allocation .*failed|There is insufficient memory/i,advice:'检查可用内存与实例分配；无法预留时适当降低分配，堆内存耗尽时结合系统余量调整。',confidence:'certain'},
  {rule:'dependency',title:'加载器报告模组依赖不满足',pattern:/requires .*which is missing|requires .*which is not installed|Missing mandatory dependencies|ModResolutionException|Incompatible mod set/i,advice:'打开模组管理核对加载器指出的前置与版本范围，再从社区安装适配版本。',action:'mods',confidence:'certain'},
  {rule:'duplicate',title:'加载器报告重复模组',pattern:/DuplicateModsFoundException|Duplicate mod(?:s| ID)?(?: found|:)|Found duplicate mods/i,advice:'打开模组管理中的清理重复，核对文件后确认处理。',action:'mods',confidence:'certain'},
  {rule:'mod-version',title:'加载器报告模组版本不兼容',pattern:/requires.*minecraft.*but|requires.*version.*but only|incompatible with.*version/i,advice:'按日志给出的游戏版本与加载器要求切换模组版本。',action:'mods',confidence:'certain'},
  {rule:'archive',title:'运行文件可能损坏',pattern:/ZipException:.*(?:zip END header|error in opening zip|invalid)|Invalid or corrupt jarfile/i,advice:'检查游戏本体和运行库；模组文件请通过模组管理重新下载。',action:'files',confidence:'possible'},
  {rule:'permission',title:'文件无法访问或被占用',pattern:/AccessDeniedException|Permission denied|used by another process|being used by another process/i,advice:'关闭占用该文件的程序并检查目录权限，再重试；不要删除存档锁文件。',confidence:'certain'},
  {rule:'disk',title:'磁盘空间不足',pattern:/No space left on device|There is not enough space on the disk|ENOSPC/i,advice:'释放游戏目录和临时目录所在磁盘空间，再重新执行。',confidence:'certain'},
  {rule:'graphics',title:'图形环境初始化失败',pattern:/GLFW error \d+|Failed to create OpenGL context|Pixel format not accelerated|does not support OpenGL/i,advice:'检查显卡驱动及游戏版本要求，使用显卡厂商官方驱动下载入口。',confidence:'certain'},
  {rule:'native-arch',title:'本地库或 Java 架构可能不匹配',pattern:/wrong architecture|incompatible architecture|Can't load AMD 64-bit|mach-o.*(?:arm64|x86_64)|Bad CPU type in executable/i,advice:'确认 Java 与当前系统架构匹配，并重新校验运行库。',action:'java',confidence:'possible'}
]
export function analyzeDiagnosticText(text:string):DiagnosticFinding[]{
  const lines=redactDiagnosticText(text).split(/\r?\n/),result:DiagnosticFinding[]=[]
  for(const rule of RULES){const index=lines.findIndex(line=>rule.pattern.test(line));if(index<0)continue;const evidence=lines.slice(Math.max(0,index-1),Math.min(lines.length,index+4)).join('\n').slice(0,2000);result.push({rule:rule.rule,title:rule.title,confidence:rule.confidence,evidence,advice:rule.advice,action:rule.action})}
  if(!result.length&&text.trim())result.push({rule:'unknown',title:'现有日志不足以确定原因',confidence:'unknown',evidence:'未发现首批诊断规则可确认的错误。',advice:'导出诊断日志进一步检查；不会据此禁用或删除模组。'})
  return result
}
