// Complete KAMUCL's native startup fade without changing DWM or window geometry.
using System;
using System.Runtime.InteropServices;

internal static class WindowMaterial {
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetLayeredWindowAttributes(IntPtr window, out uint color, out byte alpha, out uint flags);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll", SetLastError = true)] static extern int SetWindowLong(IntPtr window, int index, int value);

    static int Main(string[] args) {
        uint owner;
        if (args.Length != 1 || !uint.TryParse(args[0], out owner)) return 2;
        string line;
        while ((line = Console.ReadLine()) != null) {
            long value;
            var parts = line.Split(' ');
            if (parts.Length != 3 || parts[2] != "finish-opacity" || !long.TryParse(parts[0], out value)) continue;
            var window = new IntPtr(value);
            uint actual;
            GetWindowThreadProcessId(window, out actual);
            if (actual != owner) { Console.WriteLine("denied"); continue; }
            if (!IsWindowVisible(window) || IsIconic(window)) { Console.WriteLine("0"); continue; }
            // Electron keeps WS_EX_LAYERED after setOpacity(1). Only release
            // our completed full-alpha fade; preserve color keys, fractional
            // opacity and click-through windows. Electron now owns all frame,
            // clipping and Acrylic composition; never rewrite those here.
            const int index = -20, layered = 0x80000, transparent = 0x20;
            int style = GetWindowLong(window, index);
            uint color, flags; byte alpha;
            if ((style & layered) != 0 && (style & transparent) == 0 &&
                GetLayeredWindowAttributes(window, out color, out alpha, out flags) && flags == 2 && alpha == 255) {
                if (SetWindowLong(window, index, style & ~layered) == 0) {
                    Console.WriteLine("opacity cleanup failed: " + Marshal.GetLastWin32Error());
                    continue;
                }
            }
            Console.WriteLine("0");
        }
        return 0;
    }
}
