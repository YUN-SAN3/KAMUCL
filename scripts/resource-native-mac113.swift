// QA-only read-only observer. Compile with the system libproc/mach bridging
// header created by resource-mac113-native.cjs. No process signals or VM writes.
import Foundation
import Darwin

func emit(_ value: [String: Any]) {
    do {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    } catch { fputs("observer JSON failure: \(error)\n", stderr); exit(2) }
}
func epochMs() -> Double { Date().timeIntervalSince1970 * 1000 }
func monoMs() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000 }
var cpuTimebase = mach_timebase_info_data_t()
let cpuTimebaseResult = mach_timebase_info(&cpuTimebase)
guard cpuTimebaseResult == KERN_SUCCESS && cpuTimebase.numer > 0 && cpuTimebase.denom > 0 else {
    emit(["event": "observer-error", "stage": "mach_timebase_info", "kernResult": cpuTimebaseResult]); exit(2)
}
func cpuNanoseconds(_ ticks: UInt64) -> UInt64 {
    UInt64(cpuTimebase.denom).dividingFullWidth(ticks.multipliedFullWidth(by: UInt64(cpuTimebase.numer))).quotient
}
func processCPUClockNanoseconds() -> UInt64? {
    var value = timespec()
    guard clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &value) == 0 && value.tv_sec >= 0 && value.tv_nsec >= 0 else { return nil }
    return UInt64(value.tv_sec) * 1_000_000_000 + UInt64(value.tv_nsec)
}
struct Identity {
    let pid: Int32, ppid: Int32, creationUS: UInt64, name: String
    var creationUnixMs: Double { Double(creationUS) / 1000 }
}
func identity(_ pid: Int32) -> Identity? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
    var name = [CChar](repeating: 0, count: 128)
    let nameSize = UInt32(name.count)
    _ = proc_name(pid, &name, nameSize)
    return Identity(pid: pid, ppid: Int32(info.pbi_ppid),
                    creationUS: info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec,
                    name: String(cString: name))
}
struct ZombieIdentityProbe {
    let original: [String: Any]
    let qualified: Bool
}
func zombieIdentityProbe(_ own: Identity, argument: UInt64 = 1) -> ZombieIdentityProbe {
    // Apple XNU proc_info.c sets findzomb for PROC_PIDTBSDINFO when arg != 0,
    // then uses proc_find_zombref if proc_find fails, with normal permissions.
    // This is an immediate second identity read, never a later exit inference.
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size), start = epochMs()
    errno = 0
    let result = proc_pidinfo(own.pid, PROC_PIDTBSDINFO, argument, &info, size), code = errno
    let end = epochMs()
    let bytes = withUnsafeBytes(of: &info) { Data($0).base64EncodedString() }
    let returnedIdentity: Any
    let layout = resource_bsd_layout_value113()
    let qualified = argument == 1 && result == size && code == 0 && info.pbi_pid == UInt32(own.pid) &&
        info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec == own.creationUS &&
        info.pbi_status == RESOURCE_PROC_STATUS_ZOMBIE113
    if result == size {
        returnedIdentity = ["pid": info.pbi_pid, "ppid": info.pbi_ppid,
            "creationUnixUS": String(info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec),
            "startTimeSeconds": String(info.pbi_start_tvsec), "startTimeMicroseconds": String(info.pbi_start_tvusec),
            "status": info.pbi_status] as [String: Any]
    } else { returnedIdentity = NSNull() }
    return ZombieIdentityProbe(original: [
        "source": "Actual proc_pidinfo PROC_PIDTBSDINFO identity observation",
        "api": "proc_pidinfo", "flavor": PROC_PIDTBSDINFO, "argument": argument,
        "requestedPID": own.pid, "expectedCreationUnixUS": String(own.creationUS),
        "result": result, "systemErrno": code, "bufferSize": size, "originalBufferBase64": bytes,
        "bufferLayout": ["size": layout.size, "pid": layout.pid, "ppid": layout.ppid, "status": layout.status,
            "startTimeSeconds": layout.start_sec, "startTimeMicroseconds": layout.start_usec, "byteOrder": "little-endian"],
        "probeStartUnixMs": start, "probeEndUnixMs": end, "identity": returnedIdentity,
        "zombieStatusConstant": RESOURCE_PROC_STATUS_ZOMBIE113, "qualified": qualified,
        "scope": "Original same-creation SZOMB proves awaiting parent collection; live, short, denied or unknown results do not prove exit"],
        qualified: qualified)
}
func processTable() -> (identities: [Identity], listedPIDs: Set<Int32>, errors: [[String: Any]]) {
    let requested = proc_listallpids(nil, 0)
    guard requested > 0 else {
        return ([], [], [["stage": "proc_listallpids capacity", "result": requested,
            "errno": errno, "atUnixMs": epochMs(), "required": true]])
    }
    var capacity = max(256, Int(requested) + 256)
    while capacity <= 131_072 {
        var ids = [Int32](repeating: 0, count: capacity)
        let byteCount = Int32(ids.count * MemoryLayout<Int32>.size)
        let count = Int(proc_listallpids(&ids, byteCount))
        if count <= 0 {
            return ([], [], [["stage": "proc_listallpids collection", "result": count,
                "errno": errno, "atUnixMs": epochMs(), "required": true]])
        }
        if count >= capacity { capacity *= 2; continue }
        let listed = Set(ids.prefix(count).filter { $0 > 0 })
        return (listed.compactMap(identity), listed, [])
    }
    return ([], [], [["stage": "proc_listallpids capacity limit", "capacity": capacity,
        "atUnixMs": epochMs(), "required": true]])
}
func identityJSON(_ own: Identity?) -> Any {
    guard let own = own else { return NSNull() }
    return ["pid": own.pid, "ppid": own.ppid, "name": own.name,
            "creationUnixUS": String(own.creationUS)] as [String: Any]
}
// Each registration is bound once to the original verified process. A numeric
// generation in udata prevents a late event from being credited to another PID
// generation. NOTE_EXITSTATUS/ptrace/signals are neither requested nor needed.
final class OwnedExitObserver {
    let fd: Int32
    var nextGeneration: UInt64 = 0
    var registrations: [Int32: [String: Any]] = [:]
    var notifications: [Int32: [String: Any]] = [:]
    var pendingErrors: [[String: Any]] = []
    var closed = false
    init(_ descriptor: Int32) { fd = descriptor }
    func eventJSON(_ event: resource_proc_event113) -> [String: Any] {
        ["ident": event.ident, "filter": event.filter, "flags": event.flags,
         "fflags": event.fflags, "data": event.data,
         "userDataGeneration": String(event.generation),
         "callResult": event.call_result, "systemErrno": event.system_errno,
         "observedAtUnixMs": epochMs()]
    }
    func register(_ own: Identity) {
        if registrations[own.pid] != nil { return }
        nextGeneration += 1
        let before = identity(own.pid), start = epochMs(), token = nextGeneration
        var registration: [String: Any] = ["pid": own.pid, "expectedCreationUnixUS": String(own.creationUS),
            "userDataGeneration": String(token), "beforeIdentity": identityJSON(before),
            "registrationStartUnixMs": start, "qualified": false,
            "request": ["filter": Int16(EVFILT_PROC), "flags": UInt16(EV_ADD | EV_ENABLE | EV_ONESHOT | EV_RECEIPT),
                        "fflags": UInt32(NOTE_EXIT), "userDataGeneration": String(token)],
            "scope": "Read-only kernel process NOTE_EXIT bound to verified owned PID and creation; no signals, status, target writes or debugger attachment"]
        if before?.creationUS == own.creationUS {
            var receipt = resource_proc_event113()
            _ = resource_proc_register113(fd, own.pid, token, &receipt)
            let after = identity(own.pid)
            registration["receipt"] = eventJSON(receipt)
            registration["afterIdentity"] = identityJSON(after)
            registration["qualified"] = receipt.call_result == 1 && receipt.ident == UInt64(own.pid) &&
                receipt.filter == Int16(EVFILT_PROC) && (receipt.flags & UInt16(EV_ERROR)) != 0 && receipt.data == 0 &&
                receipt.generation == token && after?.creationUS == own.creationUS
        } else { registration["afterIdentity"] = NSNull(); registration["receipt"] = NSNull() }
        registration["registrationEndUnixMs"] = epochMs()
        registrations[own.pid] = registration
        emit(["event": "owned-exit-registration", "atUnixMs": epochMs(), "registration": registration])
        if registration["qualified"] as? Bool != true {
            pendingErrors.append(["pid": own.pid, "stage": "owned NOTE_EXIT registration or same-creation recheck",
                "atUnixMs": epochMs(), "required": true, "registration": registration,
                "reason": "An unqualified registration cannot prove exit or hide the original owned identity"])
        }
    }
    func drain() {
        while true {
            var events = [resource_proc_event113](repeating: resource_proc_event113(), count: 64)
            let count = events.withUnsafeMutableBufferPointer { resource_proc_drain113(fd, $0.baseAddress!, Int32($0.count)) }
            if count < 0 {
                pendingErrors.append(["stage": "owned NOTE_EXIT nonblocking drain", "atUnixMs": epochMs(),
                    "required": true, "original": eventJSON(events[0])]); return
            }
            if count == 0 { return }
            for event in events.prefix(Int(count)) {
                let raw = eventJSON(event)
                let pid = event.ident <= UInt64(Int32.max) ? Int32(event.ident) : -1
                let registration = registrations[pid]
                let qualified = registration?["qualified"] as? Bool == true &&
                    registration?["userDataGeneration"] as? String == String(event.generation) &&
                    event.filter == Int16(EVFILT_PROC) && (event.flags & UInt16(EV_ERROR)) == 0 &&
                    (event.fflags & UInt32(NOTE_EXIT)) != 0 && notifications[pid] == nil
                let evidence: [String: Any] = ["pid": pid, "registration": registration ?? [:],
                    "notification": raw, "qualified": qualified,
                    "source": "Actual original kqueue EVFILT_PROC NOTE_EXIT notification"]
                emit(["event": "owned-kernel-exit", "atUnixMs": epochMs(), "evidence": evidence])
                if qualified { notifications[pid] = evidence }
                else { pendingErrors.append(["pid": pid, "stage": "unmatched owned NOTE_EXIT notification", "required": true,
                    "atUnixMs": epochMs(), "original": evidence]) }
            }
            if count < 64 { return }
        }
    }
    func exitEvidence(_ own: Identity) -> [String: Any]? {
        drain()
        guard let value = notifications[own.pid],
              let registration = value["registration"] as? [String: Any],
              registration["expectedCreationUnixUS"] as? String == String(own.creationUS) else { return nil }
        return value
    }
    func takeErrors() -> [[String: Any]] { let result = pendingErrors; pendingErrors.removeAll(); return result }
    func close() -> [String: Any] {
        if closed { return ["alreadyClosed": true] }
        errno = 0; let result = Darwin.close(fd), code = errno; closed = true
        return ["descriptor": fd, "closeResult": result, "errno": code, "atUnixMs": epochMs()]
    }
}
func counters(_ own: Identity, role: String, exitObserver: OwnedExitObserver? = nil) -> ([String: Any], [[String: Any]]) {
    var row: [String: Any] = ["pid": own.pid, "ppid": own.ppid, "name": own.name,
        "creationUnixMs": own.creationUnixMs, "creationUnixUS": String(own.creationUS), "role": role,
        "physicalFootprintBytes": NSNull(), "residentSizeBytes": NSNull(),
        "residentSizeMaxBytes": NSNull(), "virtualSizeBytes": NSNull(), "cpuNs": NSNull(),
        "pageFaultCount": NSNull(), "pageins": NSNull(), "readBytes": NSNull(), "writeBytes": NSNull()]
    let collectionStartUnixMs = epochMs()
    row["collectionStartUnixMs"] = collectionStartUnixMs
    var errors: [[String: Any]] = []
    func invalidated(_ stage: String, _ observed: Identity?) -> ([String: Any], [[String: Any]]) {
        // Signal zero only observes existence; it never signals or stops a process.
        errno = 0
        let existenceResult = Darwin.kill(own.pid, 0)
        let existenceErrno = errno
        let reused = observed != nil && observed!.creationUS != own.creationUS
        let exited = observed == nil && existenceResult == -1 && existenceErrno == ESRCH
        let kernelExit = exitObserver?.exitEvidence(own)
        let zombieProbe = observed == nil ? zombieIdentityProbe(own) : nil
        let zombie = zombieProbe?.qualified == true
        let confirmedLifecycle = exited || reused || kernelExit != nil || zombie
        let afterIdentity: Any
        if let observed = observed {
            afterIdentity = ["pid": observed.pid, "ppid": observed.ppid,
                "name": observed.name, "creationUnixUS": String(observed.creationUS)] as [String: Any]
        } else { afterIdentity = NSNull() }
        var evidence: [String: Any] = ["pid": own.pid, "stage": stage,
            "beforeCreationUnixUS": String(own.creationUS),
            "afterIdentity": afterIdentity,
            "existenceProbe": ["result": existenceResult, "errno": existenceErrno, "signal": 0],
            "atUnixMs": epochMs(), "collectionStartUnixMs": collectionStartUnixMs,
            "lifecycleInvalidation": confirmedLifecycle, "required": !confirmedLifecycle,
            "reason": kernelExit != nil ? "Original PID/creation registration received actual kernel NOTE_EXIT; counters unavailable, never credit a terminal CPU tail" :
                zombie ? "Immediate original same-creation PROC_PIDTBSDINFO arg=1 returned SZOMB; counters unavailable, never credit a terminal CPU tail" :
                reused ? "Verified creation identity changed; never bind the replacement PID" :
                exited ? "Owned PID no longer exists during collection" : "Identity unavailable but exit or reuse is unproven",
            "originalCounterErrors": errors]
        if let kernelExit = kernelExit { evidence["kernelExitEvidence"] = kernelExit }
        if let zombieProbe = zombieProbe { evidence["zombieIdentityProbe"] = zombieProbe.original }
        row["invalidated"] = true
        row["identityInvalidation"] = evidence
        row["collectionEndUnixMs"] = evidence["atUnixMs"]
        // Keep all partial counter values in the original invalidated row. None
        // may be included in whole-tree memory or credited as an exit CPU tail.
        return (row, confirmedLifecycle ? [evidence] : errors + [evidence])
    }
    let before = identity(own.pid)
    if exitObserver?.exitEvidence(own) != nil { return invalidated("identity before counters", before) }
    guard let verifiedBefore = before, verifiedBefore.creationUS == own.creationUS else {
        return invalidated("identity before counters", before)
    }
    var task = mach_port_t(MACH_PORT_NULL)
    let isSelf = own.pid == getpid()
    let portResult = isSelf ? KERN_SUCCESS : task_for_pid(mach_task_self_, own.pid, &task)
    if isSelf { task = mach_task_self_ }
    row["taskForPIDResult"] = portResult
    if portResult == KERN_SUCCESS {
        defer { if !isSelf { _ = mach_port_deallocate(mach_task_self_, task) } }
        var basic = mach_task_basic_info_data_t()
        var basicCount = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info_data_t>.size / MemoryLayout<integer_t>.size)
        let basicCapacity = Int(basicCount)
        let basicResult = withUnsafeMutablePointer(to: &basic) {
            $0.withMemoryRebound(to: integer_t.self, capacity: basicCapacity) {
                task_info(task, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &basicCount)
            }
        }
        row["machTaskBasicInfoResult"] = basicResult; row["machTaskBasicInfoCount"] = basicCount
        if basicResult == KERN_SUCCESS {
            row["machTaskBasicInfoResidentSizeBytes"] = basic.resident_size
            row["residentSizeMaxBytes"] = basic.resident_size_max
            row["virtualSizeBytes"] = basic.virtual_size
        } else { errors.append(["pid": own.pid, "stage": "MACH_TASK_BASIC_INFO", "kernResult": basicResult, "required": false]) }
        var vm = task_vm_info_data_t()
        var vmCount = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let vmCapacity = Int(vmCount)
        let vmResult = withUnsafeMutablePointer(to: &vm) {
            $0.withMemoryRebound(to: integer_t.self, capacity: vmCapacity) {
                task_info(task, task_flavor_t(TASK_VM_INFO), $0, &vmCount)
            }
        }
        row["taskVMInfoResult"] = vmResult; row["taskVMInfoCount"] = vmCount
        if vmResult == KERN_SUCCESS && vmCount >= RESOURCE_TASK_VM_INFO_REV1_COUNT113 {
            row["taskVMInfoPhysicalFootprintBytes"] = vm.phys_footprint
            row["taskVMInfo"] = ["residentSize": vm.resident_size, "residentSizePeak": vm.resident_size_peak,
                "internal": vm.internal, "external": vm.external, "reusable": vm.reusable,
                "compressed": vm.compressed, "compressedPeak": vm.compressed_peak,
                "physFootprint": vm.phys_footprint]
        } else { errors.append(["pid": own.pid, "stage": "TASK_VM_INFO physical footprint cross-check", "kernResult": vmResult, "returnedCount": vmCount, "required": false]) }
    } else { errors.append(["pid": own.pid, "stage": "task_for_pid", "kernResult": portResult, "required": false,
                            "error": "Optional task_info cross-check unavailable; actual proc_pid_rusage physical footprint remains primary"] ) }
    var procTask = proc_taskinfo()
    let taskSize = Int32(MemoryLayout<proc_taskinfo>.size)
    if proc_pidinfo(own.pid, PROC_PIDTASKINFO, 0, &procTask, taskSize) == taskSize {
        // Apple fill_taskprocinfo returns recount_times_mach, not nanoseconds.
        // Preserve original ticks and the actual host timebase before converting.
        row["cpuNs"] = cpuNanoseconds(procTask.pti_total_user) + cpuNanoseconds(procTask.pti_total_system)
        row["cpuSource"] = "PROC_PIDTASKINFO Mach absolute ticks converted with mach_timebase_info"
        row["cpuTimebase"] = ["numer": cpuTimebase.numer, "denom": cpuTimebase.denom]
        row["pageFaultCount"] = Int64(procTask.pti_faults); row["pageins"] = Int64(procTask.pti_pageins)
        row["procTaskInfo"] = ["totalUserMachTicks": procTask.pti_total_user, "totalSystemMachTicks": procTask.pti_total_system,
            "totalUserNs": cpuNanoseconds(procTask.pti_total_user), "totalSystemNs": cpuNanoseconds(procTask.pti_total_system),
            "cowFaults": procTask.pti_cow_faults, "contextSwitches": procTask.pti_csw,
            "threads": procTask.pti_threadnum, "runningThreads": procTask.pti_numrunning]
    } else { errors.append(["pid": own.pid, "stage": "PROC_PIDTASKINFO", "errno": errno]) }
    var usage = rusage_info_v2()
    let usageResult = resource_pid_rusage113(own.pid, &usage)
    row["procRusageResult"] = usageResult
    if usageResult == 0 {
        row["readBytes"] = usage.ri_diskio_bytesread; row["writeBytes"] = usage.ri_diskio_byteswritten
        // Both native APIs report the kernel physical footprint. Public libproc
        // is primary because a signed app may deny an external task port.
        // It is never replaced by RSS, JS heap, reserved virtual bytes or zero.
        row["physicalFootprintBytes"] = usage.ri_phys_footprint
        row["residentSizeBytes"] = usage.ri_resident_size
        row["physicalFootprintSource"] = "proc_pid_rusage RUSAGE_INFO_V2 ri_phys_footprint"
        row["residentSizeSource"] = "proc_pid_rusage RUSAGE_INFO_V2 ri_resident_size"
        row["procRusagePhysicalFootprintBytes"] = usage.ri_phys_footprint
        row["procRusageResidentSizeBytes"] = usage.ri_resident_size
    } else { errors.append(["pid": own.pid, "stage": "proc_pid_rusage primary footprint/resident/IO", "errno": errno]) }
    let after = identity(own.pid)
    guard let verifiedAfter = after, verifiedAfter.creationUS == own.creationUS else {
        return invalidated("identity after counters", after)
    }
    row["collectionEndUnixMs"] = epochMs()
    return (row, errors)
}
enum ZombieQualificationFailure: Error { case failed(String) }
func qualifyOwnedZombie() -> [String: Any] {
    var proof: [String: Any] = ["event": "owned-zombie-qualification", "passed": false,
        "startedAtUnixMs": epochMs(), "parentPID": getpid(),
        "scope": "Actual own fork/pipe children; natural EOF/_exit, original same-creation SZOMB before waitpid, independent of NOTE_EXIT; no product resource acceptance"]
    var controlFD: Int32 = -1, childFD: Int32 = -1
    var controlPID: Int32 = -1, childPID: Int32 = -1
    var naturalReaps: [[String: Any]] = []
    func require(_ condition: Bool, _ reason: String) throws {
        if !condition { throw ZombieQualificationFailure.failed(reason) }
    }
    func releaseAndReap(_ pid: inout Int32, _ fd: inout Int32) {
        guard pid > 0 else { return }
        let closeAttempted = fd >= 0
        var closeResult: Any = NSNull(), closeErrno: Any = NSNull()
        if closeAttempted {
            errno = 0
            closeResult = Darwin.close(fd); closeErrno = errno
        }
        fd = -1
        var status: Int32 = 0
        errno = 0
        let result = resource_reap_child113(pid, &status), code = errno
        let validated = result == pid
        naturalReaps.append(["pid": pid, "closeAttempted": closeAttempted,
            "releasePipeCloseResult": closeResult, "releasePipeErrno": closeErrno,
            "waitPIDResult": result, "systemErrno": code,
            "originalWaitStatusBuffer": status, "waitStatusValidated": validated,
            "rawWaitStatus": validated ? status as Any : NSNull(),
            "naturalExitCode": validated ? resource_child_exit_code113(status) as Any : NSNull(),
            "atUnixMs": epochMs()])
        pid = -1
    }
    func awaitIdentity(_ pid: Int32) throws -> Identity {
        let deadline = monoMs() + 5000
        while monoMs() < deadline {
            if let own = identity(pid), own.ppid == getpid() { return own }
            usleep(10_000)
        }
        throw ZombieQualificationFailure.failed("Actual fork child live identity unavailable")
    }
    do {
        // Fork's child branch stays entirely inside the async-signal-safe C
        // wrapper. The later child closes its inherited control release fd.
        controlPID = resource_waiting_child113(&controlFD, -1)
        try require(controlPID > 0, "Own control fork failed")
        let control = try awaitIdentity(controlPID)
        childPID = resource_waiting_child113(&childFD, controlFD)
        try require(childPID > 0, "Own zombie fixture fork failed")
        let own = try awaitIdentity(childPID)
        proof["originalOwnedIdentity"] = identityJSON(own)
        proof["originalControlIdentity"] = identityJSON(control)
        let liveProbe = zombieIdentityProbe(control)
        let (liveRow, liveErrors) = counters(control, role: "owned-live-zombie-control")
        proof["liveControl"] = ["probe": liveProbe.original, "row": liveRow, "errors": liveErrors]
        try require(!liveProbe.qualified && identity(control.pid)?.creationUS == control.creationUS &&
            liveRow["invalidated"] as? Bool != true && liveErrors.filter { $0["required"] as? Bool != false }.isEmpty &&
            (liveRow["physicalFootprintBytes"] as? UInt64 ?? 0) > 0, "Actual live control must remain measurable, never a zombie")
        errno = 0
        let releaseResult = Darwin.close(childFD), releaseErrno = errno
        childFD = -1
        proof["naturalExitRelease"] = ["pid": own.pid, "pipeCloseResult": releaseResult,
            "systemErrno": releaseErrno, "atUnixMs": epochMs(), "signalDelivered": false]
        try require(releaseResult == 0, "Own child natural EOF release failed")
        let deadline = monoMs() + 5000
        var observations: [[String: Any]] = [], sawZombie = false
        while monoMs() < deadline {
            let probe = zombieIdentityProbe(own)
            observations.append(probe.original)
            if probe.qualified { sawZombie = true; break }
            usleep(10_000)
        }
        proof["zombieWaitObservations"] = observations
        try require(sawZombie, "Actual un-reaped same-creation SZOMB unavailable")
        let ordinaryProbe = zombieIdentityProbe(own, argument: 0)
        proof["ordinaryIdentityAtZombie"] = ordinaryProbe.original
        try require(ordinaryProbe.original["identity"] is NSNull, "Fixture must reproduce ordinary identity lookup failure")
        // No exit observer is supplied. This proves the new immediate native
        // identity branch, not a previously received or later NOTE_EXIT event.
        let (zombieRow, zombieErrors) = counters(own, role: "owned-unreaped-zombie")
        proof["zombieCounters"] = ["row": zombieRow, "errors": zombieErrors, "noteExitObserverSupplied": false]
        let evidence = zombieRow["identityInvalidation"] as? [String: Any]
        let originalProbe = evidence?["zombieIdentityProbe"] as? [String: Any]
        let existence = evidence?["existenceProbe"] as? [String: Any]
        let counterFields = ["physicalFootprintBytes", "residentSizeBytes", "residentSizeMaxBytes", "virtualSizeBytes",
            "cpuNs", "pageFaultCount", "pageins", "readBytes", "writeBytes"]
        try require(zombieRow["invalidated"] as? Bool == true && evidence?["lifecycleInvalidation"] as? Bool == true &&
            originalProbe?["qualified"] as? Bool == true && evidence?["kernelExitEvidence"] == nil &&
            existence?["result"] as? Int32 == 0 && existence?["errno"] as? Int32 == 0 &&
            counterFields.allSatisfy { zombieRow[$0] is NSNull }, "Zombie branch must prove the former unknown-alive race without invented counters")
        let wrong = Identity(pid: own.pid, ppid: own.ppid, creationUS: own.creationUS + 1, name: own.name)
        let (wrongRow, wrongErrors) = counters(wrong, role: "qualification-only-mismatched-creation")
        proof["mismatchedCreationDiagnostic"] = ["row": wrongRow, "errors": wrongErrors,
            "scope": "Negative diagnostic only; deliberately wrong expected creation is never a verified owned replacement"]
        let wrongEvidence = wrongRow["identityInvalidation"] as? [String: Any]
        try require(wrongEvidence?["lifecycleInvalidation"] as? Bool == false && wrongEvidence?["required"] as? Bool == true &&
            !wrongErrors.isEmpty, "A different creation must remain an original required error")
        try require(identity(control.pid)?.creationUS == control.creationUS, "Unrelated control must remain alive before own zombie reap")
        proof["controlAliveBeforeReap"] = identityJSON(identity(control.pid))
        releaseAndReap(&childPID, &childFD)
        try require(naturalReaps.last?["waitPIDResult"] as? Int32 == own.pid &&
            naturalReaps.last?["naturalExitCode"] as? Int32 == 0 &&
            naturalReaps.last?["systemErrno"] as? Int32 == 0, "Own zombie must be reaped with natural exit zero")
        try require(identity(control.pid)?.creationUS == control.creationUS, "Control must remain alive after own zombie reap")
        proof["controlAliveAfterReap"] = identityJSON(identity(control.pid))
        releaseAndReap(&controlPID, &controlFD)
        try require(naturalReaps.last?["waitPIDResult"] as? Int32 == control.pid &&
            naturalReaps.last?["naturalExitCode"] as? Int32 == 0, "Own control must exit naturally")
        proof["passed"] = true
    } catch { proof["failure"] = String(describing: error) }
    // Failure cleanup only releases/reaps the two PIDs returned by our forks.
    // No global enumeration, signals, foreign process control or fabricated exit.
    releaseAndReap(&childPID, &childFD)
    releaseAndReap(&controlPID, &controlFD)
    proof["naturalReaps"] = naturalReaps
    proof["finishedAtUnixMs"] = epochMs()
    return proof
}
if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--zombie-self-test" {
    let proof = qualifyOwnedZombie()
    emit(proof); exit(proof["passed"] as? Bool == true ? 0 : 1)
}
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--identity",
   let pid = Int32(CommandLine.arguments[2]), let row = identity(pid) {
    emit(["pid": row.pid, "ppid": row.ppid, "name": row.name,
          "creationUnixUS": String(row.creationUS), "creationUnixMs": row.creationUnixMs]); exit(0)
}
if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--inspect-exited-owner",
   let pid = Int32(CommandLine.arguments[2]), let creation = UInt64(CommandLine.arguments[3]) {
    let original = Identity(pid: pid, ppid: getpid(), creationUS: creation, name: "previously verified owned qualification child")
    let (row, errors) = counters(original, role: "owned-qualification-child")
    let evidence = row["identityInvalidation"] as? [String: Any]
    let probe = evidence?["existenceProbe"] as? [String: Any]
    let passed = row["invalidated"] as? Bool == true && evidence?["lifecycleInvalidation"] as? Bool == true &&
        evidence?["afterIdentity"] is NSNull && probe?["result"] as? Int32 == -1 && probe?["errno"] as? Int32 == ESRCH
    emit(["event": "owned-exit-qualification", "passed": passed, "atUnixMs": epochMs(),
          "invalidatedRow": row, "errors": errors,
          "scope": "Read-only native identity/existence after caller awaited its own previously verified child's natural exit; no signal delivered"])
    exit(passed ? 0 : 1)
}
if CommandLine.arguments.contains("--self-test") {
    guard let own = identity(getpid()) else { emit(["event": "self-test", "passed": false, "reason": "self identity unavailable"]); exit(1) }
    guard let beforeClockStart = processCPUClockNanoseconds() else { emit(["event": "self-test", "passed": false, "reason": "Native process CPU clock unavailable"]); exit(1) }
    let (before, beforeErrors) = counters(own, role: "native-self-test")
    guard let beforeClockEnd = processCPUClockNanoseconds() else { emit(["event": "self-test", "passed": false]); exit(1) }
    let bytes = 32 * 1024 * 1024
    let allocation = UnsafeMutableRawPointer.allocate(byteCount: bytes, alignment: 4096)
    allocation.initializeMemory(as: UInt8.self, repeating: 13, count: bytes)
    var checksum: UInt64 = 0x113
    while true {
        for _ in 0..<10000 { checksum = checksum &* 6364136223846793005 &+ 1 }
        guard let current = processCPUClockNanoseconds() else { emit(["event": "self-test", "passed": false]); exit(1) }
        if current - beforeClockEnd >= 250_000_000 { break }
    }
    guard let afterClockStart = processCPUClockNanoseconds() else { emit(["event": "self-test", "passed": false]); exit(1) }
    let (after, afterErrors) = counters(own, role: "native-self-test")
    guard let afterClockEnd = processCPUClockNanoseconds(), let beforeCPU = before["cpuNs"] as? UInt64,
          let afterCPU = after["cpuNs"] as? UInt64, afterCPU >= beforeCPU else { emit(["event": "self-test", "passed": false]); exit(1) }
    let cpuDelta = afterCPU - beforeCPU
    let bracketLower = afterClockStart - beforeClockEnd, bracketUpper = afterClockEnd - beforeClockStart
    let cpuPassed = cpuDelta >= bracketLower && cpuDelta <= bracketUpper
    let requiredErrors = (beforeErrors + afterErrors).filter { $0["required"] as? Bool != false }
    let passed = cpuPassed && requiredErrors.isEmpty && (after["physicalFootprintBytes"] as? UInt64 ?? 0) > 0 &&
        (after["residentSizeBytes"] as? UInt64 ?? 0) > 0 && identity(getpid())?.creationUS == own.creationUS
    emit(["event": "self-test", "passed": passed, "scope": "Native compiler/API and own PID identity qualification only, not launcher performance",
          "atUnixMs": epochMs(), "before": before, "after": after, "errors": beforeErrors + afterErrors,
          "touchedAllocationBytes": bytes, "firstByte": allocation.load(as: UInt8.self),
          "cpuQualification": ["passed": cpuPassed, "observedConvertedDeltaNs": cpuDelta,
             "clockGettimeBracketLowerNs": bracketLower, "clockGettimeBracketUpperNs": bracketUpper,
             "beforeClockStartNs": beforeClockStart, "beforeClockEndNs": beforeClockEnd,
             "afterClockStartNs": afterClockStart, "afterClockEndNs": afterClockEnd,
             "machTimebase": ["numer": cpuTimebase.numer, "denom": cpuTimebase.denom],
             "checksum": String(checksum), "scope": "Actual CPU API unit cross-check inside original clock_gettime brackets; not a product performance tolerance"]])
    allocation.deallocate(); exit(passed ? 0 : 1)
}
guard CommandLine.arguments.count == 4, let ownerPID = Int32(CommandLine.arguments[2]),
      let ownerCreation = UInt64(CommandLine.arguments[3]), identity(ownerPID)?.creationUS == ownerCreation else {
    fputs("Expected control JSON, actual owner PID and native creation microseconds\n", stderr); exit(2)
}
func runObserver() -> Int32 {
let controlFile = CommandLine.arguments[1], started = monoMs()
var generation: Int = -1, phase = "observer-ready", seeds: [Int32: Double] = [:], roles: [Int32: String] = [:]
var known: [Int32: Identity] = [:], retired = Set<Int32>(), stopping = false, observerExitCode: Int32 = 0
let queueDescriptor = kqueue()
guard queueDescriptor >= 0 else { emit(["event": "observer-error", "stage": "read-only owned exit kqueue creation", "errno": errno]); return 2 }
let exitObserver = OwnedExitObserver(queueDescriptor)
defer {
    if !exitObserver.closed {
        emit(["event": "exit-observer-finally-close", "atUnixMs": epochMs(), "original": exitObserver.close()])
    }
}
emit(["event": "ready", "observerPid": getpid(), "atUnixMs": epochMs(),
      "counter": "proc_pid_rusage ri_phys_footprint and ri_resident_size primary; optional task_info MACH_TASK_BASIC_INFO + TASK_VM_INFO cross-check; proc_pidinfo creation and cumulative CPU/faults",
      "intervalRequestedMs": 100, "writesToTarget": false, "cpuTimebase": ["numer": cpuTimebase.numer, "denom": cpuTimebase.denom],
      "cpuSource": "PROC_PIDTASKINFO Mach absolute ticks converted to nanoseconds using the original host timebase",
      "lifecycleSource": "Read-only kqueue EVFILT_PROC NOTE_EXIT with original owned creation checked before and after registration and original udata generation",
      "gpuCounter": "No process GPU allocation API used; not available"])
while !stopping {
    if let ownerNow = identity(ownerPID) {
        if ownerNow.creationUS != ownerCreation { stopping = true; break }
    } else {
        errno = 0
        let ownerExists = Darwin.kill(ownerPID, 0), ownerErrno = errno
        if ownerExists == -1 && ownerErrno == ESRCH { stopping = true; break }
        emit(["event": "observer-error", "stage": "controller identity unavailable",
              "pid": ownerPID, "atUnixMs": epochMs(),
              "existenceProbe": ["result": ownerExists, "errno": ownerErrno, "signal": 0]])
        observerExitCode = 2; break
    }
    if monoMs() - started > 900_000 { emit(["event": "observer-error", "error": "Per-session observer time limit exceeded"]); observerExitCode = 3; break }
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath: controlFile))
        if let command = try JSONSerialization.jsonObject(with: data) as? [String: Any],
           let nextGeneration = command["generation"] as? Int, nextGeneration != generation {
            generation = nextGeneration; phase = command["phase"] as? String ?? phase
            for seed in command["seeds"] as? [[String: Any]] ?? [] {
                if let pid = seed["pid"] as? Int32, let date = seed["startedAt"] as? Double { seeds[pid] = date; roles[pid] = seed["role"] as? String }
            }
            for role in command["roles"] as? [[String: Any]] ?? [] {
                if let pid = role["pid"] as? Int32 { roles[pid] = role["role"] as? String }
            }
            stopping = command["stop"] as? Bool ?? false
        }
    } catch { emit(["event": "control-error", "atUnixMs": epochMs(), "error": String(describing: error)]) }
    if stopping { break }
    let sampleStart = monoMs(), snapshot = processTable(), table = snapshot.identities
    var observed: [Int32: Identity] = [:], errors = snapshot.errors
    for row in table where !retired.contains(row.pid) {
        if let old = known[row.pid] {
            if old.creationUS == row.creationUS { observed[row.pid] = row }
            // The old owner is checked again by counters and retained as an
            // invalidated row. Never read counters for the replacement PID.
            else { observed[row.pid] = old }
        } else if let launch = seeds[row.pid] {
            if row.creationUnixMs >= launch - 2 && row.creationUnixMs <= epochMs() {
                known[row.pid] = row; observed[row.pid] = row
            } else { errors.append(["pid": row.pid, "stage": "seed identity", "error": "Seed predates this owned launch", "creationUnixMs": row.creationUnixMs, "launchUnixMs": launch]) }
        }
    }
    // Listing can succeed while identity retrieval fails for a live owned PID.
    // Recheck its original identity instead of silently dropping it. A genuine
    // ESRCH/reuse is recorded by counters; a live/unknown failure is mandatory.
    for (pid, old) in known where !retired.contains(pid) && observed[pid] == nil {
        observed[pid] = old
    }
    var verifiedParentPIDs = Set(table.filter { observed[$0.pid]?.creationUS == $0.creationUS }.map { $0.pid })
    var changed = true
    while changed {
        changed = false
        for row in table where observed[row.pid] == nil && known[row.pid] == nil && !retired.contains(row.pid) {
            if verifiedParentPIDs.contains(row.ppid), let parent = observed[row.ppid], row.creationUS >= parent.creationUS {
                known[row.pid] = row; observed[row.pid] = row; verifiedParentPIDs.insert(row.pid); changed = true
            }
        }
    }
    var rows: [[String: Any]] = [], invalidatedRows: [[String: Any]] = []
    for row in observed.values.sorted(by: { $0.pid < $1.pid }) {
        exitObserver.register(row)
        // Java version probes are helpers. Only an explicitly observed actual
        // Game launch may receive a Game role; the executable name is not proof.
        let (result, failures) = counters(row, role: roles[row.pid] ?? "unclassified-owned-descendant", exitObserver: exitObserver)
        errors += failures
        if result["invalidated"] as? Bool == true {
            invalidatedRows.append(result)
            if let evidence = result["identityInvalidation"] as? [String: Any], evidence["lifecycleInvalidation"] as? Bool == true {
                retired.insert(row.pid)
                emit(["event": "owned-identity-retired", "pid": row.pid, "creationUnixUS": String(row.creationUS),
                      "atUnixMs": epochMs(), "original": evidence,
                      "scope": "Retire original identity once; never bind replacement PID or invent terminal counters"])
            }
        }
        else { rows.append(result) }
    }
    errors += exitObserver.takeErrors()
    let requiredErrors = errors.filter { $0["required"] as? Bool != false }
    emit(["event": "sample", "atUnixMs": epochMs(), "monoMs": monoMs() - started,
          "phase": phase, "collectionMs": monoMs() - sampleStart, "rows": rows,
          "counterErrors": requiredErrors, "wholeTreeCountersComplete": requiredErrors.isEmpty && invalidatedRows.isEmpty,
          "optionalCounterErrors": errors.filter { $0["required"] as? Bool == false && $0["lifecycleInvalidation"] as? Bool != true },
          "lifecycleInvalidations": errors.filter { $0["lifecycleInvalidation"] as? Bool == true },
          "invalidatedRows": invalidatedRows])
    usleep(100_000)
}
let identities = known.values.sorted(by: { $0.pid < $1.pid }).map {
    ["pid": $0.pid, "ppid": $0.ppid, "name": $0.name, "creationUnixUS": String($0.creationUS), "creationUnixMs": $0.creationUnixMs] as [String: Any]
}
let closeReceipt = exitObserver.close()
if closeReceipt["closeResult"] as? Int32 != 0 { observerExitCode = 2 }
emit(["event": "stopped", "observerPid": getpid(), "atUnixMs": epochMs(), "ownedIdentities": identities,
      "retiredPIDs": retired.sorted(), "kernelExitObserverClose": closeReceipt, "code": observerExitCode])
return observerExitCode
}
let observerResult = runObserver()
if observerResult != 0 { exit(observerResult) }
