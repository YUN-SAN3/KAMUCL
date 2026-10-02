using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Threading;
using System.Collections.Generic;
using System.Globalization;

// A single alpha-composited scene owns the complete portable startup.
sealed class StartupFeedback : Form {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; public Point(int a,int b){x=a;y=b;} }
    [StructLayout(LayoutKind.Sequential)] struct NativeSize { public int cx,cy; public NativeSize(int a,int b){cx=a;cy=b;} }
    [StructLayout(LayoutKind.Sequential,Pack=1)] struct Blend { public byte op,flags,alpha,format; }
    [StructLayout(LayoutKind.Sequential)] struct BitmapInfo {
        public uint size;public int width,height;public ushort planes,bits;public uint compression,imageSize;public int xppm,yppm;public uint used,important;
    }
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr w,IntPtr dst,ref Point pos,ref NativeSize size,IntPtr src,ref Point origin,int key,ref Blend blend,int flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr w);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr w,IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc,ref BitmapInfo info,uint usage,out IntPtr bits,IntPtr section,uint offset);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr w);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action,uint parameter,ref bool value,uint flags);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
    readonly string signal; readonly int parentId; readonly Stopwatch clock=Stopwatch.StartNew();
    const double FrameMilliseconds=1000.0/60;
    System.Threading.Timer frameTimer; readonly object frameGate=new object();
    double nextFrame; int framePending; bool preciseTimer;
    readonly Bitmap face;
    readonly string frameProbe=Environment.GetEnvironmentVariable("KAMUCL_FRAME_PROBE");
    readonly List<double> frameTimes=new List<double>();
    Bitmap surface;IntPtr surfaceDC,surfaceImage,previousImage;
    sealed class Shard {
        public PointF[] vertices; public double sourceX,sourceY,targetX,targetY,x,y,phase,spin,delay,ox,oy,vx,vy;
        public double fromX,fromY,fromRotation,fromScale; public bool captured;
        public Bitmap image,glass,appearance; public float originX,originY; public int appearanceLevel=-1;
    }
    readonly List<Shard> shards=new List<Shard>(); readonly bool reduced;
    const double ConvergeMilliseconds=1400,HoldMilliseconds=2000,PointerRadius=140;
    double lastScene; uint randomSeed=1041;
    bool reported,assembled; double convergence=-1,reveal=-1; string caption="正在启动…";
    float scale=1; int logicalWidth,logicalHeight,board,boardLeft,boardTop;
    StartupFeedback(string done,int pid){
        signal=done;parentId=pid;AutoScaleMode=AutoScaleMode.None;
        FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
        StartPosition=FormStartPosition.Manual;Bounds=Screen.PrimaryScreen.Bounds;
        using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("face.png"))
        using(var source=new Bitmap(stream))face=new Bitmap(source);
        bool animation=true;SystemParametersInfo(0x1042,0,ref animation,0);reduced=!animation;
    }
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x80000|0x08000000|0x20|0x80;return p;}}
    protected override void OnShown(EventArgs e){
        base.OnShown(e);scale=GetDpiForWindow(Handle)/96f;Geometry();TickScene();
        preciseTimer=timeBeginPeriod(1)==0;nextFrame=clock.Elapsed.TotalMilliseconds+FrameMilliseconds;
        frameTimer=new System.Threading.Timer(QueueFrame,null,0,1);
    }
    void QueueFrame(object state){
        lock(frameGate){
            double now=clock.Elapsed.TotalMilliseconds;
            if(now<nextFrame)return;
            // Absolute deadlines avoid adding render time to every frame. Late
            // frames are skipped, never queued into a burst on the UI thread.
            nextFrame+=FrameMilliseconds;
            if(nextFrame<=now)nextFrame=now+FrameMilliseconds;
            if(Interlocked.Exchange(ref framePending,1)!=0)return;
        }
        try{BeginInvoke((MethodInvoker)delegate{
            try{if(!IsDisposed)TickScene();}finally{Interlocked.Exchange(ref framePending,0);}
        });}catch(InvalidOperationException){Interlocked.Exchange(ref framePending,0);}
    }
    double RandomUnit(){randomSeed=unchecked(randomSeed*1664525+1013904223);return randomSeed/4294967296.0;}
    void Geometry(){
        foreach(var old in shards){old.image.Dispose();old.glass.Dispose();if(old.appearance!=null)old.appearance.Dispose();}shards.Clear();randomSeed=1041;
        logicalWidth=(int)Math.Round(Width/scale);logicalHeight=(int)Math.Round(Height/scale);
        board=Math.Max(80,(int)Math.Floor(Math.Min(224,Math.Min(logicalWidth*.26,logicalHeight*.32))));
        boardLeft=(int)Math.Round((logicalWidth-board)/2.0);boardTop=(int)Math.Round((logicalHeight-board)/2.0);
        var points=new PointF[49];double cell=board/6.0;
        for(int row=0;row<=6;row++)for(int col=0;col<=6;col++)points[row*7+col]=new PointF(
            (float)((col+(col>0&&col<6?(RandomUnit()-.5)*.65:0))*cell),
            (float)((row+(row>0&&row<6?(RandomUnit()-.5)*.65:0))*cell));
        for(int row=0;row<6;row++)for(int col=0;col<6;col++){
            var a=points[row*7+col];var b=points[row*7+col+1];var c=points[(row+1)*7+col];var d=points[(row+1)*7+col+1];
            if((row+col)%2==1){AddShard(a,b,c);AddShard(b,d,c);}else{AddShard(a,b,d);AddShard(a,d,c);}
        }
    }
    void AddShard(PointF a,PointF b,PointF c){
        var s=new Shard{sourceX=(a.X+b.X+c.X)/3.0,sourceY=(a.Y+b.Y+c.Y)/3.0};
        s.vertices=new[]{new PointF((float)(a.X-s.sourceX),(float)(a.Y-s.sourceY)),new PointF((float)(b.X-s.sourceX),(float)(b.Y-s.sourceY)),new PointF((float)(c.X-s.sourceX),(float)(c.Y-s.sourceY))};
        s.targetX=boardLeft+s.sourceX;s.targetY=boardTop+s.sourceY;
        s.x=logicalWidth*(.10+RandomUnit()*.80);s.y=logicalHeight*(.14+RandomUnit()*.62);
        s.phase=RandomUnit()*Math.PI*2;s.spin=(RandomUnit()-.5)*2.4;s.delay=RandomUnit()*180;
        float minX=Math.Min(s.vertices[0].X,Math.Min(s.vertices[1].X,s.vertices[2].X)),minY=Math.Min(s.vertices[0].Y,Math.Min(s.vertices[1].Y,s.vertices[2].Y));
        float maxX=Math.Max(s.vertices[0].X,Math.Max(s.vertices[1].X,s.vertices[2].X)),maxY=Math.Max(s.vertices[0].Y,Math.Max(s.vertices[1].Y,s.vertices[2].Y));
        s.originX=3-minX;s.originY=3-minY;
        int w=(int)Math.Ceiling(maxX-minX)+6,h=(int)Math.Ceiling(maxY-minY)+6;
        s.image=new Bitmap(w*2,h*2,PixelFormat.Format32bppPArgb);s.glass=new Bitmap(w*2,h*2,PixelFormat.Format32bppPArgb);
        using(var polygon=new GraphicsPath()){
            polygon.AddPolygon(s.vertices);
            using(var g=Graphics.FromImage(s.image)){
                g.ScaleTransform(2,2);g.TranslateTransform(s.originX,s.originY);g.SetClip(polygon);
                g.InterpolationMode=InterpolationMode.NearestNeighbor;g.PixelOffsetMode=PixelOffsetMode.Half;
                g.DrawImage(face,new RectangleF((float)-s.sourceX,(float)-s.sourceY,board,board),new RectangleF(0,0,face.Width,face.Height),GraphicsUnit.Pixel);
            }
            using(var g=Graphics.FromImage(s.glass)){
                g.ScaleTransform(2,2);g.TranslateTransform(s.originX,s.originY);g.SmoothingMode=SmoothingMode.AntiAlias;
                using(var tint=new LinearGradientBrush(new PointF(-28,-30),new PointF(32,35),Color.White,Color.White)){
                    tint.InterpolationColors=new ColorBlend{Positions=new[]{0f,.40f,.52f,1f},Colors=new[]{Color.FromArgb(128,239,250,255),Color.FromArgb(32,186,223,255),Color.FromArgb(88,255,255,255),Color.FromArgb(40,188,176,250)}};
                    g.FillPath(tint,polygon);
                }
                using(var dark=new Pen(Color.FromArgb(69,37,51,73),2.4f))g.DrawPath(dark,polygon);
                using(var edge=new Pen(Color.FromArgb(184,234,247,255),.85f))g.DrawPath(edge,polygon);
                using(var bevel=new Pen(Color.FromArgb(220,255,255,255),1.4f))g.DrawLine(bevel,s.vertices[0],s.vertices[1]);
            }
        }
        UpdateAppearance(s,0);shards.Add(s);
    }
    // Alpha-composite small textures only when the assembly opacity changes.
    // Per-frame transformed ImageAttributes draws are prohibitively slow in GDI+.
    void UpdateAppearance(Shard s,int level){
        if(s.appearanceLevel==level)return;s.appearanceLevel=level;
        if(s.appearance==null)s.appearance=new Bitmap(s.image.Width,s.image.Height,PixelFormat.Format32bppPArgb);
        using(var g=Graphics.FromImage(s.appearance))using(var alpha=new ImageAttributes()){
            g.Clear(Color.Transparent);var rect=new Rectangle(0,0,s.image.Width,s.image.Height);var matrix=new ColorMatrix();
            matrix.Matrix33=(float)(.12+.88*level/24.0);alpha.SetColorMatrix(matrix);
            g.DrawImage(s.image,rect,0,0,s.image.Width,s.image.Height,GraphicsUnit.Pixel,alpha);
            matrix.Matrix33=(float)((1-level/24.0)*.95);alpha.SetColorMatrix(matrix);
            g.DrawImage(s.glass,rect,0,0,s.glass.Width,s.glass.Height,GraphicsUnit.Pixel,alpha);
        }
    }
    void FloatPose(Shard s,double time,out double x,out double y,out double rotation,out double size){
        x=s.x+Math.Sin(time/1500+s.phase)*14+s.ox;y=s.y+Math.Cos(time/1800+s.phase)*11+s.oy;
        rotation=s.spin+Math.Sin(time/2100+s.phase)*.22;size=1.06+Math.Sin(time/1900+s.phase)*.12;
    }
    void MoveGlass(double time,double delta,double pointerX,double pointerY){
        double dt=Math.Min(32,Math.Max(0,delta))/1000,drag=Math.Exp(-5*dt);
        foreach(var s in shards){
            double x,y,rotation,size;FloatPose(s,time,out x,out y,out rotation,out size);
            double dx=x-pointerX,dy=y-pointerY,distance=Math.Sqrt(dx*dx+dy*dy),fx=0,fy=0;
            if(distance<PointerRadius){
                if(distance<1){dx=Math.Cos(s.phase);dy=Math.Sin(s.phase);}
                double force=2400*Math.Pow(1-distance/PointerRadius,2)/Math.Max(1,distance);fx=dx*force;fy=dy*force;
            }
            s.vx=(s.vx+(fx-s.ox*8)*dt)*drag;s.vy=(s.vy+(fy-s.oy*8)*dt)*drag;
            s.ox=Math.Max(-180,Math.Min(180,s.ox+s.vx*dt));s.oy=Math.Max(-180,Math.Min(180,s.oy+s.vy*dt));
        }
    }
    static double Smooth(double v){v=Math.Max(0,Math.Min(1,v));return v*v*v*(v*(v*6-15)+10);}
    void TickScene(){
        try{using(var parent=Process.GetProcessById(parentId))if(parent.HasExited){Close();return;}}catch{Close();return;}
        if(clock.ElapsedMilliseconds>90000){Close();return;}
        string command="";try{if(File.Exists(signal))command=File.ReadAllText(signal);}catch{}
        if(command=="closed"||command=="fallback"){Close();return;}
        if(command.StartsWith("loading\n"))caption=command.Substring(8);
        if(command.StartsWith("assembling\n"))caption=command.Substring(11);
        double now=clock.Elapsed.TotalMilliseconds;
        if((command=="ready"||command.StartsWith("assembling\n"))&&convergence<0&&(reduced||now>=900))convergence=now;
        if(command=="ready")caption="准备就绪";
        if(convergence<0&&!reduced){var cursor=Cursor.Position;MoveGlass(now,lastScene==0?FrameMilliseconds:now-lastScene,(cursor.X-Left)/scale,(cursor.Y-Top)/scale);}lastScene=now;
        if(command=="reveal"&&reveal<0)reveal=now;
        if(reveal>=0&&(reduced||now-reveal>=320)){Mark(".finished","done");Close();return;}
        EnsureSurface();PaintScene(surface,now);
        if(!Present(reveal<0?1:1-Smooth((now-reveal)/320))){Close();return;}
        if(!String.IsNullOrEmpty(frameProbe))frameTimes.Add(clock.Elapsed.TotalMilliseconds);
        if(!reported){reported=true;Mark(".visible",Process.GetCurrentProcess().Id.ToString());var probe=Environment.GetEnvironmentVariable("KAMUCL_BOOT_PROBE");if(!String.IsNullOrEmpty(probe))try{File.WriteAllText(probe,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString());}catch{}}
        if(!assembled&&command=="ready"&&convergence>=0&&now-convergence>=(reduced?0:ConvergeMilliseconds+HoldMilliseconds)){assembled=true;Mark(".assembled",reduced?"reduced":"ready");}
    }
    void Mark(string suffix,string value){try{File.WriteAllText(signal+suffix,value);}catch{}}
    static GraphicsPath Round(RectangleF r,float radius){var p=new GraphicsPath();float d=radius*2;p.AddArc(r.X,r.Y,d,d,180,90);p.AddArc(r.Right-d,r.Y,d,d,270,90);p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);p.AddArc(r.X,r.Bottom-d,d,d,90,90);p.CloseFigure();return p;}
    Bitmap DrawScene(double time){
        var bitmap=new Bitmap(Width,Height,PixelFormat.Format32bppPArgb);
        PaintScene(bitmap,time);return bitmap;
    }
    void PaintScene(Bitmap bitmap,double time){
        using(var g=Graphics.FromImage(bitmap)){
            g.Clear(Color.Transparent);g.ScaleTransform(scale,scale);g.SmoothingMode=SmoothingMode.AntiAlias;g.PixelOffsetMode=PixelOffsetMode.Half;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            if(reduced||(convergence>=0&&time-convergence>=ConvergeMilliseconds)){
                // One unbroken image removes triangle seams at the final pose.
                g.InterpolationMode=InterpolationMode.NearestNeighbor;
                g.DrawImage(face,new RectangleF(boardLeft,boardTop,board,board),new RectangleF(0,0,face.Width,face.Height),GraphicsUnit.Pixel);
            }else{
                foreach(var s in shards){
                    double x,y,rotation,size,progress=0;
                    if(convergence<0)FloatPose(s,time,out x,out y,out rotation,out size);
                    else{
                        if(!s.captured){FloatPose(s,convergence,out s.fromX,out s.fromY,out s.fromRotation,out s.fromScale);s.captured=true;}
                        progress=Smooth((time-convergence-s.delay)/(ConvergeMilliseconds-180));
                        x=s.fromX+(s.targetX-s.fromX)*progress;y=s.fromY+(s.targetY-s.fromY)*progress;
                        rotation=s.fromRotation*(1-progress);size=s.fromScale+(1-s.fromScale)*progress;
                    }
                    var state=g.Save();g.TranslateTransform((float)x,(float)y);g.RotateTransform((float)(rotation*180/Math.PI));g.ScaleTransform((float)size,(float)size);
                    UpdateAppearance(s,(int)Math.Round(progress*24));g.InterpolationMode=InterpolationMode.NearestNeighbor;
                    g.DrawImage(s.appearance,-s.originX,-s.originY,s.image.Width/2f,s.image.Height/2f);g.Restore(state);
                }
            }
            var panel=new RectangleF(logicalWidth/2f-110,logicalHeight/2f+135,220,86);
            using(var outline=Round(panel,14))using(var fill=new SolidBrush(Color.FromArgb(184,23,32,33)))using(var border=new Pen(Color.FromArgb(36,255,255,255),1)){g.FillPath(fill,outline);g.DrawPath(border,outline);}
            using(var titleFont=new Font("Segoe UI",20,FontStyle.Bold,GraphicsUnit.Pixel))using(var textFont=new Font("Microsoft YaHei UI",12,FontStyle.Regular,GraphicsUnit.Pixel))using(var ink=new SolidBrush(Color.FromArgb(245,248,246)))using(var format=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center}){
                g.DrawString("KAMUCL",titleFont,ink,new RectangleF(panel.X,panel.Y+10,panel.Width,30),format);
                g.DrawString(caption,textFont,ink,new RectangleF(panel.X+10,panel.Y+44,panel.Width-20,25),format);
            }
        }
    }
    void EnsureSurface(){
        if(surface!=null&&surface.Width==Width&&surface.Height==Height)return;
        ReleaseSurface();surfaceDC=CreateCompatibleDC(IntPtr.Zero);
        var info=new BitmapInfo{size=(uint)Marshal.SizeOf(typeof(BitmapInfo)),width=Width,height=-Height,planes=1,bits=32};IntPtr pixels;
        surfaceImage=CreateDIBSection(surfaceDC,ref info,0,out pixels,IntPtr.Zero,0);
        if(surfaceDC==IntPtr.Zero||surfaceImage==IntPtr.Zero)throw new InvalidOperationException("Startup surface allocation failed");
        previousImage=SelectObject(surfaceDC,surfaceImage);
        surface=new Bitmap(Width,Height,Width*4,PixelFormat.Format32bppPArgb,pixels);
    }
    void ReleaseSurface(){
        if(surface!=null){surface.Dispose();surface=null;}
        if(surfaceDC!=IntPtr.Zero){if(previousImage!=IntPtr.Zero)SelectObject(surfaceDC,previousImage);DeleteDC(surfaceDC);surfaceDC=IntPtr.Zero;previousImage=IntPtr.Zero;}
        if(surfaceImage!=IntPtr.Zero){DeleteObject(surfaceImage);surfaceImage=IntPtr.Zero;}
    }
    bool Present(double opacity){
        // Draw directly into the retained top-down DIB. No full-screen allocation
        // or GetHbitmap copy is needed for each of the 60 frames per second.
        var pos=new Point(Left,Top);var size=new NativeSize(Width,Height);var origin=new Point(0,0);var blend=new Blend{alpha=(byte)Math.Round(255*opacity),format=1};
        return UpdateLayeredWindow(Handle,IntPtr.Zero,ref pos,ref size,surfaceDC,ref origin,0,ref blend,2);
    }
    protected override void Dispose(bool disposing){if(disposing){
        if(frameTimer!=null){frameTimer.Dispose();frameTimer=null;}
        if(preciseTimer){timeEndPeriod(1);preciseTimer=false;}
        if(!String.IsNullOrEmpty(frameProbe))try{File.WriteAllLines(frameProbe,frameTimes.ConvertAll(t=>t.ToString("F3",CultureInfo.InvariantCulture)).ToArray());}catch{}
        ReleaseSurface();foreach(var s in shards){s.image.Dispose();s.glass.Dispose();if(s.appearance!=null)s.appearance.Dispose();}shards.Clear();face.Dispose();
    }base.Dispose(disposing);}
    [STAThread] static void Main(string[] args){
        try{
            SetProcessDpiAwarenessContext(new IntPtr(-4));Application.EnableVisualStyles();
            if(args.Length==2&&args[0]=="--render"){
                Directory.CreateDirectory(args[1]);using(var form=new StartupFeedback("",Process.GetCurrentProcess().Id)){
                    form.Bounds=new Rectangle(0,0,1280,720);form.Geometry();
                    foreach(var time in new[]{350,1500})using(var b=form.DrawScene(time))b.Save(Path.Combine(args[1],time+".png"));
                    double x,y,r,z;form.FloatPose(form.shards[0],1500,out x,out y,out r,out z);
                    for(int i=0;i<60;i++)form.MoveGlass(1500,FrameMilliseconds,x,y);
                    using(var b=form.DrawScene(1500))b.Save(Path.Combine(args[1],"pointer.png"));
                    File.WriteAllText(Path.Combine(args[1],"interaction.txt"),Math.Sqrt(form.shards[0].ox*form.shards[0].ox+form.shards[0].oy*form.shards[0].oy).ToString(CultureInfo.InvariantCulture));
                    form.convergence=2000;
                    foreach(var time in new[]{2200,2700,3400,5400}){form.caption="准备就绪";using(var b=form.DrawScene(time))b.Save(Path.Combine(args[1],time+".png"));}
                }return;
            }
            int parent;if(args.Length!=2||!Int32.TryParse(args[1],out parent))return;
            Application.Run(new StartupFeedback(args[0],parent));
        }catch{/* Optional feedback must not prevent startup. */}
    }
}
