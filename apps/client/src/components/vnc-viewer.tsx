import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import clsx from "clsx";

// RFB type definition (copied from @novnc/novnc types to avoid static imports)
// The actual module is dynamically imported to avoid top-level await issues
interface RFBOptions {
  credentials?: {
    username?: string;
    password?: string;
    target?: string;
  };
  wsProtocols?: string[];
}

interface RFBInstance {
  scaleViewport: boolean;
  clipViewport: boolean;
  dragViewport: boolean;
  resizeSession: boolean;
  viewOnly: boolean;
  showDotCursor: boolean;
  background: string;
  qualityLevel: number;
  compressionLevel: number;
  readonly capabilities: { power?: boolean };
  disconnect(): void;
  sendCredentials(credentials: { username?: string; password?: string; target?: string }): void;
  sendKey(keysym: number, code: string | null, down?: boolean): void;
  sendCtrlAltDel(): void;
  focus(options?: FocusOptions): void;
  blur(): void;
  clipboardPasteFrom(text: string): void;
  machineShutdown(): void;
  machineReboot(): void;
  machineReset(): void;
  addEventListener(type: string, listener: (event: CustomEvent) => void): void;
  removeEventListener(type: string, listener: (event: CustomEvent) => void): void;
}

interface RFBConstructor {
  new (target: HTMLElement, urlOrChannel: string | WebSocket, options?: RFBOptions): RFBInstance;
}

// Dynamically import RFB to avoid top-level await issues with noVNC
let RFBClass: RFBConstructor | null = null;
const loadRFB = async (): Promise<RFBConstructor> => {
  if (RFBClass) return RFBClass;
  // noVNC 1.7.0-beta exports from core/rfb.js via package.json "exports"
  const module = await import("@novnc/novnc");
  RFBClass = module.default;
  return RFBClass;
};

export type VncConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface VncViewerProps {
  /** WebSocket URL to connect to (wss:// or ws://) - should point to websockify endpoint */
  url: string;
  /** Additional CSS class for the container */
  className?: string;
  /** Inline styles for the container */
  style?: CSSProperties;
  /** Background color for the canvas container */
  background?: string;
  /** Scale the viewport to fit the container */
  scaleViewport?: boolean;
  /** Clip the viewport to the container bounds */
  clipViewport?: boolean;
  /** Allow dragging the viewport when clipped */
  dragViewport?: boolean;
  /** Resize the remote session to match container size */
  resizeSession?: boolean;
  /** View-only mode (no keyboard/mouse input) */
  viewOnly?: boolean;
  /** Show dot cursor when remote cursor is hidden */
  showDotCursor?: boolean;
  /** JPEG quality level (0-9, higher is better quality) */
  qualityLevel?: number;
  /** Compression level (0-9, higher is more compression) */
  compressionLevel?: number;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Initial reconnect delay in ms */
  reconnectDelay?: number;
  /** Maximum reconnect delay in ms */
  maxReconnectDelay?: number;
  /** Maximum number of reconnect attempts (0 = infinite) */
  maxReconnectAttempts?: number;
  /** Focus the canvas on click */
  focusOnClick?: boolean;
  /** Loading fallback element */
  loadingFallback?: ReactNode;
  /** Error fallback element */
  errorFallback?: ReactNode;
  /** Called when connection is established */
  onConnect?: (rfb: RFBInstance) => void;
  /** Called when connection is closed */
  onDisconnect?: (rfb: RFBInstance | null, detail: { clean: boolean }) => void;
  /** Called when credentials are required */
  onCredentialsRequired?: (rfb: RFBInstance) => void;
  /** Called when security failure occurs */
  onSecurityFailure?: (
    rfb: RFBInstance | null,
    detail: { status: number; reason: string }
  ) => void;
  /** Called when clipboard data is received from server */
  onClipboard?: (rfb: RFBInstance, text: string) => void;
  /** Called when connection status changes */
  onStatusChange?: (status: VncConnectionStatus) => void;
  /** Called when desktop name is received */
  onDesktopName?: (rfb: RFBInstance, name: string) => void;
  /** Called when capabilities are received */
  onCapabilities?: (rfb: RFBInstance, capabilities: Record<string, boolean>) => void;
}

