# MIKO WhatsApp helper for Windows (UI Automation). The Windows counterpart of the
# "whatsapp" command in ax-mac.swift: same stdin/stdout contract, so src/main/whatsapp.ts
# and the shared chooser logic are used unchanged.
#
# Modes:
#   open (default)  stdin: {"search":"Dad"}                                  -> list results
#                   stdin: {"search":"Dad","name":"Dad","snippet":"...","reuseSearch":true}
#                                                                            -> open that one row
#   inspect         prints the WhatsApp accessibility tree (control types, ids, short names)
#                   so the owner can check what this installed version exposes. Message text
#                   on the conversation side is redacted. Nothing is sent anywhere.
#
# Output (open): one JSON line
#   {"ok":true,"status":"results","rows":[{"name":"Dad","snippet":"..."}],"inspected":true}
#   {"ok":true,"status":"none"} | {"ok":true,"status":"opened","header":"Dad"}
#   {"ok":false,"status":"failed|lost-focus|assisted|unverified","reason":"...","diag":"..."}
#
# Safety rules (the same as the Mac helper):
# - Text is typed only while WhatsApp's search box itself has keyboard focus; the focus is
#   checked before every character. The message box is never focused, typed into or read.
# - The search is typed once. Opening a result reuses the search that is already there.
# - A row is opened only when exactly one row matches the chosen name (and preview).
# - Success is reported only after the open chat's header shows that name.
# - No screen coordinates are guessed: a click is used only on a row/box found through
#   accessibility, after checking that the element under that point is that row/box.
param([string]$Mode = 'open')

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { [Console]::InputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Emit($obj) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $obj -Compress -Depth 5))
  [Console]::Out.Flush()
}

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows;
using System.Windows.Automation;

public class MikoWaRow
{
    public string name = "";
    public string snippet = "";
}

public class MikoWaResult
{
    public string status = "failed";
    public string reason = "";
    public string header = "";
    public string diag = "";
    public bool inspected = false;
    public List<MikoWaRow> rows = new List<MikoWaRow>();
}

