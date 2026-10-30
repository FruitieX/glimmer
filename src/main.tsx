import {
  createContext,
  lazy,
  StrictMode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Code2,
  Lightbulb,
  LogOut,
  Router as RouterIcon,
  WifiOff,
} from "lucide-react";
import { api, post, type AppState, type AuthStatus } from "./api";
import { startLive, useConnected, useOnChange } from "./live";
import { Button, cx, ToastProvider } from "./components/ui";
import { LightsPage } from "./pages/Lights";
import { LightPage } from "./pages/Light";
import { EffectsPage } from "./pages/Effects";
import { StringsPage } from "./pages/Strings";
import "./styles.css";

const EditorPage = lazy(() =>
  import("./pages/Editor").then((m) => ({ default: m.EditorPage })),
);

// ---- Routing ----

const RouteContext = createContext<{
  path: string;
  navigate: (to: string) => void;
}>({
  path: "/",
  navigate: () => {},
});

export function useRoute() {
  return useContext(RouteContext);
}

export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const { navigate } = useRoute();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ---- App state ----

const StateContext = createContext<{
  state: AppState;
  reload: () => Promise<void>;
} | null>(null);

export function useApp() {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("no app state");
  return ctx;
}

function Shell({ children, user }: { children: ReactNode; user: string }) {
  const { path } = useRoute();
  const connected = useConnected();
  const nav = [
    {
      to: "/",
      label: "Lights",
      icon: Lightbulb,
      active: path === "/" || path.startsWith("/lights"),
    },
    {
      to: "/effects",
      label: "Effects",
      icon: Code2,
      active: path.startsWith("/effects"),
    },
    {
      to: "/strings",
      label: "Strings",
      icon: RouterIcon,
      active: path.startsWith("/strings"),
    },
  ];
  return (
    <div className="min-h-dvh pb-24 md:pb-10">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-ink/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Link
            to="/"
            className="flex items-center gap-2.5 font-semibold tracking-tight"
          >
            <img
              src="/icon.svg"
              alt=""
              width={30}
              height={30}
              className="rounded-lg"
            />
            <span className="text-[17px]">Twinkly</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cx(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
                  n.active
                    ? "bg-raised text-white"
                    : "text-muted hover:text-white",
                )}
              >
                <n.icon size={16} />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {!connected && (
              <span className="flex items-center gap-1.5 text-xs text-warn">
                <WifiOff size={14} /> Reconnecting…
              </span>
            )}
            <span className="hidden text-sm text-muted sm:block">{user}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Sign out"
              onClick={async () => {
                await post("/auth/logout");
                location.href = "/";
              }}
            >
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line/60 bg-ink/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className={cx(
              "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
              n.active ? "text-glow" : "text-muted",
            )}
          >
            <n.icon size={20} />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function SignIn({ auth }: { auth: AuthStatus }) {
  const params = new URLSearchParams(location.search);
  const problem = params.get("signin");
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <img
          src="/icon.svg"
          alt=""
          width={72}
          height={72}
          className="mx-auto rounded-2xl shadow-[0_0_60px_-10px_rgb(255_181_71/0.6)]"
        />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Twinkly</h1>
        <p className="mt-2 text-sm text-muted">
          Animations for the house's LED strings.
        </p>
        {problem && (
          <p className="mt-6 rounded-xl bg-bad/10 px-4 py-3 text-sm text-bad">
            {problem === "not-allowed"
              ? "Your account doesn't have access to this app."
              : "Signing in didn't work. Please try again."}
          </p>
        )}
        <div className="mt-8 space-y-3">
          {auth.oidc && (
            <a href="/auth/login" className="block">
              <Button variant="primary" className="w-full">
                Sign in with passkey
              </Button>
            </a>
          )}
          {auth.devLogin && (
            <a href="/auth/dev" className="block">
              <Button className="w-full">Sign in for development</Button>
            </a>
          )}
          {!auth.oidc && !auth.devLogin && (
            <p className="text-sm text-muted">
              No sign-in method is configured.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Pages() {
  const { path } = useRoute();
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "lights" && parts[1]) return <LightPage id={parts[1]} />;
  if (parts[0] === "effects" && parts[1])
    return (
      <Suspense
        fallback={
          <div className="py-20 text-center text-sm text-muted">
            Loading editor…
          </div>
        }
      >
        <EditorPage id={parts[1]} />
      </Suspense>
    );
  if (parts[0] === "effects") return <EffectsPage />;
  if (parts[0] === "strings") return <StringsPage />;
  return <LightsPage />;
}

function App() {
  const [path, setPath] = useState(location.pathname);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    history.pushState(null, "", to);
    setPath(new URL(to, location.href).pathname);
    scrollTo({ top: 0 });
  }, []);

  const reload = useCallback(async () => {
    try {
      setState(await api<AppState>("/state"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    api<AuthStatus>("/auth/status").then(setAuth, () =>
      setAuth({ user: null, oidc: false, devLogin: false }),
    );
  }, []);
  useEffect(() => {
    if (auth?.user) {
      startLive();
      reload();
    }
  }, [auth, reload]);
  useOnChange(reload);

  if (!auth) return null;
  if (!auth.user) return <SignIn auth={auth} />;
  if (!state)
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">
        {error ?? "Loading…"}
      </div>
    );
  return (
    <RouteContext.Provider value={{ path, navigate }}>
      <StateContext.Provider value={{ state, reload }}>
        <Shell user={state.user}>
          <Pages />
        </Shell>
      </StateContext.Provider>
    </RouteContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