export interface VncViewerHandle {
  /** Connect to the VNC server */
  connect: () => void;
  /** Disconnect from the VNC server */
  disconnect: () => void;
  /** Get current connection status */
  getStatus: () => VncConnectionStatus;
  /** Check if currently connected */
  isConnected: () => boolean;
  /** Send clipboard text to remote server */
  clipboardPaste: (text: string) => void;
  /** Send Ctrl+Alt+Del */
  sendCtrlAltDel: () => void;
  /** Send a key event */
  sendKey: (keysym: number, code: string, down?: boolean) => void;
  /** Focus the VNC canvas */
  focus: () => void;
  /** Blur the VNC canvas */
  blur: () => void;
  /** Get the underlying RFB instance */
  getRfb: () => RFBInstance | null;
  /** Machine power actions */
  machineShutdown: () => void;
  machineReboot: () => void;
  machineReset: () => void;
}

/**
 * VncViewer - A React component for connecting to VNC servers via websockify
 *
 * Features:
 * - Auto-connect and auto-reconnect with exponential backoff
 * - Full clipboard support (Cmd+V paste)
 * - Keyboard and mouse input
 * - Viewport scaling and resizing
 */
export const VncViewer = forwardRef<VncViewerHandle, VncViewerProps>(
  function VncViewer(
    {
      url,
      className,
      style,
      background = "#000000",
      scaleViewport = true,
      clipViewport = false,
      dragViewport = false,
      resizeSession = false,
      viewOnly = false,
      showDotCursor = false,
      qualityLevel = 6,
      compressionLevel = 2,
      autoConnect = true,
      autoReconnect = true,
      reconnectDelay = 1000,
      maxReconnectDelay = 30000,
      maxReconnectAttempts = 0,
      focusOnClick = true,
      loadingFallback,
      errorFallback,
      onConnect,
      onDisconnect,
      onCredentialsRequired,
      onSecurityFailure,
      onClipboard,
      onStatusChange,
      onDesktopName,
      onCapabilities,
    },
    ref
  ) {
    console.log("[VncViewer] Component rendering, url:", url);

    const containerRef = useRef<HTMLDivElement>(null);
    const rfbRef = useRef<RFBInstance | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null
    );
    const reconnectAttemptsRef = useRef(0);
    const currentReconnectDelayRef = useRef(reconnectDelay);
    const isUnmountedRef = useRef(false);
    const urlRef = useRef(url);
    const shouldReconnectRef = useRef(autoReconnect);
    const connectInternalRef = useRef<(() => Promise<void>) | null>(null);

    const [status, setStatus] = useState<VncConnectionStatus>("disconnected");

    // Keep urlRef updated
    useEffect(() => {
      urlRef.current = url;
    }, [url]);

    // Keep shouldReconnectRef updated
    useEffect(() => {
      shouldReconnectRef.current = autoReconnect;
    }, [autoReconnect]);

    // Update status and notify
    const updateStatus = useCallback(
      (newStatus: VncConnectionStatus) => {
        setStatus(newStatus);
        onStatusChange?.(newStatus);
      },
      [onStatusChange]
    );

    // Clear reconnect timer
    const clearReconnectTimer = useCallback(() => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }, []);

    // Schedule reconnect with exponential backoff
    const scheduleReconnect = useCallback(() => {
      if (isUnmountedRef.current || !shouldReconnectRef.current) {
        return;
      }

      // Check max attempts
      if (
        maxReconnectAttempts > 0 &&
        reconnectAttemptsRef.current >= maxReconnectAttempts
      ) {
        console.log(
          `[VncViewer] Max reconnect attempts (${maxReconnectAttempts}) reached`
        );
        updateStatus("error");
        return;
      }

      clearReconnectTimer();

      const delay = currentReconnectDelayRef.current;
      console.log(
        `[VncViewer] Scheduling reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1})`
      );

      reconnectTimerRef.current = setTimeout(() => {
        if (isUnmountedRef.current) return;
        reconnectAttemptsRef.current++;
        // Exponential backoff
        currentReconnectDelayRef.current = Math.min(
          currentReconnectDelayRef.current * 2,
          maxReconnectDelay
        );
        connectInternalRef.current?.();
      }, delay);
    }, [
      clearReconnectTimer,
      maxReconnectAttempts,
      maxReconnectDelay,
      updateStatus,
    ]);

    // Internal connect function
    const connectInternal = useCallback(async () => {
      if (isUnmountedRef.current) return;
      if (!containerRef.current) {
        console.warn("[VncViewer] Container not available for connection");
        return;
      }

      // Clean up existing connection
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch (e) {
          console.error("[VncViewer] Error disconnecting existing RFB:", e);
        }
        rfbRef.current = null;
      }

      updateStatus("connecting");

      try {
        // Dynamically load RFB class
        const RFB = await loadRFB();
        if (isUnmountedRef.current) return;

        const wsUrl = urlRef.current;
        console.log(`[VncViewer] Connecting to ${wsUrl}`);

        const rfb = new RFB(containerRef.current, wsUrl, {
          credentials: undefined,
          wsProtocols: ["binary"],
        });

        // Configure RFB options
        rfb.scaleViewport = scaleViewport;
        rfb.clipViewport = clipViewport;
        rfb.dragViewport = dragViewport;
        rfb.resizeSession = resizeSession;
        rfb.viewOnly = viewOnly;
        rfb.showDotCursor = showDotCursor;
        rfb.qualityLevel = qualityLevel;
        rfb.compressionLevel = compressionLevel;

        // Event handlers
        rfb.addEventListener("connect", () => {
          if (isUnmountedRef.current) return;
          console.log("[VncViewer] Connected");
          // Reset reconnect state on successful connection
          reconnectAttemptsRef.current = 0;
          currentReconnectDelayRef.current = reconnectDelay;
          updateStatus("connected");
          onConnect?.(rfb);
        });

        rfb.addEventListener("disconnect", (e) => {
          if (isUnmountedRef.current) return;
          const detail = (e as CustomEvent<{ clean: boolean }>).detail;
          console.log(
            `[VncViewer] Disconnected (clean: ${detail?.clean ?? false})`
          );
          rfbRef.current = null;
          updateStatus("disconnected");
          onDisconnect?.(rfb, detail ?? { clean: false });

          // Auto-reconnect on non-clean disconnect
          if (!detail?.clean && shouldReconnectRef.current) {
            scheduleReconnect();
          }
        });

        rfb.addEventListener("credentialsrequired", () => {
          if (isUnmountedRef.current) return;
          console.log("[VncViewer] Credentials required");
          onCredentialsRequired?.(rfb);
        });

        rfb.addEventListener("securityfailure", (e) => {
          if (isUnmountedRef.current) return;
          const detail = (e as CustomEvent<{ status: number; reason: string }>)
            .detail;
          console.error("[VncViewer] Security failure:", detail);
          updateStatus("error");
          onSecurityFailure?.(rfb, detail ?? { status: 0, reason: "Unknown" });
        });

        rfb.addEventListener("clipboard", (e) => {
          if (isUnmountedRef.current) return;
          const detail = (e as CustomEvent<{ text: string }>).detail;
          onClipboard?.(rfb, detail?.text ?? "");
        });

        rfb.addEventListener("desktopname", (e) => {
          if (isUnmountedRef.current) return;
          const detail = (e as CustomEvent<{ name: string }>).detail;
          onDesktopName?.(rfb, detail?.name ?? "");
        });

        rfb.addEventListener("capabilities", (e) => {
          if (isUnmountedRef.current) return;
          const detail = (
            e as CustomEvent<{ capabilities: Record<string, boolean> }>
          ).detail;
          onCapabilities?.(rfb, detail?.capabilities ?? {});
        });

        rfbRef.current = rfb;
      } catch (error) {
        console.error("[VncViewer] Failed to create RFB connection:", error);
        updateStatus("error");
        if (shouldReconnectRef.current) {
          scheduleReconnect();
        }
      }
    }, [
      scaleViewport,
      clipViewport,
      dragViewport,
      resizeSession,
      viewOnly,
      showDotCursor,
      qualityLevel,
      compressionLevel,
      reconnectDelay,
      updateStatus,
      scheduleReconnect,
      onConnect,
      onDisconnect,
      onCredentialsRequired,
      onSecurityFailure,
      onClipboard,
      onDesktopName,
      onCapabilities,
    ]);

    // Keep connectInternalRef updated
    useEffect(() => {
      connectInternalRef.current = connectInternal;
    }, [connectInternal]);

    // Public connect method
    const connect = useCallback(() => {
      clearReconnectTimer();
      reconnectAttemptsRef.current = 0;
      currentReconnectDelayRef.current = reconnectDelay;
      connectInternal();
    }, [clearReconnectTimer, reconnectDelay, connectInternal]);

    // Public disconnect method
    const disconnect = useCallback(() => {
      clearReconnectTimer();
      shouldReconnectRef.current = false; // Prevent auto-reconnect on explicit disconnect
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch (e) {
          console.error("[VncViewer] Error during disconnect:", e);
        }
        rfbRef.current = null;
      }
      updateStatus("disconnected");
    }, [clearReconnectTimer, updateStatus]);

    // Clipboard paste handler - syncs clipboard then sends Ctrl+V
    // Uses proper DOM key codes for QEMU extended key events
    const clipboardPaste = useCallback((text: string) => {
      const rfb = rfbRef.current;
      if (!rfb) return;

      try {
        // Sync clipboard to VNC server
        rfb.clipboardPasteFrom(text);
        console.log("[VncViewer] Clipboard synced, sending Ctrl+V...");

        // X11 keysyms (same as noVNC's KeyTable)
        const XK_Meta_L = 0xffe7;
        const XK_Meta_R = 0xffe8;
        const XK_Super_L = 0xffeb;
        const XK_Super_R = 0xffec;
        const XK_Control_L = 0xffe3;
        const XK_v = 0x0076;

        // Small delay to ensure clipboard is processed by VNC server
        setTimeout(() => {
          // Release Meta/Super keys that might be held from user's Cmd
          // (noVNC sent Meta down before we intercepted the V keydown)
          rfb.sendKey(XK_Meta_L, "MetaLeft", false);
          rfb.sendKey(XK_Meta_R, "MetaRight", false);
          rfb.sendKey(XK_Super_L, "OSLeft", false);
          rfb.sendKey(XK_Super_R, "OSRight", false);

          // Send Ctrl+V with proper DOM codes (like noVNC's sendCtrlAltDel)
          rfb.sendKey(XK_Control_L, "ControlLeft", true);
          rfb.sendKey(XK_v, "KeyV", true);
          rfb.sendKey(XK_v, "KeyV", false);
          rfb.sendKey(XK_Control_L, "ControlLeft", false);
          console.log("[VncViewer] Ctrl+V sent");
        }, 50);
      } catch (e) {
        console.error("[VncViewer] Error pasting to clipboard:", e);
      }
    }, []);

    // Send a key combo to VNC, releasing Meta/Super first (for Mac Cmd → Linux Ctrl translation)
    const sendKeyCombo = useCallback((keysym: number, code: string, withShift = false) => {
      const rfb = rfbRef.current;
      if (!rfb) return;

      // X11 keysyms for modifiers
      const XK_Shift_L = 0xffe1;
      const XK_Meta_L = 0xffe7;
      const XK_Meta_R = 0xffe8;
      const XK_Super_L = 0xffeb;
      const XK_Super_R = 0xffec;
      const XK_Control_L = 0xffe3;

      // Release Meta/Super keys that might be held from user's Cmd
      rfb.sendKey(XK_Meta_L, "MetaLeft", false);
      rfb.sendKey(XK_Meta_R, "MetaRight", false);
      rfb.sendKey(XK_Super_L, "OSLeft", false);
      rfb.sendKey(XK_Super_R, "OSRight", false);

      // Send Ctrl+<key> (with optional Shift)
      rfb.sendKey(XK_Control_L, "ControlLeft", true);
      if (withShift) rfb.sendKey(XK_Shift_L, "ShiftLeft", true);
      rfb.sendKey(keysym, code, true);
      rfb.sendKey(keysym, code, false);
      if (withShift) rfb.sendKey(XK_Shift_L, "ShiftLeft", false);
      rfb.sendKey(XK_Control_L, "ControlLeft", false);
    }, []);

    // Mac Cmd → Linux Ctrl shortcut mappings
    // Maps key to [keysym, code, requiresShift]
    const cmdToCtrlMap: Record<string, [number, string, boolean?]> = useMemo(() => ({
      // Common shortcuts
      a: [0x0061, "KeyA"],         // Select all
      c: [0x0063, "KeyC"],         // Copy
      x: [0x0078, "KeyX"],         // Cut
      z: [0x007a, "KeyZ"],         // Undo
      y: [0x0079, "KeyY"],         // Redo (alternative)
      s: [0x0073, "KeyS"],         // Save
      f: [0x0066, "KeyF"],         // Find
      g: [0x0067, "KeyG"],         // Find next
      h: [0x0068, "KeyH"],         // Replace (some apps)
      n: [0x006e, "KeyN"],         // New
      o: [0x006f, "KeyO"],         // Open
      p: [0x0070, "KeyP"],         // Print
      w: [0x0077, "KeyW"],         // Close tab/window
      t: [0x0074, "KeyT"],         // New tab
      l: [0x006c, "KeyL"],         // Focus address bar / Go to line
      r: [0x0072, "KeyR"],         // Reload
      d: [0x0064, "KeyD"],         // Bookmark / Duplicate
      b: [0x0062, "KeyB"],         // Bold
      i: [0x0069, "KeyI"],         // Italic
      u: [0x0075, "KeyU"],         // Underline
      k: [0x006b, "KeyK"],         // Kill line (terminal) / Insert link
      "/": [0x002f, "Slash"],      // Comment (IDEs)
      "[": [0x005b, "BracketLeft"], // Outdent
      "]": [0x005d, "BracketRight"], // Indent
    }), []);

    // Shortcuts that need Shift modifier (Cmd+Shift+X → Ctrl+Shift+X)
    const cmdShiftToCtrlShiftMap: Record<string, [number, string]> = useMemo(() => ({
      z: [0x007a, "KeyZ"],         // Redo
      f: [0x0066, "KeyF"],         // Find in files
      s: [0x0073, "KeyS"],         // Save as
      p: [0x0070, "KeyP"],         // Command palette (VSCode)
      g: [0x0067, "KeyG"],         // Find previous
    }), []);

    // Check if VNC viewer is focused (container or any child including canvas)
    const isVncFocused = useCallback(() => {
      const container = containerRef.current;
      if (!container) return false;
      const active = document.activeElement;
      return container === active || container.contains(active);
    }, []);

    // Send Ctrl+key combo (releasing Meta first for Mac)
    const sendCtrlKey = useCallback((keysym: number, code: string, releaseMeta = false) => {
      const rfb = rfbRef.current;
      if (!rfb) return;

      const XK_Control_L = 0xffe3;

      if (releaseMeta) {
        // Release Meta/Super keys that might be held from user's Option key
        rfb.sendKey(0xffe7, "MetaLeft", false);
        rfb.sendKey(0xffe8, "MetaRight", false);
        rfb.sendKey(0xffeb, "OSLeft", false);
        rfb.sendKey(0xffec, "OSRight", false);
        // Also release Alt since Option maps to Alt
        rfb.sendKey(0xffe9, "AltLeft", false);
        rfb.sendKey(0xffea, "AltRight", false);
      }

      rfb.sendKey(XK_Control_L, "ControlLeft", true);
      rfb.sendKey(keysym, code, true);
      rfb.sendKey(keysym, code, false);
      rfb.sendKey(XK_Control_L, "ControlLeft", false);
    }, []);

    // Intercept Mac shortcuts and translate to Linux equivalents
    // Listen at document level to intercept before browser handles them
    useEffect(() => {
      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

      const handleKeyDown = async (e: KeyboardEvent) => {
        // Only handle if VNC is focused
        if (!isVncFocused()) return;
        if (!rfbRef.current) return;

        const key = e.key.toLowerCase();

        // === Arrow key handling ===
        // Cmd+Arrow → Home/End (line) or Ctrl+Home/End (document)
        if (isMac && e.metaKey && !e.ctrlKey && !e.altKey) {
          const XK_Home = 0xff50;
          const XK_End = 0xff57;

          if (e.key === "ArrowLeft") {
            e.preventDefault();
            e.stopPropagation();
            console.log("[VncViewer] Cmd+Left → Home");
            sendKeyCombo(XK_Home, "Home");
            return;
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            console.log("[VncViewer] Cmd+Right → End");
            sendKeyCombo(XK_End, "End");
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            console.log("[VncViewer] Cmd+Up → Ctrl+Home");
            sendKeyCombo(XK_Home, "Home"); // Ctrl+Home via sendKeyCombo
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            console.log("[VncViewer] Cmd+Down → Ctrl+End");
            sendKeyCombo(XK_End, "End"); // Ctrl+End via sendKeyCombo
            return;
          }

          // Also handle Cmd+Backspace → Ctrl+U (kill to beginning of line)
          if (e.key === "Backspace") {
            e.preventDefault();
            e.stopPropagation();
            console.log("[VncViewer] Cmd+Backspace → Ctrl+U");
            sendKeyCombo(0x0075, "KeyU");
            return;
          }
        }

        // Option+Arrow → Ctrl+Arrow (word navigation)
        if (isMac && e.altKey && !e.metaKey && !e.ctrlKey) {
          const XK_Left = 0xff51;
          const XK_Right = 0xff53;

          if (e.key === "ArrowLeft") {
            e.preventDefault();
            e.stopPropagation();
            console.log("[VncViewer] Option+Left → Ctrl+Left (word left)");
            sendCtrlKey(XK_Left, "ArrowLeft", true);
            return;
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            console.log("[VncViewer] Option+Right → Ctrl+Right (word right)");
            sendCtrlKey(XK_Right, "ArrowRight", true);
            return;
          }
          // Option+Backspace → Ctrl+W (delete word backward)
          if (e.key === "Backspace") {
            e.preventDefault();
            e.stopPropagation();
            console.log("[VncViewer] Option+Backspace → Ctrl+W (delete word)");
            sendCtrlKey(0x0077, "KeyW", true);
            return;
          }
        }

        // === Cmd+<key> → Ctrl+<key> (Mac only) ===
        if (isMac && e.metaKey && !e.altKey) {
          // Special case: Cmd+V needs clipboard handling
          if (key === "v" && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            try {
              const text = await navigator.clipboard.readText();
              if (text) {
                console.log("[VncViewer] Cmd+V intercepted, pasting...");
                clipboardPaste(text);
              }
            } catch (err) {
              console.error("[VncViewer] Clipboard read failed:", err);
            }
            return;
          }

          // Cmd+Shift+<key> → Ctrl+Shift+<key>
          if (e.shiftKey && cmdShiftToCtrlShiftMap[key]) {
            e.preventDefault();
            e.stopPropagation();
            const [keysym, code] = cmdShiftToCtrlShiftMap[key];
            console.log(`[VncViewer] Cmd+Shift+${key.toUpperCase()} → Ctrl+Shift+${key.toUpperCase()}`);
            sendKeyCombo(keysym, code, true);
            return;
          }

          // Cmd+<key> → Ctrl+<key>
          if (!e.shiftKey && cmdToCtrlMap[key]) {
            e.preventDefault();
            e.stopPropagation();
            const [keysym, code] = cmdToCtrlMap[key];
            console.log(`[VncViewer] Cmd+${key.toUpperCase()} → Ctrl+${key.toUpperCase()}`);
            sendKeyCombo(keysym, code);
            return;
          }
        }

        // === Ctrl+<key> on Mac for GNU readline shortcuts ===
        // Only the common ones that browsers intercept (Ctrl+A = select all in browser)
        if (isMac && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          const readlineKeys: Record<string, [number, string]> = {
            a: [0x0061, "KeyA"], // Beginning of line
            e: [0x0065, "KeyE"], // End of line
            k: [0x006b, "KeyK"], // Kill to end of line
            u: [0x0075, "KeyU"], // Kill to beginning of line
            w: [0x0077, "KeyW"], // Delete word backward
            y: [0x0079, "KeyY"], // Yank
            l: [0x006c, "KeyL"], // Clear screen
            c: [0x0063, "KeyC"], // Interrupt (SIGINT)
            d: [0x0064, "KeyD"], // EOF / Delete char
          };

          if (readlineKeys[key]) {
            e.preventDefault();
            e.stopPropagation();
            const [keysym, code] = readlineKeys[key];
            console.log(`[VncViewer] Ctrl+${key.toUpperCase()} → Ctrl+${key.toUpperCase()}`);
            sendCtrlKey(keysym, code, false);
            return;
          }
        }
      };

      // Listen at document level with capture to intercept before browser default handlers
      document.addEventListener("keydown", handleKeyDown, { capture: true });
      return () => {
        document.removeEventListener("keydown", handleKeyDown, { capture: true });
      };
    }, [clipboardPaste, sendKeyCombo, sendCtrlKey, isVncFocused, cmdToCtrlMap, cmdShiftToCtrlShiftMap]);

    // Fallback: Document-level paste event listener
    // Handles cases where keydown might not fire (e.g., Electron menu triggers paste)
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleDocumentPaste = (e: ClipboardEvent) => {
        // Only handle if VNC container has focus
        if (!container.contains(document.activeElement)) return;
        if (!rfbRef.current) return;

        const text =
          e.clipboardData?.getData("text/plain") ||
          e.clipboardData?.getData("text");
        if (text) {
          console.log("[VncViewer] Document paste event intercepted");
          e.preventDefault();
          e.stopPropagation();
          clipboardPaste(text);
        }
      };

      // Capture phase to intercept before other handlers
      document.addEventListener("paste", handleDocumentPaste, { capture: true });
      return () => document.removeEventListener("paste", handleDocumentPaste, { capture: true });
    }, [clipboardPaste]);

    // Focus the canvas
    const focus = useCallback(() => {
      rfbRef.current?.focus();
    }, []);

    // Blur the canvas
    const blur = useCallback(() => {
      rfbRef.current?.blur();
    }, []);

    // Expose imperative handle
    useImperativeHandle(
      ref,
      () => ({
        connect,
        disconnect,
        getStatus: () => status,
        isConnected: () => status === "connected",
        clipboardPaste,
        sendCtrlAltDel: () => rfbRef.current?.sendCtrlAltDel(),
        sendKey: (keysym, code, down) =>
          rfbRef.current?.sendKey(keysym, code, down),
        focus,
        blur,
        getRfb: () => rfbRef.current,
        machineShutdown: () => rfbRef.current?.machineShutdown(),
        machineReboot: () => rfbRef.current?.machineReboot(),
        machineReset: () => rfbRef.current?.machineReset(),
      }),
      [connect, disconnect, status, clipboardPaste, focus, blur]
    );

    // Auto-connect on mount
    useEffect(() => {
      isUnmountedRef.current = false;

      if (autoConnect) {
        // Small delay to ensure DOM is ready
        const timer = setTimeout(() => {
          if (!isUnmountedRef.current) {
            connect();
          }
        }, 100);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [autoConnect, connect]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        isUnmountedRef.current = true;
        clearReconnectTimer();
        if (rfbRef.current) {
          try {
            rfbRef.current.disconnect();
          } catch (e) {
            console.error("[VncViewer] Error during unmount cleanup:", e);
          }
          rfbRef.current = null;
        }
      };
    }, [clearReconnectTimer]);

    // Reconnect when URL changes
    useEffect(() => {
      if (status === "connected" || status === "connecting") {
        // URL changed, reconnect
        console.log("[VncViewer] URL changed, reconnecting...");
        connect();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url]);


    // Handle container click for focus
    const handleContainerClick = useCallback(() => {
      if (focusOnClick && rfbRef.current) {
        focus();
      }
    }, [focusOnClick, focus]);

    // Compute what to render
    const showLoading = status === "connecting" || status === "disconnected";
    const showError = status === "error";

    // Default loading fallback
    const defaultLoadingFallback = useMemo(
      () => (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
            <span className="text-sm text-neutral-400">
              {status === "connecting"
                ? "Connecting to remote desktop..."
                : "Waiting for connection..."}
            </span>
          </div>
        </div>
      ),
      [status]
    );

    // Default error fallback
    const defaultErrorFallback = useMemo(
      () => (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-red-400">
              Failed to connect to remote desktop
            </span>
            <button
              type="button"
              onClick={connect}
              className="mt-2 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
            >
              Retry
            </button>
          </div>
        </div>
      ),
      [connect]
    );

    // Prevent Electron's context menu so noVNC can handle right-clicks
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
    }, []);

    return (
      <div
        className={clsx("relative overflow-hidden", className)}
        style={{ background, ...style }}
        onClick={handleContainerClick}
        onContextMenu={handleContextMenu}
      >
        {/* VNC Canvas Container */}
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ background }}
          tabIndex={0}
        />

        {/* Loading Overlay */}
        {showLoading && (loadingFallback ?? defaultLoadingFallback)}

        {/* Error Overlay */}
        {showError && (errorFallback ?? defaultErrorFallback)}
      </div>
    );
  }
);

export default VncViewer;
