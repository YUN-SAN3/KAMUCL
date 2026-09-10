using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

// Small pre-Electron overlay: its only lifetime controls are this wrapper and the handoff signal.
sealed class StartupFeedback : Form {
    readonly string signal; readonly int parentId; readonly Stopwatch clock = Stopwatch.StartNew();
    readonly Timer timer = new Timer(); readonly Bitmap face;
    readonly PointF[] points = new PointF[64]; bool reported;
    StartupFeedback(string done, int pid) {
        signal = done; parentId = pid;
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
        BackColor = Color.Magenta; TransparencyKey = Color.Magenta; DoubleBuffered = true;
        Bounds = Screen.PrimaryScreen.Bounds; StartPosition = FormStartPosition.Manual;
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("face.png"))
        using (var source = new Bitmap(stream)) face = new Bitmap(source);
        var random = new Random(1041);
        for (int i = 0; i < 64; i++) points[i] = new PointF(25 + (float)random.NextDouble() * (Width - 70), Height * (.3f + (float)random.NextDouble() * .6f));
        timer.Interval = 16; timer.Tick += delegate {
            bool parentAlive = true;
            try { using (var parent = Process.GetProcessById(parentId)) parentAlive = !parent.HasExited; } catch { parentAlive = false; }
            if (!parentAlive || File.Exists(signal) || clock.ElapsedMilliseconds > 90000) { Close(); return; }
            Invalidate();
        }; timer.Start();
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x20 | 0x80; return p; } }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
        e.Graphics.PixelOffsetMode = PixelOffsetMode.Half;
        float size = Math.Max(10, Math.Min(224, Math.Min(Width * .26f, Height * .32f)) / 8);
        double time = clock.ElapsedMilliseconds;
        for (int i = 0; i < 64; i++) {
            float rise = (float)(Math.Min(time / 750, 1) * Height * .10);
            var destination = new RectangleF(points[i].X + (float)Math.Sin(time / 500 + i) * 3, points[i].Y - rise, size, size);
            e.Graphics.DrawImage(face, destination, new RectangleF(i % 8 * face.Width / 8f, i / 8 * face.Height / 8f, face.Width / 8f, face.Height / 8f), GraphicsUnit.Pixel);
        }
        if (!reported) {
            reported = true;
            var probe = Environment.GetEnvironmentVariable("KAMUCL_BOOT_PROBE");
            if (!String.IsNullOrEmpty(probe)) try { File.WriteAllText(probe, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString()); } catch { }
        }
    }
    protected override void Dispose(bool disposing) { if (disposing) { timer.Dispose(); face.Dispose(); } base.Dispose(disposing); }
    [STAThread] static void Main(string[] args) {
        if (args.Length != 2) return;
        int parent; if (!Int32.TryParse(args[1], out parent)) return;
        try { Application.EnableVisualStyles(); Application.Run(new StartupFeedback(args[0], parent)); } catch { /* Feedback must never prevent launcher startup. */ }
    }
}
