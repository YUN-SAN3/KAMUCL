// SPDX-License-Identifier: MIT
// X11/XWayland operations are confined to a same-user JVM PID and its start time.
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <unistd.h>
#include <sys/stat.h>
#include <chrono>
#include <thread>
#include <fstream>
#include <sstream>
#include <iostream>
#include <string>
#include <vector>
#include <cstdlib>

static std::string identity(long pid) {
  std::string root="/proc/"+std::to_string(pid); struct stat s{};
  if (stat(root.c_str(), &s) || s.st_uid != geteuid()) return "";
  std::ifstream f(root+"/stat"); std::string line; std::getline(f,line);
  auto end=line.rfind(')'); if (end==std::string::npos) return "";
  std::istringstream values(line.substr(end+2)); std::string value;
  for(int field=3;field<=22;++field) if(!(values>>value)) return "";
  return value;
}
static unsigned long property(Display* d, Window w, Atom atom) {
  Atom type; int format; unsigned long count, remaining; unsigned char* raw=nullptr;
  unsigned long value=0;
  if(XGetWindowProperty(d,w,atom,0,1,False,XA_CARDINAL,&type,&format,&count,&remaining,&raw)==Success
    && raw && format==32 && count==1) value=*reinterpret_cast<unsigned long*>(raw);
  if(raw) XFree(raw); return value;
}
static std::vector<Window> windows(Display* d, Window root) {
  Atom type;int format;unsigned long count, remaining;unsigned char* raw=nullptr;
  std::vector<Window> result;
  if(XGetWindowProperty(d,root,XInternAtom(d,"_NET_CLIENT_LIST",False),0,65536,False,XA_WINDOW,&type,&format,&count,&remaining,&raw)==Success
    && raw && format==32) {
    auto p=reinterpret_cast<Window*>(raw);result.assign(p,p+count);
  }
  if(raw)XFree(raw);return result;
}
static int harmlessXError(Display*,XErrorEvent*) { return 0; }
int main(int argc,char**argv) {
  if(argc!=4) {std::cerr<<"Usage: LinuxGameWindow focus|close pid timeoutMs";return 2;}
  std::string action=argv[1];long pid=std::strtol(argv[2],nullptr,10),timeout=std::strtol(argv[3],nullptr,10);
  if((action!="focus"&&action!="close")||pid<=1||timeout<1||timeout>60000)return 2;
  std::string accepted=identity(pid);if(accepted.empty()){std::cerr<<"Game process is not owned by this user";return 3;}
  Display* d=XOpenDisplay(nullptr);if(!d){std::cerr<<"X11/XWayland session required for game window operations";return 4;}
  XSetErrorHandler(harmlessXError);Window root=DefaultRootWindow(d),target=None;
  Atom pidAtom=XInternAtom(d,"_NET_WM_PID",False),protocols=XInternAtom(d,"WM_PROTOCOLS",False),del=XInternAtom(d,"WM_DELETE_WINDOW",False);
  auto until=std::chrono::steady_clock::now()+std::chrono::milliseconds(timeout);bool sent=false;
  while(std::chrono::steady_clock::now()<until) {
    if(identity(pid)!=accepted){XCloseDisplay(d);return 0;}
    for(Window w:windows(d,root)) if(property(d,w,pidAtom)==static_cast<unsigned long>(pid)) {target=w;break;}
    if(target!=None && !sent) {
      XEvent e{};e.xclient.type=ClientMessage;e.xclient.display=d;e.xclient.window=target;e.xclient.format=32;
      if(action=="close") {
        Atom* supported=nullptr;int count=0;bool safe=false;
        if(XGetWMProtocols(d,target,&supported,&count)) {for(int i=0;i<count;++i)if(supported[i]==del)safe=true;XFree(supported);}
        if(!safe){std::cerr<<"Game has no normal WM_DELETE_WINDOW handler; exit inside Minecraft";XCloseDisplay(d);return 5;}
        e.xclient.message_type=protocols;e.xclient.data.l[0]=del;e.xclient.data.l[1]=CurrentTime;
        if(!XSendEvent(d,target,False,NoEventMask,&e)){XCloseDisplay(d);return 6;}
        XFlush(d);std::cout<<"{\"action\":\"close\",\"pid\":"<<pid<<",\"window\":"<<target<<",\"normalCloseSent\":true}";XCloseDisplay(d);return 0;
      }
      e.xclient.message_type=XInternAtom(d,"_NET_ACTIVE_WINDOW",False);e.xclient.data.l[0]=2;e.xclient.data.l[1]=CurrentTime;
      XSendEvent(d,root,False,SubstructureRedirectMask|SubstructureNotifyMask,&e);XFlush(d);sent=true;
    }
    if(sent) {
      Window focus=None;int revert;XGetInputFocus(d,&focus,&revert);
      for(int n=0;n<32&&focus!=None&&focus!=root;++n) {
        if(focus==target){std::cout<<"{\"action\":\"focus\",\"pid\":"<<pid<<",\"window\":"<<target<<",\"focused\":true}";XCloseDisplay(d);return 0;}
        Window r,parent,*children=nullptr;unsigned int count=0;
        if(!XQueryTree(d,focus,&r,&parent,&children,&count))break;if(children)XFree(children);focus=parent;
      }
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(75));
  }
  std::cerr<<(target==None?"Owned Minecraft window was not found":"Desktop rejected game activation");XCloseDisplay(d);return 7;
}
