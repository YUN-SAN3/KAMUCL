// Diagnostic only. Query the actual hosted Metal device; do not open a window
// or change the launcher's backend, GPU feature flags, or rendering behavior.
import Foundation
import Metal

var rows: [[String: Any]] = []
for device in MTLCopyAllDevices() {
    var row: [String: Any] = [
        "name": device.name, "registryID": String(device.registryID),
        "lowPower": device.isLowPower, "headless": device.isHeadless,
        "removable": device.isRemovable,
        "mac1": device.supportsFamily(.mac1), "mac2": device.supportsFamily(.mac2),
        "apple1": device.supportsFamily(.apple1),
        "common1": device.supportsFamily(.common1),
        "common2": device.supportsFamily(.common2),
        "common3": device.supportsFamily(.common3),
        "argumentBuffersTier": device.argumentBuffersSupport.rawValue,
        "commandQueueCreated": device.makeCommandQueue() != nil
    ]
    do {
        let source = "#include <metal_stdlib>\nusing namespace metal;\nkernel void diagnostic_copy(device uint *out [[buffer(0)]], uint index [[thread_position_in_grid]]) { out[index] = index; }"
        let library = try device.makeLibrary(source: source, options: nil)
        row["shaderLibraryCreated"] = true
        if let function = library.makeFunction(name: "diagnostic_copy") {
            _ = try device.makeComputePipelineState(function: function)
            row["computePipelineCreated"] = true
        } else {
            row["computePipelineCreated"] = false
            row["shaderError"] = "Compiled diagnostic function missing"
        }
    } catch {
        row["shaderLibraryCreated"] = false
        row["computePipelineCreated"] = false
        row["shaderError"] = String(describing: error)
    }
    rows.append(row)
}
let result: [String: Any] = [
    "classification": "Native Metal API capability diagnostic only; not launcher or game acceptance",
    "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
    "defaultDevice": MTLCreateSystemDefaultDevice()?.name ?? "",
    "defaultDeviceCreated": MTLCreateSystemDefaultDevice() != nil,
    "devices": rows
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
