// Diagnostic-only accelerated NSGL capability query. No window, game library,
// software fallback, GPU preference or acceptance threshold is changed.
import AppKit
import OpenGL.GL3
import Foundation

func text(_ value: UnsafePointer<GLubyte>?) -> Any {
    guard let value = value else { return NSNull() }
    return String(cString: value)
}
func probe(_ profile: UInt32, _ name: String) -> [String: Any] {
    // Correspond to GLFW's accelerated / closest-policy NSGL attribute family
    // and default framebuffer hints. The actual JVM hint array is not observed.
    let attributes: [NSOpenGLPixelFormatAttribute] = [
        UInt32(NSOpenGLPFAAccelerated), UInt32(NSOpenGLPFAClosestPolicy),
        UInt32(NSOpenGLPFAOpenGLProfile), profile,
        UInt32(NSOpenGLPFAColorSize), 24, UInt32(NSOpenGLPFAAlphaSize), 8,
        UInt32(NSOpenGLPFADepthSize), 24, UInt32(NSOpenGLPFAStencilSize), 8,
        UInt32(NSOpenGLPFADoubleBuffer), UInt32(NSOpenGLPFASampleBuffers), 0, 0
    ]
    var result: [String: Any] = ["profile": name, "attributes": attributes, "acceleratedRequested": true, "allowOfflineRenderersRequested": false, "pixelFormatCreated": false, "contextCreated": false, "fallbackUsed": false]
    attributes.withUnsafeBufferPointer { pointer in
        guard let format = NSOpenGLPixelFormat(attributes: pointer.baseAddress!) else {
            result["failurePhase"] = "NSOpenGLPixelFormat returned nil"
            return
        }
        result["pixelFormatCreated"] = true
        result["virtualScreens"] = format.numberOfVirtualScreens
        guard let context = NSOpenGLContext(format: format, share: nil) else {
            result["failurePhase"] = "NSOpenGLContext returned nil"
            return
        }
        result["contextCreated"] = true
        context.makeCurrentContext()
        result["glVersion"] = text(glGetString(GLenum(GL_VERSION)))
        result["glRenderer"] = text(glGetString(GLenum(GL_RENDERER)))
        result["glVendor"] = text(glGetString(GLenum(GL_VENDOR)))
        result["glError"] = glGetError()
        NSOpenGLContext.clearCurrentContext()
        context.clearDrawable()
    }
    return result
}
let rows = autoreleasepool { [probe(UInt32(NSOpenGLProfileVersion3_2Core), "3.2 core"), probe(UInt32(NSOpenGLProfileVersion4_1Core), "4.1 core")] }
let result: [String: Any] = ["complete": true, "platform": "darwin", "pid": ProcessInfo.processInfo.processIdentifier, "osVersion": ProcessInfo.processInfo.operatingSystemVersionString, "probes": rows, "classification": "Actual native diagnostic only; not a Minecraft world/renderer test. Exact game-requested hint array was not captured. No fallback attempted."]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data([10]))