public static class MikoWhatsApp
{
    const uint INPUT_KEYBOARD = 1, INPUT_MOUSE = 0;
    const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
    const int SW_RESTORE = 9;
    const ushort VK_BACK = 0x08, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_A = 0x41;

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion u; }

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc fn, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    static readonly Regex SectionLabel = new Regex("^(chats?|contacts?|messages?|groups?|groups in common|other contacts|contacts on whatsapp|archived)$", RegexOptions.IgnoreCase);
    static readonly Regex NoResults = new Regex("^no (chats|contacts|messages|results)\\b|no chats, contacts or messages found", RegexOptions.IgnoreCase);
    static readonly Regex TimeLike = new Regex("^(\\d{1,2}[:.]\\d{2}(\\s?[ap]\\.?m\\.?)?|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4})$", RegexOptions.IgnoreCase);
    static readonly Regex CountLike = new Regex("^(\\d+|\\d+ unread messages?|unread|muted|pinned|archived)$", RegexOptions.IgnoreCase);

    static string trace = "";

    static void Note(string s)
    {
        if (trace.Length < 600) trace += (trace.Length > 0 ? " " : "") + s;
    }

    public static string Clean(string raw)
    {
        if (raw == null) return "";
        string s = Regex.Replace(raw, "[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]", "");
        return Regex.Replace(s, "\\s+", " ").Trim();
    }

    public static bool Same(string a, string b)
    {
        return string.Equals(Clean(a), Clean(b), StringComparison.OrdinalIgnoreCase);
    }

    static bool Contains(string hay, string needle)
    {
        return Clean(hay).IndexOf(Clean(needle), StringComparison.OrdinalIgnoreCase) >= 0;
    }

    // ---------- window + focus ----------

    static IntPtr FindWindowHandle()
    {
        HashSet<uint> pids = new HashSet<uint>();
        foreach (Process p in Process.GetProcesses())
        {
            try { if (p.ProcessName.StartsWith("WhatsApp", StringComparison.OrdinalIgnoreCase)) pids.Add((uint)p.Id); } catch { }
        }
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr hwnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hwnd)) return true;
            StringBuilder title = new StringBuilder(256);
            GetWindowText(hwnd, title, 256);
            if (title.ToString().IndexOf("WhatsApp", StringComparison.OrdinalIgnoreCase) < 0) return true;
            StringBuilder cls = new StringBuilder(256);
            GetClassName(hwnd, cls, 256);
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            // Store builds can be hosted by ApplicationFrameHost; the frame carries the title.
            if (pids.Contains(pid) || cls.ToString() == "ApplicationFrameWindow")
            {
                found = hwnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    static INPUT Key(ushort vk, ushort scan, uint flags)
    {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.u.ki.wVk = vk;
        input.u.ki.wScan = scan;
        input.u.ki.dwFlags = flags;
        return input;
    }

    static void Inject(INPUT[] inputs)
    {
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    static bool Front(IntPtr hwnd)
    {
        return GetForegroundWindow() == hwnd;
    }

    static bool Focus(IntPtr hwnd)
    {
        if (!IsWindow(hwnd)) return false;
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        if (Front(hwnd)) return true;
        uint ignored;
        uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint me = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        if (attached) AttachThreadInput(me, fgThread, false);
        if (!Front(hwnd))
        {
            // A released Alt tap lets this process change the foreground window.
            Inject(new INPUT[] { Key(VK_MENU, 0, 0), Key(VK_MENU, 0, KEYEVENTF_KEYUP) });
            SetForegroundWindow(hwnd);
        }
        for (int i = 0; i < 10 && !Front(hwnd); i++) Thread.Sleep(50);
        return Front(hwnd);
    }

    // ---------- UI Automation helpers ----------

    static Condition Type(ControlType t)
    {
        return new PropertyCondition(AutomationElement.ControlTypeProperty, t);
    }

    static Condition AnyType(params ControlType[] types)
    {
        if (types.Length == 1) return Type(types[0]);
        Condition[] list = new Condition[types.Length];
        for (int i = 0; i < types.Length; i++) list[i] = Type(types[i]);
        return new OrCondition(list);
    }

    static List<AutomationElement> All(AutomationElement root, Condition c)
    {
        List<AutomationElement> list = new List<AutomationElement>();
        try
        {
            foreach (AutomationElement e in root.FindAll(TreeScope.Descendants, c)) list.Add(e);
        }
        catch { }
        return list;
    }

    static string Name(AutomationElement e)
    {
        try { return Clean(e.Current.Name); } catch { return ""; }
    }

    static Rect Box(AutomationElement e)
    {
        try { return e.Current.BoundingRectangle; } catch { return Rect.Empty; }
    }

    static string Label(AutomationElement e)
    {
        try { return Clean(e.Current.Name + " " + e.Current.HelpText + " " + e.Current.AutomationId); } catch { return ""; }
    }

    static bool IsComposerLabel(string label)
    {
        return Regex.IsMatch(label, "type a message|message composer|compose|ComposerTextView|MessageTextBox|ChatInput", RegexOptions.IgnoreCase);
    }

    static string ValueOf(AutomationElement e)
    {
        try
        {
            object p;
            if (e.TryGetCurrentPattern(ValuePattern.Pattern, out p)) return Clean(((ValuePattern)p).Current.Value);
            if (e.TryGetCurrentPattern(TextPattern.Pattern, out p)) return Clean(((TextPattern)p).DocumentRange.GetText(400));
        }
        catch { }
        return "";
    }

    static bool HasFocus(AutomationElement e)
    {
        try
        {
            AutomationElement f = AutomationElement.FocusedElement;
            if (f == null) return false;
            if (Automation.Compare(f, e)) return true;
            // Web views can report the focused node as a child of the edit box.
            TreeWalker walker = TreeWalker.RawViewWalker;
            AutomationElement parent = walker.GetParent(f);
            for (int i = 0; i < 3 && parent != null; i++)
            {
                if (Automation.Compare(parent, e)) return true;
                parent = walker.GetParent(parent);
            }
        }
        catch { }
        return false;
    }

    static bool FocusedIsComposer()
    {
        try
        {
            AutomationElement f = AutomationElement.FocusedElement;
            return f != null && IsComposerLabel(Label(f));
        }
        catch { return false; }
    }

    /// WhatsApp's chat search box: an edit labelled "search", never the message box.
    /// With several (chat search + in-chat search), the left-most one is the chat list search.
    static AutomationElement FindSearch(AutomationElement win, out int edits)
    {
        AutomationElement best = null;
        Rect bestBox = Rect.Empty;
        List<AutomationElement> all = All(win, Type(ControlType.Edit));
        edits = all.Count;
        foreach (AutomationElement e in all)
        {
            string label = Label(e);
            if (IsComposerLabel(label)) continue;
            if (label.IndexOf("search", StringComparison.OrdinalIgnoreCase) < 0) continue;
            Rect r = Box(e);
            if (r.IsEmpty || r.Width < 20) continue;
            if (best == null || r.Left < bestBox.Left) { best = e; bestBox = r; }
        }
        return best;
    }

    static bool ElementAtPointIs(AutomationElement target, Point p)
    {
        try
        {
            AutomationElement hit = AutomationElement.FromPoint(p);
            TreeWalker walker = TreeWalker.RawViewWalker;
            for (int i = 0; i < 8 && hit != null; i++)
            {
                if (Automation.Compare(hit, target)) return true;
                hit = walker.GetParent(hit);
            }
        }
        catch { }
        return false;
    }

    /// Click the centre of an element found through accessibility, only after checking that
    /// the element under that point really is that element (never a guessed coordinate).
    static bool VerifiedClick(AutomationElement e, IntPtr hwnd)
    {
        Rect r = Box(e);
        if (r.IsEmpty || !Front(hwnd)) return false;
        Point p = new Point(r.Left + r.Width / 2, r.Top + r.Height / 2);
        if (!ElementAtPointIs(e, p)) return false;
        SetCursorPos((int)p.X, (int)p.Y);
        INPUT down = new INPUT();
        down.type = INPUT_MOUSE;
        down.u.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
        INPUT up = new INPUT();
        up.type = INPUT_MOUSE;
        up.u.mi.dwFlags = MOUSEEVENTF_LEFTUP;
        Inject(new INPUT[] { down, up });
        return true;
    }

    static bool FocusSearch(AutomationElement search, IntPtr hwnd)
    {
        if (HasFocus(search)) return true;
        try { search.SetFocus(); } catch { }
        for (int i = 0; i < 6 && !HasFocus(search); i++) Thread.Sleep(50);
        if (HasFocus(search)) return true;
        Note("setfocus-failed");
        if (VerifiedClick(search, hwnd))
        {
            for (int i = 0; i < 8 && !HasFocus(search); i++) Thread.Sleep(50);
        }
        return HasFocus(search);
    }

    static bool ClearSearch(AutomationElement search, IntPtr hwnd)
    {
        if (ValueOf(search).Length == 0) return true;
        if (!Front(hwnd) || !HasFocus(search) || FocusedIsComposer()) return false;
        Inject(new INPUT[] { Key(VK_CONTROL, 0, 0), Key(VK_A, 0, 0), Key(VK_A, 0, KEYEVENTF_KEYUP), Key(VK_CONTROL, 0, KEYEVENTF_KEYUP) });
        Thread.Sleep(60);
        if (!Front(hwnd) || !HasFocus(search) || FocusedIsComposer()) return false;
        Inject(new INPUT[] { Key(VK_BACK, 0, 0), Key(VK_BACK, 0, KEYEVENTF_KEYUP) });
        for (int i = 0; i < 10 && ValueOf(search).Length > 0; i++) Thread.Sleep(50);
        return ValueOf(search).Length == 0;
    }

    /// Types one character at a time, checking before each one that the search box still has focus.
    static bool TypeIntoSearch(string text, AutomationElement search, IntPtr hwnd)
    {
        foreach (char ch in text)
        {
            if (!Front(hwnd) || FocusedIsComposer() || !HasFocus(search)) return false;
            Inject(new INPUT[] { Key(0, ch, KEYEVENTF_UNICODE), Key(0, ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP) });
            Thread.Sleep(18);
        }
        return true;
    }

    // ---------- results ----------

    class Found
    {
        public AutomationElement el;
        public MikoWaRow row;
        public Rect box;
    }

    static AutomationElement ResultsContainer(AutomationElement win, Rect searchBox, out string kind)
    {
        kind = "";
        List<AutomationElement> lists = All(win, AnyType(ControlType.List, ControlType.DataGrid, ControlType.Table, ControlType.Tree, ControlType.Group, ControlType.Pane));
        AutomationElement fallback = null;
        foreach (AutomationElement e in lists)
        {
            string name = Name(e);
            if (Regex.IsMatch(name, "^search results", RegexOptions.IgnoreCase)) { kind = "search-results"; return e; }
            if (fallback == null && Regex.IsMatch(name, "^(chat list|chats)$", RegexOptions.IgnoreCase))
            {
                Rect r = Box(e);
                if (!r.IsEmpty && r.Top >= searchBox.Top) fallback = e;
            }
        }
        if (fallback != null) kind = "chat-list";
        return fallback;
    }

    static List<Found> ReadRows(AutomationElement win, Rect searchBox, out bool none, out string place)
    {
        none = false;
        string kind;
        AutomationElement container = ResultsContainer(win, searchBox, out kind);
        AutomationElement scope = container != null ? container : win;
        place = container != null ? kind : "window";
        double paneRight = searchBox.Right + 24;

        // Section labels ("Chats", "Contacts", "Messages") by position; message hits are skipped.
        List<KeyValuePair<double, string>> sections = new List<KeyValuePair<double, string>>();
        foreach (AutomationElement t in All(scope, Type(ControlType.Text)))
        {
            string name = Name(t);
            Rect r = Box(t);
            if (r.IsEmpty || r.Left > paneRight) continue;
            if (NoResults.IsMatch(name)) none = true;
            if (SectionLabel.IsMatch(name)) sections.Add(new KeyValuePair<double, string>(r.Top, name.ToLowerInvariant()));
        }

        List<Found> rows = new List<Found>();
        foreach (AutomationElement e in All(scope, AnyType(ControlType.ListItem, ControlType.DataItem, ControlType.TreeItem)))
        {
            if (rows.Count >= 12) break;
            Rect r = Box(e);
            if (r.IsEmpty || r.Height < 20 || r.Left > paneRight || r.Top < searchBox.Bottom - 2) continue;
            bool nested = false;
            foreach (Found f in rows) if (f.box.Contains(r)) { nested = true; break; }
            if (nested) continue;

            string section = "";
            double best = double.MinValue;
            foreach (KeyValuePair<double, string> s in sections)
            {
                if (s.Key <= r.Top + 2 && s.Key > best) { best = s.Key; section = s.Value; }
            }
            if (section.StartsWith("message")) continue;

            List<string> texts = new List<string>();
            foreach (AutomationElement t in All(e, Type(ControlType.Text)))
            {
                string name = Name(t);
                if (name.Length == 0) continue;
                if (texts.Count > 0 && texts[texts.Count - 1] == name) continue;
                texts.Add(name);
            }
            if (texts.Count == 0)
            {
                foreach (string part in Name(e).Split(new char[] { ',', '\n' }))
                {
                    string c = Clean(part);
                    if (c.Length > 0) texts.Add(c);
                }
            }
            if (texts.Count == 1 && SectionLabel.IsMatch(texts[0])) continue;
            string title = "";
            List<string> rest = new List<string>();
            foreach (string t in texts)
            {
                if (TimeLike.IsMatch(t) || CountLike.IsMatch(t)) continue;
                if (title.Length == 0) title = t; else rest.Add(t);
            }
            if (title.Length == 0 || SectionLabel.IsMatch(title)) continue;
            string snippet = Clean(string.Join(" ", rest.ToArray()));
            if (snippet.Length > 120) snippet = snippet.Substring(0, 120);
            Found found = new Found();
            found.el = e;
            found.box = r;
            found.row = new MikoWaRow();
            found.row.name = title.Length > 80 ? title.Substring(0, 80) : title;
            found.row.snippet = snippet;
            rows.Add(found);
        }
        if (rows.Count > 0) none = false;
        return rows;
    }

    static bool SnippetMatches(string rowSnippet, string want)
    {
        if (want.Length == 0) return true;
        return Same(rowSnippet, want) || Contains(rowSnippet, want) || Contains(want, rowSnippet);
    }

    static bool PressRow(Found target, IntPtr hwnd)
    {
        object p;
        try
        {
            if (target.el.TryGetCurrentPattern(InvokePattern.Pattern, out p)) { ((InvokePattern)p).Invoke(); Note("press=invoke"); return true; }
            if (target.el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { ((SelectionItemPattern)p).Select(); Note("press=select"); return true; }
            // Web views often put the clickable part one level down.
            foreach (AutomationElement child in All(target.el, Condition.TrueCondition))
            {
                Rect r = Box(child);
                if (r.IsEmpty || !target.box.Contains(r)) continue;
                if (child.TryGetCurrentPattern(InvokePattern.Pattern, out p)) { ((InvokePattern)p).Invoke(); Note("press=child-invoke"); return true; }
            }
        }
        catch { }
        if (VerifiedClick(target.el, hwnd)) { Note("press=verified-click"); return true; }
        return false;
    }

    /// The open chat's name in the conversation header (right of the chat list, near the top).
    static string ConfirmedHeader(AutomationElement win, Rect searchBox, string name)
    {
        Rect w = Box(win);
        double minX = searchBox.Right + 8;
        foreach (AutomationElement e in All(win, AnyType(ControlType.Text, ControlType.Button, ControlType.Hyperlink, ControlType.Header, ControlType.HeaderItem)))
        {
            string label = Name(e);
            if (!Same(label, name)) continue;
            Rect r = Box(e);
            if (r.IsEmpty || r.Left < minX || r.Top > w.Top + 200 || r.Height < 8 || r.Height > 80) continue;
            return label;
        }
        return "";
    }

    // ---------- entry points ----------

    static MikoWaResult Fail(string status, string reason)
    {
        MikoWaResult r = new MikoWaResult();
        r.status = status;
        r.reason = reason;
        r.diag = trace;
        return r;
    }

    public static MikoWaResult Open(string query, string pickName, string pickSnippet, bool reuse)
    {
        query = Clean(query);
        pickName = Clean(pickName);
        pickSnippet = Clean(pickSnippet);
        bool press = pickName.Length > 0;
        if (query.Length == 0 || query.Length > 80) return Fail("failed", "That name isn\u2019t one I can search for.");

        IntPtr hwnd = IntPtr.Zero;
        for (int i = 0; i < 40 && hwnd == IntPtr.Zero; i++)
        {
            hwnd = FindWindowHandle();
            if (hwnd == IntPtr.Zero) Thread.Sleep(250);
        }
        if (hwnd == IntPtr.Zero) return Fail("failed", "WhatsApp\u2019s window didn\u2019t appear.");
        if (!Focus(hwnd)) return Fail("lost-focus", "WhatsApp isn\u2019t in front, so I stopped.");

        AutomationElement win;
        try { win = AutomationElement.FromHandle(hwnd); } catch { return Fail("failed", "Windows accessibility couldn\u2019t read WhatsApp\u2019s window."); }

        // Web-based WhatsApp builds its accessibility tree on first use; give it a moment.
        AutomationElement search = null;
        int edits = 0;
        for (int i = 0; i < 20 && search == null; i++)
        {
            search = FindSearch(win, out edits);
            if (search == null) Thread.Sleep(250);
        }
        Note("edits=" + edits);
        if (search == null)
        {
            return Fail("failed", "This WhatsApp version doesn\u2019t show its search box to Windows accessibility (" + edits + " text fields found, none labelled search), so I didn\u2019t type anything.");
        }
        Rect searchBox = Box(search);

        string value = ValueOf(search);
        bool canReuse = reuse && Contains(value, query);
        if (!canReuse)
        {
            if (reuse) return Fail("failed", "WhatsApp\u2019s search results went stale, so I stopped before pressing again.");
            if (!FocusSearch(search, hwnd))
            {
                if (FocusedIsComposer()) return Fail("failed", "The message box was focused, so I didn\u2019t type and left the draft alone.");
                return Fail("failed", "I couldn\u2019t put the cursor in WhatsApp\u2019s search box, so I didn\u2019t type anything.");
            }
            if (value.Length > 0 && !ClearSearch(search, hwnd))
            {
                return Fail("failed", "WhatsApp\u2019s search wasn\u2019t empty, so I didn\u2019t type over it.");
            }
            if (!TypeIntoSearch(query, search, hwnd))
            {
                if (FocusedIsComposer()) return Fail("failed", "The message box got focus, so I stopped typing and left the draft alone.");
                if (!Front(hwnd)) return Fail("lost-focus", "WhatsApp isn\u2019t in front any more, so I stopped.");
                return Fail("failed", "WhatsApp\u2019s search box lost focus, so I stopped typing.");
            }
            for (int i = 0; i < 20 && !Contains(value = ValueOf(search), query); i++) Thread.Sleep(100);
            if (!Contains(value, query)) return Fail("failed", "I couldn\u2019t put that name into WhatsApp\u2019s search.");
        }

        bool none = false;
        string place = "";
        List<Found> rows = new List<Found>();
        for (int i = 0; i < 30; i++)
        {
            if (!Front(hwnd)) return Fail("lost-focus", "WhatsApp isn\u2019t in front any more, so I stopped.");
            Thread.Sleep(i == 0 ? 300 : 120);
            rows = ReadRows(win, searchBox, out none, out place);
            if (rows.Count > 0 || none) break;
        }
        Note("list=" + place + " rows=" + rows.Count + (none ? " none" : ""));

        MikoWaResult result = new MikoWaResult();
        result.inspected = true;
        foreach (Found f in rows) result.rows.Add(f.row);
        if (rows.Count == 0 && !none)
        {
            result.status = "assisted";
            result.reason = "I typed \u201c" + query + "\u201d in WhatsApp\u2019s search, but this WhatsApp version doesn\u2019t show the results to Windows accessibility. Pick the chat there.";
            result.inspected = false;
            result.diag = trace;
            return result;
        }
        if (!press)
        {
            result.status = rows.Count > 0 ? "results" : "none";
            result.diag = trace;
            return result;
        }

        List<Found> hits = new List<Found>();
        foreach (Found f in rows) if (Same(f.row.name, pickName) && SnippetMatches(f.row.snippet, pickSnippet)) hits.Add(f);
        if (hits.Count > 1)
        {
            result.status = "assisted";
            result.reason = "Several chats look the same in WhatsApp. Pick the one you want there.";
            result.diag = trace;
            return result;
        }
        if (hits.Count == 0)
        {
            result.status = "none";
            result.reason = "That chat isn\u2019t in the WhatsApp results.";
            result.diag = trace;
            return result;
        }
        if (!Front(hwnd)) return Fail("lost-focus", "WhatsApp isn\u2019t in front any more, so I stopped.");
        if (!PressRow(hits[0], hwnd)) return Fail("failed", "WhatsApp didn\u2019t let me open that result through Windows accessibility.");

        string header = "";
        for (int i = 0; i < 25 && header.Length == 0; i++)
        {
            Thread.Sleep(120);
            header = ConfirmedHeader(win, searchBox, pickName);
        }
        if (header.Length == 0)
        {
            result.status = "unverified";
            result.reason = "I selected a row but couldn\u2019t confirm the chat header.";
            result.diag = trace;
            return result;
        }
        result.status = "opened";
        result.header = header;
        result.diag = trace;
        return result;
    }

    /// Accessibility tree for the owner to inspect. Text on the conversation side is redacted.
    public static string Inspect(int maxNodes)
    {
        IntPtr hwnd = FindWindowHandle();
        if (hwnd == IntPtr.Zero) return "WhatsApp's window wasn't found. Open WhatsApp and run this again.";
        AutomationElement win = AutomationElement.FromHandle(hwnd);
        int edits;
        AutomationElement search = FindSearch(win, out edits);
        Rect w = Box(win);
        double paneRight = search != null ? Box(search).Right + 24 : w.Left + w.Width * 0.4;
        StringBuilder sb = new StringBuilder();
        sb.AppendLine("window: " + Name(win) + "  edits=" + edits + "  search=" + (search != null ? Label(search) : "(none)"));
        int count = 0;
        Walk(win, 0, sb, ref count, maxNodes, paneRight, w.Top + 200);
        return sb.ToString();
    }

    static void Walk(AutomationElement e, int depth, StringBuilder sb, ref int count, int max, double paneRight, double headerBottom)
    {
        if (count >= max || depth > 40) return;
        count++;
        string type = "", id = "", cls = "", name = "";
        Rect r = Box(e);
        try { type = e.Current.ControlType.ProgrammaticName.Replace("ControlType.", ""); id = e.Current.AutomationId; cls = e.Current.ClassName; name = Name(e); } catch { }
        bool conversation = !r.IsEmpty && r.Left > paneRight && r.Top > headerBottom;
        if (conversation && name.Length > 0) name = "(redacted)";
        if (name.Length > 50) name = name.Substring(0, 50) + "\u2026";
        List<string> patterns = new List<string>();
        object p;
        try
        {
            if (e.TryGetCurrentPattern(InvokePattern.Pattern, out p)) patterns.Add("Invoke");
            if (e.TryGetCurrentPattern(ValuePattern.Pattern, out p)) patterns.Add("Value");
            if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) patterns.Add("SelectionItem");
        }
        catch { }
        sb.Append(new string(' ', depth * 2)).Append(type);
        if (id.Length > 0) sb.Append(" id=").Append(id);
        if (cls.Length > 0) sb.Append(" class=").Append(cls);
        if (name.Length > 0) sb.Append(" name=\"").Append(name).Append("\"");
        if (patterns.Count > 0) sb.Append(" [").Append(string.Join(",", patterns.ToArray())).Append("]");
        if (!r.IsEmpty) sb.Append(" @").Append((int)r.Left).Append(",").Append((int)r.Top).Append(" ").Append((int)r.Width).Append("x").Append((int)r.Height);
        sb.AppendLine();
        TreeWalker walker = TreeWalker.ControlViewWalker;
        AutomationElement child = null;
        try { child = walker.GetFirstChild(e); } catch { }
        while (child != null && count < max)
        {
            Walk(child, depth + 1, sb, ref count, max, paneRight, headerBottom);
            try { child = walker.GetNextSibling(child); } catch { child = null; }
        }
    }
}
'@

# Compile once per version of this file and reuse the DLL (keeps each search fast).
try {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = [System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($source))).Replace('-', '').Substring(0, 16)
  $dll = Join-Path ([System.IO.Path]::GetTempPath()) "miko-whatsapp-$hash.dll"
  $refs = @('UIAutomationClient', 'UIAutomationTypes', 'WindowsBase')
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName WindowsBase
  $loaded = $false
  if (Test-Path $dll) {
    # A run stopped mid-compile can leave a broken DLL: drop it and compile again.
    try { Add-Type -Path $dll; $loaded = $true } catch { Remove-Item -LiteralPath $dll -Force -ErrorAction SilentlyContinue }
  }
  if (-not $loaded) {
    # -IgnoreWarnings: Windows PowerShell treats compiler warnings as errors.
    Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies $refs -OutputAssembly $dll -OutputType Library -IgnoreWarnings
    if (-not ('MikoWhatsApp' -as [type])) { Add-Type -Path $dll }
  }
} catch {
  $message = ($_.Exception.Message -replace '[\r\n]+', ' ')
  if ($message.Length -gt 300) { $message = $message.Substring(0, 300) }
  Emit ([ordered]@{ ok = $false; status = 'failed'; reason = "MIKO's Windows WhatsApp helper couldn't start."; diag = "compile: $message" })
  exit 0
}

