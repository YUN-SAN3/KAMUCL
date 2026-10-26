using System;
using System.Runtime.InteropServices;
using System.Threading;

// Disposable real Win32 window, never a user's game. GLFW class is a fixture.
class GameWindowSize117 {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct WC { public uint size, style; public IntPtr proc; public int clsExtra, winExtra; public IntPtr instance, icon, cursor, background; public string menu, name; public IntPtr smallIcon; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr w; public IntPtr l; public uint time; public int x, y; }
    delegate IntPtr WndProc(IntPtr h, uint m, UIntPtr w, IntPtr l);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClassEx(ref WC c);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr h,uint m,UIntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern bool AdjustWindowRect(ref RECT r,uint style,bool menu);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out RECT r);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int mode);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg,IntPtr h,uint min,uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint message,UIntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern void PostQuitMessage(int result);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h,int index,int value);
    static WndProc proc;
    static IntPtr window;
    const uint Normal=0x00CF0000;
    static void Size(int width,int height) { RECT r=new RECT {right=width,bottom=height}; AdjustWindowRect(ref r,Normal,false); SetWindowPos(window,IntPtr.Zero,100,100,r.right-r.left,r.bottom-r.top,0x0014); }
    static void Receipt(string command) { RECT r; GetClientRect(window,out r); Console.WriteLine("{\"command\":\""+command+"\",\"pid\":"+System.Diagnostics.Process.GetCurrentProcess().Id+",\"width\":"+r.right+",\"height\":"+r.bottom+"}"); }
    static int Main() {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        proc=delegate(IntPtr h,uint m,UIntPtr w,IntPtr l) { if(m==0x8001){DestroyWindow(h);return IntPtr.Zero;} if(m==2){PostQuitMessage(0);return IntPtr.Zero;} return DefWindowProc(h,m,w,l); };
        WC c=new WC { size=(uint)Marshal.SizeOf(typeof(WC)), name="GLFWKamuclSizeFixture117", proc=Marshal.GetFunctionPointerForDelegate(proc), background=new IntPtr(6) };
        if(RegisterClassEx(ref c)==0)return 2;
        window=CreateWindowEx(0x08000000,c.name,"KAMUCL disposable game size fixture",Normal,100,100,1100,750,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        if(window==IntPtr.Zero)return 3;
        Size(1000,600); ShowWindow(window,4); Receipt("ready");
        new Thread(delegate() { SetThreadDpiAwarenessContext(new IntPtr(-4)); string s; while((s=Console.ReadLine())!=null) { if(s=="resize"){Size(1280,720);Receipt(s);} else if(s=="hide"){ShowWindow(window,0);Receipt(s);} else if(s=="show"){ShowWindow(window,4);Receipt(s);} else if(s=="borderless"){SetWindowLong(window,-16,unchecked((int)0x90000000));Receipt(s);} else if(s=="close"){PostMessage(window,0x8001,UIntPtr.Zero,IntPtr.Zero);return;} } PostMessage(window,0x8001,UIntPtr.Zero,IntPtr.Zero); }).Start();
        MSG msg; while(GetMessage(out msg,IntPtr.Zero,0,0)>0){TranslateMessage(ref msg);DispatchMessage(ref msg);}
        return 0;
    }
}
