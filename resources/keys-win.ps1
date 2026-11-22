# MIKO Keys for Windows: the Windows counterpart of keys-mac.swift.
#   Hold Shift + A  -> {"event":"talk-start"} ... {"event":"talk-stop"}
#   Tab + Q         -> {"event":"switcher"}
# A quick Shift + A tap still types "A": the A is held back for a moment and replayed
# when it is let go before the hold threshold. Tab itself always passes through (as on
# the Mac); only the Q of Tab + Q is swallowed. Nothing typed is logged or stored.
#
# It also answers switcher requests on stdin (one JSON reply per line):
#   list <id>               -> {"id":1,"windows":[{hwnd,pid,title,path,name,minimized,active}]}
#   focus <id> <hwnd>       -> {"id":2,"ok":true}
#   close <id> <hwnd,...>   -> {"id":3,"ok":true}   (WM_CLOSE: apps still ask to save)
# Exits when stdin closes or the parent process ends.
param([int]$Parent = 0, [int]$HoldMs = 350)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class MikoKeys
{
    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    const int VK_TAB = 0x09, VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;
    const int VK_LSHIFT = 0xA0, VK_RSHIFT = 0xA1, VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3, VK_LMENU = 0xA4, VK_RMENU = 0xA5;
    const int VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_A = 0x41, VK_Q = 0x51;
    const uint LLKHF_EXTENDED = 0x01, LLKHF_INJECTED = 0x10;
    const uint INPUT_KEYBOARD = 1, KEYEVENTF_EXTENDEDKEY = 0x0001, KEYEVENTF_KEYUP = 0x0002;
    const int GWL_EXSTYLE = -20;
    const long WS_EX_TOOLWINDOW = 0x00000080L, WS_EX_NOACTIVATE = 0x08000000L;
    const uint GW_OWNER = 4;
    const int DWMWA_CLOAKED = 14;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint WM_CLOSE = 0x0010;
    const int SW_RESTORE = 9;

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion u; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

    delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc fn, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc fn, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc fn, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

    static readonly object gate = new object();
    static readonly object outGate = new object();
    static LowLevelKeyboardProc hookProc;
    static IntPtr hook = IntPtr.Zero;
    static Timer holdTimer;
    static int holdMs = 350;

    static bool tabDown = false;
    static bool shiftDown = false;
    static bool qSwallow = false;
    /** The physical A is held back (from its first press until it is released). */
    static bool aSwallow = false;
    /** Held back but not yet decided: becomes talk after holdMs, or is replayed as a typed A. */
    static bool aPending = false;
    static bool talking = false;
    static uint aScan = 0;

    public static void Emit(string json)
    {
        lock (outGate)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }

    static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
    static bool OtherModifiers() { return Down(VK_CONTROL) || Down(VK_MENU) || Down(VK_LWIN) || Down(VK_RWIN); }
    static bool IsShift(int vk) { return vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT; }
    static bool IsModifier(int vk)
    {
        return IsShift(vk) || vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL || vk == VK_MENU ||
            vk == VK_LMENU || vk == VK_RMENU || vk == VK_LWIN || vk == VK_RWIN;
    }

    static INPUT Key(ushort vk, ushort scan, bool up, bool extended)
    {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.u.ki.wVk = vk;
        input.u.ki.wScan = scan;
        input.u.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0);
        return input;
    }

    static void Inject(List<INPUT> inputs)
    {
        if (inputs.Count == 0) return;
        INPUT[] array = inputs.ToArray();
        SendInput((uint)array.Length, array, Marshal.SizeOf(typeof(INPUT)));
    }

    /** Types the held-back A. withShift: Shift was already released, so press it around the A. */
    static void ReplayA(bool withShift, List<INPUT> after)
    {
        List<INPUT> inputs = new List<INPUT>();
        if (withShift) inputs.Add(Key(VK_LSHIFT, 0, false, false));
        inputs.Add(Key(VK_A, (ushort)aScan, false, false));
        inputs.Add(Key(VK_A, (ushort)aScan, true, false));
        if (withShift) inputs.Add(Key(VK_LSHIFT, 0, true, false));
        if (after != null) inputs.AddRange(after);
        Inject(inputs);
    }

    static void StopTalk()
    {
        if (!talking) return;
        talking = false;
        Emit("{\"event\":\"talk-stop\"}");
    }

    static void OnHold(object state)
    {
        lock (gate)
        {
            if (!aPending) return;
            aPending = false;
            if (!shiftDown) return;
            talking = true;
            Emit("{\"event\":\"talk-start\"}");
        }
    }

    static IntPtr OnKey(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return CallNextHookEx(hook, nCode, wParam, lParam);
        KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        // Our own replays (and other software's synthetic keys) pass straight through.
        if ((k.flags & LLKHF_INJECTED) != 0) return CallNextHookEx(hook, nCode, wParam, lParam);
        int msg = wParam.ToInt32();
        bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        bool up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        int vk = (int)k.vkCode;
        lock (gate)
        {
            if (vk == VK_TAB) tabDown = down ? true : up ? false : tabDown;

            if (IsShift(vk))
            {
                if (down) shiftDown = true;
                if (up)
                {
                    shiftDown = Down(VK_LSHIFT) && vk != VK_LSHIFT || Down(VK_RSHIFT) && vk != VK_RSHIFT;
                    if (!shiftDown)
                    {
                        if (talking) StopTalk();
                        if (aPending)
                        {
                            // Shift let go before A: they typed a capital A.
                            aPending = false;
                            holdTimer.Change(Timeout.Infinite, Timeout.Infinite);
                            ReplayA(true, null);
                        }
                    }
                }
                return CallNextHookEx(hook, nCode, wParam, lParam);
            }

            // Tab + Q -> switcher. Tab already went through; only Q is swallowed.
            if (vk == VK_Q)
            {
                if (down && (qSwallow || (tabDown && !OtherModifiers() && !shiftDown)))
                {
                    if (!qSwallow) Emit("{\"event\":\"switcher\"}");
                    qSwallow = true;
                    return (IntPtr)1;
                }
                if (up && qSwallow)
                {
                    qSwallow = false;
                    return (IntPtr)1;
                }
            }

            // Shift + A held -> talk. A quick tap is replayed as a typed "A".
            if (vk == VK_A)
            {
                if (down)
                {
                    if (aSwallow) return (IntPtr)1;
                    if (shiftDown && !OtherModifiers())
                    {
                        aSwallow = true;
                        aPending = true;
                        aScan = k.scanCode;
                        holdTimer.Change(holdMs, Timeout.Infinite);
                        return (IntPtr)1;
                    }
                }
                else if (up && aSwallow)
                {
                    aSwallow = false;
                    if (aPending)
                    {
                        aPending = false;
                        holdTimer.Change(Timeout.Infinite, Timeout.Infinite);
                        ReplayA(false, null);
                    }
                    StopTalk();
                    return (IntPtr)1;
                }
            }
            else if (down && aPending && !IsModifier(vk))
            {
                // Fast typing ("AB"): type the held A first, then this key, in order.
                aPending = false;
                holdTimer.Change(Timeout.Infinite, Timeout.Infinite);
                List<INPUT> after = new List<INPUT>();
                after.Add(Key((ushort)vk, (ushort)k.scanCode, false, (k.flags & LLKHF_EXTENDED) != 0));
                ReplayA(false, after);
                return (IntPtr)1;
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    // ------------------------------------------------------------ windows for the switcher

    static string Esc(string text)
    {
        if (text == null) return "";
        StringBuilder sb = new StringBuilder(text.Length + 8);
        foreach (char c in text)
        {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c < 0x20) sb.Append(string.Format("\\u{0:x4}", (int)c));
            else sb.Append(c);
        }
        return sb.ToString();
    }

    static string ProcessPath(uint pid)
    {
        IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (handle == IntPtr.Zero) return "";
        try
        {
            StringBuilder sb = new StringBuilder(1024);
            int size = sb.Capacity;
            return QueryFullProcessImageName(handle, 0, sb, ref size) ? sb.ToString() : "";
        }
        finally { CloseHandle(handle); }
    }

    static string FriendlyName(string path, string title)
    {
        try
        {
            if (path.Length > 0)
            {
                string description = FileVersionInfo.GetVersionInfo(path).FileDescription;
                if (!string.IsNullOrEmpty(description) && description.Trim().Length > 0) return description.Trim();
                return Path.GetFileNameWithoutExtension(path);
            }
        }
        catch { }
        return title;
    }

    static bool Cloaked(IntPtr hwnd)
    {
        int value = 0;
        try { return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out value, 4) == 0 && value != 0; }
        catch { return false; }
    }

    /** Store apps live inside ApplicationFrameHost; the real app is a child window's process. */
    static uint FramedPid(IntPtr frame, uint framePid)
    {
        uint found = 0;
        EnumChildWindows(frame, delegate (IntPtr child, IntPtr l)
        {
            uint pid;
            GetWindowThreadProcessId(child, out pid);
            if (pid != 0 && pid != framePid) { found = pid; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    static string ListWindows()
    {
        IntPtr foreground = GetForegroundWindow();
        StringBuilder sb = new StringBuilder("[");
        int count = 0;
        EnumWindows(delegate (IntPtr hwnd, IntPtr l)
        {
            if (count >= 80) return false;
            if (!IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) != IntPtr.Zero) return true;
            long ex = GetWindowLong(hwnd, GWL_EXSTYLE);
            if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return true;
            int length = GetWindowTextLength(hwnd);
            if (length == 0 || Cloaked(hwnd)) return true;
            StringBuilder title = new StringBuilder(length + 1);
            GetWindowText(hwnd, title, title.Capacity);
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            string path = ProcessPath(pid);
            if (path.EndsWith("\\ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
            {
                uint real = FramedPid(hwnd, pid);
                if (real != 0) { pid = real; path = ProcessPath(real); }
            }
            string name = path.EndsWith("\\ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase) || path.Length == 0
                ? title.ToString()
                : FriendlyName(path, title.ToString());
            if (count > 0) sb.Append(",");
            sb.Append("{\"hwnd\":").Append(hwnd.ToInt64())
              .Append(",\"pid\":").Append(pid)
              .Append(",\"title\":\"").Append(Esc(title.ToString())).Append("\"")
              .Append(",\"path\":\"").Append(Esc(path)).Append("\"")
              .Append(",\"name\":\"").Append(Esc(name)).Append("\"")
              .Append(",\"minimized\":").Append(IsIconic(hwnd) ? "true" : "false")
              .Append(",\"active\":").Append(hwnd == foreground ? "true" : "false")
              .Append("}");
            count++;
            return true;
        }, IntPtr.Zero);
        sb.Append("]");
        return sb.ToString();
    }

    static bool Focus(IntPtr hwnd)
    {
        if (!IsWindow(hwnd)) return false;
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        uint ignored;
        uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint me = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        if (attached) AttachThreadInput(me, fgThread, false);
        if (GetForegroundWindow() != hwnd)
        {
            // Windows only lets the process that got the last input change the foreground;
            // a released Alt tap counts as that input.
            List<INPUT> alt = new List<INPUT>();
            alt.Add(Key(VK_MENU, 0, false, false));
            alt.Add(Key(VK_MENU, 0, true, false));
            Inject(alt);
            SetForegroundWindow(hwnd);
        }
        return GetForegroundWindow() == hwnd;
    }

    static void Commands()
    {
        try
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                string[] parts = line.Trim().Split(' ');
                if (parts.Length < 2) continue;
                string id = parts[1];
                int ignoredId;
                if (!int.TryParse(id, out ignoredId)) continue;
                try
                {
                    if (parts[0] == "list")
                    {
                        Emit("{\"id\":" + id + ",\"windows\":" + ListWindows() + "}");
                    }
                    else if (parts[0] == "focus" && parts.Length >= 3)
                    {
                        long raw;
                        bool ok = long.TryParse(parts[2], out raw) && Focus(new IntPtr(raw));
                        Emit("{\"id\":" + id + ",\"ok\":" + (ok ? "true" : "false") + "}");
                    }
                    else if (parts[0] == "close" && parts.Length >= 3)
                    {
                        bool ok = false;
                        foreach (string item in parts[2].Split(','))
                        {
                            long raw;
                            if (long.TryParse(item, out raw) && IsWindow(new IntPtr(raw)))
                                ok = PostMessage(new IntPtr(raw), WM_CLOSE, IntPtr.Zero, IntPtr.Zero) || ok;
                        }
                        Emit("{\"id\":" + id + ",\"ok\":" + (ok ? "true" : "false") + "}");
                    }
                }
                catch (Exception error)
                {
                    Emit("{\"id\":" + id + ",\"error\":\"" + Esc(error.Message) + "\"}");
                }
            }
        }
        catch { }
        // stdin closed: MIKO is gone.
        Environment.Exit(0);
    }

    public static void Run(int parent, int hold)
    {
        holdMs = hold > 100 && hold < 2000 ? hold : 350;
        holdTimer = new Timer(OnHold, null, Timeout.Infinite, Timeout.Infinite);
        hookProc = OnKey;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero)
        {
            Emit("{\"error\":\"hook\",\"detail\":\"SetWindowsHookEx failed (" + Marshal.GetLastWin32Error() + ")\"}");
        }
        else
        {
            Emit("{\"ready\":true}");
        }
        Thread commands = new Thread(Commands);
        commands.IsBackground = true;
        commands.Start();
        if (parent > 0)
        {
            Thread watch = new Thread(delegate ()
            {
                while (true)
                {
                    Thread.Sleep(2000);
                    try { if (Process.GetProcessById(parent).HasExited) Environment.Exit(0); }
                    catch { Environment.Exit(0); }
                }
            });
            watch.IsBackground = true;
            watch.Start();
        }
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
    }
}
'@

try {
  # -IgnoreWarnings: Windows PowerShell treats compiler warnings (e.g. struct fields filled by Win32) as errors.
  Add-Type -TypeDefinition $source -Language CSharp -IgnoreWarnings
} catch {
  $message = ($_.Exception.Message -replace '[\r\n]+', ' ')
  if ($message.Length -gt 300) { $message = $message.Substring(0, 300) }
  [Console]::Out.WriteLine((@{ error = 'compile'; detail = $message } | ConvertTo-Json -Compress))
  exit 0
}

[MikoKeys]::Run($Parent, $HoldMs)