if ($Mode -eq 'inspect') {
  [Console]::Out.WriteLine([MikoWhatsApp]::Inspect(2500))
  exit 0
}

$request = $null
try {
  $raw = [Console]::In.ReadToEnd()
  if ($raw) { $request = $raw | ConvertFrom-Json }
} catch {}
if (-not $request -or -not $request.search) {
  Emit ([ordered]@{ ok = $false; status = 'failed'; reason = "That name isn't one I can search for." })
  exit 0
}

try {
  $name = if ($request.name) { [string]$request.name } else { '' }
  $snippet = if ($request.snippet) { [string]$request.snippet } else { '' }
  $result = [MikoWhatsApp]::Open([string]$request.search, $name, $snippet, [bool]$request.reuseSearch)
  $rows = New-Object System.Collections.ArrayList
  foreach ($row in $result.rows) { [void]$rows.Add([ordered]@{ name = $row.name; snippet = $row.snippet }) }
  Emit ([ordered]@{
    ok = ($result.status -eq 'opened' -or $result.status -eq 'results' -or $result.status -eq 'none')
    status = $result.status
    reason = $result.reason
    header = $result.header
    rows = $rows.ToArray()
    inspected = $result.inspected
    composerReady = $false
    diag = $result.diag
  })
} catch {
  $message = ($_.Exception.Message -replace '[\r\n]+', ' ')
  if ($message.Length -gt 200) { $message = $message.Substring(0, 200) }
  Emit ([ordered]@{ ok = $false; status = 'failed'; reason = 'Windows accessibility stopped while reading WhatsApp.'; diag = $message })
}
exit 0
